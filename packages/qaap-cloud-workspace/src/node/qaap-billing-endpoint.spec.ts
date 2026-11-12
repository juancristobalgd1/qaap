// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as crypto from 'crypto';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { json } from 'body-parser';
import * as express from '@theia/core/shared/express';
import { QAAP_BILLING_CANCEL_API_PATH, QAAP_BILLING_CONFIRM_CHECKOUT_API_PATH, QAAP_BILLING_WEBHOOK_API_PATH } from '../common/qaap-cloud-api-types';
import { clearAirwallexTokenCache } from './qaap-airwallex-billing';
import { QaapBillingEndpoint } from './qaap-billing-endpoint';

const AIRWALLEX_ENV_KEYS = [
    'AIRWALLEX_CLIENT_ID', 'AIRWALLEX_API_KEY', 'AIRWALLEX_WEBHOOK_SECRET', 'AIRWALLEX_PRICE_STARTER_MONTHLY',
    'AIRWALLEX_PRICE_PRO_MONTHLY', 'AIRWALLEX_API_BASE', 'AIRWALLEX_ENV',
] as const;

const WEBHOOK_SECRET = 'whsec_test_secret';

/** Routes a stubbed `fetch` by `METHOD /path`. Unknown routes answer 404 so a stray call fails loudly. */
function stubAirwallexFetch(routes: Record<string, unknown>, calls: string[]): () => void {
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        const key = `${init?.method ?? 'GET'} ${url.pathname}`;
        calls.push(key);
        if (!(key in routes)) {
            return new Response(JSON.stringify({ message: 'not found' }), { status: 404 });
        }
        return new Response(JSON.stringify(routes[key]), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    return () => { globalThis.fetch = original; };
}

const LOGIN_ROUTE = {
    'POST /api/v1/authentication/login': { token: 'tok_test', expires_at: '2099-01-01T00:00:00+0000' },
};

const makeRes = (): { statusCode?: number; body?: unknown; status: (code: number) => { json: (b: unknown) => void }; json: (b: unknown) => void } => {
    const res: {
        statusCode?: number;
        body?: unknown;
        status: (code: number) => { json: (b: unknown) => void };
        json: (b: unknown) => void;
    } = {
        status(code: number) {
            res.statusCode = code;
            return { json: (b: unknown) => { res.body = b; } };
        },
        json(b: unknown) {
            res.statusCode = 200;
            res.body = b;
        },
    };
    return res;
};

describe('QaapBillingEndpoint auth gate', () => {

    it('GET returns 401 without a session', async () => {
        const endpoint = Object.create(QaapBillingEndpoint.prototype) as QaapBillingEndpoint;
        Object.assign(endpoint, {
            auth: {
                authenticate: () => ({ kind: 'unauthorized' }),
                resolveUserLogin: () => undefined,
            },
        });
        const res = makeRes();
        await (endpoint as unknown as { handleGet(req: object, response: typeof res): Promise<void> }).handleGet({}, res);
        expect(res.statusCode).to.equal(401);
    });

    describe('dev-activate', () => {
        const ENV_KEYS = [
            'NODE_ENV', 'QAAP_CLOUD_MODE', 'QAAP_SKIP_AUTH', 'QAAP_BILLING_DEV_CHECKOUT', 'QAAP_TENANT_BACKEND_MODE',
            ...AIRWALLEX_ENV_KEYS,
        ] as const;
        const savedEnv = new Map<string, string | undefined>(ENV_KEYS.map(key => [key, process.env[key]]));

        beforeEach(() => {
            for (const key of ENV_KEYS) {
                delete process.env[key];
            }
        });

        afterEach(() => {
            for (const [key, value] of savedEnv) {
                if (value === undefined) {
                    delete process.env[key];
                } else {
                    process.env[key] = value;
                }
            }
        });

        async function devActivate(skipAuthEnabled: boolean): Promise<{ statusCode?: number; plans: string[] }> {
            const plans: string[] = [];
            const endpoint = Object.create(QaapBillingEndpoint.prototype) as QaapBillingEndpoint;
            Object.assign(endpoint, {
                auth: {
                    authenticate: () => ({ kind: 'authenticated', userLogin: 'mallory' }),
                    resolveUserLogin: () => 'mallory',
                    isSkipAuthEnabled: () => skipAuthEnabled,
                },
                store: {
                    setPlan: async (_login: string, plan: string) => {
                        plans.push(plan);
                        return { login: 'mallory', planId: plan };
                    },
                },
            });
            const res = makeRes();
            await (endpoint as unknown as { handleDevActivate(req: object, response: typeof res): Promise<void> })
                .handleDevActivate({ body: { planId: 'pro' } }, res);
            return { statusCode: res.statusCode, plans };
        }

        it('is refused in production even when QAAP_SKIP_AUTH and QAAP_BILLING_DEV_CHECKOUT are set', async () => {
            process.env.NODE_ENV = 'production';
            process.env.QAAP_SKIP_AUTH = 'true';
            process.env.QAAP_BILLING_DEV_CHECKOUT = '1';
            expect(await devActivate(false)).to.deep.equal({ statusCode: 403, plans: [] });
        });

        it('is refused in a hosted cloud mode with the dev-checkout flag', async () => {
            process.env.QAAP_CLOUD_MODE = 'docker';
            process.env.QAAP_BILLING_DEV_CHECKOUT = 'true';
            expect(await devActivate(true)).to.deep.equal({ statusCode: 403, plans: [] });
        });

        it('is refused on a tenant backend, which runs with NODE_ENV=development and QAAP_CLOUD_MODE=local', async () => {
            process.env.NODE_ENV = 'development';
            process.env.QAAP_CLOUD_MODE = 'local';
            process.env.QAAP_TENANT_BACKEND_MODE = '1';
            process.env.QAAP_BILLING_DEV_CHECKOUT = '1';
            expect(await devActivate(true)).to.deep.equal({ statusCode: 403, plans: [] });
        });

        it('ignores a raw QAAP_SKIP_AUTH that the auth guard does not honour', async () => {
            process.env.QAAP_SKIP_AUTH = 'true';
            expect(await devActivate(false)).to.deep.equal({ statusCode: 403, plans: [] });
        });

        it('is refused while Airwallex billing is configured', async () => {
            process.env.AIRWALLEX_CLIENT_ID = 'cid';
            process.env.AIRWALLEX_API_KEY = 'key';
            process.env.AIRWALLEX_PRICE_STARTER_MONTHLY = 'price_starter';
            process.env.AIRWALLEX_PRICE_PRO_MONTHLY = 'price_pro';
            expect(await devActivate(true)).to.deep.equal({ statusCode: 403, plans: [] });
        });

        it('still switches plans locally under skip-auth or the dev-checkout flag', async () => {
            expect(await devActivate(true)).to.deep.equal({ statusCode: 200, plans: ['pro'] });
            process.env.QAAP_BILLING_DEV_CHECKOUT = '1';
            expect(await devActivate(false)).to.deep.equal({ statusCode: 200, plans: ['pro'] });
        });
    });
});

describe('QaapBillingEndpoint Airwallex webhook', () => {

    let server: http.Server | undefined;
    let savedEnv: Map<string, string | undefined>;
    let restoreFetch: (() => void) | undefined;
    let fetchCalls: string[];

    const subscription = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
        id: 'sub_1',
        status: 'ACTIVE',
        customer_id: 'cus_1',
        price_id: 'price_pro',
        metadata: {},
        current_period_ends_at: '2099-01-01T00:00:00+0000',
        ...overrides,
    });

    beforeEach(() => {
        savedEnv = new Map(AIRWALLEX_ENV_KEYS.map(key => [key, process.env[key]]));
        process.env.AIRWALLEX_WEBHOOK_SECRET = WEBHOOK_SECRET;
        process.env.AIRWALLEX_CLIENT_ID = 'cid_test';
        process.env.AIRWALLEX_API_KEY = 'key_test';
        process.env.AIRWALLEX_PRICE_STARTER_MONTHLY = 'price_starter';
        process.env.AIRWALLEX_PRICE_PRO_MONTHLY = 'price_pro';
        process.env.AIRWALLEX_API_BASE = 'https://airwallex.test';
        clearAirwallexTokenCache();
        fetchCalls = [];
    });

    afterEach(async () => {
        restoreFetch?.();
        restoreFetch = undefined;
        for (const [key, value] of savedEnv) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
        clearAirwallexTokenCache();
        await new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve());
        server = undefined;
    });

    const post = async (app: express.Application, payload: string, headers: Record<string, string>): Promise<{ status: number; body: string }> => {
        server = http.createServer(app);
        await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
        const port = (server.address() as AddressInfo).port;
        return new Promise((resolve, reject) => {
            const request = http.request({
                host: '127.0.0.1',
                port,
                method: 'POST',
                path: QAAP_BILLING_WEBHOOK_API_PATH,
                headers: { 'content-type': 'application/json', ...headers },
            }, response => {
                let body = '';
                response.setEncoding('utf8');
                response.on('data', chunk => { body += chunk; });
                response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
            });
            request.once('error', reject);
            request.end(payload);
        });
    };

    /** Airwallex signing: hex HMAC-SHA256 over `x-timestamp` followed by the raw body. */
    const signHeaders = (payload: string, options: { key?: string; timestampMs?: number } = {}): Record<string, string> => {
        const timestamp = String(options.timestampMs ?? Date.now());
        const signature = crypto.createHmac('sha256', options.key ?? WEBHOOK_SECRET)
            .update(timestamp, 'utf8')
            .update(payload, 'utf8')
            .digest('hex');
        return { 'x-timestamp': timestamp, 'x-signature': signature };
    };

    /** Mirrors production: upstream `@theia/filesystem` installs a global `json()` before Qaap contributions. */
    const appWithEarlierJsonParser = (
        applyCalls: unknown[][],
        processed: Set<string> = new Set(),
        logins: Record<string, string> = {},
    ): express.Application => {
        const app = express();
        app.use(json());
        const endpoint = new QaapBillingEndpoint();
        Object.assign(endpoint, {
            store: {
                applyAirwallexSubscription: async (...args: unknown[]) => { applyCalls.push(args); return { applied: true, account: {} }; },
                findLoginByAirwallexSubscription: async (id: string) => logins[id],
                hasProcessedBillingEvent: async (id: string) => processed.has(id),
                markBillingEventProcessed: async (id: string) => { processed.add(id); },
            },
        });
        endpoint.configure(app);
        return app;
    };

    const deliver = async (app: express.Application, event: object, headers?: Record<string, string>): Promise<{ status: number; body: string }> => {
        const payload = JSON.stringify(event);
        const response = await post(app, payload, headers ?? signHeaders(payload));
        await new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve());
        server = undefined;
        return response;
    };

    it('verifies the signature against the raw bytes after an earlier global json() parser, then re-fetches the subscription', async () => {
        restoreFetch = stubAirwallexFetch({
            ...LOGIN_ROUTE,
            'GET /api/v1/billing/subscriptions/sub_1': subscription({ metadata: { qaapLogin: 'octocat', planId: 'pro' } }),
        }, fetchCalls);
        const calls: unknown[][] = [];
        // Pretty-printed: re-serialising a parsed body would not reproduce these bytes.
        const payload = JSON.stringify({
            id: 'evt_1',
            name: 'billing_checkout.completed',
            data: { object: { id: 'bco_1', subscription_id: 'sub_1' } },
        }, undefined, 2) + '\n';
        const response = await post(appWithEarlierJsonParser(calls), payload, signHeaders(payload));
        expect(response.status).to.equal(200);
        expect(JSON.parse(response.body)).to.deep.equal({ received: true });
        expect(fetchCalls).to.include('GET /api/v1/billing/subscriptions/sub_1');
        expect(calls).to.have.length(1);
        expect(calls[0][0]).to.equal('octocat');
        expect(calls[0][1]).to.include({ status: 'active', planId: 'pro', subscriptionId: 'sub_1', customerId: 'cus_1' });
    });

    it('applies the re-read state of an ACTIVE subscription to the account that owns it', async () => {
        restoreFetch = stubAirwallexFetch({
            ...LOGIN_ROUTE,
            'GET /api/v1/billing/subscriptions/sub_1': subscription({ status: 'ACTIVE', price_id: 'price_pro' }),
        }, fetchCalls);
        const calls: unknown[][] = [];
        const response = await deliver(appWithEarlierJsonParser(calls, new Set(), { sub_1: 'octocat' }), {
            id: 'evt_active', name: 'subscription.updated', data: { object: { id: 'sub_1' } },
        });
        expect(response.status).to.equal(200);
        expect(calls).to.have.length(1);
        expect(calls[0][0]).to.equal('octocat');
        expect(calls[0][1]).to.include({ status: 'active', planId: 'pro', subscriptionId: 'sub_1' });
    });

    it('attributes a checkout event by re-reading the checkout when the subscription carries no login', async () => {
        restoreFetch = stubAirwallexFetch({
            ...LOGIN_ROUTE,
            'GET /api/v1/billing/subscriptions/sub_1': subscription({ status: 'ACTIVE', price_id: 'price_pro' }),
            'GET /api/v1/billing/billing_checkouts/bco_9': {
                id: 'bco_9', status: 'COMPLETED', subscription_id: 'sub_1', metadata: { qaapLogin: 'octocat', planId: 'pro' },
            },
        }, fetchCalls);
        const calls: unknown[][] = [];
        const response = await deliver(appWithEarlierJsonParser(calls), {
            id: 'evt_bco', name: 'billing_checkout.completed', data: { object: { id: 'bco_9', subscription_id: 'sub_1' } },
        });
        expect(response.status).to.equal(200);
        expect(fetchCalls).to.include('GET /api/v1/billing/billing_checkouts/bco_9');
        expect(calls).to.have.length(1);
        expect(calls[0][0]).to.equal('octocat');
    });

    it('ignores a checkout whose subscription differs from the event subscription', async () => {
        restoreFetch = stubAirwallexFetch({
            ...LOGIN_ROUTE,
            'GET /api/v1/billing/subscriptions/sub_1': subscription({ status: 'ACTIVE', price_id: 'price_pro' }),
            'GET /api/v1/billing/billing_checkouts/bco_9': {
                id: 'bco_9', status: 'COMPLETED', subscription_id: 'sub_other', metadata: { qaapLogin: 'mallory', planId: 'pro' },
            },
        }, fetchCalls);
        const calls: unknown[][] = [];
        const response = await deliver(appWithEarlierJsonParser(calls), {
            id: 'evt_bco2', name: 'billing_checkout.completed', data: { object: { id: 'bco_9', subscription_id: 'sub_1' } },
        });
        expect(response.status).to.equal(200);
        expect(calls).to.have.length(0);
    });

    it('maps UNPAID to past_due, which the store turns into Starter', async () => {
        restoreFetch = stubAirwallexFetch({
            ...LOGIN_ROUTE,
            'GET /api/v1/billing/subscriptions/sub_1': subscription({ status: 'UNPAID', price_id: 'price_pro' }),
        }, fetchCalls);
        const calls: unknown[][] = [];
        const response = await deliver(appWithEarlierJsonParser(calls, new Set(), { sub_1: 'octocat' }), {
            id: 'evt_unpaid', name: 'subscription.updated', data: { object: { id: 'sub_1' } },
        });
        expect(response.status).to.equal(200);
        expect(calls[0][1]).to.include({ status: 'past_due', subscriptionId: 'sub_1' });
    });

    it('maps CANCELLED to canceled, which the store turns into Starter', async () => {
        restoreFetch = stubAirwallexFetch({
            ...LOGIN_ROUTE,
            'GET /api/v1/billing/subscriptions/sub_1': subscription({ status: 'CANCELLED', price_id: 'price_pro' }),
        }, fetchCalls);
        const calls: unknown[][] = [];
        const response = await deliver(appWithEarlierJsonParser(calls, new Set(), { sub_1: 'octocat' }), {
            id: 'evt_cancelled', name: 'subscription.cancelled', data: { object: { id: 'sub_1' } },
        });
        expect(response.status).to.equal(200);
        expect(calls[0][1]).to.include({ status: 'canceled', subscriptionId: 'sub_1' });
    });

    it('ignores events that do not refer to a subscription, without calling Airwallex', async () => {
        restoreFetch = stubAirwallexFetch({ ...LOGIN_ROUTE }, fetchCalls);
        const calls: unknown[][] = [];
        const processed = new Set<string>();
        const response = await deliver(appWithEarlierJsonParser(calls, processed), {
            id: 'evt_payment', name: 'payment_intent.succeeded', data: { object: { id: 'pi_1' } },
        });
        expect(response.status).to.equal(200);
        expect(fetchCalls).to.have.length(0);
        expect(calls).to.have.length(0);
        expect(processed.has('evt_payment')).to.equal(true);
    });

    it('rejects a payload signed with another secret', async () => {
        const calls: unknown[][] = [];
        const payload = JSON.stringify({ id: 'evt_2', name: 'subscription.updated', data: { object: { id: 'sub_1' } } });
        const response = await post(appWithEarlierJsonParser(calls), payload, signHeaders(payload, { key: 'whsec_other' }));
        expect(response.status).to.equal(400);
        expect(JSON.parse(response.body)).to.deep.equal({ error: 'invalid_signature' });
        expect(calls).to.have.length(0);
    });

    it('rejects a payload whose tampered body no longer matches the signature', async () => {
        const calls: unknown[][] = [];
        const signed = JSON.stringify({ id: 'evt_t', name: 'subscription.updated', data: { object: { id: 'sub_1' } } });
        const tampered = signed.replace('sub_1', 'sub_9');
        const response = await post(appWithEarlierJsonParser(calls), tampered, signHeaders(signed));
        expect(response.status).to.equal(400);
        expect(JSON.parse(response.body)).to.deep.equal({ error: 'invalid_signature' });
        expect(calls).to.have.length(0);
    });

    it('rejects a stale timestamp outside the five minute tolerance', async () => {
        const calls: unknown[][] = [];
        const payload = JSON.stringify({ id: 'evt_stale', name: 'subscription.updated', data: { object: { id: 'sub_1' } } });
        const response = await post(
            appWithEarlierJsonParser(calls),
            payload,
            signHeaders(payload, { timestampMs: Date.now() - 10 * 60_000 }),
        );
        expect(response.status).to.equal(400);
        expect(JSON.parse(response.body)).to.deep.equal({ error: 'invalid_signature' });
        expect(calls).to.have.length(0);
    });

    it('rejects a request without signature headers', async () => {
        const payload = JSON.stringify({ id: 'evt_nosig', name: 'subscription.updated', data: { object: { id: 'sub_1' } } });
        const response = await post(appWithEarlierJsonParser([]), payload, {});
        expect(response.status).to.equal(400);
    });

    it('applies a redelivered event id only once', async () => {
        restoreFetch = stubAirwallexFetch({
            ...LOGIN_ROUTE,
            'GET /api/v1/billing/subscriptions/sub_1': subscription({ status: 'CANCELLED', price_id: 'price_pro' }),
        }, fetchCalls);
        const calls: unknown[][] = [];
        const processed = new Set<string>();
        const event = {
            id: 'evt_dup', name: 'subscription.cancelled', data: { object: { id: 'sub_1' } },
        };
        expect((await deliver(appWithEarlierJsonParser(calls, processed, { sub_1: 'octocat' }), event)).status).to.equal(200);
        const second = await deliver(appWithEarlierJsonParser(calls, processed, { sub_1: 'octocat' }), event);
        expect(JSON.parse(second.body)).to.deep.equal({ received: true, duplicate: true });
        expect(calls).to.have.length(1);
        expect(calls[0][1]).to.include({ status: 'canceled' });
    });

    it('answers 409 to a redelivery while the first attempt is still running, so the provider retries', async () => {
        restoreFetch = stubAirwallexFetch({
            ...LOGIN_ROUTE,
            'GET /api/v1/billing/subscriptions/sub_1': subscription({ status: 'ACTIVE', price_id: 'price_pro' }),
        }, fetchCalls);
        const calls: unknown[][] = [];
        const processed = new Set<string>();
        let release: () => void = () => undefined;
        const gate = new Promise<void>(resolve => { release = resolve; });
        let entered: () => void = () => undefined;
        const started = new Promise<void>(resolve => { entered = resolve; });
        const app = express();
        app.use(json());
        const endpoint = new QaapBillingEndpoint();
        Object.assign(endpoint, {
            store: {
                applyAirwallexSubscription: async (...args: unknown[]) => { calls.push(args); entered(); await gate; return { applied: true, account: {} }; },
                findLoginByAirwallexSubscription: async () => 'octocat',
                hasProcessedBillingEvent: async (id: string) => processed.has(id),
                markBillingEventProcessed: async (id: string) => { processed.add(id); },
            },
        });
        endpoint.configure(app);
        const payload = JSON.stringify({ id: 'evt_slow', name: 'subscription.updated', data: { object: { id: 'sub_1' } } });
        const first = post(app, payload, signHeaders(payload));
        await started;
        const port = (server!.address() as AddressInfo).port;
        const second = await new Promise<number>((resolve, reject) => {
            const request = http.request({
                host: '127.0.0.1', port, method: 'POST', path: QAAP_BILLING_WEBHOOK_API_PATH,
                headers: { 'content-type': 'application/json', ...signHeaders(payload) },
            }, response => { response.resume(); response.on('end', () => resolve(response.statusCode ?? 0)); });
            request.once('error', reject);
            request.end(payload);
        });
        expect(second).to.equal(409);
        expect(processed.has('evt_slow')).to.equal(false);
        release();
        expect((await first).status).to.equal(200);
        expect(processed.has('evt_slow')).to.equal(true);
        expect(calls).to.have.length(1);
    });
});

describe('QaapBillingEndpoint confirm and cancel', () => {

    let savedEnv: Map<string, string | undefined>;
    let restoreFetch: (() => void) | undefined;
    let fetchCalls: string[];

    beforeEach(() => {
        savedEnv = new Map(AIRWALLEX_ENV_KEYS.map(key => [key, process.env[key]]));
        process.env.AIRWALLEX_CLIENT_ID = 'cid_test';
        process.env.AIRWALLEX_API_KEY = 'key_test';
        process.env.AIRWALLEX_PRICE_STARTER_MONTHLY = 'price_starter';
        process.env.AIRWALLEX_PRICE_PRO_MONTHLY = 'price_pro';
        process.env.AIRWALLEX_API_BASE = 'https://airwallex.test';
        clearAirwallexTokenCache();
        fetchCalls = [];
    });

    afterEach(() => {
        restoreFetch?.();
        restoreFetch = undefined;
        for (const [key, value] of savedEnv) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
        clearAirwallexTokenCache();
    });

    const makeEndpoint = (login: string, store: Record<string, unknown>): QaapBillingEndpoint => {
        const endpoint = Object.create(QaapBillingEndpoint.prototype) as QaapBillingEndpoint;
        Object.assign(endpoint, {
            auth: {
                authenticate: () => ({ kind: 'authenticated', userLogin: login }),
                resolveUserLogin: () => login,
                isSkipAuthEnabled: () => false,
            },
            store,
        });
        return endpoint;
    };

    it('confirms a completed checkout by id and applies the subscription it created', async () => {
        restoreFetch = stubAirwallexFetch({
            'POST /api/v1/authentication/login': { token: 'tok', expires_at: '2099-01-01T00:00:00+0000' },
            'GET /api/v1/billing/billing_checkouts/bco_1': {
                id: 'bco_1', status: 'COMPLETED', subscription_id: 'sub_1', customer_id: 'cus_1',
                metadata: { qaapLogin: 'octocat', planId: 'pro' },
            },
            'GET /api/v1/billing/subscriptions/sub_1': {
                id: 'sub_1', status: 'ACTIVE', price_id: 'price_pro', customer_id: 'cus_1',
            },
        }, fetchCalls);
        const applied: unknown[][] = [];
        const endpoint = makeEndpoint('octocat', {
            applyAirwallexSubscription: async (...args: unknown[]) => { applied.push(args); return { applied: true, account: { login: 'octocat', planId: 'pro' } }; },
            getOrCreateAccount: async () => ({ login: 'octocat', planId: 'pro' }),
        });
        const res = makeRes();
        await (endpoint as unknown as { handleConfirmCheckout(req: object, response: typeof res): Promise<void> })
            .handleConfirmCheckout({ body: { checkoutId: 'bco_1' } }, res);
        expect(res.statusCode).to.equal(200);
        expect(applied).to.have.length(1);
        expect(applied[0][0]).to.equal('octocat');
        expect(applied[0][1]).to.include({ status: 'active', planId: 'pro', subscriptionId: 'sub_1', adoptSubscription: true });
    });

    it('refuses a checkout that belongs to another login', async () => {
        restoreFetch = stubAirwallexFetch({
            'POST /api/v1/authentication/login': { token: 'tok', expires_at: '2099-01-01T00:00:00+0000' },
            'GET /api/v1/billing/billing_checkouts/bco_2': {
                id: 'bco_2', status: 'COMPLETED', subscription_id: 'sub_2', metadata: { qaapLogin: 'mallory', planId: 'pro' },
            },
        }, fetchCalls);
        const applied: unknown[][] = [];
        const endpoint = makeEndpoint('octocat', {
            applyAirwallexSubscription: async (...args: unknown[]) => { applied.push(args); return { applied: true, account: {} }; },
        });
        const res = makeRes();
        await (endpoint as unknown as { handleConfirmCheckout(req: object, response: typeof res): Promise<void> })
            .handleConfirmCheckout({ body: { checkoutId: 'bco_2' } }, res);
        expect(res.statusCode).to.equal(403);
        expect(applied).to.have.length(0);
    });

    it('cancels the signed-in subscription and applies the re-read state', async () => {
        restoreFetch = stubAirwallexFetch({
            'POST /api/v1/authentication/login': { token: 'tok', expires_at: '2099-01-01T00:00:00+0000' },
            'POST /api/v1/billing/subscriptions/sub_1/cancel': { id: 'sub_1', status: 'CANCELLED' },
            'GET /api/v1/billing/subscriptions/sub_1': { id: 'sub_1', status: 'CANCELLED', price_id: 'price_pro' },
        }, fetchCalls);
        const applied: unknown[][] = [];
        const endpoint = makeEndpoint('octocat', {
            getOrCreateAccount: async () => ({ login: 'octocat', planId: 'pro', subscriptionId: 'sub_1' }),
            applyAirwallexSubscription: async (...args: unknown[]) => { applied.push(args); return { applied: true, account: { login: 'octocat', planId: 'starter' } }; },
        });
        const res = makeRes();
        await (endpoint as unknown as { handleCancel(req: object, response: typeof res): Promise<void> })
            .handleCancel({}, res);
        expect(res.statusCode).to.equal(200);
        expect(fetchCalls).to.include('POST /api/v1/billing/subscriptions/sub_1/cancel');
        expect(applied[0][1]).to.include({ status: 'canceled', subscriptionId: 'sub_1' });
    });

    it('answers 404 to cancel when the account has no subscription', async () => {
        const endpoint = makeEndpoint('octocat', {
            getOrCreateAccount: async () => ({ login: 'octocat', planId: 'starter' }),
        });
        const res = makeRes();
        await (endpoint as unknown as { handleCancel(req: object, response: typeof res): Promise<void> })
            .handleCancel({}, res);
        expect(res.statusCode).to.equal(404);
    });

    it('answers 503 to checkout when Airwallex billing is not configured', async () => {
        for (const key of AIRWALLEX_ENV_KEYS) {
            delete process.env[key];
        }
        const endpoint = makeEndpoint('octocat', {});
        const res = makeRes();
        await (endpoint as unknown as { handleCheckout(req: object, response: typeof res): Promise<void> })
            .handleCheckout({ body: { planId: 'starter' }, headers: {} }, res);
        expect(res.statusCode).to.equal(503);
        expect((res.body as { error: string }).error).to.equal('checkout_not_configured');
    });

    it('exposes the cancel and confirm paths next to the other billing routes', () => {
        expect(QAAP_BILLING_CANCEL_API_PATH).to.equal('/qaap/api/billing/cancel');
        expect(QAAP_BILLING_CONFIRM_CHECKOUT_API_PATH).to.equal('/qaap/api/billing/confirm-checkout');
    });
});
