// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
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
});
