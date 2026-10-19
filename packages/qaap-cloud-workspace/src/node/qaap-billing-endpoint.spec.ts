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
import { QAAP_BILLING_WEBHOOK_API_PATH } from '../common/qaap-cloud-api-types';
import { QaapBillingEndpoint } from './qaap-billing-endpoint';

describe('QaapBillingEndpoint auth gate', () => {

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
        const ENV_KEYS = ['NODE_ENV', 'QAAP_CLOUD_MODE', 'QAAP_SKIP_AUTH', 'QAAP_BILLING_DEV_CHECKOUT', 'STRIPE_SECRET_KEY'] as const;
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
                .handleDevActivate({ body: { planId: 'team' } }, res);
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

        it('ignores a raw QAAP_SKIP_AUTH that the auth guard does not honour', async () => {
            process.env.QAAP_SKIP_AUTH = 'true';
            expect(await devActivate(false)).to.deep.equal({ statusCode: 403, plans: [] });
        });

        it('still switches plans locally under skip-auth or the dev-checkout flag', async () => {
            expect(await devActivate(true)).to.deep.equal({ statusCode: 200, plans: ['team'] });
            process.env.QAAP_BILLING_DEV_CHECKOUT = '1';
            expect(await devActivate(false)).to.deep.equal({ statusCode: 200, plans: ['team'] });
        });
    });
});

describe('QaapBillingEndpoint Stripe webhook', () => {

    const secret = 'whsec_test_secret';
    let server: http.Server | undefined;
    let previousSecret: string | undefined;

    beforeEach(() => {
        previousSecret = process.env.STRIPE_WEBHOOK_SECRET;
        process.env.STRIPE_WEBHOOK_SECRET = secret;
    });

    afterEach(async () => {
        if (previousSecret === undefined) {
            delete process.env.STRIPE_WEBHOOK_SECRET;
        } else {
            process.env.STRIPE_WEBHOOK_SECRET = previousSecret;
        }
        await new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve());
        server = undefined;
    });

    const post = async (app: express.Application, payload: string, signature: string): Promise<{ status: number; body: string }> => {
        server = http.createServer(app);
        await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
        const port = (server.address() as AddressInfo).port;
        return new Promise((resolve, reject) => {
            const request = http.request({
                host: '127.0.0.1',
                port,
                method: 'POST',
                path: QAAP_BILLING_WEBHOOK_API_PATH,
                headers: { 'content-type': 'application/json', 'stripe-signature': signature },
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

    const sign = (payload: string, key: string = secret): string => {
        const timestamp = Math.floor(Date.now() / 1000);
        const v1 = crypto.createHmac('sha256', key).update(`${timestamp}.${payload}`, 'utf8').digest('hex');
        return `t=${timestamp},v1=${v1}`;
    };

    /** Mirrors production: upstream `@theia/filesystem` installs a global `json()` before Qaap contributions. */
    const appWithEarlierJsonParser = (setPlanCalls: unknown[][]): express.Application => {
        const app = express();
        app.use(json());
        const endpoint = new QaapBillingEndpoint();
        Object.assign(endpoint, { store: { setPlan: async (...args: unknown[]) => { setPlanCalls.push(args); return {}; } } });
        endpoint.configure(app);
        return app;
    };

    it('verifies the signature against the raw bytes even after an earlier global json() parser', async () => {
        const calls: unknown[][] = [];
        // Pretty-printed like Stripe: re-serialising a parsed body would not reproduce these bytes.
        const payload = JSON.stringify({
            id: 'evt_1',
            type: 'checkout.session.completed',
            data: { object: { mode: 'subscription', customer: 'cus_1', subscription: 'sub_1', metadata: { login: 'octocat', planId: 'pro' } } },
        }, undefined, 2) + '\n';
        const response = await post(appWithEarlierJsonParser(calls), payload, sign(payload));
        expect(response.status).to.equal(200);
        expect(JSON.parse(response.body)).to.deep.equal({ received: true });
        expect(calls).to.have.length(1);
        expect(calls[0][0]).to.equal('octocat');
        expect(calls[0][1]).to.equal('pro');
    });

    it('rejects a payload signed with another secret', async () => {
        const calls: unknown[][] = [];
        const payload = JSON.stringify({ id: 'evt_2', type: 'customer.subscription.deleted', data: { object: { metadata: { login: 'octocat' } } } });
        const response = await post(appWithEarlierJsonParser(calls), payload, sign(payload, 'whsec_other'));
        expect(response.status).to.equal(400);
        expect(JSON.parse(response.body)).to.deep.equal({ error: 'invalid_signature' });
        expect(calls).to.have.length(0);
    });
});
