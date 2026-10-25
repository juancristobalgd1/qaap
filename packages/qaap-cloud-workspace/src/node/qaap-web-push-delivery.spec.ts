// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapPushNotifyRequest } from '../common/qaap-cloud-api-types';
import { QaapPushOutbox } from './qaap-push-outbox';
import { QaapWebPushService } from './qaap-web-push-service';

const KEYS = { p256dh: 'p', auth: 'a' };

describe('QaapWebPushService delivery modes', () => {
    const envKeys = ['QAAP_TENANT_BACKEND_MODE', 'QAAP_VAPID_PUBLIC_KEY', 'QAAP_VAPID_PRIVATE_KEY'] as const;
    const saved: Record<string, string | undefined> = {};

    beforeEach(() => {
        for (const key of envKeys) {
            saved[key] = process.env[key];
        }
        process.env.QAAP_VAPID_PUBLIC_KEY = 'pub';
        process.env.QAAP_VAPID_PRIVATE_KEY = 'priv';
        delete process.env.QAAP_TENANT_BACKEND_MODE;
    });

    afterEach(() => {
        for (const key of envKeys) {
            if (saved[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = saved[key];
            }
        }
    });

    interface Harness {
        readonly service: QaapWebPushService;
        readonly delivered: Array<{ endpoint: string, payload: string }>;
        readonly removed: string[];
        readonly outbox: QaapPushOutbox;
    }

    function harness(options: { rows?: Array<{ endpoint: string, userLogin: string }>, failWith?: unknown } = {}): Harness {
        const delivered: Array<{ endpoint: string, payload: string }> = [];
        const removed: string[] = [];
        const outbox = new QaapPushOutbox();
        const rows = (options.rows ?? []).map(row => ({ userLogin: row.userLogin, subscription: { endpoint: row.endpoint, keys: KEYS }, createdAt: 'now' }));
        const service = Object.create(QaapWebPushService.prototype) as QaapWebPushService;
        Object.assign(service, {
            outbox,
            subscriptions: {
                listForUser: async (login: string) => rows.filter(row => row.userLogin === login),
                listAll: async () => rows,
                remove: async (endpoint: string) => { removed.push(endpoint); },
            },
            deliver: async (endpoint: string, _keys: unknown, payload: string): Promise<void> => {
                if (options.failWith !== undefined) {
                    throw options.failWith;
                }
                delivered.push({ endpoint, payload });
            },
        });
        return { service, delivered, removed, outbox };
    }

    const request: QaapPushNotifyRequest = { title: 'Agent finished', body: 'done', tag: 'qaap-agent-done', userLogin: 'alice', url: '/x' };

    it('in tenant-backend mode queues the notification and sends nothing', async () => {
        process.env.QAAP_TENANT_BACKEND_MODE = '1';
        const { service, delivered, outbox } = harness({ rows: [{ endpoint: 'https://push/a', userLogin: 'alice' }] });
        const stats = await service.notify(request);
        expect(stats).to.deep.equal({ sent: 0, failed: 0 });
        expect(delivered).to.deep.equal([]);
        expect(outbox.size()).to.equal(1);
        expect(outbox.drain()[0]).to.not.have.property('userLogin');
    });

    it('outside tenant mode (single backend) sends directly to the owner subscriptions', async () => {
        const { service, delivered } = harness({ rows: [
            { endpoint: 'https://push/a', userLogin: 'alice' },
            { endpoint: 'https://push/b', userLogin: 'bob' },
        ] });
        const stats = await service.notify(request);
        expect(stats).to.deep.equal({ sent: 1, failed: 0 });
        expect(delivered.map(entry => entry.endpoint)).to.deep.equal(['https://push/a']);
        expect(JSON.parse(delivered[0].payload)).to.include({ title: 'Agent finished', url: '/x' });
    });

    it('forgets a subscription the push service reports as gone (404/410)', async () => {
        const gone = Object.assign(new Error('gone'), { statusCode: 410 });
        const { service, removed } = harness({ rows: [{ endpoint: 'https://push/a', userLogin: 'alice' }], failWith: gone });
        expect(await service.notify(request)).to.deep.equal({ sent: 0, failed: 1 });
        expect(removed).to.deep.equal(['https://push/a']);
    });

    it('keeps a subscription after a transient failure', async () => {
        const transient = Object.assign(new Error('boom'), { statusCode: 500 });
        const { service, removed } = harness({ rows: [{ endpoint: 'https://push/a', userLogin: 'alice' }], failWith: transient });
        expect(await service.notify(request)).to.deep.equal({ sent: 0, failed: 1 });
        expect(removed).to.deep.equal([]);
    });
});
