// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Fields needed to nest isolated Parallel worktree forks under their parent and to
 * bucket multi-agent {@link parallelRunId} variants. Intentionally structural so both
 * conversation DTOs and inbox items can share the helper.
 */
export interface IsolatedForkGroupingFields {
    readonly id: string;
    readonly forkedFromId?: string;
    readonly parallelRunId?: string;
    readonly worktreeBranch?: string;
}

export interface PartitionedAgentConversations<T extends IsolatedForkGroupingFields> {
    /** Conversations that stay in the flat list (parents, orphans, unrelated sessions). */
    readonly roots: readonly T[];
    /** Isolated Parallel forks keyed by the parent conversation still present in {@link roots}. */
    readonly forksByParentId: ReadonlyMap<string, readonly T[]>;
    /** Multi-agent "Run variants" keyed by {@link IsolatedForkGroupingFields.parallelRunId}. */
    readonly variantRuns: ReadonlyMap<string, readonly T[]>;
}

/**
 * A delivery-mode `'parallel'` fork: dedicated worktree branch, parent id, and not a
 * multi-agent {@link IsolatedForkGroupingFields.parallelRunId} variant.
 */
export const isIsolatedWorktreeFork = (item: IsolatedForkGroupingFields): boolean =>
    !!item.forkedFromId && !item.parallelRunId && !!item.worktreeBranch;

/**
 * Split a project conversation list into flat roots, nested isolated forks, and
 * parallel-run variant buckets. Forks whose parent is missing from {@link items}
 * stay as roots so they never disappear from the list.
 */
export const partitionAgentConversations = <T extends IsolatedForkGroupingFields>(
    items: readonly T[],
): PartitionedAgentConversations<T> => {
    const ids = new Set(items.map(item => item.id));
    const forksByParentId = new Map<string, T[]>();
    const variantRuns = new Map<string, T[]>();
    const nestedForkIds = new Set<string>();
    const variantIds = new Set<string>();

    for (const item of items) {
        if (item.parallelRunId) {
            const bucket = variantRuns.get(item.parallelRunId) ?? [];
            bucket.push(item);
            variantRuns.set(item.parallelRunId, bucket);
            variantIds.add(item.id);
            continue;
        }
        if (isIsolatedWorktreeFork(item) && item.forkedFromId && ids.has(item.forkedFromId)) {
            const bucket = forksByParentId.get(item.forkedFromId) ?? [];
            bucket.push(item);
            forksByParentId.set(item.forkedFromId, bucket);
            nestedForkIds.add(item.id);
        }
    }

    return {
        roots: items.filter(item => !nestedForkIds.has(item.id) && !variantIds.has(item.id)),
        forksByParentId,
        variantRuns,
    };
};

/** Parent row followed immediately by its nested isolated forks (fingerprint + DOM order). */
export const expandConversationSlots = <T extends IsolatedForkGroupingFields>(
    roots: readonly T[],
    forksByParentId: ReadonlyMap<string, readonly T[]>,
): T[] => {
    const out: T[] = [];
    for (const root of roots) {
        out.push(root);
        const forks = forksByParentId.get(root.id);
        if (forks?.length) {
            out.push(...forks);
        }
    }
    return out;
};
