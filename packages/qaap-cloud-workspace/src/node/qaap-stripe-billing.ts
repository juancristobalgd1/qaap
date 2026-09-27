// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as crypto from 'crypto';
import type { QaapBillingPlanId } from '../common/qaap-billing-plans';

export type QaapPayablePlanId = Extract<QaapBillingPlanId, 'pro' | 'team'>;

export function isQaapPayablePlanId(value: string): value is QaapPayablePlanId {
    return value === 'pro' || value === 'team';
}

export function isStripeBillingConfigured(): boolean {
    return Boolean(
        process.env.STRIPE_SECRET_KEY?.trim()
        && process.env.STRIPE_PRICE_PRO_MONTHLY?.trim()
        && process.env.STRIPE_PRICE_TEAM_MONTHLY?.trim(),
    );
}

/** Local-only plan switch when Stripe keys are absent (QAAP_SKIP_AUTH / QAAP_BILLING_DEV_CHECKOUT). */
export function isBillingDevActivateEnabled(): boolean {
    if (process.env.QAAP_BILLING_DEV_CHECKOUT === '1' || process.env.QAAP_BILLING_DEV_CHECKOUT === 'true') {
        return true;
    }
    return process.env.QAAP_SKIP_AUTH === '1' || process.env.QAAP_SKIP_AUTH === 'true';
}

export function stripePriceIdForPlan(planId: QaapPayablePlanId): string | undefined {
    const raw = planId === 'pro'
        ? process.env.STRIPE_PRICE_PRO_MONTHLY
        : process.env.STRIPE_PRICE_TEAM_MONTHLY;
    const priceId = raw?.trim();
    return priceId || undefined;
}

export function resolveBillingPublicOrigin(reqOrigin: string | undefined, reqReferer: string | undefined): string {
    const configured = process.env.QAAP_PUBLIC_URL?.trim() || process.env.THEIA_HOST?.trim();
    if (configured) {
        return configured.replace(/\/$/, '');
    }
    if (reqOrigin?.trim()) {
        return reqOrigin.trim().replace(/\/$/, '');
    }
    if (reqReferer?.trim()) {
        try {
            return new URL(reqReferer).origin;
        } catch {
            /* fall through */
        }
    }
    return 'http://localhost:3000';
}

function formBody(fields: Record<string, string | undefined>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined && value !== '') {
            params.set(key, value);
        }
    }
    return params.toString();
}

export async function createSubscriptionCheckoutSession(options: {
    readonly login: string;
    readonly planId: QaapPayablePlanId;
    readonly origin: string;
    readonly customerId?: string;
}): Promise<{ readonly url: string; readonly sessionId: string }> {
    const secret = process.env.STRIPE_SECRET_KEY?.trim();
    const priceId = stripePriceIdForPlan(options.planId);
    if (!secret || !priceId) {
        throw new Error(`Missing Stripe configuration for plan ${options.planId}`);
    }
    const successUrl = `${options.origin}/?qaapBilling=success&plan=${options.planId}&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${options.origin}/?qaapBilling=cancel`;
    const body = formBody({
        mode: 'subscription',
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: options.login,
        customer: options.customerId,
        'line_items[0][price]': priceId,
        'line_items[0][quantity]': '1',
        'metadata[login]': options.login,
        'metadata[planId]': options.planId,
        'subscription_data[metadata][login]': options.login,
        'subscription_data[metadata][planId]': options.planId,
        allow_promotion_codes: 'true',
    });
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${secret}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
    });
    const json = await response.json() as { id?: string; url?: string; error?: { message?: string } };
    if (!response.ok || !json.url || !json.id) {
        throw new Error(json.error?.message || `Stripe Checkout failed (${response.status})`);
    }
    return { url: json.url, sessionId: json.id };
}

export interface QaapStripeCheckoutSessionObject {
    readonly id?: string;
    readonly mode?: string;
    readonly status?: string | null;
    readonly payment_status?: string | null;
    readonly client_reference_id?: string | null;
    readonly customer?: string | { readonly id?: string } | null;
    readonly subscription?: string | { readonly id?: string } | null;
    readonly metadata?: Record<string, string> | null;
}

export interface QaapStripeSubscriptionObject {
    readonly metadata?: Record<string, string> | null;
}

export interface QaapStripeEvent {
    readonly type: string;
    readonly data: {
        readonly object: QaapStripeCheckoutSessionObject | QaapStripeSubscriptionObject;
    };
}

/** True when Checkout finished successfully enough to grant entitlements. */
export function isCheckoutSessionPaid(session: QaapStripeCheckoutSessionObject): boolean {
    return session.payment_status === 'paid' || session.status === 'complete';
}

/** Fetch a Checkout Session by id (server-side Stripe secret). */
export async function retrieveCheckoutSession(sessionId: string): Promise<QaapStripeCheckoutSessionObject> {
    const secret = process.env.STRIPE_SECRET_KEY?.trim();
    if (!secret) {
        throw new Error('Missing STRIPE_SECRET_KEY');
    }
    const id = sessionId.trim();
    if (!id || !/^cs_[A-Za-z0-9_]+$/.test(id)) {
        throw new Error('Invalid Checkout session id');
    }
    const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(id)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${secret}` },
    });
    const json = await response.json() as QaapStripeCheckoutSessionObject & { error?: { message?: string } };
    if (!response.ok) {
        throw new Error(json.error?.message || `Stripe session retrieve failed (${response.status})`);
    }
    return json;
}

export function verifyStripeWebhookEvent(
    payload: Buffer,
    signatureHeader: string,
    webhookSecret: string,
    toleranceSec: number = 300,
): QaapStripeEvent {
    const parts = signatureHeader.split(',').map(part => part.trim());
    let timestamp = '';
    const signatures: string[] = [];
    for (const part of parts) {
        const [key, value] = part.split('=');
        if (key === 't') {
            timestamp = value ?? '';
        } else if (key === 'v1' && value) {
            signatures.push(value);
        }
    }
    if (!timestamp || signatures.length === 0) {
        throw new Error('Invalid Stripe signature header');
    }
    const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
    if (!Number.isFinite(age) || age > toleranceSec) {
        throw new Error('Stripe signature timestamp outside tolerance');
    }
    const expected = crypto
        .createHmac('sha256', webhookSecret)
        .update(`${timestamp}.${payload.toString('utf8')}`, 'utf8')
        .digest('hex');
    const valid = signatures.some(sig => {
        try {
            return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(sig, 'utf8'));
        } catch {
            return false;
        }
    });
    if (!valid) {
        throw new Error('Stripe signature mismatch');
    }
    return JSON.parse(payload.toString('utf8')) as QaapStripeEvent;
}

export function extractCheckoutPlanAndLogin(session: QaapStripeCheckoutSessionObject): {
    readonly login: string | undefined;
    readonly planId: QaapPayablePlanId | undefined;
} {
    const login = (session.client_reference_id || session.metadata?.login || '').trim() || undefined;
    const fromMeta = session.metadata?.planId?.trim();
    if (fromMeta && isQaapPayablePlanId(fromMeta)) {
        return { login, planId: fromMeta };
    }
    return { login, planId: undefined };
}

export function stripeCustomerIdFromSession(session: QaapStripeCheckoutSessionObject): string | undefined {
    if (typeof session.customer === 'string') {
        return session.customer;
    }
    return session.customer?.id;
}

export function stripeSubscriptionIdFromSession(session: QaapStripeCheckoutSessionObject): string | undefined {
    if (typeof session.subscription === 'string') {
        return session.subscription;
    }
    return session.subscription?.id;
}
