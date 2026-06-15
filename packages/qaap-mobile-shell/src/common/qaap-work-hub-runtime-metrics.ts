// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Browser tab memory snapshot (Chrome `performance.memory`). */
export interface QaapMemorySnapshot {
    readonly jsHeapUsedMb: number;
    readonly jsHeapTotalMb: number;
    readonly jsHeapLimitMb?: number;
}

/** Result of a short rAF-based FPS sample while the main thread is under load. */
export interface QaapFpsSampleResult {
    readonly durationMs: number;
    readonly frameCount: number;
    readonly medianFps: number;
    readonly p95FrameMs: number;
    readonly droppedFrames: number;
    readonly longTaskCount: number;
    readonly maxLongTaskMs: number;
}

export interface QaapNavigationTimingResult {
    readonly conversationId: string;
    readonly durationMs: number;
    readonly historyVisible: boolean;
    readonly hubScrollReplaceChildren: number;
    readonly inlineExecutionConnected: boolean;
}

export interface QaapRuntimeSnapshot {
    readonly memory?: QaapMemorySnapshot;
    readonly workHubFirstShowMs?: number;
    readonly lastNavigation?: QaapNavigationTimingResult;
}

interface PerformanceMemory {
    readonly usedJSHeapSize: number;
    readonly totalJSHeapSize: number;
    readonly jsHeapSizeLimit?: number;
}

/** Read Chrome heap counters when available. */
export function readQaapMemorySnapshot(): QaapMemorySnapshot | undefined {
    if (typeof performance === 'undefined') {
        return undefined;
    }
    const memory = (performance as Performance & { memory?: PerformanceMemory }).memory;
    if (!memory) {
        return undefined;
    }
    return {
        jsHeapUsedMb: round2(memory.usedJSHeapSize / (1024 * 1024)),
        jsHeapTotalMb: round2(memory.totalJSHeapSize / (1024 * 1024)),
        jsHeapLimitMb: memory.jsHeapSizeLimit !== undefined
            ? round2(memory.jsHeapSizeLimit / (1024 * 1024))
            : undefined,
    };
}

/**
 * Samples frame pacing via `requestAnimationFrame`. Long tasks are counted with
 * `PerformanceObserver` when supported — a practical proxy for main-thread CPU pressure
 * in the browser (real process CPU requires CDP or backend metrics).
 */
export class QaapWorkHubFpsSampler {

    protected rafId = 0;
    protected startedAt = 0;
    protected frameTimes: number[] = [];
    protected longTaskCount = 0;
    protected maxLongTaskMs = 0;
    protected longTaskCountAtStart = 0;
    protected maxLongTaskMsAtStart = 0;
    protected longTaskObserver: PerformanceObserver | undefined;

    start(): void {
        this.frameTimes = [];
        this.startedAt = performance.now();
        this.ensureLongTaskObserver();
        this.longTaskCountAtStart = this.longTaskCount;
        this.maxLongTaskMsAtStart = this.maxLongTaskMs;
        const tick = (now: number): void => {
            this.frameTimes.push(now);
            this.rafId = requestAnimationFrame(tick);
        };
        this.rafId = requestAnimationFrame(tick);
    }

    stop(): QaapFpsSampleResult {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = 0;
        }
        const durationMs = Math.max(1, performance.now() - this.startedAt);
        const deltas: number[] = [];
        let droppedFrames = 0;
        for (let index = 1; index < this.frameTimes.length; index++) {
            const delta = this.frameTimes[index] - this.frameTimes[index - 1];
            deltas.push(delta);
            if (delta > 32) {
                droppedFrames++;
            }
        }
        const medianFrameMs = median(deltas) ?? 16.67;
        const p95FrameMs = percentile(deltas, 0.95) ?? medianFrameMs;
        const medianFps = round2(1000 / Math.max(medianFrameMs, 1));
        return {
            durationMs: round2(durationMs),
            frameCount: this.frameTimes.length,
            medianFps,
            p95FrameMs: round2(p95FrameMs),
            droppedFrames,
            longTaskCount: this.longTaskCount - this.longTaskCountAtStart,
            maxLongTaskMs: round2(Math.max(0, this.maxLongTaskMs - this.maxLongTaskMsAtStart)),
        };
    }

    protected ensureLongTaskObserver(): void {
        if (this.longTaskObserver !== undefined || typeof PerformanceObserver === 'undefined') {
            return;
        }
        try {
            this.longTaskObserver = new PerformanceObserver(list => {
                for (const entry of list.getEntries()) {
                    this.longTaskCount++;
                    this.maxLongTaskMs = Math.max(this.maxLongTaskMs, entry.duration);
                }
            });
            this.longTaskObserver.observe({ entryTypes: ['longtask'] });
        } catch {
            /* unsupported */
        }
    }

    dispose(): void {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = 0;
        }
        this.longTaskObserver?.disconnect();
        this.longTaskObserver = undefined;
    }
}

export function formatQaapFpsSampleLog(sample: QaapFpsSampleResult): string {
    return [
        '[Qaap work-hub fps]',
        `duration=${sample.durationMs}ms`,
        `medianFps=${sample.medianFps}`,
        `p95Frame=${sample.p95FrameMs}ms`,
        `frames=${sample.frameCount}`,
        `dropped=${sample.droppedFrames}`,
        `longTasks=${sample.longTaskCount}`,
        `maxLongTask=${sample.maxLongTaskMs}ms`,
    ].join(' ');
}

export function formatQaapMemorySnapshotLog(snapshot: QaapMemorySnapshot): string {
    const limit = snapshot.jsHeapLimitMb !== undefined ? ` limit=${snapshot.jsHeapLimitMb}MB` : '';
    return `[Qaap work-hub memory] used=${snapshot.jsHeapUsedMb}MB total=${snapshot.jsHeapTotalMb}MB${limit}`;
}

export function logQaapFpsSample(sample: QaapFpsSampleResult | undefined): void {
    if (!sample || typeof console === 'undefined' || typeof console.info !== 'function') {
        return;
    }
    console.info(formatQaapFpsSampleLog(sample));
}

export function logQaapMemorySnapshot(snapshot: QaapMemorySnapshot | undefined): void {
    if (!snapshot || typeof console === 'undefined' || typeof console.info !== 'function') {
        return;
    }
    console.info(formatQaapMemorySnapshotLog(snapshot));
}

export function waitForAnimationFrames(count: number): Promise<void> {
    if (typeof requestAnimationFrame === 'undefined' || count <= 0) {
        return Promise.resolve();
    }
    return new Promise(resolve => {
        let remaining = count;
        const step = (): void => {
            remaining--;
            if (remaining <= 0) {
                resolve();
                return;
            }
            requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    });
}

function median(values: readonly number[]): number | undefined {
    if (values.length === 0) {
        return undefined;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
}

function percentile(values: readonly number[], ratio: number): number | undefined {
    if (values.length === 0) {
        return undefined;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
    return sorted[index];
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}
