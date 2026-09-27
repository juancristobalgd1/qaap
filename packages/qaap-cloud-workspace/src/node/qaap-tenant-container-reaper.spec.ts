// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type {
    QaapTenantActivityReason,
    QaapTenantRuntimeState,
} from '../common/qaap-cloud-api-types';
import { QaapTenantContainerReaper, resolveTenantRuntimeDuration } from './qaap-tenant-container-reaper';
import { QaapTenantActivityTracker } from './qaap-tenant-activity-tracker';
import { QaapTenantRuntimeMetrics } from './qaap-tenant-runtime-metrics';
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

function createHarness(containers: any[], record: QaapTenantRuntimeRecord): {
    reaper: QaapTenantContainerReaper;
    store: MemoryRuntimeStore;
    calls: { stop: number; destroy: number };
} {
    const store = new MemoryRuntimeStore();
    store.records.set(record.tenantLogin, record);
    const calls = { stop: 0, destroy: 0 };
    const docker = {
        isEnabled: () => true,
        listManagedTenantContainers: async () => containers,
        stopTenantRuntime: async () => { calls.stop += 1; },
        destroyTenantRuntime: async () => { calls.destroy += 1; },
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
    return { reaper, store, calls };
}

describe('Qaap tenant container reaper', () => {
    it('parses only non-negative integer durations', () => {
        expect(resolveTenantRuntimeDuration('30000', 1)).to.equal(30000);
        expect(resolveTenantRuntimeDuration('-1', 1)).to.equal(1);
        expect(resolveTenantRuntimeDuration('invalid', 1)).to.equal(1);
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
});
