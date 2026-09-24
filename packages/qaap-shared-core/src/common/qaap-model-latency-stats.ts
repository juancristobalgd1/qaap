// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Observed per-model turn latency, tracked client-side so the composer's model picker can show a
 * real-world duration signal instead of leaving users to discover — mid-task — that a given free
 * model routinely takes 3-19 minutes per turn. Backed by `localStorage`; each model keeps a small
 * ring of its most recent turn durations, so the reported median stays cheap to compute and
 * naturally adapts if a provider gets faster or slower over time.
 */

const STORAGE_KEY = 'qaap.modelTurnStats.v1';

/** Number of most-recent turn durations kept per model. */
export const MODEL_TURN_STATS_RING_SIZE = 8;

/** Median turn duration above which a model is flagged as slow in the picker (2 minutes). */
export const MODEL_TURN_STATS_SLOW_THRESHOLD_MS = 120_000;

interface QaapModelTurnStatsEntry {
    /** Most recent observed turn durations (ms), oldest first, capped at {@link MODEL_TURN_STATS_RING_SIZE}. */
    readonly durations: number[];
}

type QaapModelTurnStatsStore = Record<string, QaapModelTurnStatsEntry>;

export interface QaapModelTurnStatsSummary {
    /** Median observed turn duration in milliseconds. */
    readonly median: number;
    /** Number of samples the median was computed from. */
    readonly samples: number;
}

/** Minimal shape needed to derive the canonical per-model stats key. */
export interface QaapModelStatsKeySource {
    readonly provider: string;
    readonly modelId: string;
}

/**
 * Canonical per-model stats key: `${provider}/${modelId}` lowercased. Aligned with the
 * `QaapAgentModelSelection` shape used across `qaap-agent-model-selection.ts` (provider + modelId
 * identify a model; `vendor` is a display/catalog grouping, not part of identity).
 */
export function canonicalModelStatsKey(model: QaapModelStatsKeySource): string {
    return `${model.provider}/${model.modelId}`.toLowerCase();
}

/** Pushes a new duration onto a ring, keeping only the last {@link MODEL_TURN_STATS_RING_SIZE} samples. Pure — no I/O. */
export function pushTurnDuration(durations: readonly number[], durationMs: number): number[] {
    return [...durations, durationMs].slice(-MODEL_TURN_STATS_RING_SIZE);
}

/** Computes the median of a non-empty list of durations. Pure — no I/O. */
export function medianDuration(durations: readonly number[]): number {
    const sorted = [...durations].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function sanitizeDurations(value: unknown): number[] {
    const durations = value && typeof value === 'object' ? (value as { durations?: unknown }).durations : undefined;
    if (!Array.isArray(durations)) {
        return [];
    }
    return durations
        .filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry) && entry > 0)
        .slice(-MODEL_TURN_STATS_RING_SIZE);
}

function readStore(): QaapModelTurnStatsStore {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return {};
        }
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') {
            return {};
        }
        const store: QaapModelTurnStatsStore = {};
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
            const durations = sanitizeDurations(value);
            if (durations.length > 0) {
                store[key] = { durations };
            }
        }
        return store;
    } catch {
        return {};
    }
}

function writeStore(store: QaapModelTurnStatsStore): void {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
        /* localStorage unavailable (private mode, quota exceeded, non-browser context) */
    }
}

/** Records one observed turn duration for a model, keeping only the last {@link MODEL_TURN_STATS_RING_SIZE}. */
export function recordModelTurnDuration(modelKey: string, durationMs: number): void {
    if (!modelKey.trim() || !Number.isFinite(durationMs) || durationMs <= 0) {
        return;
    }
    const store = readStore();
    const existing = store[modelKey]?.durations ?? [];
    store[modelKey] = { durations: pushTurnDuration(existing, durationMs) };
    writeStore(store);
}

/** Resolves the observed median turn duration for a model, if any samples have been recorded. */
export function resolveModelTurnStats(modelKey: string): QaapModelTurnStatsSummary | undefined {
    const durations = readStore()[modelKey]?.durations;
    if (!durations || durations.length === 0) {
        return undefined;
    }
    return { median: medianDuration(durations), samples: durations.length };
}

/** Formats a duration as e.g. `45s` or `2m 10s`, matching the style of the package's other duration chips. */
export function formatTurnDuration(ms: number): string {
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes === 0) {
        return `${seconds}s`;
    }
    if (seconds === 0) {
        return `${minutes}m`;
    }
    return `${minutes}m ${seconds}s`;
}
