// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { createHash, randomUUID } from 'crypto';
import { lastCronFireAt, cronSlotIsDue } from '@theia/qaap-mobile-shell/lib/common/qaap-work-hub-cron';
import { QAAP_SKIP_AUTH_USER_LOGIN } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { QaapGithubAuthGuard } from '@theia/qaap-mobile-shell/lib/node/qaap-github-auth-guard';
import { QaapCreateJobLoopRequest } from '../common/qaap-job-loop';
import { QaapJobLoopTemplateDefinition } from '../common/qaap-job-loop-template';
import { QaapJobLoopTrigger } from '../common/qaap-job-loop-trigger';
import { QaapJobLoopEngine } from './qaap-job-loop-engine';
import { QaapJobLoopTemplateStore } from './qaap-job-loop-template-store';
import { QaapJobLoopTriggerLeaseManager } from './qaap-job-loop-trigger-lease';
import { QaapJobLoopTriggerStore } from './qaap-job-loop-trigger-store';

const TICK_MS = 60_000;

/** Executes durable job-loop templates from schedules and authenticated webhook deliveries. */
@injectable()
export class QaapJobLoopTriggerService {

    @inject(QaapJobLoopTriggerStore)
    protected readonly store: QaapJobLoopTriggerStore;
    @inject(QaapJobLoopTemplateStore)
    protected readonly templates: QaapJobLoopTemplateStore;
    @inject(QaapJobLoopEngine)
    protected readonly engine: QaapJobLoopEngine;
    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;
    @inject(QaapJobLoopTriggerLeaseManager)
    protected readonly leases: QaapJobLoopTriggerLeaseManager;

    protected timer: NodeJS.Timeout | undefined;
    protected ticking = false;
    protected stopping = false;
    protected readonly chains = new Map<string, Promise<unknown>>();

    @postConstruct()
    protected start(): void {
        this.timer = setInterval(() => void this.tick(), TICK_MS);
        this.timer.unref?.();
        void this.tick();
    }

    async fireManual(ownerLogin: string, id: string): Promise<QaapJobLoopTrigger | undefined> {
        const trigger = this.store.get(ownerLogin, id);
        if (!trigger) { return undefined; }
        await this.enqueue(trigger.id, () => this.run(trigger, 'manual', randomUUID()));
        return this.store.get(ownerLogin, id);
    }

    async fireWebhook(id: string, deliveryId?: string): Promise<'missing' | 'duplicate' | 'accepted'> {
        const trigger = this.store.getAny(id);
        if (!trigger || trigger.type !== 'webhook' || !trigger.enabled) { return 'missing'; }
        if (!await this.store.claimDelivery(id, deliveryId)) { return 'duplicate'; }
        await this.enqueue(id, () => this.run(trigger, 'webhook', deliveryId?.trim() || randomUUID()));
        return 'accepted';
    }

    async shutdown(): Promise<void> {
        this.stopping = true;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
        await Promise.all([...this.chains.values()].map(chain => chain.catch(() => undefined)));
    }

    protected async tick(): Promise<void> {
        if (this.stopping || this.ticking) { return; }
        this.ticking = true;
        try {
            const now = Date.now();
            for (const trigger of this.store.listAll()) {
                const slot = this.dueSlot(trigger, now);
                if (slot) { void this.enqueue(trigger.id, () => this.run(trigger, trigger.type, slot)); }
            }
        } finally { this.ticking = false; }
    }

    protected dueSlot(trigger: QaapJobLoopTrigger, now: number): string | undefined {
        if (!trigger.enabled || trigger.type === 'webhook') { return undefined; }
        if (trigger.type === 'interval') {
            const intervalMs = (trigger.intervalMinutes ?? 5) * 60_000;
            if (now - (trigger.lastRunAt ?? 0) < intervalMs) { return undefined; }
            return `interval:${Math.floor(now / intervalMs)}`;
        }
        if (!cronSlotIsDue(trigger.cronExpression ?? '', trigger.timezone ?? 'UTC', trigger.lastRunAt, now)) { return undefined; }
        const fire = lastCronFireAt(trigger.cronExpression ?? '', trigger.timezone ?? 'UTC', new Date(now));
        return fire ? `cron:${fire.getTime()}` : undefined;
    }

    protected enqueue(id: string, operation: () => Promise<void>): Promise<void> {
        const previous = this.chains.get(id) ?? Promise.resolve();
        const next = previous.catch(() => undefined).then(operation);
        this.chains.set(id, next.then(() => undefined, () => undefined));
        return next;
    }

    protected async run(trigger: QaapJobLoopTrigger, source: 'manual' | 'interval' | 'cron' | 'webhook', slot: string): Promise<void> {
        if (this.stopping || !trigger.enabled) { return; }
        const lease = this.leases.acquire(trigger.id, slot);
        if (!lease) { return; }
        try {
            await this.store.markRun(trigger.id, undefined, 'running');
            const template = this.templates.get(trigger.ownerLogin, trigger.templateId);
            if (!template?.definition) { throw new Error('Job loop template not found.'); }
            const definition = this.canonicalizeDefinition(trigger.ownerLogin, template.definition);
            const result = await this.engine.create({
                ...definition,
                idempotencyKey: this.idempotencyKey(trigger.id, source, slot),
            }, trigger.ownerLogin);
            await this.store.markRun(trigger.id, result.loop.id, 'completed');
        } catch (error) {
            await this.store.markRun(trigger.id, undefined, 'failed').catch(markError =>
                console.warn(`[qaap-job-loop-triggers] failed to persist trigger ${trigger.id} failure:`, markError));
            console.warn(`[qaap-job-loop-triggers] trigger ${trigger.id} failed:`, error);
        } finally {
            if (source === 'manual' || source === 'webhook') {
                lease.release();
            }
        }
    }

    /** A fixed-length, engine-valid key; untrusted delivery ids never enter it verbatim. */
    protected idempotencyKey(triggerId: string, source: string, slot: string): string {
        const canonicalSource = /^[a-z]+$/.test(source) ? source : 'event';
        const digest = createHash('sha256').update(slot.trim()).digest('hex');
        return `trigger:${triggerId}:${canonicalSource}:${digest}`;
    }

    /** Re-check durable paths at fire time so edited or legacy state cannot escape its tenant. */
    protected canonicalizeDefinition(ownerLogin: string, definition: QaapJobLoopTemplateDefinition): QaapCreateJobLoopRequest {
        const nodes = definition.graph.nodes.map(node => {
            const resolved = ownerLogin === QAAP_SKIP_AUTH_USER_LOGIN
                ? this.auth.resolveOwnedRepositoryCwd({ kind: 'skip', userLogin: ownerLogin }, node.request.cwd)
                : this.auth.resolveOwnedRepositoryCwdForLogin(ownerLogin, node.request.cwd);
            if (resolved.kind !== 'ok') {
                throw new Error('Job loop trigger workspace is no longer available.');
            }
            return {
                key: node.key,
                request: { ...node.request, cwd: resolved.cwd },
                dependsOn: node.dependsOn,
                bindings: node.bindings,
            };
        });
        const canonical = { ...definition, graph: { nodes } };
        this.engine.validate(canonical);
        return canonical;
    }
}
