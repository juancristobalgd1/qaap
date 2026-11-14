// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as crypto from 'crypto';
import {
    isQaapBillingPlanId,
    type QaapBillingPlanId,
    type QaapBillingSubscriptionStatus,
} from '../common/qaap-billing-plans';
import { isQaapHostedOrTenantBackendRuntime } from './qaap-docker-control-plane';

/** Airwallex calls are on the Checkout path: fail fast instead of holding the browser request open. */
const AIRWALLEX_REQUEST_TIMEOUT_MS = 20_000;
const TOKEN_REFRESH_MARGIN_MS = 60_000;
const TOKEN_FALLBACK_TTL_MS = 25 * 60_000;
/** Webhook deliveries older or further in the future than this are rejected (replay protection). */
const WEBHOOK_TOLERANCE_MS = 5 * 60_000;
const AIRWALLEX_ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;

/** Error from an Airwallex REST call. The message comes from Airwallex; credentials are never included. */
export class AirwallexApiError extends Error {
    readonly status: number;
    readonly code?: string;

    constructor(message: string, status: number, code?: string) {
        super(message);
        this.name = 'AirwallexApiError';
        this.status = status;
        this.code = code;
    }
}

export type QaapWebhookHeaders = Readonly<Record<string, string | string[] | undefined>>;

/** Webhook envelope. Event names are not fully documented, so only the fields read here are typed. */
export interface QaapAirwallexWebhookEvent {
    readonly id?: string;
    readonly name?: string;
    readonly type?: string;
    readonly data?: { readonly object?: Record<string, unknown> | null } | null;
}

export interface QaapAirwallexSubscriptionState {
    readonly subscriptionId: string;
    readonly customerId?: string;
    readonly status: QaapBillingSubscriptionStatus;
    /** Plan of the price the subscription bills (or its `planId` metadata). */
    readonly planId?: QaapBillingPlanId;
    /** Login stamped in the checkout metadata, when the subscription carries it. */
    readonly login?: string;
    readonly currentPeriodEnd?: string;
}

export interface QaapAirwallexCheckoutState {
    readonly checkoutId: string;
    readonly status?: string;
    readonly subscriptionId?: string;
    readonly customerId?: string;
    readonly login?: string;
    readonly planId?: QaapBillingPlanId;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
    const value = record?.[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Airwallex stores a Subscription's price in `price_id`, or in the first line item. */
function airwallexSubscriptionPriceId(raw: Record<string, unknown>): string | undefined {
    const lineItems = Array.isArray(raw.line_items) ? raw.line_items as unknown[] : [];
    return stringField(asRecord(raw), 'price_id') ?? stringField(asRecord(lineItems[0]), 'price_id');
}

// ---------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------

/** REST base: `AIRWALLEX_API_BASE` wins, then `AIRWALLEX_ENV=prod` selects production, demo otherwise. */
export function airwallexApiBase(env: NodeJS.ProcessEnv = process.env): string {
    const override = env.AIRWALLEX_API_BASE?.trim();
    if (override) {
        return override.replace(/\/$/, '');
    }
    const environment = env.AIRWALLEX_ENV?.trim().toLowerCase();
    return environment === 'prod' || environment === 'production'
        ? 'https://api.airwallex.com'
        : 'https://api-demo.airwallex.com';
}

function airwallexCredentials(env: NodeJS.ProcessEnv = process.env): { readonly clientId: string; readonly apiKey: string } | undefined {
    const clientId = env.AIRWALLEX_CLIENT_ID?.trim();
    const apiKey = env.AIRWALLEX_API_KEY?.trim();
    return clientId && apiKey ? { clientId, apiKey } : undefined;
}

export function airwallexPriceIdForPlan(planId: QaapBillingPlanId, env: NodeJS.ProcessEnv = process.env): string | undefined {
    const raw = planId === 'pro' ? env.AIRWALLEX_PRICE_PRO_MONTHLY : env.AIRWALLEX_PRICE_STARTER_MONTHLY;
    return raw?.trim() || undefined;
}

/**
 * The Airwallex account that collects the payment. Required by Airwallex when the organization has more
 * than one linked payment account ("Need to specify the linked_payment_account_id"); optional otherwise.
 */
export function airwallexLinkedPaymentAccountId(env: NodeJS.ProcessEnv = process.env): string | undefined {
    return env.AIRWALLEX_LINKED_PAYMENT_ACCOUNT_ID?.trim() || undefined;
}

export function airwallexPlanForPriceId(priceId: string | undefined, env: NodeJS.ProcessEnv = process.env): QaapBillingPlanId | undefined {
    if (!priceId) {
        return undefined;
    }
    if (priceId === airwallexPriceIdForPlan('pro', env)) {
        return 'pro';
    }
    if (priceId === airwallexPriceIdForPlan('starter', env)) {
        return 'starter';
    }
    return undefined;
}

/** Hosted checkout needs client credentials and a monthly price for each paid plan. */
export function isAirwallexBillingConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
    return Boolean(
        airwallexCredentials(env)
        && airwallexPriceIdForPlan('starter', env)
        && airwallexPriceIdForPlan('pro', env),
    );
}

/**
 * Local-only plan switch when Airwallex is not configured (skip-auth or QAAP_BILLING_DEV_CHECKOUT).
 * Never in a production/hosted runtime or a tenant backend: there it would hand out paid plans for free. Pass
 * `QaapGithubAuthGuard.isSkipAuthEnabled()`, which already refuses skip-auth in production,
 * rather than reading QAAP_SKIP_AUTH here.
 */
export function isBillingDevActivateEnabled(skipAuthEnabled: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
    if (isQaapHostedOrTenantBackendRuntime(env)) {
        return false;
    }
    return skipAuthEnabled || env.QAAP_BILLING_DEV_CHECKOUT === '1' || env.QAAP_BILLING_DEV_CHECKOUT === 'true';
}

/**
 * Origin for the Checkout return URLs. A hosted or tenant runtime only trusts `QAAP_PUBLIC_URL`
 * and answers `undefined` without it: the request's `Origin`/`Referer` are client-controlled and would
 * let a caller send the paid redirect anywhere. Local development keeps the request fallbacks.
 */
export function resolveBillingPublicOrigin(
    reqOrigin: string | undefined,
    reqReferer: string | undefined,
    env: NodeJS.ProcessEnv = process.env,
): string | undefined {
    const publicUrl = env.QAAP_PUBLIC_URL?.trim();
    if (publicUrl) {
        return publicUrl.replace(/\/$/, '');
    }
    if (isQaapHostedOrTenantBackendRuntime(env)) {
        return undefined;
    }
    const configured = env.THEIA_HOST?.trim();
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

// ---------------------------------------------------------------------------------------------
// Authentication and token cache
// ---------------------------------------------------------------------------------------------

interface CachedAirwallexToken {
    readonly token: string;
    readonly expiresAt: number;
}

/** Keyed by base URL and client id, so a credential or environment change never reuses a token. */
const tokenCache = new Map<string, CachedAirwallexToken>();

export function clearAirwallexTokenCache(): void {
    tokenCache.clear();
}

/**
 * Airwallex returns offsets as "+0000", which `Date.parse` does not always accept: normalise to "+00:00".
 */
function parseAirwallexExpiresAt(value: unknown): number | undefined {
    if (typeof value !== 'string' || value.length === 0) {
        return undefined;
    }
    const parsed = Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
    return Number.isFinite(parsed) ? parsed : undefined;
}

async function readAirwallexJson(response: Response): Promise<Record<string, unknown>> {
    const text = await response.text();
    if (!text) {
        return {};
    }
    try {
        return asRecord(JSON.parse(text) as unknown) ?? {};
    } catch {
        return {};
    }
}

function airwallexErrorFrom(response: Response, body: Record<string, unknown>): AirwallexApiError {
    const message = stringField(body, 'message') ?? `Airwallex request failed with status ${response.status}`;
    return new AirwallexApiError(message, response.status, stringField(body, 'code'));
}

async function airwallexAccessToken(now: number = Date.now()): Promise<string> {
    const credentials = airwallexCredentials();
    if (!credentials) {
        throw new AirwallexApiError('Airwallex billing is not configured', 503, 'checkout_not_configured');
    }
    const base = airwallexApiBase();
    const key = `${base}|${credentials.clientId}`;
    const cached = tokenCache.get(key);
    if (cached && now < cached.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
        return cached.token;
    }
    const response = await fetch(`${base}/api/v1/authentication/login`, {
        method: 'POST',
        headers: {
            'x-client-id': credentials.clientId,
            'x-api-key': credentials.apiKey,
        },
        signal: AbortSignal.timeout(AIRWALLEX_REQUEST_TIMEOUT_MS),
    });
    const body = await readAirwallexJson(response);
    if (!response.ok) {
        tokenCache.delete(key);
        throw airwallexErrorFrom(response, body);
    }
    const token = stringField(body, 'token');
    if (!token) {
        throw new AirwallexApiError('Airwallex login response did not include a token', response.status);
    }
    tokenCache.set(key, {
        token,
        expiresAt: parseAirwallexExpiresAt(body.expires_at) ?? now + TOKEN_FALLBACK_TTL_MS,
    });
    return token;
}

/** Authenticated REST call. A 401 drops the cached token and retries exactly once with a fresh login. */
async function airwallexRequest(
    method: 'GET' | 'POST',
    path: string,
    payload: object | undefined,
    retryUnauthorized: boolean = true,
): Promise<Record<string, unknown>> {
    const token = await airwallexAccessToken();
    const headers: Record<string, string> = {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
    };
    if (payload !== undefined) {
        headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(`${airwallexApiBase()}${path}`, {
        method,
        headers,
        body: payload !== undefined ? JSON.stringify(payload) : undefined,
        signal: AbortSignal.timeout(AIRWALLEX_REQUEST_TIMEOUT_MS),
    });
    const body = await readAirwallexJson(response);
    if (response.status === 401 && retryUnauthorized) {
        clearAirwallexTokenCache();
        return airwallexRequest(method, path, payload, false);
    }
    if (!response.ok) {
        throw airwallexErrorFrom(response, body);
    }
    return body;
}

function assertAirwallexId(id: string): string {
    const trimmed = id.trim();
    if (!AIRWALLEX_ID_PATTERN.test(trimmed)) {
        throw new AirwallexApiError('Invalid Airwallex object id', 400, 'invalid_id');
    }
    return trimmed;
}

// ---------------------------------------------------------------------------------------------
// Checkout, subscriptions and mapping
// ---------------------------------------------------------------------------------------------

/**
 * Creates a hosted subscription checkout for a plan's monthly price. Airwallex rejects template
 * placeholders in `success_url` ("must be a valid URL"), so the checkout is created with a plain return
 * URL and then, best effort, updated to carry its own id as `?checkout=`; without it the return path
 * polls the entitlements, which the webhook also updates.
 */
export async function createAirwallexSubscriptionCheckout(options: {
    readonly login: string;
    readonly planId: QaapBillingPlanId;
    readonly origin: string;
}): Promise<{ readonly id: string; readonly url: string }> {
    const priceId = airwallexPriceIdForPlan(options.planId);
    if (!priceId) {
        throw new AirwallexApiError(`Missing Airwallex price for plan ${options.planId}`, 503, 'checkout_not_configured');
    }
    const linkedPaymentAccountId = airwallexLinkedPaymentAccountId();
    const successUrl = `${options.origin}/?qaapBilling=success&plan=${options.planId}`;
    const body = await airwallexRequest('POST', '/api/v1/billing/billing_checkouts/create', {
        request_id: crypto.randomUUID(),
        ...(linkedPaymentAccountId ? { linked_payment_account_id: linkedPaymentAccountId } : {}),
        mode: 'SUBSCRIPTION',
        line_items: [{ price_id: priceId, quantity: 1 }],
        success_url: successUrl,
        back_url: `${options.origin}/?qaapBilling=cancel`,
        metadata: { qaapLogin: options.login, planId: options.planId },
        customer_data: { name: options.login },
        // Required for SUBSCRIPTION mode; the billing cycle comes from the recurring price.
        subscription_data: { metadata: { qaapLogin: options.login, planId: options.planId } },
    }).catch(error => {
        if (!linkedPaymentAccountId && error instanceof AirwallexApiError && /linked_payment_account_id/i.test(error.message)) {
            // A configuration gap, not a transient failure: say exactly which variable fixes it.
            throw new AirwallexApiError(
                'Airwallex needs the collecting account: set AIRWALLEX_LINKED_PAYMENT_ACCOUNT_ID (Airwallex → Settings → Account details → Account ID).',
                503,
                'checkout_not_configured',
            );
        }
        throw error;
    });
    const id = stringField(body, 'id');
    const url = stringField(body, 'url');
    if (!id || !url) {
        throw new AirwallexApiError('Airwallex checkout response is missing id or url', 502);
    }
    await airwallexRequest('POST', `/api/v1/billing/billing_checkouts/${encodeURIComponent(id)}/update`, {
        success_url: `${successUrl}&checkout=${encodeURIComponent(id)}`,
    }).catch(() => undefined);
    return { id, url };
}

export function mapAirwallexCheckout(raw: Record<string, unknown>): QaapAirwallexCheckoutState {
    const checkoutId = stringField(raw, 'id');
    if (!checkoutId) {
        throw new AirwallexApiError('Airwallex checkout response is missing id', 502);
    }
    const metadata = asRecord(raw.metadata);
    const metadataPlan = stringField(metadata, 'planId');
    return {
        checkoutId,
        status: stringField(raw, 'status'),
        subscriptionId: stringField(raw, 'subscription_id'),
        customerId: stringField(raw, 'customer_id'),
        login: stringField(metadata, 'qaapLogin'),
        planId: metadataPlan && isQaapBillingPlanId(metadataPlan) ? metadataPlan : undefined,
    };
}

export async function fetchAirwallexCheckout(checkoutId: string): Promise<QaapAirwallexCheckoutState> {
    const id = assertAirwallexId(checkoutId);
    const raw = await airwallexRequest('GET', `/api/v1/billing/billing_checkouts/${encodeURIComponent(id)}`, undefined);
    return mapAirwallexCheckout(raw);
}

/**
 * Airwallex subscription status → Qaap status. Unknown statuses map to `pending`, which never changes the plan.
 */
export function airwallexSubscriptionStatus(status: unknown): QaapBillingSubscriptionStatus {
    const normalized = typeof status === 'string' ? status.trim().toUpperCase() : '';
    if (normalized === 'ACTIVE' || normalized === 'IN_TRIAL') {
        return 'active';
    }
    if (normalized === 'UNPAID') {
        return 'past_due';
    }
    if (normalized === 'CANCELLED' || normalized === 'CANCELED') {
        return 'canceled';
    }
    return 'pending';
}

export function mapAirwallexSubscription(raw: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env): QaapAirwallexSubscriptionState {
    const subscriptionId = stringField(raw, 'id');
    if (!subscriptionId) {
        throw new AirwallexApiError('Airwallex subscription response is missing id', 502);
    }
    const metadata = asRecord(raw.metadata);
    const metadataPlan = stringField(metadata, 'planId');
    const planId = airwallexPlanForPriceId(airwallexSubscriptionPriceId(raw), env)
        ?? (metadataPlan && isQaapBillingPlanId(metadataPlan) ? metadataPlan : undefined);
    return {
        subscriptionId,
        customerId: stringField(raw, 'customer_id'),
        status: airwallexSubscriptionStatus(raw.status),
        planId,
        login: stringField(metadata, 'qaapLogin'),
        currentPeriodEnd: stringField(raw, 'current_period_ends_at'),
    };
}

/** Fetches the subscription itself: the source of truth for webhooks and confirm. */
export async function fetchAirwallexSubscription(subscriptionId: string): Promise<QaapAirwallexSubscriptionState> {
    const id = assertAirwallexId(subscriptionId);
    const raw = await airwallexRequest('GET', `/api/v1/billing/subscriptions/${encodeURIComponent(id)}`, undefined);
    return mapAirwallexSubscription(raw);
}

/** Cancels the subscription. Callers re-fetch the subscription afterwards to apply its authoritative state. */
export async function cancelAirwallexSubscription(subscriptionId: string): Promise<void> {
    const id = assertAirwallexId(subscriptionId);
    await airwallexRequest('POST', `/api/v1/billing/subscriptions/${encodeURIComponent(id)}/cancel`, {
        request_id: crypto.randomUUID(),
        proration_behavior: 'NONE',
    });
}

// ---------------------------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------------------------

function headerValue(headers: QaapWebhookHeaders, name: string): string | undefined {
    const value = headers[name];
    const first = Array.isArray(value) ? value[0] : value;
    return first?.trim() || undefined;
}

/**
 * Verifies `x-signature` = hex HMAC-SHA256 of `x-timestamp` followed by the raw body, keyed with the
 * webhook secret, then parses the body. Throws on any failure. The timestamp may be Unix milliseconds
 * (as documented for Airwallex) or seconds.
 */
export function verifyAirwallexWebhook(
    rawBody: Buffer,
    headers: QaapWebhookHeaders,
    secret: string,
    now: number = Date.now(),
): QaapAirwallexWebhookEvent {
    const timestamp = headerValue(headers, 'x-timestamp');
    const signature = headerValue(headers, 'x-signature');
    if (!secret || !timestamp || !signature || !/^\d+$/.test(timestamp)) {
        throw new Error('Invalid Airwallex webhook signature');
    }
    const signedAt = timestamp.length <= 10 ? Number(timestamp) * 1000 : Number(timestamp);
    if (!Number.isSafeInteger(signedAt) || Math.abs(now - signedAt) > WEBHOOK_TOLERANCE_MS) {
        throw new Error('Airwallex webhook timestamp outside tolerance');
    }
    const expected = crypto
        .createHmac('sha256', secret)
        .update(timestamp, 'utf8')
        .update(rawBody)
        .digest('hex');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const providedBuffer = Buffer.from(signature.toLowerCase(), 'utf8');
    if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
        throw new Error('Invalid Airwallex webhook signature');
    }
    return JSON.parse(rawBody.toString('utf8')) as QaapAirwallexWebhookEvent;
}

/**
 * Subscription id an event refers to: `subscription_id` on checkout/invoice-style objects, or the object's
 * own id when the event name is about a subscription. Other events return `undefined` and are ignored.
 */
export function airwallexSubscriptionIdFromEvent(event: QaapAirwallexWebhookEvent): string | undefined {
    const object = event.data?.object;
    if (!object) {
        return undefined;
    }
    const direct = stringField(object, 'subscription_id');
    if (direct) {
        return direct;
    }
    const eventName = `${event.name ?? ''} ${event.type ?? ''}`.toLowerCase();
    return eventName.includes('subscription') ? stringField(object, 'id') : undefined;
}
