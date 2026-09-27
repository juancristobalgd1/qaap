// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapUserAiSettingsEndpoint } from './qaap-user-ai-settings-endpoint';

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
