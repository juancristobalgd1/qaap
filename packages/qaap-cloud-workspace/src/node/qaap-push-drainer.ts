// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import type { BackendApplicationContribution } from '@theia/core/lib/node';
import { isQaapTenantBackendMode } from '@theia/qaap-adapters/lib/common/qaap-tenant-backend-auth';
import { QaapDockerOrchestrator } from './qaap-docker-orchestrator';
import { QaapWebPushService } from './qaap-web-push-service';
import { QaapPushOwnerRateLimit } from './qaap-push-owner-rate-limit';
import { sanitizeQaapPushRequest } from './qaap-push-payload';
import { QAAP_PUSH_OUTBOX_CAPACITY } from './qaap-push-outbox';

export const QAAP_PUSH_DRAIN_DEFAULT_INTERVAL_MS = 10_000;
/** Per tenant: a backend that does not answer within this window is skipped for this round. */
export const QAAP_PUSH_DRAIN_TENANT_TIMEOUT_MS = 2_000;
const DRAIN_CONCURRENCY = 8;

/**
 * Control-plane side of the push pull model. Every interval it asks each RUNNING tenant backend for
 * its outbox and delivers the notifications with the subscriptions of that tenant's owner. Paused,
 * stopped and unknown tenants are never contacted, so this never wakes an idle backend.
 *
 * The owner is the login the orchestrator bound to the tenant container, never a payload field.
 */
@injectable()
export class QaapPushDrainer implements BackendApplicationContribution {

    @inject(QaapDockerOrchestrator)
    protected readonly docker: QaapDockerOrchestrator;

    @inject(QaapWebPushService)
    protected readonly webPush: QaapWebPushService;

    protected readonly rateLimit = new QaapPushOwnerRateLimit();
    /** Last problem logged per tenant: a repeating failure is logged once, not every tick. */
    protected readonly lastProblem = new Map<string, string>();
    protected timer: NodeJS.Timeout | undefined;
    protected ticking = false;

    onStart(): void {
        if (!this.isEnabled()) {
            return;
        }
        this.timer = setInterval(() => { void this.tick(); }, this.intervalMs());
        this.timer.unref?.();
    }

    onStop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }

    /** Only the control plane of a backend-per-tenant deployment, and only when it can send at all. */
    isEnabled(): boolean {
        return this.docker.isBackendPerTenantEnabled() && !isQaapTenantBackendMode() && this.webPush.isConfigured();
    }

    protected intervalMs(): number {
        const configured = Number.parseInt(process.env.QAAP_PUSH_DRAIN_INTERVAL_MS?.trim() ?? '', 10);
        return Number.isInteger(configured) && configured >= 1_000 ? configured : QAAP_PUSH_DRAIN_DEFAULT_INTERVAL_MS;
    }

    /** One round over the running tenant backends. Exposed for tests. */
    async tick(): Promise<void> {
        if (this.ticking) {
            return;
        }
        this.ticking = true;
        try {
            const owners = await this.runningTenantLogins();
            await this.forEachLimited(owners, DRAIN_CONCURRENCY, owner => this.drainTenant(owner));
        } catch (error) {
            this.logOnce('sweep', `outbox sweep failed: ${reasonOf(error)}`);
        } finally {
            this.ticking = false;
        }
    }

    protected async runningTenantLogins(): Promise<string[]> {
        const containers = await this.docker.listManagedTenantContainers();
        const logins = containers
            .filter(container => container.kind === 'backend' && container.running && !container.paused && !!container.tenantLogin)
            .map(container => container.tenantLogin!.toLowerCase());
        return [...new Set(logins)];
    }

    /** Never throws: every failure is logged (once per cause) and the other tenants carry on. */
    protected async drainTenant(owner: string): Promise<void> {
        let body: unknown;
        try {
            body = await this.withTimeout(this.docker.fetchTenantPushOutbox(owner, QAAP_PUSH_DRAIN_TENANT_TIMEOUT_MS), QAAP_PUSH_DRAIN_TENANT_TIMEOUT_MS);
        } catch {
            this.logOnce(owner, 'no answer within the timeout');
            return;
        }
        if (body === undefined) {
            this.logOnce(owner, 'outbox not reachable');
            return;
        }
        this.lastProblem.delete(owner);
        const entries = this.parseEntries(body);
        let dropped = 0;
        for (const entry of entries) {
            if (!this.rateLimit.tryAcquire(owner)) {
                dropped++;
                continue;
            }
            try {
                await this.webPush.notify({ ...entry, userLogin: owner });
            } catch (error) {
                this.logOnce(owner, `delivery failed: ${reasonOf(error)}`);
            }
        }
        if (dropped > 0) {
            this.logOnce(owner, `rate limit reached: ${dropped} notification(s) dropped`);
        }
    }

    /** Accepts only the documented shape; invalid entries are skipped, the list is capped. */
    protected parseEntries(body: unknown): NonNullable<ReturnType<typeof sanitizeQaapPushRequest>>[] {
        const raw = (body as { entries?: unknown } | undefined)?.entries;
        if (!Array.isArray(raw)) {
            return [];
        }
        return raw.slice(0, QAAP_PUSH_OUTBOX_CAPACITY)
            .map(entry => sanitizeQaapPushRequest(entry))
            .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
    }

    protected logOnce(owner: string, problem: string): void {
        if (this.lastProblem.get(owner) === problem) {
            return;
        }
        this.lastProblem.set(owner, problem);
        console.warn(`[qaap-push-drainer] tenant ${owner}: ${problem}`);
    }

    protected withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('timeout')), ms);
        });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    }

    protected async forEachLimited<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
        let next = 0;
        const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (next < items.length) {
                const item = items[next++];
                await work(item);
            }
        });
        await Promise.all(workers);
    }
}

function reasonOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
