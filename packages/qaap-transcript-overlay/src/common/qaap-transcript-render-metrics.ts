// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Dev/bench counters for transcript hot-path renders (enable via enableTranscriptRenderMetrics). */
export type QaapTranscriptRenderMetricKind =
    | 'sse_scheduled'
    | 'sse_flushed'
    | 'render_full'
    | 'render_patch_activity'
    | 'render_patch_last_agent'
    | 'render_patch_append'
    | 'render_patch_none'
    | 'render_skip_unchanged_tail'
    | 'timeline_sync'
    | 'timeline_sync_skipped'
    | 'timeline_create'
    | 'timeline_item_sync'
    | 'timeline_item_sync_light'
    | 'timeline_item_sync_skipped';

export type QaapTranscriptRenderMetricsSnapshot = Readonly<Record<QaapTranscriptRenderMetricKind, number>> & {
    readonly enabled: boolean;
};

const METRICS_GLOBAL_KEY = '__QAAP_TRANSCRIPT_RENDER_METRICS__';

type MetricsStore = {
    enabled: boolean;
    counts: Record<QaapTranscriptRenderMetricKind, number>;
};

const EMPTY_COUNTS = (): Record<QaapTranscriptRenderMetricKind, number> => ({
    sse_scheduled: 0,
    sse_flushed: 0,
    render_full: 0,
    render_patch_activity: 0,
    render_patch_last_agent: 0,
    render_patch_append: 0,
    render_patch_none: 0,
    render_skip_unchanged_tail: 0,
    timeline_sync: 0,
    timeline_sync_skipped: 0,
    timeline_create: 0,
    timeline_item_sync: 0,
    timeline_item_sync_light: 0,
    timeline_item_sync_skipped: 0,
});

function resolveStore(): MetricsStore | undefined {
    if (typeof globalThis === 'undefined') {
        return undefined;
    }
    const root = globalThis as typeof globalThis & { [METRICS_GLOBAL_KEY]?: MetricsStore };
    if (!root[METRICS_GLOBAL_KEY]) {
        root[METRICS_GLOBAL_KEY] = { enabled: false, counts: EMPTY_COUNTS() };
    }
    return root[METRICS_GLOBAL_KEY];
}

export function enableTranscriptRenderMetrics(enabled = true): void {
    const store = resolveStore();
    if (!store) {
        return;
    }
    store.enabled = enabled;
    if (enabled) {
        store.counts = EMPTY_COUNTS();
    }
}

export function isTranscriptRenderMetricsEnabled(): boolean {
    return resolveStore()?.enabled === true;
}

export function resetTranscriptRenderMetrics(): void {
    const store = resolveStore();
    if (!store) {
        return;
    }
    store.counts = EMPTY_COUNTS();
}

export function recordTranscriptRenderMetric(kind: QaapTranscriptRenderMetricKind, count = 1): void {
    const store = resolveStore();
    if (!store?.enabled || count <= 0) {
        return;
    }
    store.counts[kind] += count;
}

export function getTranscriptRenderMetricsSnapshot(): QaapTranscriptRenderMetricsSnapshot {
    const store = resolveStore();
    if (!store) {
        return { enabled: false, ...EMPTY_COUNTS() };
    }
    return { enabled: store.enabled, ...store.counts };
}
