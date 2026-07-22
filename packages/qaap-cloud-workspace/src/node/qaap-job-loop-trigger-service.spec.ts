// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { createHash } from 'crypto';
import { QaapJobLoopTriggerService } from './qaap-job-loop-trigger-service';

describe('QaapJobLoopTriggerService', () => {
    it('uses a stable cron slot and does not run a webhook on the timer', () => {
        const service = Object.create(QaapJobLoopTriggerService.prototype) as QaapJobLoopTriggerService;
        const now = Date.parse('2026-06-01T06:01:00.000Z');
        const cron = (service as unknown as { dueSlot(trigger: unknown, at: number): string | undefined }).dueSlot({
            id: 'cron', ownerLogin: 'alice', templateId: 'template', title: 'Daily', type: 'cron', enabled: true,
            cronExpression: '0 6 * * *', timezone: 'UTC', lastRunAt: now - 86_400_000, createdAt: 1, updatedAt: 1,
        }, now);
        const webhook = (service as unknown as { dueSlot(trigger: unknown, at: number): string | undefined }).dueSlot({
            id: 'hook', ownerLogin: 'alice', templateId: 'template', title: 'Hook', type: 'webhook', enabled: true, createdAt: 1, updatedAt: 1,
        }, now);
        expect(cron).to.equal(`cron:${Date.parse('2026-06-01T06:00:00.000Z')}`);
        expect(webhook).to.equal(undefined);
    });

    it('allows the next schedule after a replica died while marking the prior admission running', () => {
        const service = Object.create(QaapJobLoopTriggerService.prototype) as QaapJobLoopTriggerService;
        const now = Date.parse('2026-06-01T06:10:00.000Z');
        const slot = (service as unknown as { dueSlot(trigger: unknown, at: number): string | undefined }).dueSlot({
            id: 'interval', ownerLogin: 'alice', templateId: 'template', title: 'Every five minutes',
            type: 'interval', enabled: true, intervalMinutes: 5, lastRunState: 'running',
            lastRunAt: now - 6 * 60_000, createdAt: 1, updatedAt: 1,
        }, now);

        expect(slot).to.equal(`interval:${Math.floor(now / (5 * 60_000))}`);
    });

    it('uses an owner-scoped template and deterministic webhook idempotency key', async () => {
        const service = Object.create(QaapJobLoopTriggerService.prototype) as QaapJobLoopTriggerService;
        const calls: Array<{ owner?: string; key?: string }> = [];
        let leaseReleased = false;
        Object.assign(service, {
            store: { markRun: () => Promise.resolve() },
            leases: { acquire: () => ({ expiresAt: Date.now() + 60_000, release: () => leaseReleased = true }) },
            auth: { resolveOwnedRepositoryCwdForLogin: (_owner: string, cwd: string) => ({ kind: 'ok', cwd }) },
            templates: { get: (owner: string, id: string) => owner === 'alice' && id === 'template'
                ? { definition: { graph: { nodes: [{ key: 'one', request: { command: 'true', cwd: '/repo' } }] }, until: { nodeKey: 'one', operator: 'truthy' } } }
                : undefined },
            engine: {
                validate: () => undefined,
                create: (request: { idempotencyKey?: string }, owner?: string) => { calls.push({ owner, key: request.idempotencyKey }); return Promise.resolve({ loop: { id: 'loop-1' } }); },
            },
        });
        await (service as unknown as { run(trigger: unknown, source: 'webhook', slot: string): Promise<void> }).run({
            id: 'trigger-1', ownerLogin: 'alice', templateId: 'template', title: 'Hook', type: 'webhook', enabled: true, createdAt: 1, updatedAt: 1,
        }, 'webhook', 'delivery-1');
        expect(calls).to.deep.equal([{ owner: 'alice', key: `trigger:trigger-1:webhook:${createHash('sha256').update('delivery-1').digest('hex')}` }]);
        expect(leaseReleased).to.equal(true);
    });

    it('does not run when another replica owns its trigger slot', async () => {
        const service = Object.create(QaapJobLoopTriggerService.prototype) as QaapJobLoopTriggerService;
        let marked = false;
        Object.assign(service, {
            store: { markRun: () => { marked = true; return Promise.resolve(); } },
            leases: { acquire: () => undefined },
        });
        await (service as unknown as { run(trigger: unknown, source: 'interval', slot: string): Promise<void> }).run({
            id: 'trigger-1', ownerLogin: 'alice', templateId: 'template', title: 'Hourly', type: 'interval', enabled: true, createdAt: 1, updatedAt: 1,
        }, 'interval', 'interval:1');
        expect(marked).to.equal(false);
    });

    it('retains a scheduled slot claim so another replica cannot admit the same slot', async () => {
        const service = Object.create(QaapJobLoopTriggerService.prototype) as QaapJobLoopTriggerService;
        let leaseReleased = false;
        Object.assign(service, {
            store: { markRun: () => Promise.resolve() },
            leases: { acquire: () => ({ expiresAt: Date.now() + 60_000, release: () => leaseReleased = true }) },
            auth: { resolveOwnedRepositoryCwdForLogin: (_owner: string, cwd: string) => ({ kind: 'ok', cwd }) },
            templates: { get: () => ({ definition: { graph: { nodes: [{ key: 'one', request: { command: 'true', cwd: '/repo' } }] }, until: { nodeKey: 'one', operator: 'truthy' } } }) },
            engine: { validate: () => undefined, create: () => Promise.resolve({ loop: { id: 'loop-1' } }) },
        });

        await (service as unknown as { run(trigger: unknown, source: 'interval', slot: string): Promise<void> }).run({
            id: 'trigger-1', ownerLogin: 'alice', templateId: 'template', title: 'Hourly', type: 'interval', enabled: true, createdAt: 1, updatedAt: 1,
        }, 'interval', 'interval:1');

        expect(leaseReleased).to.equal(false);
    });
});
