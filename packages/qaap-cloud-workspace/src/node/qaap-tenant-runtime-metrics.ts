// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import type { QaapTenantRuntimeMetrics as QaapTenantRuntimeMetricsSnapshot } from '../common/qaap-cloud-api-types';
import type { QaapTenantBackendWakeSample } from './qaap-tenant-backend-wake-timeline';

/** How many recent tenant backend wakes the percentiles are computed over. */
const BACKEND_WAKE_WINDOW = 100;
/** How many recent task sandbox starts (per source) the percentiles are computed over. */
const TASK_SANDBOX_WINDOW = 100;

/** How the task-sandbox broker served a create (see `QaapTaskSandboxBrokerSandbox.source`). */
export type QaapTaskSandboxStartSource = 'spare' | 'cold' | 'reused';

/** Latency summary of recent tenant backend wakes (cold starts of the per-tenant Theia backend). */
export interface QaapTenantBackendWakeMetrics {
    /** Wakes recorded since this control-plane process started (successful and failed). */
    readonly count: number;
    readonly failures: number;
    /** Successful wakes the percentiles below are computed over (at most the last {@link BACKEND_WAKE_WINDOW}). */
    readonly window: number;
    readonly p50Ms?: number;
    readonly p95Ms?: number;
    readonly maxMs?: number;
    readonly last?: QaapTenantBackendWakeSample;
}

/** Latency summary of one kind of operation over a recent window. */
export interface QaapLatencySummary {
    readonly count: number;
    readonly window: number;
    readonly p50Ms?: number;
    readonly p95Ms?: number;
    readonly maxMs?: number;
}

/**
 * What a task waited for in the broker's `create` (doc/qaap-task-sandbox.md, "Startup budget"):
 * adopting the tenant's spare, starting a new sandbox, or reusing the running one. Spares and
 * toolchain populations are background work, reported separately.
 */
export interface QaapTaskSandboxStartMetrics {
    readonly spare: QaapLatencySummary;
    readonly cold: QaapLatencySummary;
    readonly reused: number;
    readonly sparesCreated: QaapLatencySummary;
    readonly spareFailures: number;
    readonly toolchainPopulations: QaapLatencySummary;
    readonly toolchainFailures: number;
}

export interface QaapTenantRuntimeMetricsReport extends QaapTenantRuntimeMetricsSnapshot {
    readonly backendWake: QaapTenantBackendWakeMetrics;
    readonly taskSandbox: QaapTaskSandboxStartMetrics;
}

/** Process-local counters exposed through the control-plane endpoint and structured logs. */
@injectable()
export class QaapTenantRuntimeMetrics {

    protected scans = 0;
    protected candidates = 0;
    protected stops = 0;
    protected destroys = 0;
    protected stopFailures = 0;
    protected destroyFailures = 0;
    protected coldStarts = 0;
    protected coldStartTotalMs = 0;
    protected lastScanAt: string | undefined;
    protected backendWakes = 0;
    protected backendWakeFailures = 0;
    protected lastBackendWake: QaapTenantBackendWakeSample | undefined;
    /** Total durations of the most recent successful backend wakes, oldest first. */
    protected readonly recentBackendWakeMs: number[] = [];
    protected readonly sandboxStarts = { spare: new QaapLatencyWindow(), cold: new QaapLatencyWindow() };
    protected sandboxReuses = 0;
    protected readonly spareCreations = new QaapLatencyWindow();
    protected spareFailures = 0;
    protected readonly toolchainPopulations = new QaapLatencyWindow();
    protected toolchainFailures = 0;

    recordScan(candidateCount: number): void {
        this.scans += 1;
        this.candidates += Math.max(0, candidateCount);
        this.lastScanAt = new Date().toISOString();
    }

    recordStop(success: boolean): void {
        if (success) {
            this.stops += 1;
        } else {
            this.stopFailures += 1;
        }
    }

    recordDestroy(success: boolean): void {
        if (success) {
            this.destroys += 1;
        } else {
            this.destroyFailures += 1;
        }
    }

    recordColdStart(durationMs: number): void {
        this.coldStarts += 1;
        this.coldStartTotalMs += Math.max(0, durationMs);
    }

    /** Records one tenant backend wake with its phase breakdown (see `QaapTenantBackendWakeTimeline`). */
    recordBackendWake(sample: QaapTenantBackendWakeSample): void {
        this.backendWakes += 1;
        this.lastBackendWake = sample;
        if (!sample.ok) {
            this.backendWakeFailures += 1;
            return;
        }
        this.recentBackendWakeMs.push(Math.max(0, sample.totalMs));
        if (this.recentBackendWakeMs.length > BACKEND_WAKE_WINDOW) {
            this.recentBackendWakeMs.shift();
        }
    }

    /** One task sandbox create as the tenant backend waited for it. */
    recordTaskSandboxStart(source: QaapTaskSandboxStartSource, durationMs: number): void {
        if (source === 'reused') {
            this.sandboxReuses += 1;
            return;
        }
        this.sandboxStarts[source].record(durationMs);
    }

    /** One spare sandbox started in the background (off any task's path). */
    recordSpareSandbox(success: boolean, durationMs: number): void {
        if (success) {
            this.spareCreations.record(durationMs);
        } else {
            this.spareFailures += 1;
        }
    }

    /** One population of the read-only agent toolchain volume (at boot or on a first create). */
    recordToolchainPopulation(success: boolean, durationMs: number): void {
        if (success) {
            this.toolchainPopulations.record(durationMs);
        } else {
            this.toolchainFailures += 1;
        }
    }

    snapshot(): QaapTenantRuntimeMetricsReport {
        return {
            scans: this.scans,
            candidates: this.candidates,
            stops: this.stops,
            destroys: this.destroys,
            stopFailures: this.stopFailures,
            destroyFailures: this.destroyFailures,
            coldStarts: this.coldStarts,
            coldStartTotalMs: this.coldStartTotalMs,
            lastScanAt: this.lastScanAt,
            backendWake: this.backendWakeSnapshot(),
            taskSandbox: {
                spare: this.sandboxStarts.spare.summary(),
                cold: this.sandboxStarts.cold.summary(),
                reused: this.sandboxReuses,
                sparesCreated: this.spareCreations.summary(),
                spareFailures: this.spareFailures,
                toolchainPopulations: this.toolchainPopulations.summary(),
                toolchainFailures: this.toolchainFailures,
            },
        };
    }

    protected backendWakeSnapshot(): QaapTenantBackendWakeMetrics {
        const sorted = [...this.recentBackendWakeMs].sort((a, b) => a - b);
        return {
            count: this.backendWakes,
            failures: this.backendWakeFailures,
            window: sorted.length,
            ...(sorted.length ? {
                p50Ms: this.percentile(sorted, 0.5),
                p95Ms: this.percentile(sorted, 0.95),
                maxMs: sorted[sorted.length - 1],
            } : {}),
            ...(this.lastBackendWake ? { last: this.lastBackendWake } : {}),
        };
    }

    /** Nearest-rank percentile of an ascending, non-empty list. */
    protected percentile(sorted: readonly number[], quantile: number): number {
        const rank = Math.min(sorted.length, Math.max(1, Math.ceil(quantile * sorted.length)));
        return sorted[rank - 1];
    }
}

/** Count and nearest-rank percentiles over the last {@link TASK_SANDBOX_WINDOW} durations. */
class QaapLatencyWindow {

    protected count = 0;
    protected readonly recent: number[] = [];

    record(durationMs: number): void {
        this.count += 1;
        this.recent.push(Math.max(0, durationMs));
        if (this.recent.length > TASK_SANDBOX_WINDOW) {
            this.recent.shift();
        }
    }

    summary(): QaapLatencySummary {
        const sorted = [...this.recent].sort((a, b) => a - b);
        const at = (quantile: number): number => sorted[Math.min(sorted.length, Math.max(1, Math.ceil(quantile * sorted.length))) - 1];
        return {
            count: this.count,
            window: sorted.length,
            ...(sorted.length ? { p50Ms: at(0.5), p95Ms: at(0.95), maxMs: sorted[sorted.length - 1] } : {}),
        };
    }
}
