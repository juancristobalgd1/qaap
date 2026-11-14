// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as crypto from 'crypto';
import {
    AirwallexApiError,
    airwallexApiBase,
    airwallexPlanForPriceId,
    airwallexSubscriptionIdFromEvent,
    airwallexSubscriptionStatus,
    clearAirwallexTokenCache,
    createAirwallexSubscriptionCheckout,
    isAirwallexBillingConfigured,
    mapAirwallexSubscription,
    verifyAirwallexWebhook,
} from './qaap-airwallex-billing';

const ENV_KEYS = [
    'AIRWALLEX_CLIENT_ID', 'AIRWALLEX_API_KEY', 'AIRWALLEX_WEBHOOK_SECRET', 'AIRWALLEX_PRICE_STARTER_MONTHLY',
    'AIRWALLEX_PRICE_PRO_MONTHLY', 'AIRWALLEX_API_BASE', 'AIRWALLEX_ENV', 'AIRWALLEX_LINKED_PAYMENT_ACCOUNT_ID',
] as const;

type Handler = (url: string, init: RequestInit | undefined) => { status: number; body: unknown };

describe('qaap-airwallex-billing', () => {

    let savedEnv: Map<string, string | undefined>;
    let originalFetch: typeof fetch;
    let requests: Array<{ url: string; init: RequestInit | undefined }>;

    /** Installs a fake Airwallex: `handler` decides each response, every request is recorded. */
    const stubFetch = (handler: Handler): void => {
        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
            requests.push({ url, init });
            const result = handler(url, init);
            return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'content-type': 'application/json' } });
        }) as unknown as typeof fetch;
    };

    const loginOk = (token: string): Handler => (url): { status: number; body: unknown } => url.endsWith('/api/v1/authentication/login')
        ? { status: 201, body: { token, expires_at: '2099-01-01T00:00:00+0000' } }
        : { status: 404, body: { message: 'unexpected' } };

    beforeEach(() => {
        savedEnv = new Map(ENV_KEYS.map(key => [key, process.env[key]]));
        for (const key of ENV_KEYS) {
            delete process.env[key];
        }
        process.env.AIRWALLEX_API_BASE = 'https://airwallex.test';
        originalFetch = globalThis.fetch;
        requests = [];
        clearAirwallexTokenCache();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        for (const [key, value] of savedEnv) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
        clearAirwallexTokenCache();
    });

    const configure = (): void => {
        process.env.AIRWALLEX_CLIENT_ID = 'cid_test';
        process.env.AIRWALLEX_API_KEY = 'key_test';
        process.env.AIRWALLEX_PRICE_STARTER_MONTHLY = 'price_starter';
        process.env.AIRWALLEX_PRICE_PRO_MONTHLY = 'price_pro';
    };

    describe('configuration', () => {
        it('is configured only with credentials and both monthly prices', () => {
            expect(isAirwallexBillingConfigured({})).to.equal(false);
            configure();
            expect(isAirwallexBillingConfigured()).to.equal(true);
            delete process.env.AIRWALLEX_PRICE_STARTER_MONTHLY;
            expect(isAirwallexBillingConfigured()).to.equal(false);
        });

        it('selects demo unless AIRWALLEX_ENV is prod, and AIRWALLEX_API_BASE overrides both', () => {
            delete process.env.AIRWALLEX_API_BASE;
            expect(airwallexApiBase({})).to.equal('https://api-demo.airwallex.com');
            expect(airwallexApiBase({ AIRWALLEX_ENV: 'prod' })).to.equal('https://api.airwallex.com');
            expect(airwallexApiBase({ AIRWALLEX_ENV: 'demo' })).to.equal('https://api-demo.airwallex.com');
            expect(airwallexApiBase({ AIRWALLEX_ENV: 'prod', AIRWALLEX_API_BASE: 'https://x.test/' })).to.equal('https://x.test');
        });

        it('maps price ids back to plans', () => {
            configure();
            expect(airwallexPlanForPriceId('price_pro')).to.equal('pro');
            expect(airwallexPlanForPriceId('price_starter')).to.equal('starter');
            expect(airwallexPlanForPriceId('price_other')).to.equal(undefined);
            expect(airwallexPlanForPriceId(undefined)).to.equal(undefined);
        });
    });

    describe('authentication and checkout', () => {
        it('logs in once, caches the token and sends it as a bearer token', async () => {
            configure();
            stubFetch((url, init) => {
                if (url.endsWith('/authentication/login')) {
                    return loginOk('tok_1')(url, init);
                }
                return { status: 200, body: { id: 'bco_1', url: 'https://checkout.test/bco_1' } };
            });
            await createAirwallexSubscriptionCheckout({ login: 'octocat', planId: 'starter', origin: 'https://qaap.test' });
            await createAirwallexSubscriptionCheckout({ login: 'octocat', planId: 'pro', origin: 'https://qaap.test' });
            const logins = requests.filter(entry => entry.url.endsWith('/authentication/login'));
            expect(logins).to.have.length(1);
            expect((logins[0].init?.headers as Record<string, string>)['x-client-id']).to.equal('cid_test');
            const checkouts = requests.filter(entry => entry.url.includes('/billing_checkouts/create'));
            expect(checkouts).to.have.length(2);
            expect((checkouts[0].init?.headers as Record<string, string>).Authorization).to.equal('Bearer tok_1');
        });

        it('creates a subscription checkout for the requested plan price with the login in metadata', async () => {
            configure();
            stubFetch((url, init) => url.endsWith('/authentication/login')
                ? loginOk('tok')(url, init)
                : { status: 201, body: { id: 'bco_9', url: 'https://checkout.test/bco_9' } });
            const checkout = await createAirwallexSubscriptionCheckout({ login: 'octocat', planId: 'pro', origin: 'https://qaap.test' });
            expect(checkout).to.deep.equal({ id: 'bco_9', url: 'https://checkout.test/bco_9' });
            const body = JSON.parse(String(requests[1].init?.body)) as Record<string, unknown>;
            expect(body.mode).to.equal('SUBSCRIPTION');
            expect(body.line_items).to.deep.equal([{ price_id: 'price_pro', quantity: 1 }]);
            expect(body.metadata).to.deep.equal({ qaapLogin: 'octocat', planId: 'pro' });
            expect(String(body.success_url)).to.equal('https://qaap.test/?qaapBilling=success&plan=pro');
            expect(body.subscription_data).to.deep.equal({ metadata: { qaapLogin: 'octocat', planId: 'pro' } });
            const update = requests.find(entry => entry.url.endsWith('/billing_checkouts/bco_9/update'));
            expect(JSON.parse(String(update?.init?.body))).to.deep.equal({
                success_url: 'https://qaap.test/?qaapBilling=success&plan=pro&checkout=bco_9',
            });
            expect(String(body.request_id)).to.match(/^[0-9a-f-]{36}$/);
        });

        it('sends the collecting account when AIRWALLEX_LINKED_PAYMENT_ACCOUNT_ID is set, and omits it otherwise', async () => {
            configure();
            stubFetch((url, init) => url.endsWith('/authentication/login')
                ? loginOk('tok')(url, init)
                : { status: 201, body: { id: 'bco_1', url: 'https://checkout.test/bco_1' } });
            await createAirwallexSubscriptionCheckout({ login: 'octocat', planId: 'starter', origin: 'https://qaap.test' });
            process.env.AIRWALLEX_LINKED_PAYMENT_ACCOUNT_ID = ' acct_collect ';
            await createAirwallexSubscriptionCheckout({ login: 'octocat', planId: 'starter', origin: 'https://qaap.test' });
            const bodies = requests.filter(entry => entry.url.includes('/billing_checkouts/create'))
                .map(entry => JSON.parse(String(entry.init?.body)) as Record<string, unknown>);
            expect(bodies[0]).to.not.have.property('linked_payment_account_id');
            expect(bodies[1].linked_payment_account_id).to.equal('acct_collect');
        });

        it('turns the multiple-linked-accounts rejection into a checkout_not_configured that names the variable', async () => {
            configure();
            stubFetch((url, init) => url.endsWith('/authentication/login')
                ? loginOk('tok')(url, init)
                : {
                    status: 400, body: {
                        code: 'validation_error',
                        message: 'Need to specify the linked_payment_account_id in the request, since the seller has multiple linked payment accounts.',
                    },
                });
            let caught: unknown;
            try {
                await createAirwallexSubscriptionCheckout({ login: 'octocat', planId: 'pro', origin: 'https://qaap.test' });
            } catch (error) {
                caught = error;
            }
            expect(caught).to.be.instanceOf(AirwallexApiError);
            expect((caught as AirwallexApiError).status).to.equal(503);
            expect((caught as AirwallexApiError).code).to.equal('checkout_not_configured');
            expect((caught as Error).message).to.contain('AIRWALLEX_LINKED_PAYMENT_ACCOUNT_ID');
        });

        it('retries exactly once with a fresh token after a 401', async () => {
            configure();
            let logins = 0;
            let attempts = 0;
            stubFetch(url => {
                if (url.endsWith('/authentication/login')) {
                    logins++;
                    return { status: 201, body: { token: `tok_${logins}`, expires_at: '2099-01-01T00:00:00+0000' } };
                }
                if (!url.includes('/billing_checkouts/create')) {
                    return { status: 200, body: {} };
                }
                attempts++;
                return attempts === 1
                    ? { status: 401, body: { message: 'expired' } }
                    : { status: 201, body: { id: 'bco_2', url: 'https://checkout.test/bco_2' } };
            });
            const checkout = await createAirwallexSubscriptionCheckout({ login: 'octocat', planId: 'starter', origin: 'https://qaap.test' });
            expect(checkout.id).to.equal('bco_2');
            expect(logins).to.equal(2);
            expect(attempts).to.equal(2);
        });

        it('surfaces the Airwallex message without the key or token', async () => {
            configure();
            stubFetch((url, init) => url.endsWith('/authentication/login')
                ? loginOk('tok')(url, init)
                : { status: 400, body: { code: 'invalid_price', message: 'price is not active' } });
            try {
                await createAirwallexSubscriptionCheckout({ login: 'octocat', planId: 'pro', origin: 'https://qaap.test' });
                expect.fail('expected a rejection');
            } catch (error) {
                expect(error).to.be.instanceOf(AirwallexApiError);
                const apiError = error as AirwallexApiError;
                expect(apiError.message).to.equal('price is not active');
                expect(apiError.status).to.equal(400);
                expect(apiError.code).to.equal('invalid_price');
                expect(apiError.message).to.not.include('key_test');
                expect(apiError.message).to.not.include('tok');
            }
        });
    });

    describe('subscription mapping', () => {
        it('maps Airwallex statuses onto Qaap statuses', () => {
            expect(airwallexSubscriptionStatus('ACTIVE')).to.equal('active');
            expect(airwallexSubscriptionStatus('IN_TRIAL')).to.equal('active');
            expect(airwallexSubscriptionStatus('UNPAID')).to.equal('past_due');
            expect(airwallexSubscriptionStatus('CANCELLED')).to.equal('canceled');
            expect(airwallexSubscriptionStatus('PENDING')).to.equal('pending');
            expect(airwallexSubscriptionStatus('SOMETHING_NEW')).to.equal('pending');
            expect(airwallexSubscriptionStatus(undefined)).to.equal('pending');
        });

        it('takes the plan from the price, falling back to the planId metadata', () => {
            configure();
            const fromPrice = mapAirwallexSubscription({
                id: 'sub_1', status: 'ACTIVE', customer_id: 'cus_1', line_items: [{ price_id: 'price_starter' }],
                metadata: { qaapLogin: 'octocat', planId: 'pro' }, current_period_ends_at: '2099-01-01T00:00:00+0000',
            });
            expect(fromPrice).to.deep.include({
                subscriptionId: 'sub_1', customerId: 'cus_1', status: 'active', planId: 'starter', login: 'octocat',
                currentPeriodEnd: '2099-01-01T00:00:00+0000',
            });
            const fromMetadata = mapAirwallexSubscription({ id: 'sub_2', status: 'UNPAID', metadata: { planId: 'pro' } });
            expect(fromMetadata).to.deep.include({ status: 'past_due', planId: 'pro' });
        });

        it('extracts the subscription an event refers to, and ignores unrelated events', () => {
            expect(airwallexSubscriptionIdFromEvent({ name: 'billing_checkout.completed', data: { object: { id: 'bco_1', subscription_id: 'sub_1' } } }))
                .to.equal('sub_1');
            expect(airwallexSubscriptionIdFromEvent({ name: 'subscription.updated', data: { object: { id: 'sub_2' } } }))
                .to.equal('sub_2');
            expect(airwallexSubscriptionIdFromEvent({ name: 'payment.succeeded', data: { object: { id: 'pi_1' } } }))
                .to.equal(undefined);
        });
    });

    describe('webhook signature', () => {
        const secret = 'whsec_unit';
        const body = Buffer.from('{"id":"evt_1","name":"subscription.updated","data":{"object":{"id":"sub_1"}}}\n', 'utf8');
        const sign = (timestamp: string, payload: Buffer, key: string = secret): string => crypto
            .createHmac('sha256', key)
            .update(timestamp, 'utf8')
            .update(payload)
            .digest('hex');

        it('accepts a correctly signed body within the tolerance and parses it', () => {
            const now = 1_800_000_000_000;
            const timestamp = String(now - 1000);
            const event = verifyAirwallexWebhook(body, { 'x-timestamp': timestamp, 'x-signature': sign(timestamp, body) }, secret, now);
            expect(event.id).to.equal('evt_1');
        });

        it('accepts a timestamp given in seconds', () => {
            const now = 1_800_000_000_000;
            const timestamp = String(Math.floor((now - 1000) / 1000));
            expect(verifyAirwallexWebhook(body, { 'x-timestamp': timestamp, 'x-signature': sign(timestamp, body) }, secret, now).id)
                .to.equal('evt_1');
        });

        it('rejects a wrong secret, a tampered body and missing headers', () => {
            const now = 1_800_000_000_000;
            const timestamp = String(now);
            expect(() => verifyAirwallexWebhook(body, { 'x-timestamp': timestamp, 'x-signature': sign(timestamp, body, 'whsec_other') }, secret, now))
                .to.throw('Invalid Airwallex webhook signature');
            const tampered = Buffer.from(body.toString('utf8').replace('sub_1', 'sub_2'), 'utf8');
            expect(() => verifyAirwallexWebhook(tampered, { 'x-timestamp': timestamp, 'x-signature': sign(timestamp, body) }, secret, now))
                .to.throw('Invalid Airwallex webhook signature');
            expect(() => verifyAirwallexWebhook(body, { 'x-signature': sign(timestamp, body) }, secret, now))
                .to.throw('Invalid Airwallex webhook signature');
        });

        it('rejects a stale or future timestamp outside five minutes', () => {
            const now = 1_800_000_000_000;
            const stale = String(now - 6 * 60_000);
            expect(() => verifyAirwallexWebhook(body, { 'x-timestamp': stale, 'x-signature': sign(stale, body) }, secret, now))
                .to.throw('Airwallex webhook timestamp outside tolerance');
            const future = String(now + 6 * 60_000);
            expect(() => verifyAirwallexWebhook(body, { 'x-timestamp': future, 'x-signature': sign(future, body) }, secret, now))
                .to.throw('Airwallex webhook timestamp outside tolerance');
        });
    });
});
