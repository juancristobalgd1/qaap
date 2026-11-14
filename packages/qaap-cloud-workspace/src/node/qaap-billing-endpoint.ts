// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Application, Request, Response } from '@theia/core/shared/express';
import { json, raw } from 'body-parser';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { QaapGithubAuthGuard } from '@theia/qaap-shared-core/lib/node/qaap-github-auth-guard';
import { QaapAsyncRoute } from '@theia/qaap-shared-core/lib/node/qaap-async-route';
import { QaapExpressRouteOrder } from '@theia/qaap-shared-core/lib/node/qaap-express-route-order';
import {
    QAAP_BILLING_API_PATH,
    QAAP_BILLING_CANCEL_API_PATH,
    QAAP_BILLING_CHECKOUT_API_PATH,
    QAAP_BILLING_CONFIRM_CHECKOUT_API_PATH,
    QAAP_BILLING_DEV_ACTIVATE_API_PATH,
    QAAP_BILLING_WEBHOOK_API_PATH,
} from '../common/qaap-cloud-api-types';
import {
    QAAP_BILLING_PLANS,
    entitlementsFor,
    isQaapBillingPlanId,
    type QaapBillingAccount,
    type QaapBillingPlanId,
    type QaapBillingSubscriptionStatus,
} from '../common/qaap-billing-plans';
import {
    airwallexSubscriptionIdFromEvent,
    cancelAirwallexSubscription,
    createAirwallexSubscriptionCheckout,
    fetchAirwallexCheckout,
    fetchAirwallexSubscription,
    isAirwallexBillingConfigured,
    isBillingDevActivateEnabled,
    resolveBillingPublicOrigin,
    verifyAirwallexWebhook,
    type QaapAirwallexSubscriptionState,
    type QaapAirwallexWebhookEvent,
} from './qaap-airwallex-billing';
import { QaapBillingStore, type QaapAirwallexSubscriptionUpdate } from './qaap-billing-store';

const CHECKOUT_PLAN_IDS: readonly QaapBillingPlanId[] = ['starter', 'pro'];

/** Subscription states that still bill the account: a checkout for the same plan is refused, and a replaced one is cancelled. */
const PAYING_SUBSCRIPTION_STATUSES: readonly string[] = ['active', 'past_due'];

const unixSecondsNow = (): number => Math.floor(Date.now() / 1000);

/**
 * Billing entitlements + hosted Airwallex subscription checkout for the Starter and Pro monthly plans.
 * Subscription state is always re-read from Airwallex before it is applied, so a webhook, a confirm
 * and a cancel all converge on the provider's current state.
 */
@injectable()
export class QaapBillingEndpoint implements BackendApplicationContribution {

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    @inject(QaapBillingStore)
    protected readonly store: QaapBillingStore;

    /** Event ids being handled right now, so a concurrent redelivery is not applied twice. */
    protected readonly billingEventsInFlight = new Set<string>();

    configure(app: Application): void {
        // Webhook must receive the raw body for signature verification.
        app.post(
            QAAP_BILLING_WEBHOOK_API_PATH,
            raw({ type: 'application/json' }),
            QaapAsyncRoute.wrap('qaap-billing', (req, res) => this.handleWebhook(req, res)),
        );
        // An earlier global `json()` (upstream `@theia/filesystem`) would consume the stream before `raw()` runs.
        QaapExpressRouteOrder.moveLastRouteFirst(app, 'qaap-billing-webhook');
        app.use(json());
        app.get(QAAP_BILLING_API_PATH, QaapAsyncRoute.wrap('qaap-billing', (req, res) => this.handleGet(req, res)));
        app.post(QAAP_BILLING_CHECKOUT_API_PATH, QaapAsyncRoute.wrap('qaap-billing', (req, res) => this.handleCheckout(req, res)));
        app.post(QAAP_BILLING_CONFIRM_CHECKOUT_API_PATH, QaapAsyncRoute.wrap('qaap-billing', (req, res) => this.handleConfirmCheckout(req, res)));
        app.post(QAAP_BILLING_CANCEL_API_PATH, QaapAsyncRoute.wrap('qaap-billing', (req, res) => this.handleCancel(req, res)));
        app.post(QAAP_BILLING_DEV_ACTIVATE_API_PATH, QaapAsyncRoute.wrap('qaap-billing', (req, res) => this.handleDevActivate(req, res)));
    }

    protected billingSnapshot(login: string, account: Awaited<ReturnType<QaapBillingStore['getOrCreateAccount']>>): object {
        const checkoutEnabled = isAirwallexBillingConfigured();
        return {
            account,
            entitlements: entitlementsFor(account),
            catalog: {
                plans: QAAP_BILLING_PLANS,
            },
            checkout: {
                checkoutEnabled,
                devActivateEnabled: !checkoutEnabled && isBillingDevActivateEnabled(this.auth.isSkipAuthEnabled()),
                payablePlanIds: [...CHECKOUT_PLAN_IDS],
            },
        };
    }

    protected async handleGet(req: Request, res: Response): Promise<void> {
        const login = this.requireLogin(req, res);
        if (!login) {
            return;
        }
        const account = await this.store.getOrCreateAccount(login);
        res.json(this.billingSnapshot(login, account));
    }

    protected async handleCheckout(req: Request, res: Response): Promise<void> {
        const login = this.requireLogin(req, res);
        if (!login) {
            return;
        }
        const planIdRaw = typeof req.body?.planId === 'string' ? req.body.planId.trim() : '';
        if (!isQaapBillingPlanId(planIdRaw)) {
            res.status(400).json({ error: 'planId must be "starter" or "pro"' });
            return;
        }
        if (!isAirwallexBillingConfigured()) {
            res.status(503).json({
                error: 'checkout_not_configured',
                message: 'Airwallex billing is not configured. Set AIRWALLEX_CLIENT_ID, AIRWALLEX_API_KEY, AIRWALLEX_PRICE_STARTER_MONTHLY and AIRWALLEX_PRICE_PRO_MONTHLY.',
                devActivateEnabled: isBillingDevActivateEnabled(this.auth.isSkipAuthEnabled()),
            });
            return;
        }
        const current = await this.store.getOrCreateAccount(login);
        if (current.planId === planIdRaw && this.isPayingSubscription(current)) {
            // Re-buying the plan already paid for would create a second subscription that bills alongside it.
            res.status(409).json({ error: 'already_subscribed' });
            return;
        }
        const origin = resolveBillingPublicOrigin(
            typeof req.headers.origin === 'string' ? req.headers.origin : undefined,
            typeof req.headers.referer === 'string' ? req.headers.referer : undefined,
        );
        if (!origin) {
            res.status(503).json({
                error: 'public_url_not_configured',
                message: 'Set QAAP_PUBLIC_URL to the public https origin before enabling checkout.',
            });
            return;
        }
        try {
            const checkout = await createAirwallexSubscriptionCheckout({ login, planId: planIdRaw, origin });
            res.json({ url: checkout.url, checkoutId: checkout.id });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Checkout failed';
            res.status(500).json({ error: 'checkout_failed', message });
        }
    }

    /**
     * After the hosted checkout returns with `?checkout=<id>`, the browser confirms it so entitlements update
     * without waiting for the webhook. The checkout must belong to this login and carry a subscription, and
     * the subscription's authoritative state is what gets applied. Idempotent with the webhook.
     */
    protected async handleConfirmCheckout(req: Request, res: Response): Promise<void> {
        const login = this.requireLogin(req, res);
        if (!login) {
            return;
        }
        if (!isAirwallexBillingConfigured()) {
            res.status(503).json({ error: 'checkout_not_configured' });
            return;
        }
        const checkoutId = typeof req.body?.checkoutId === 'string' ? req.body.checkoutId.trim() : '';
        if (!checkoutId) {
            res.status(400).json({ error: 'checkoutId_required' });
            return;
        }
        try {
            // Captured before the provider reads: a webhook that fetched an older state and applies later is stale.
            const readAt = unixSecondsNow();
            const checkout = await fetchAirwallexCheckout(checkoutId);
            if (checkout.login !== login) {
                res.status(403).json({ error: 'session_login_mismatch' });
                return;
            }
            if (!checkout.planId) {
                res.status(400).json({ error: 'session_missing_plan' });
                return;
            }
            if (!checkout.subscriptionId) {
                res.status(409).json({ error: 'checkout_not_complete', status: checkout.status });
                return;
            }
            const subscription = await fetchAirwallexSubscription(checkout.subscriptionId);
            if (subscription.status === 'pending') {
                res.status(409).json({ error: 'checkout_not_complete', status: checkout.status });
                return;
            }
            const previous = await this.store.getOrCreateAccount(login);
            const result = await this.store.applyAirwallexSubscription(login, {
                status: subscription.status,
                planId: checkout.planId,
                customerId: subscription.customerId ?? checkout.customerId,
                subscriptionId: subscription.subscriptionId,
                eventCreated: readAt,
                adoptSubscription: true,
            });
            await this.cancelSupersededSubscription(previous, result, subscription.status);
            res.json(this.billingSnapshot(login, result.account));
        } catch (error) {
            const message = error instanceof Error ? error.message : 'confirm_failed';
            res.status(500).json({ error: 'confirm_failed', message });
        }
    }

    /** Cancels the signed-in account's subscription at Airwallex, then applies the re-read state. */
    protected async handleCancel(req: Request, res: Response): Promise<void> {
        const login = this.requireLogin(req, res);
        if (!login) {
            return;
        }
        if (!isAirwallexBillingConfigured()) {
            res.status(503).json({ error: 'checkout_not_configured' });
            return;
        }
        const current = await this.store.getOrCreateAccount(login);
        if (!current.subscriptionId) {
            res.status(404).json({ error: 'no_subscription' });
            return;
        }
        try {
            await cancelAirwallexSubscription(current.subscriptionId);
            const readAt = unixSecondsNow();
            const subscription = await fetchAirwallexSubscription(current.subscriptionId);
            const { account } = await this.store.applyAirwallexSubscription(login, this.toSubscriptionUpdate(subscription, readAt));
            res.json(this.billingSnapshot(login, account));
        } catch (error) {
            const message = error instanceof Error ? error.message : 'cancel_failed';
            res.status(502).json({ error: 'cancel_failed', message });
        }
    }

    protected async handleDevActivate(req: Request, res: Response): Promise<void> {
        const login = this.requireLogin(req, res);
        if (!login) {
            return;
        }
        if (isAirwallexBillingConfigured() || !isBillingDevActivateEnabled(this.auth.isSkipAuthEnabled())) {
            res.status(403).json({ error: 'dev_activate_disabled' });
            return;
        }
        const planIdRaw = typeof req.body?.planId === 'string' ? req.body.planId.trim() : '';
        if (!isQaapBillingPlanId(planIdRaw)) {
            res.status(400).json({ error: 'planId must be "starter" or "pro"' });
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
        const webhookSecret = process.env.AIRWALLEX_WEBHOOK_SECRET?.trim();
        if (!webhookSecret) {
            res.status(503).json({ error: 'webhook_not_configured' });
            return;
        }
        if (!Buffer.isBuffer(req.body)) {
            // Another parser consumed the stream first: the signed bytes are gone, so nothing can be verified.
            res.status(400).json({ error: 'webhook_body_unavailable' });
            return;
        }
        let event: QaapAirwallexWebhookEvent;
        try {
            event = verifyAirwallexWebhook(req.body, req.headers, webhookSecret);
        } catch {
            res.status(400).json({ error: 'invalid_signature' });
            return;
        }

        const eventId = typeof event.id === 'string' && event.id ? event.id : undefined;
        if (eventId && this.billingEventsInFlight.has(eventId)) {
            // The first delivery may still fail: answer non-2xx so the provider retries instead of dropping it.
            res.status(409).json({ error: 'event_in_progress' });
            return;
        }
        if (eventId && await this.store.hasProcessedBillingEvent(eventId)) {
            res.json({ received: true, duplicate: true });
            return;
        }
        if (eventId) {
            this.billingEventsInFlight.add(eventId);
        }
        try {
            await this.applyAirwallexEvent(event);
            if (eventId) {
                // Only after success: a failed delivery must stay retryable.
                await this.store.markBillingEventProcessed(eventId);
            }
            res.json({ received: true });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'webhook_failed';
            res.status(500).json({ error: message });
        } finally {
            if (eventId) {
                this.billingEventsInFlight.delete(eventId);
            }
        }
    }

    /**
     * Event names are not fully documented, so the event only selects a subscription id. The subscription is
     * then re-fetched and its current state applied; the event payload is never trusted for the state itself.
     */
    protected async applyAirwallexEvent(event: QaapAirwallexWebhookEvent): Promise<void> {
        const subscriptionId = airwallexSubscriptionIdFromEvent(event);
        if (!subscriptionId) {
            return;
        }
        const readAt = unixSecondsNow();
        const subscription = await fetchAirwallexSubscription(subscriptionId);
        const metadataLogin = subscription.login
            ?? await this.store.findLoginByAirwallexSubscription(subscription.subscriptionId);
        const checkoutLogin = metadataLogin ? undefined : await this.loginFromCheckoutEvent(event, subscription.subscriptionId);
        const login = metadataLogin ?? checkoutLogin;
        if (!login) {
            return;
        }
        // Only a checkout that points at this subscription may move the account onto it. Plain updates of a
        // subscription the account no longer uses (e.g. the superseded one) are ignored by the store.
        const adoptSubscription = checkoutLogin !== undefined && subscription.status === 'active';
        const previous = await this.store.getOrCreateAccount(login);
        const result = await this.store.applyAirwallexSubscription(login, {
            ...this.toSubscriptionUpdate(subscription, readAt),
            adoptSubscription,
        });
        await this.cancelSupersededSubscription(previous, result, subscription.status);
    }

    protected isPayingSubscription(account: QaapBillingAccount): boolean {
        return !!account.subscriptionId
            && account.subscriptionStatus !== undefined
            && PAYING_SUBSCRIPTION_STATUSES.includes(account.subscriptionStatus);
    }

    /**
     * Cancels the subscription the account paid for before a new one took over. Runs only after the new
     * subscription is applied and active, so a failed cancel leaves the new plan in place: it is logged and
     * the caller still succeeds. The provider's later CANCELLED for the old subscription is ignored by the store.
     */
    protected async cancelSupersededSubscription(
        previous: QaapBillingAccount,
        result: { readonly applied: boolean; readonly account: QaapBillingAccount },
        status: QaapBillingSubscriptionStatus,
    ): Promise<void> {
        const supersededId = previous.subscriptionId;
        if (!result.applied || status !== 'active' || !supersededId || !this.isPayingSubscription(previous)
            || !result.account.subscriptionId || result.account.subscriptionId === supersededId) {
            return;
        }
        try {
            await cancelAirwallexSubscription(supersededId);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'cancel_failed';
            console.warn(`[qaap-billing] could not cancel superseded subscription ${supersededId}: ${message}`);
        }
    }

    /**
     * Airwallex may not copy the checkout metadata onto the subscription, and the buyer may never come back
     * to confirm. For checkout events the checkout itself is re-fetched: its metadata carries the login we
     * stamped at creation, and it must point at the same subscription.
     */
    protected async loginFromCheckoutEvent(event: QaapAirwallexWebhookEvent, subscriptionId: string): Promise<string | undefined> {
        const objectId = event.data?.object?.id;
        if (typeof objectId !== 'string' || !objectId.startsWith('bco_')) {
            return undefined;
        }
        const checkout = await fetchAirwallexCheckout(objectId);
        return checkout.subscriptionId === subscriptionId ? checkout.login : undefined;
    }

    protected toSubscriptionUpdate(
        subscription: QaapAirwallexSubscriptionState,
        readAt: number,
    ): QaapAirwallexSubscriptionUpdate {
        return {
            status: subscription.status,
            planId: subscription.planId,
            subscriptionId: subscription.subscriptionId,
            customerId: subscription.customerId,
            eventCreated: readAt,
        };
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
