// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import type { BackendApplicationContribution } from '@theia/core/lib/node';
import { QaapDockerOrchestrator, type QaapManagedTenantContainer } from './qaap-docker-orchestrator';
import { QaapTenantActivityTracker } from './qaap-tenant-activity-tracker';
import { QaapTenantRuntimeMetrics } from './qaap-tenant-runtime-metrics';
import { QaapTenantRuntimeStore, type QaapTenantRuntimeRecord } from './qaap-tenant-runtime-store';

const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_DESTROY_AFTER_MS = 24 * 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_FIRST_SWEEP_DELAY_MS = 30 * 1000;

export function resolveTenantRuntimeDuration(raw: string | undefined, fallback: number): number {
    const value = Number.parseInt(raw?.trim() || '', 10);
    return Number.isInteger(value) && value >= 0 ? value : fallback;
}

/** Stops idle tenant runtimes and destroys their ephemeral containers after a retention TTL. */
@injectable()
export class QaapTenantContainerReaper implements BackendApplicationContribution {

    @inject(QaapDockerOrchestrator)
    protected readonly docker: QaapDockerOrchestrator;

    @inject(QaapTenantActivityTracker)
    protected readonly activity: QaapTenantActivityTracker;

    @inject(QaapTenantRuntimeStore)
    protected readonly store: QaapTenantRuntimeStore;

    @inject(QaapTenantRuntimeMetrics)
    protected readonly metrics: QaapTenantRuntimeMetrics;

    protected timer: NodeJS.Timeout | undefined;
    protected firstSweepTimer: NodeJS.Timeout | undefined;
    protected ticking = false;

    onStart(): void {
        if (!this.isEnabled()) {
            return;
        }
        this.firstSweepTimer = setTimeout(() => {
            this.firstSweepTimer = undefined;
            void this.sweep();
        }, this.firstSweepDelayMs());
        this.firstSweepTimer.unref?.();
        this.timer = setInterval(() => { void this.sweep(); }, this.intervalMs());
        this.timer.unref?.();
    }

    onStop(): void {
        if (this.firstSweepTimer) {
            clearTimeout(this.firstSweepTimer);
            this.firstSweepTimer = undefined;
        }
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }

    isEnabled(): boolean {
        const configured = process.env.QAAP_TENANT_REAPER_ENABLED?.trim();
        if (configured !== undefined && configured !== '') {
            return /^(1|true|yes)$/i.test(configured);
        }
        // Docker-hosted runtimes get lifecycle management by default; the explicit flag can still
        // disable it during rollout or incident response. Local/non-Docker runtimes are inert.
        return this.docker.isEnabled();
    }

    protected idleTimeoutMs(): number {
        return resolveTenantRuntimeDuration(process.env.QAAP_TENANT_IDLE_TIMEOUT_MS, DEFAULT_IDLE_TIMEOUT_MS);
    }

    protected destroyAfterMs(): number {
        return resolveTenantRuntimeDuration(process.env.QAAP_TENANT_DESTROY_AFTER_MS, DEFAULT_DESTROY_AFTER_MS);
    }

    protected intervalMs(): number {
        return Math.max(1_000, resolveTenantRuntimeDuration(process.env.QAAP_TENANT_REAPER_INTERVAL_MS, DEFAULT_INTERVAL_MS));
    }

    protected firstSweepDelayMs(): number {
        return Math.max(0, resolveTenantRuntimeDuration(process.env.QAAP_TENANT_REAPER_FIRST_SWEEP_DELAY_MS, DEFAULT_FIRST_SWEEP_DELAY_MS));
    }

    async sweep(now = Date.now()): Promise<void> {
        if (!this.isEnabled() || !this.docker.isEnabled() || this.ticking) {
            return;
        }
        this.ticking = true;
        try {
            const discovered = await this.docker.listManagedTenantContainers();
            const records = new Map(this.store.list().map(record => [record.tenantLogin, record]));
            const byContainerId = new Map<string, QaapTenantRuntimeRecord>();
            for (const record of records.values()) {
                if (record.workerContainerId) {
                    byContainerId.set(record.workerContainerId, record);
                }
                if (record.backendContainerId) {
                    byContainerId.set(record.backendContainerId, record);
                }
            }
            // Older worker containers predate the tenant-login label. They are only attributed
            // when their id is already present in durable metadata; unknown containers remain
            // visible to operators but are never touched by the reaper.
            const containers = discovered.flatMap(container => container.tenantLogin
                ? [container]
                : (() => {
                    const record = byContainerId.get(container.containerId);
                    return record ? [{ ...container, tenantLogin: record.tenantLogin }] : [];
                })());
            const byTenant = this.groupByTenant(containers);
            for (const [tenantLogin, tenantContainers] of byTenant) {
                const current = records.get(tenantLogin) ?? this.adopt(tenantLogin, tenantContainers, now);
                if (!records.has(tenantLogin)) {
                    records.set(tenantLogin, current);
                }
            }
            const candidates = [...records.values()].filter(record => byTenant.has(record.tenantLogin));
            this.metrics.recordScan(candidates.length);
            for (const candidate of candidates) {
                await this.reconcile(candidate, byTenant.get(candidate.tenantLogin) ?? [], now);
            }
        } catch (error) {
            console.warn(`[qaap-runtime] reaper scan failed: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            this.ticking = false;
        }
    }

    protected groupByTenant(containers: readonly QaapManagedTenantContainer[]): Map<string, QaapManagedTenantContainer[]> {
        const grouped = new Map<string, QaapManagedTenantContainer[]>();
        for (const container of containers) {
            if (!container.tenantLogin) {
                continue;
            }
            const current = grouped.get(container.tenantLogin) ?? [];
            current.push(container);
            grouped.set(container.tenantLogin, current);
        }
        return grouped;
    }

    protected adopt(
        tenantLogin: string,
        containers: readonly QaapManagedTenantContainer[],
        now: number,
    ): QaapTenantRuntimeRecord {
        const running = containers.some(container => container.running);
        return this.store.setState(tenantLogin, running ? 'active' : 'stopped', {
            lastActivityAt: new Date(now).toISOString(),
            stoppedAt: running ? undefined : new Date(now).toISOString(),
            workerContainerId: containers.find(container => container.kind === 'worker')?.containerId,
            backendContainerId: containers.find(container => container.kind === 'backend')?.containerId,
            reaperEnabled: true,
        }, now);
    }

    protected async reconcile(
        candidate: QaapTenantRuntimeRecord,
        containers: readonly QaapManagedTenantContainer[],
        now: number,
    ): Promise<void> {
        if (this.activity.isProtected(candidate.tenantLogin, now)) {
            return;
        }
        const latest = this.store.get(candidate.tenantLogin) ?? candidate;
        const lastActivity = Date.parse(latest.lastActivityAt ?? '');
        const activityAt = Number.isFinite(lastActivity) ? lastActivity : now;
        const hasRunning = containers.some(container => container.running);

        if (hasRunning && (latest.state === 'active' || latest.state === 'error') && now - activityAt >= this.idleTimeoutMs()) {
            const idleSince = latest.idleSince ?? new Date(now).toISOString();
            this.store.setState(candidate.tenantLogin, 'idle', {
                idleSince,
                workerContainerId: containers.find(container => container.kind === 'worker')?.containerId,
                backendContainerId: containers.find(container => container.kind === 'backend')?.containerId,
                reaperEnabled: true,
                lastError: undefined,
            }, now);
            await this.stopIfStillIdle(candidate.tenantLogin, activityAt, now);
            return;
        }

        if (hasRunning && latest.state === 'idle' && now - activityAt >= this.idleTimeoutMs()) {
            await this.stopIfStillIdle(candidate.tenantLogin, activityAt, now);
            return;
        }

        if (!hasRunning && (latest.state === 'stopped' || latest.state === 'error') && latest.destroyAfter) {
            const destroyAt = Date.parse(latest.destroyAfter);
            if (Number.isFinite(destroyAt) && destroyAt <= now) {
                await this.destroyIfStillStopped(candidate.tenantLogin, now);
            }
        }
    }

    protected async stopIfStillIdle(tenantLogin: string, activityAt: number, now: number): Promise<void> {
        const latest = this.store.get(tenantLogin);
        if (!latest || this.activity.isProtected(tenantLogin, now) || Date.parse(latest.lastActivityAt ?? '') > activityAt) {
            return;
        }
        try {
            await this.docker.stopTenantRuntime(tenantLogin);
            this.store.setState(tenantLogin, 'stopped', {
                stoppedAt: new Date(now).toISOString(),
                destroyAfter: new Date(now + this.destroyAfterMs()).toISOString(),
                reaperEnabled: true,
                lastError: undefined,
            }, now);
            this.metrics.recordStop(true);
            console.info(`[qaap-runtime] stopped idle tenant ${tenantLogin}`);
        } catch (error) {
            this.metrics.recordStop(false);
            this.store.setState(tenantLogin, 'idle', {
                reaperEnabled: true,
                lastError: error instanceof Error ? error.message : String(error),
            }, now);
            console.warn(`[qaap-runtime] could not stop tenant ${tenantLogin}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    protected async destroyIfStillStopped(tenantLogin: string, now: number): Promise<void> {
        const latest = this.store.get(tenantLogin);
        if (!latest || (latest.state !== 'stopped' && latest.state !== 'error') || this.activity.isProtected(tenantLogin, now)) {
            return;
        }
        try {
            await this.docker.destroyTenantRuntime(tenantLogin);
            this.store.setState(tenantLogin, 'destroyed', {
                workerContainerId: undefined,
                backendContainerId: undefined,
                reaperEnabled: true,
                lastError: undefined,
            }, now);
            this.metrics.recordDestroy(true);
            console.info(`[qaap-runtime] destroyed retained containers for tenant ${tenantLogin}`);
        } catch (error) {
            this.metrics.recordDestroy(false);
            this.store.setState(tenantLogin, 'stopped', {
                reaperEnabled: true,
                lastError: error instanceof Error ? error.message : String(error),
            }, now);
            console.warn(`[qaap-runtime] could not destroy tenant ${tenantLogin}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
