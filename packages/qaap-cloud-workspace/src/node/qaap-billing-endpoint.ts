// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Application, Request, Response } from '@theia/core/shared/express';
import { json, raw } from 'body-parser';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { QaapGithubAuthGuard } from '@theia/qaap-mobile-shell/lib/node/qaap-github-auth-guard';
import {
    QAAP_BILLING_API_PATH,
    QAAP_BILLING_CHECKOUT_API_PATH,
    QAAP_BILLING_DEV_ACTIVATE_API_PATH,
    QAAP_BILLING_WEBHOOK_API_PATH,
} from '../common/qaap-cloud-api-types';
import { QAAP_BILLING_PLANS, QAAP_CODEX_HOSTED_RATES, QAAP_RUNTIME_PACKS, entitlementsFor } from '../common/qaap-billing-plans';
import { QaapBillingStore } from './qaap-billing-store';
import {
    createSubscriptionCheckoutSession,
    extractCheckoutPlanAndLogin,
    isBillingDevActivateEnabled,
    isQaapPayablePlanId,
    isStripeBillingConfigured,
    resolveBillingPublicOrigin,
    stripeCustomerIdFromSession,
    stripeSubscriptionIdFromSession,
    verifyStripeWebhookEvent,
    type QaapStripeCheckoutSessionObject,
    type QaapStripeSubscriptionObject,
} from './qaap-stripe-billing';

/** Billing entitlements + Stripe Checkout for Pro / Team monthly subscriptions. */
@injectable()
export class QaapBillingEndpoint implements BackendApplicationContribution {

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    @inject(QaapBillingStore)
    protected readonly store: QaapBillingStore;

    configure(app: Application): void {
        // Webhook must receive the raw body for signature verification.
        app.post(
            QAAP_BILLING_WEBHOOK_API_PATH,
            raw({ type: 'application/json' }),
            (req, res) => void this.handleWebhook(req, res),
        );
        app.use(json());
        app.get(QAAP_BILLING_API_PATH, (req, res) => void this.handleGet(req, res));
        app.post(QAAP_BILLING_CHECKOUT_API_PATH, (req, res) => void this.handleCheckout(req, res));
        app.post(QAAP_BILLING_DEV_ACTIVATE_API_PATH, (req, res) => void this.handleDevActivate(req, res));
    }

    protected async handleGet(req: Request, res: Response): Promise<void> {
        const login = this.requireLogin(req, res);
        if (!login) {
            return;
        }
        const account = await this.store.getOrCreateAccount(login);
        res.json({
            account,
            entitlements: entitlementsFor(account),
            catalog: {
                plans: QAAP_BILLING_PLANS,
                runtimePacks: QAAP_RUNTIME_PACKS,
                hostedModels: QAAP_CODEX_HOSTED_RATES,
            },
            checkout: {
                stripeEnabled: isStripeBillingConfigured(),
                devActivateEnabled: !isStripeBillingConfigured() && isBillingDevActivateEnabled(),
                payablePlanIds: ['pro', 'team'],
            },
        });
    }

    protected async handleCheckout(req: Request, res: Response): Promise<void> {
        const login = this.requireLogin(req, res);
        if (!login) {
            return;
        }
        const planIdRaw = typeof req.body?.planId === 'string' ? req.body.planId.trim() : '';
        if (!isQaapPayablePlanId(planIdRaw)) {
            res.status(400).json({ error: 'planId must be "pro" or "team"' });
            return;
        }
        if (!isStripeBillingConfigured()) {
            res.status(503).json({
                error: 'stripe_not_configured',
                message: 'Stripe is not configured. Set STRIPE_SECRET_KEY and STRIPE_PRICE_*_MONTHLY.',
                devActivateEnabled: isBillingDevActivateEnabled(),
            });
            return;
        }
        try {
            const account = await this.store.getOrCreateAccount(login);
            const origin = resolveBillingPublicOrigin(
                typeof req.headers.origin === 'string' ? req.headers.origin : undefined,
                typeof req.headers.referer === 'string' ? req.headers.referer : undefined,
            );
            const session = await createSubscriptionCheckoutSession({
                login,
                planId: planIdRaw,
                origin,
                customerId: account.stripeCustomerId,
            });
            res.json({ url: session.url, sessionId: session.sessionId });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Checkout failed';
            res.status(500).json({ error: 'checkout_failed', message });
        }
    }

    protected async handleDevActivate(req: Request, res: Response): Promise<void> {
        const login = this.requireLogin(req, res);
        if (!login) {
            return;
        }
        if (isStripeBillingConfigured() || !isBillingDevActivateEnabled()) {
            res.status(403).json({ error: 'dev_activate_disabled' });
            return;
        }
        const planIdRaw = typeof req.body?.planId === 'string' ? req.body.planId.trim() : '';
        if (planIdRaw !== 'starter' && !isQaapPayablePlanId(planIdRaw)) {
            res.status(400).json({ error: 'planId must be "starter", "pro", or "team"' });
            return;
        }
        const account = await this.store.setPlan(
            login,
            planIdRaw,
            planIdRaw === 'starter' ? { clearSubscription: true } : undefined,
        );
        res.json({
            account,
            entitlements: entitlementsFor(account),
        });
    }

    protected async handleWebhook(req: Request, res: Response): Promise<void> {
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
        if (!webhookSecret) {
            res.status(503).json({ error: 'stripe_webhook_not_configured' });
            return;
        }
        const signature = req.headers['stripe-signature'];
        if (typeof signature !== 'string') {
            res.status(400).json({ error: 'missing_signature' });
            return;
        }
        let event;
        try {
            const payload = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body ?? ''), 'utf8');
            event = verifyStripeWebhookEvent(payload, signature, webhookSecret);
        } catch {
            res.status(400).json({ error: 'invalid_signature' });
            return;
        }

        try {
            if (event.type === 'checkout.session.completed') {
                const session = event.data.object as QaapStripeCheckoutSessionObject;
                if (session.mode === 'subscription') {
                    const { login, planId } = extractCheckoutPlanAndLogin(session);
                    if (login && planId) {
                        await this.store.setPlan(login, planId, {
                            customerId: stripeCustomerIdFromSession(session),
                            subscriptionId: stripeSubscriptionIdFromSession(session),
                        });
                    }
                }
            } else if (event.type === 'customer.subscription.deleted') {
                const subscription = event.data.object as QaapStripeSubscriptionObject;
                const login = subscription.metadata?.login?.trim();
                if (login) {
                    await this.store.setPlan(login, 'starter', { clearSubscription: true });
                }
            }
            res.json({ received: true });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'webhook_failed';
            res.status(500).json({ error: message });
        }
    }

    protected requireLogin(req: Request, res: Response): string | undefined {
        const ctx = this.auth.authenticate(req);
        if (ctx.kind === 'unauthorized') {
            res.status(401).json({ error: 'Not signed in' });
            return undefined;
        }
        const login = this.auth.resolveUserLogin(ctx);
        if (!login) {
            res.status(401).json({ error: 'Not signed in' });
            return undefined;
        }
        return login;
    }
}
