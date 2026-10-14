// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type {
    QaapTenantActivityReason,
    QaapTenantRuntimeState,
} from '../common/qaap-cloud-api-types';
import {
    MAX_TENANT_IDLE_TIMEOUT_MS,
    MIN_TENANT_IDLE_TIMEOUT_MS,
    QaapTenantContainerReaper,
    resolveTenantRuntimeDuration,
} from './qaap-tenant-container-reaper';
import { QaapTenantActivityTracker } from './qaap-tenant-activity-tracker';
import { QaapTenantRuntimeMetrics } from './qaap-tenant-runtime-metrics';
import type { QaapTenantBusyStatus } from './qaap-tenant-busy-probe';
import type {
    QaapTenantRuntimePatch,
    QaapTenantRuntimeRecord,
} from './qaap-tenant-runtime-store';

class MemoryRuntimeStore {
    readonly records = new Map<string, QaapTenantRuntimeRecord>();

    get(login: string): QaapTenantRuntimeRecord | undefined {
        return this.records.get(login.toLowerCase());
    }

    list(): QaapTenantRuntimeRecord[] {
        return [...this.records.values()];
    }

    touch(login: string, reason: QaapTenantActivityReason, at = Date.now()): QaapTenantRuntimeRecord {
        return this.setState(login, this.get(login)?.state ?? 'active', {
            lastActivityAt: new Date(at).toISOString(),
            lastActivityReason: reason,
        }, at);
    }

    setState(login: string, state: QaapTenantRuntimeState, patch: QaapTenantRuntimePatch = {}, at = Date.now()): QaapTenantRuntimeRecord {
        const key = login.toLowerCase();
        const record: QaapTenantRuntimeRecord = {
            ...this.get(key),
            ...patch,
            tenantLogin: key,
            state,
            updatedAt: new Date(at).toISOString(),
            reaperEnabled: patch.reaperEnabled ?? this.get(key)?.reaperEnabled ?? true,
        };
        this.records.set(key, record);
        return record;
    }
}

function createHarness(containers: any[], record: QaapTenantRuntimeRecord, busy?: () => QaapTenantBusyStatus | undefined): {
    reaper: QaapTenantContainerReaper;
    store: MemoryRuntimeStore;
    calls: { stop: number; destroy: number; probe: number; pause: number };
} {
    const store = new MemoryRuntimeStore();
    store.records.set(record.tenantLogin, record);
    const calls = { stop: 0, destroy: 0, probe: 0, pause: 0 };
    const docker = {
        isEnabled: () => true,
        listManagedTenantContainers: async () => containers,
        stopTenantRuntime: async () => { calls.stop += 1; },
        destroyTenantRuntime: async () => { calls.destroy += 1; },
        pauseTenantBackend: async () => { calls.pause += 1; return true; },
        probeTenantBackendBusy: async () => {
            calls.probe += 1;
            return busy ? busy() : { busy: false, runningTasks: 0 };
        },
        retryDeferredTenantBackendRecreations: async () => undefined,
    };
    const activity = new QaapTenantActivityTracker();
    (activity as any).store = store;
    const reaper = new QaapTenantContainerReaper();
    (reaper as any).docker = docker;
    (reaper as any).activity = activity;
    (reaper as any).store = store;
    (reaper as any).metrics = new QaapTenantRuntimeMetrics();
    (reaper as any).isEnabled = () => true;
    (reaper as any).idleTimeoutMs = () => 100;
    (reaper as any).destroyAfterMs = () => 1_000;
    // Freezing is opt-in per test so the stop/destroy expectations above stay independent of it.
    (reaper as any).pauseAfterMs = () => 0;
    return { reaper, store, calls };
}

describe('Qaap tenant container reaper', () => {
    it('parses only non-negative integer durations', () => {
        expect(resolveTenantRuntimeDuration('30000', 1)).to.equal(30000);
        expect(resolveTenantRuntimeDuration('-1', 1)).to.equal(1);
        expect(resolveTenantRuntimeDuration('invalid', 1)).to.equal(1);
    });

    it('reads QAAP_TENANT_IDLE_TIMEOUT_MS with a 30 min default and clamps it to [1 min, 7 days]', () => {
        const saved = process.env.QAAP_TENANT_IDLE_TIMEOUT_MS;
        const originalWarn = console.warn;
        const warnings: string[] = [];
        console.warn = (line: string) => { warnings.push(line); };
        try {
            const reaper = new QaapTenantContainerReaper() as unknown as { idleTimeoutMs(): number };
            const resolve = (raw: string | undefined): number => {
                if (raw === undefined) {
                    delete process.env.QAAP_TENANT_IDLE_TIMEOUT_MS;
                } else {
                    process.env.QAAP_TENANT_IDLE_TIMEOUT_MS = raw;
                }
                return reaper.idleTimeoutMs();
            };
            expect(resolve(undefined)).to.equal(30 * 60 * 1000);
            expect(resolve(' ')).to.equal(30 * 60 * 1000);
            expect(resolve('600000')).to.equal(600_000);
            expect(warnings).to.have.length(0);
            expect(resolve('0')).to.equal(MIN_TENANT_IDLE_TIMEOUT_MS);
            expect(resolve('0')).to.equal(MIN_TENANT_IDLE_TIMEOUT_MS);
            expect(resolve('999999999999')).to.equal(MAX_TENANT_IDLE_TIMEOUT_MS);
            expect(resolve('15m')).to.equal(30 * 60 * 1000);
            expect(resolve('-5')).to.equal(30 * 60 * 1000);
            // One warning per distinct rejected value, not one per sweep.
            expect(warnings).to.have.length(4);
        } finally {
            console.warn = originalWarn;
            if (saved === undefined) {
                delete process.env.QAAP_TENANT_IDLE_TIMEOUT_MS;
            } else {
                process.env.QAAP_TENANT_IDLE_TIMEOUT_MS = saved;
            }
        }
    });

    it('stops a running tenant after the idle timeout', async () => {
        const now = 10_000;
        const harness = createHarness([
            { tenantLogin: 'alice', kind: 'worker', containerId: 'worker-1', containerName: 'worker', running: true },
        ], {
            tenantLogin: 'alice',
            state: 'active',
            lastActivityAt: new Date(now - 200).toISOString(),
            reaperEnabled: true,
            updatedAt: new Date(now - 200).toISOString(),
        });

        await harness.reaper.sweep(now);

        expect(harness.calls.stop).to.equal(1);
        expect(harness.store.get('alice')?.state).to.equal('stopped');
        expect(harness.store.get('alice')?.destroyAfter).to.equal(new Date(now + 1_000).toISOString());
    });

    it('destroys a stopped tenant only after its retention deadline', async () => {
        const now = 10_000;
        const harness = createHarness([
            { tenantLogin: 'alice', kind: 'worker', containerId: 'worker-1', containerName: 'worker', running: false },
        ], {
            tenantLogin: 'alice',
            state: 'stopped',
            stoppedAt: new Date(now - 2_000).toISOString(),
            destroyAfter: new Date(now - 1).toISOString(),
            reaperEnabled: true,
            updatedAt: new Date(now - 2_000).toISOString(),
        });

        await harness.reaper.sweep(now);

        expect(harness.calls.destroy).to.equal(1);
        expect(harness.store.get('alice')?.state).to.equal('destroyed');
    });

    it('does not stop a tenant with an active operation lease', async () => {
        const now = 10_000;
        const harness = createHarness([
            { tenantLogin: 'alice', kind: 'worker', containerId: 'worker-1', containerName: 'worker', running: true },
        ], {
            tenantLogin: 'alice',
            state: 'active',
            lastActivityAt: new Date(now - 200).toISOString(),
            reaperEnabled: true,
            updatedAt: new Date(now - 200).toISOString(),
        });
        const release = (harness.reaper as any).activity.beginOperation('alice', 'build-1', 'job');

        await harness.reaper.sweep(now);
        release();

        expect(harness.calls.stop).to.equal(0);
    });

    const idleBackendTenant = (now: number): QaapTenantRuntimeRecord => ({
        tenantLogin: 'alice',
        state: 'active',
        lastActivityAt: new Date(now - 200).toISOString(),
        reaperEnabled: true,
        updatedAt: new Date(now - 200).toISOString(),
    });
    const backendContainers = [
        { tenantLogin: 'alice', kind: 'worker', containerId: 'worker-1', containerName: 'worker', running: true },
        { tenantLogin: 'alice', kind: 'backend', containerId: 'backend-1', containerName: 'backend', running: true },
    ];

    it('does not stop a tenant whose backend still runs an agent turn after the tab closed', async () => {
        const now = 10_000;
        const harness = createHarness(backendContainers, idleBackendTenant(now), () => ({ busy: true, runningTasks: 1 }));

        await harness.reaper.sweep(now);

        expect(harness.calls.probe).to.equal(1);
        expect(harness.calls.stop).to.equal(0);
        expect(harness.store.get('alice')?.state).to.equal('active');
        expect(harness.store.get('alice')?.lastActivityAt).to.equal(new Date(now).toISOString());
    });

    it('stops an idle tenant backend once it reports no running turns', async () => {
        const now = 10_000;
        const harness = createHarness(backendContainers, idleBackendTenant(now), () => ({ busy: false, runningTasks: 0 }));

        await harness.reaper.sweep(now);

        expect(harness.calls.stop).to.equal(1);
        expect(harness.store.get('alice')?.state).to.equal('stopped');
    });

    it('gives an unreachable tenant backend one sweep of grace before stopping it', async () => {
        const now = 10_000;
        const harness = createHarness(backendContainers, idleBackendTenant(now), () => undefined);

        await harness.reaper.sweep(now);
        expect(harness.calls.stop).to.equal(0);

        await harness.reaper.sweep(now + 1);
        expect(harness.calls.stop).to.equal(1);
    });

    it('does not probe worker-only tenants', async () => {
        const now = 10_000;
        const harness = createHarness([backendContainers[0]], idleBackendTenant(now));

        await harness.reaper.sweep(now);

        expect(harness.calls.probe).to.equal(0);
        expect(harness.calls.stop).to.equal(1);
    });

    describe('freezing idle backends', () => {
        const withPause = (harness: ReturnType<typeof createHarness>): ReturnType<typeof createHarness> => {
            (harness.reaper as any).pauseAfterMs = () => 50;
            return harness;
        };
        const recentlyIdle = (now: number): QaapTenantRuntimeRecord => ({
            ...idleBackendTenant(now),
            lastActivityAt: new Date(now - 60).toISOString(),
        });

        it('pauses an idle backend before its idle timeout instead of stopping it', async () => {
            const now = 10_000;
            const harness = withPause(createHarness(backendContainers, recentlyIdle(now)));

            await harness.reaper.sweep(now);

            expect(harness.calls.probe).to.equal(1);
            expect(harness.calls.pause).to.equal(1);
            expect(harness.calls.stop).to.equal(0);
            expect(harness.store.get('alice')?.state).to.equal('idle');
        });

        it('does not pause a backend that still runs an agent turn', async () => {
            const now = 10_000;
            const harness = withPause(createHarness(backendContainers, recentlyIdle(now), () => ({ busy: true, runningTasks: 1 })));

            await harness.reaper.sweep(now);

            expect(harness.calls.pause).to.equal(0);
            expect(harness.store.get('alice')?.state).to.equal('active');
        });

        it('stops a paused backend on the idle timeout without probing it', async () => {
            const now = 10_000;
            const paused = [
                backendContainers[0],
                { tenantLogin: 'alice', kind: 'backend', containerId: 'backend-1', containerName: 'backend', running: false, paused: true },
            ];
            const harness = withPause(createHarness(paused, { ...idleBackendTenant(now), state: 'idle' }));

            await harness.reaper.sweep(now);

            expect(harness.calls.probe).to.equal(0);
            expect(harness.calls.pause).to.equal(0);
            expect(harness.calls.stop).to.equal(1);
            expect(harness.store.get('alice')?.state).to.equal('stopped');
        });

        it('stops (not pauses) when freezing is disabled or not shorter than the idle timeout', async () => {
            const now = 10_000;
            const harness = createHarness(backendContainers, idleBackendTenant(now));
            (harness.reaper as any).pauseAfterMs = () => 100;

            await harness.reaper.sweep(now);

            expect(harness.calls.pause).to.equal(0);
            expect(harness.calls.stop).to.equal(1);
        });
    });
});
