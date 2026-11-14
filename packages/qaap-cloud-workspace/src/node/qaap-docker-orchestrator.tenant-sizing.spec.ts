// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapDockerOrchestrator } from './qaap-docker-orchestrator';
import type { QaapTenantResourceSizing } from './qaap-tenant-resource-sizing';

const GIB = 1024 ** 3;
const ENV_KEYS = [
    'QAAP_TENANT_MEMORY_LIMIT', 'QAAP_TENANT_CPU_LIMIT', 'QAAP_TENANT_MEMORY_LIMIT_OVERRIDES',
    'QAAP_TENANT_CPU_LIMIT_OVERRIDES', 'QAAP_TENANT_MEMORY_LIMIT_MAX', 'QAAP_TENANT_CPU_LIMIT_MAX',
] as const;

describe('QaapDockerOrchestrator tenant sizing', () => {
    const savedEnv = new Map<string, string | undefined>();

    beforeEach(() => {
        for (const key of ENV_KEYS) {
            savedEnv.set(key, process.env[key]);
            delete process.env[key];
        }
    });

    afterEach(() => {
        for (const key of ENV_KEYS) {
            const value = savedEnv.get(key);
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    });

    /** A plan sizing as the sizing service would cache it for one owner. */
    function orchestratorWithPlan(memoryGb: number | undefined, nanoCpus = 2e9): QaapDockerOrchestrator {
        const orchestrator = Object.create(QaapDockerOrchestrator.prototype) as QaapDockerOrchestrator;
        const sizing = memoryGb === undefined ? undefined : { planId: 'starter', memoryGb, memoryBytes: memoryGb * GIB, nanoCpus };
        Object.assign(orchestrator, {
            tenantResourceSizing: { peek: () => sizing } as unknown as QaapTenantResourceSizing,
        });
        return orchestrator;
    }

    it('uses the operator default (3 GiB, 2 CPUs) when no plan is known', () => {
        const orchestrator = orchestratorWithPlan(undefined);
        expect((orchestrator as any).getTenantMemoryLimitFor('alice')).to.equal(3 * GIB);
        expect((orchestrator as any).getTenantCpuLimitFor('alice')).to.equal(2e9);
    });

    it('sizes the tenant from its plan when no operator pin is set', () => {
        const orchestrator = orchestratorWithPlan(2, 4e9);
        expect((orchestrator as any).getTenantMemoryLimitFor('alice')).to.equal(2 * GIB);
        expect((orchestrator as any).getTenantCpuLimitFor('alice')).to.equal(4e9);
    });

    it('lets an explicit QAAP_TENANT_MEMORY_LIMIT and QAAP_TENANT_CPU_LIMIT pin every tenant over the plan', () => {
        process.env.QAAP_TENANT_MEMORY_LIMIT = String(3 * GIB);
        process.env.QAAP_TENANT_CPU_LIMIT = '3';
        const orchestrator = orchestratorWithPlan(2, 4e9);
        expect((orchestrator as any).getTenantMemoryLimitFor('alice')).to.equal(3 * GIB);
        expect((orchestrator as any).getTenantCpuLimitFor('alice')).to.equal(3e9);
    });

    it('raises the plan memory with QAAP_TENANT_MEMORY_LIMIT_OVERRIDES, capped by _MAX', () => {
        process.env.QAAP_TENANT_MEMORY_LIMIT_OVERRIDES = 'alice=6g,bob=8g';
        process.env.QAAP_TENANT_MEMORY_LIMIT_MAX = '6g';
        const orchestrator = orchestratorWithPlan(2);
        expect((orchestrator as any).getTenantMemoryLimitFor('Alice')).to.equal(6 * GIB);
        expect((orchestrator as any).getTenantMemoryLimitFor('bob')).to.equal(6 * GIB);
        expect((orchestrator as any).getTenantMemoryLimitFor('carol')).to.equal(2 * GIB);
    });

    it('never lets an override drop below the plan memory', () => {
        process.env.QAAP_TENANT_MEMORY_LIMIT_OVERRIDES = 'alice=1g';
        const orchestrator = orchestratorWithPlan(2);
        expect((orchestrator as any).getTenantMemoryLimitFor('alice')).to.equal(2 * GIB);
    });

    it('applies CPU overrides on top of the plan CPU', () => {
        process.env.QAAP_TENANT_CPU_LIMIT_OVERRIDES = 'alice=6';
        const orchestrator = orchestratorWithPlan(2, 4e9);
        expect((orchestrator as any).getTenantCpuLimitFor('alice')).to.equal(6e9);
        expect((orchestrator as any).getTenantCpuLimitFor('bob')).to.equal(4e9);
    });

    it('updates a live container whose Memory or NanoCpus drifted from the plan, and re-reads it', async () => {
        const orchestrator = orchestratorWithPlan(2, 4e9);
        const updates: Array<Record<string, number>> = [];
        let live = { Memory: 3 * GIB, NanoCpus: 2e9 };
        const docker = {
            getContainer: () => ({
                update: async (options: Record<string, number>) => {
                    updates.push(options);
                    live = { Memory: options.Memory, NanoCpus: options.NanoCpus };
                },
                inspect: async () => ({ HostConfig: live }),
            }),
        };
        const stale = { HostConfig: { ...live } };
        const after = await (orchestrator as any).syncTenantResourceLimits(docker, 'tenant', stale, 'alice');

        expect(updates).to.deep.equal([{ Memory: 2 * GIB, MemorySwap: 2 * GIB, NanoCpus: 4e9 }]);
        expect(after.HostConfig).to.deep.equal({ Memory: 2 * GIB, NanoCpus: 4e9 });
    });

    it('does not touch a container that already matches the plan', async () => {
        const orchestrator = orchestratorWithPlan(2, 4e9);
        let calls = 0;
        const docker = { getContainer: () => ({ update: async () => { calls++; } }) };
        const inspect = { HostConfig: { Memory: 2 * GIB, NanoCpus: 4e9 } };
        const result = await (orchestrator as any).syncTenantResourceLimits(docker, 'tenant', inspect, 'alice');
        expect(calls).to.equal(0);
        expect(result).to.equal(inspect);
    });

    it('keeps the running container when Docker refuses the update', async () => {
        const orchestrator = orchestratorWithPlan(2, 4e9);
        const docker = {
            getContainer: () => ({ update: async () => { throw new Error('memory limit below current usage'); } }),
        };
        const inspect = { HostConfig: { Memory: 4 * GIB, NanoCpus: 4e9 } };
        const result = await (orchestrator as any).syncTenantResourceLimits(docker, 'tenant', inspect, 'alice');
        expect(result).to.equal(inspect);
    });
});
