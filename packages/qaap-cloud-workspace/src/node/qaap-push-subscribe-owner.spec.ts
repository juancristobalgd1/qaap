// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapCloudWorkspaceEndpoint } from './qaap-cloud-workspace-endpoint';

describe('Qaap push subscribe ownership (control plane)', () => {

    it('stores the subscription for the session owner, never for a login sent in the body', async () => {
        const stored: Array<{ login: string, endpoint: string }> = [];
        const endpoint = Object.create(QaapCloudWorkspaceEndpoint.prototype) as QaapCloudWorkspaceEndpoint;
        Object.assign(endpoint, {
            requireAuth: () => ({ kind: 'authenticated', userLogin: 'alice' }),
            pushSubscriptions: {
                upsert: async (login: string, subscription: { endpoint: string }) => { stored.push({ login, endpoint: subscription.endpoint }); },
            },
        });
        let body: unknown;
        await (endpoint as unknown as { handlePushSubscribe(req: unknown, res: unknown): Promise<void> }).handlePushSubscribe({
            body: {
                subscription: { endpoint: 'https://push.example/s1', keys: { p256dh: 'p', auth: 'a' } },
                userLogin: 'mallory',
            },
        }, { json: (value: unknown): void => { body = value; }, status: () => ({ json: (value: unknown): void => { body = value; } }) });
        expect(stored).to.deep.equal([{ login: 'alice', endpoint: 'https://push.example/s1' }]);
        expect(body).to.deep.equal({ ok: true });
    });
});
