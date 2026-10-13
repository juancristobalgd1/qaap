// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import type { QaapTenantRuntimeMetrics as QaapTenantRuntimeMetricsSnapshot } from '../common/qaap-cloud-api-types';
import type { QaapTenantBackendWakeSample } from './qaap-tenant-backend-wake-timeline';

/** How many recent tenant backend wakes the percentiles are computed over. */
const BACKEND_WAKE_WINDOW = 100;

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

export interface QaapTenantRuntimeMetricsReport extends QaapTenantRuntimeMetricsSnapshot {
    readonly backendWake: QaapTenantBackendWakeMetrics;
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
