// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import type { QaapTenantRuntimeMetrics as QaapTenantRuntimeMetricsSnapshot } from '../common/qaap-cloud-api-types';

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

    snapshot(): QaapTenantRuntimeMetricsSnapshot {
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
        };
    }
}
