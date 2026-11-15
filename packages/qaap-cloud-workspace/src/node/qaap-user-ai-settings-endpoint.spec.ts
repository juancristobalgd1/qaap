// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapUserAiSettingsEndpoint } from './qaap-user-ai-settings-endpoint';
const OPENROUTER = 'ai-features.openrouter.openrouterApiKey';
const GOOGLE = 'ai-features.google.apiKey';
const PLACEHOLDER = `qaap-sealed-secret:${OPENROUTER}`;
const ENV_KEYS = ['QAAP_TENANT_BACKEND_MODE', 'QAAP_TENANT_LOGIN', 'QAAP_MASK_USER_SECRETS'];

describe('QaapUserAiSettingsEndpoint auth gate', () => {

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

    it('GET returns 401 without a session', () => {
        const endpoint = Object.create(QaapUserAiSettingsEndpoint.prototype) as QaapUserAiSettingsEndpoint;
        Object.assign(endpoint, {
            auth: {
                authenticate: () => ({ kind: 'unauthorized' }),
                resolveUserLogin: () => undefined,
            },
        });
        const res = makeRes();
        (endpoint as unknown as { handleGet(req: object, response: typeof res): void }).handleGet({}, res);
        expect(res.statusCode).to.equal(401);
    });

    it('PUT returns 401 without a session', () => {
        const endpoint = Object.create(QaapUserAiSettingsEndpoint.prototype) as QaapUserAiSettingsEndpoint;
        Object.assign(endpoint, {
            auth: {
                authenticate: () => ({ kind: 'unauthorized' }),
                resolveUserLogin: () => undefined,
            },
        });
        const res = makeRes();
        (endpoint as unknown as { handlePut(req: object, response: typeof res): void }).handlePut({ body: { settings: {} } }, res);
        expect(res.statusCode).to.equal(401);
    });
});

describe('QaapUserAiSettingsEndpoint secret masking', () => {

    let saved: Record<string, string | undefined>;
    beforeEach(() => {
        saved = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
    });
    afterEach(() => {
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = saved[key];
            }
        }
    });

    const endpointWith = (settings: Record<string, unknown>): QaapUserAiSettingsEndpoint => {
        const endpoint = Object.create(QaapUserAiSettingsEndpoint.prototype) as QaapUserAiSettingsEndpoint;
        Object.assign(endpoint, {
            auth: {
                authenticate: () => ({ kind: 'authenticated' }),
                resolveUserLogin: () => 'alice',
            },
            loadSettings: () => ({ ...settings }),
            saveSettings: (_login: string, patch: Record<string, unknown>) => ({ ...settings, ...patch }),
        });
        return endpoint;
    };

    const respond = (endpoint: QaapUserAiSettingsEndpoint, method: 'handleGet' | 'handlePut', body?: unknown): Record<string, unknown> => {
        let payload: Record<string, unknown> = {};
        const res = {
            json: (value: Record<string, unknown>) => { payload = value; },
            status: () => res,
        };
        (endpoint as unknown as Record<string, (req: unknown, res: unknown) => void>)[method]({ body }, res);
        return payload;
    };

    const tenant = (): void => {
        process.env.QAAP_TENANT_BACKEND_MODE = '1';
        process.env.QAAP_TENANT_LOGIN = 'alice';
        delete process.env.QAAP_MASK_USER_SECRETS;
    };

    it('masks the allowlisted key and keeps other secrets as they are on a tenant backend', () => {
        tenant();
        const payload = respond(endpointWith({ [OPENROUTER]: 'test-key-old', [GOOGLE]: 'g-real' }), 'handleGet');
        expect(payload.settings).to.deep.equal({ [OPENROUTER]: PLACEHOLDER, [GOOGLE]: 'g-real' });
    });

    it('keeps an unset key empty so the UI knows it is not saved', () => {
        tenant();
        const payload = respond(endpointWith({ [OPENROUTER]: '' }), 'handleGet');
        expect(payload.settings).to.deep.equal({ [OPENROUTER]: '' });
    });

    it('returns plain values outside tenant mode or with QAAP_MASK_USER_SECRETS=0', () => {
        const settings = { [OPENROUTER]: 'test-key-old' };
        delete process.env.QAAP_TENANT_BACKEND_MODE;
        expect(respond(endpointWith(settings), 'handleGet').settings).to.deep.equal(settings);
        tenant();
        process.env.QAAP_MASK_USER_SECRETS = '0';
        expect(respond(endpointWith(settings), 'handleGet').settings).to.deep.equal(settings);
    });

    it('masks the PUT response the same way as GET', () => {
        tenant();
        const payload = respond(endpointWith({}), 'handlePut', { settings: { [OPENROUTER]: 'test-key-new' } });
        expect(payload.settings).to.deep.equal({ [OPENROUTER]: PLACEHOLDER });
    });
});
