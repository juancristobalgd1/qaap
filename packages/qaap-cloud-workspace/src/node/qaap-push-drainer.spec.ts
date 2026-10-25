// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapPushNotifyRequest } from '../common/qaap-cloud-api-types';
import type { QaapManagedTenantContainer } from './qaap-docker-orchestrator';
import { QAAP_PUSH_OUTBOX_CAPACITY } from './qaap-push-outbox';
import { QaapPushOwnerRateLimit } from './qaap-push-owner-rate-limit';
import { QAAP_PUSH_DRAIN_TENANT_TIMEOUT_MS, QaapPushDrainer } from './qaap-push-drainer';

type Fetch = (owner: string, timeoutMs: number) => Promise<unknown>;

function container(login: string, overrides: Partial<QaapManagedTenantContainer> = {}): QaapManagedTenantContainer {
    return { kind: 'backend', containerId: `id-${login}`, containerName: `qaap-backend-${login}`, running: true, paused: false, tenantLogin: login, ...overrides };
}

describe('QaapPushDrainer (control plane)', function (): void {
    this.timeout(10_000);

    const envKeys = ['QAAP_TENANT_BACKEND_MODE'] as const;
    const saved: Record<string, string | undefined> = {};
    beforeEach(() => {
        for (const key of envKeys) {
            saved[key] = process.env[key];
        }
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

    function harness(containers: QaapManagedTenantContainer[], fetch: Fetch, options: { failNotify?: unknown } = {}): {
        drainer: QaapPushDrainer,
        fetched: string[],
        notified: Array<QaapPushNotifyRequest>,
    } {
        const fetched: string[] = [];
        const notified: QaapPushNotifyRequest[] = [];
        const drainer = Object.create(QaapPushDrainer.prototype) as QaapPushDrainer;
        Object.assign(drainer, {
            docker: {
                isBackendPerTenantEnabled: () => true,
                listManagedTenantContainers: async () => containers,
                fetchTenantPushOutbox: (owner: string, timeoutMs: number) => {
                    fetched.push(owner);
                    return fetch(owner, timeoutMs);
                },
            },
            webPush: {
                isConfigured: () => true,
                notify: async (request: QaapPushNotifyRequest) => {
                    if (options.failNotify !== undefined) {
                        throw options.failNotify;
                    }
                    notified.push(request);
                    return { sent: 1, failed: 0 };
                },
            },
            rateLimit: new QaapPushOwnerRateLimit(),
            lastProblem: new Map<string, string>(),
            ticking: false,
        });
        return { drainer, fetched, notified };
    }

    it('contacts only running, unpaused tenant backends', async () => {
        const { drainer, fetched } = harness([
            container('alice'),
            container('bob', { running: false }),
            container('carol', { paused: true, running: false }),
            container('dave', { kind: 'worker' }),
        ], async () => ({ entries: [] }));
        await drainer.tick();
        expect(fetched).to.deep.equal(['alice']);
    });

    it('delivers to the orchestrator-bound owner even when the payload names another user', async () => {
        const { drainer, notified } = harness([container('alice')], async () => ({
            entries: [{ title: 'Done', body: 'ok', userLogin: 'mallory' }],
        }));
        await drainer.tick();
        expect(notified).to.have.length(1);
        expect(notified[0].userLogin).to.equal('alice');
    });

    it('bounds field sizes, drops unsafe urls and caps the list', async () => {
        const entries = Array.from({ length: QAAP_PUSH_OUTBOX_CAPACITY + 10 }, (_, i) => ({
            title: i === 0 ? 'T'.repeat(500) : `t${i}`,
            body: 'b',
            url: i === 0 ? 'https://evil.example' : undefined,
        }));
        const { drainer, notified } = harness([container('alice')], async () => ({ entries }));
        await drainer.tick();
        expect(notified[0].title).to.have.length(120);
        expect(notified[0].url).to.equal(undefined);
        expect(notified.length).to.be.at.most(30);
    });

    it('limits deliveries to 30 per owner per minute and drops the excess', async () => {
        const entries = Array.from({ length: 40 }, (_, i) => ({ title: `t${i}`, body: 'b' }));
        const { drainer, notified } = harness([container('alice')], async () => ({ entries }));
        await drainer.tick();
        expect(notified).to.have.length(30);
    });

    it('a tenant that does not answer in time does not block the others', async () => {
        const { drainer, notified } = harness([container('slow'), container('fast')], owner => {
            if (owner === 'slow') {
                return new Promise(() => { /* never answers */ });
            }
            return Promise.resolve({ entries: [{ title: 'Fast', body: 'ok' }] });
        });
        const started = Date.now();
        await drainer.tick();
        const elapsed = Date.now() - started;
        expect(elapsed).to.be.below(QAAP_PUSH_DRAIN_TENANT_TIMEOUT_MS + 1_000);
        expect(notified.map(request => request.userLogin)).to.deep.equal(['fast']);
    });

    it('does not run when the control plane cannot send or is itself a tenant backend', () => {
        const { drainer } = harness([], async () => undefined);
        Object.assign(drainer, { webPush: { isConfigured: () => false } });
        expect(drainer.isEnabled()).to.equal(false);
        process.env.QAAP_TENANT_BACKEND_MODE = '1';
        Object.assign(drainer, { webPush: { isConfigured: () => true } });
        expect(drainer.isEnabled()).to.equal(false);
    });
});
