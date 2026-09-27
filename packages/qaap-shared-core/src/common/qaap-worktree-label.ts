// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Display naming for conversations that run in an isolated git worktree ("New Worktree",
 * isolated Parallel forks, parallel-run variants). On disk a worktree keeps its random hash
 * directory (`/tmp/qaap-worktrees/<tenant>/<hash>`), which stays the internal key; the UI shows
 * `<projectName>_<n>` instead, where `n` is a per-source-project ordinal allocated once by the
 * server and persisted on the conversation ({@link QaapWorktreeLabelFields.worktreeOrdinal}).
 *
 * Pure helpers only — shared by the backend allocator and the Work Hub sidebar.
 */

/** Structural subset of a conversation (server model or client summary) used for numbering. */
export interface QaapWorktreeLabelFields {
    readonly id: string;
    readonly cwd: string;
    readonly createdAt: number;
    /** Source repository the worktree was cut from. */
    readonly parallelBaseCwd?: string;
    /** Persisted per-project worktree ordinal (1-based). Absent on legacy conversations. */
    readonly worktreeOrdinal?: number;
    readonly ownerLogin?: string;
}

/** Normalize a cwd for comparisons: forward slashes, no trailing separator. */
export const normalizeWorktreeCwd = (cwd: string): string => {
    let normalized = cwd.replace(/\\/g, '/');
    while (normalized.length > 1 && normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
    }
    return normalized;
};

/** True when the conversation runs in a worktree of another (source) repository. */
export const isQaapWorktreeConversation = (item: Pick<QaapWorktreeLabelFields, 'cwd' | 'parallelBaseCwd'>): boolean =>
    !!item.parallelBaseCwd && !!item.cwd
    && normalizeWorktreeCwd(item.cwd) !== normalizeWorktreeCwd(item.parallelBaseCwd);

/** Numbering bucket: one independent sequence per (owner, source repository). */
export const qaapWorktreeNumberingKey = (baseCwd: string, ownerLogin?: string): string =>
    `${ownerLogin ?? ''}\u0000${normalizeWorktreeCwd(baseCwd)}`;

/** Last path segment of the source repository — the default project name for the label. */
export const qaapWorktreeProjectName = (baseCwd: string): string => {
    const normalized = normalizeWorktreeCwd(baseCwd);
    const segment = normalized.slice(normalized.lastIndexOf('/') + 1);
    return segment || normalized || 'project';
};

/** `<projectName>_<n>`, e.g. `claude-of-duty_2`. */
export const formatQaapWorktreeLabel = (projectName: string, ordinal: number): string =>
    `${projectName}_${ordinal}`;

const isValidOrdinal = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value > 0;

/**
 * Resolve an ordinal for every worktree conversation in {@link items}.
 *
 * - A persisted {@link QaapWorktreeLabelFields.worktreeOrdinal} is always kept as-is, so labels never
 *   change after reload and deleting one conversation never renumbers the others.
 * - Legacy conversations (created before ordinals existed) are numbered after the highest persisted
 *   ordinal of their bucket, one number per worktree directory, in creation order (`createdAt`,
 *   then `id` as a tiebreaker). The server
 *   persists this backfill once on startup, which freezes those numbers too.
 */
export const resolveQaapWorktreeOrdinals = <T extends QaapWorktreeLabelFields>(
    items: readonly T[],
): Map<string, number> => {
    const result = new Map<string, number>();
    const buckets = new Map<string, T[]>();
    for (const item of items) {
        if (!isQaapWorktreeConversation(item)) {
            continue;
        }
        const key = qaapWorktreeNumberingKey(item.parallelBaseCwd!, item.ownerLogin);
        const bucket = buckets.get(key) ?? [];
        bucket.push(item);
        buckets.set(key, bucket);
    }
    for (const bucket of buckets.values()) {
        let max = 0;
        // Several conversations can share one worktree (e.g. a fork copies the cwd): the ordinal
        // belongs to the worktree directory, so they all share it.
        const ordinalByCwd = new Map<string, number>();
        const legacy: T[] = [];
        for (const item of bucket) {
            if (isValidOrdinal(item.worktreeOrdinal)) {
                result.set(item.id, item.worktreeOrdinal);
                max = Math.max(max, item.worktreeOrdinal);
                const cwdKey = normalizeWorktreeCwd(item.cwd);
                if (!ordinalByCwd.has(cwdKey)) {
                    ordinalByCwd.set(cwdKey, item.worktreeOrdinal);
                }
            } else {
                legacy.push(item);
            }
        }
        legacy.sort((a, b) => (a.createdAt - b.createdAt) || a.id.localeCompare(b.id));
        for (const item of legacy) {
            const cwdKey = normalizeWorktreeCwd(item.cwd);
            let ordinal = ordinalByCwd.get(cwdKey);
            if (ordinal === undefined) {
                max += 1;
                ordinal = max;
                ordinalByCwd.set(cwdKey, ordinal);
            }
            result.set(item.id, ordinal);
        }
    }
    return result;
};

/**
 * Next ordinal for a new worktree of {@link baseCwd}: one past both the highest ordinal still in use
 * and the persisted high-water mark (so a deleted top number is never handed out again).
 */
export const nextQaapWorktreeOrdinal = (
    items: readonly QaapWorktreeLabelFields[],
    baseCwd: string,
    ownerLogin: string | undefined,
    highWaterMark = 0,
): number => {
    const key = qaapWorktreeNumberingKey(baseCwd, ownerLogin);
    const ordinals = resolveQaapWorktreeOrdinals(items);
    let max = isValidOrdinal(highWaterMark) ? highWaterMark : 0;
    for (const item of items) {
        if (!isQaapWorktreeConversation(item)
            || qaapWorktreeNumberingKey(item.parallelBaseCwd!, item.ownerLogin) !== key) {
            continue;
        }
        max = Math.max(max, ordinals.get(item.id) ?? 0);
    }
    return max + 1;
};

/**
 * Display label per worktree directory (keyed by {@link normalizeWorktreeCwd}), e.g.
 * `claude-of-duty_2`. {@link projectNameForBase} lets the UI prefer the source project's display
 * name (renamed projects); it falls back to the last segment of the source repository path.
 */
export const resolveQaapWorktreeLabelsByCwd = (
    items: readonly QaapWorktreeLabelFields[],
    projectNameForBase?: (baseCwd: string) => string | undefined,
): Map<string, string> => {
    const ordinals = resolveQaapWorktreeOrdinals(items);
    const labels = new Map<string, string>();
    for (const item of items) {
        const ordinal = ordinals.get(item.id);
        if (ordinal === undefined || !item.parallelBaseCwd) {
            continue;
        }
        const cwdKey = normalizeWorktreeCwd(item.cwd);
        if (labels.has(cwdKey)) {
            continue;
        }
        const projectName = projectNameForBase?.(item.parallelBaseCwd)?.trim() || qaapWorktreeProjectName(item.parallelBaseCwd);
        labels.set(cwdKey, formatQaapWorktreeLabel(projectName, ordinal));
    }
    return labels;
};
