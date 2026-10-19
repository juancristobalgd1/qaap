// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { FileUri } from '@theia/core/lib/common/file-uri';
import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import { resolveQaapWorktreeLabelsByCwd } from '@theia/qaap-shared-core/lib/common/qaap-worktree-label';
import { qaapProjectRemovalIdentity } from '@theia/qaap-shared-core/lib/common/qaap-project-removal-identity';

/** Id of the synthetic sidebar project that stands for a conversation cwd. */
export const conversationCwdProjectId = (cwd: string): string => `ws:${FileUri.create(cwd).toString()}`;

// Trailing separators are dropped: `…/repo/` and `…/repo` are the same folder.
const uriKey = (uri: { toString(): string } | undefined): string | undefined => uri?.toString().toLowerCase().replace(/\/+$/, '');

/**
 * `github:owner/repo` of a repository clone ROOT at `cwd` (a folder below the root does not count:
 * the clone's card only lists the conversations run at its root), whatever layout the clone path uses.
 */
const cloneRootIdentity = (cwd: string | undefined): string | undefined => {
    const identity = qaapProjectRemovalIdentity(cwd);
    if (!cwd || !identity?.startsWith('github:')) {
        return undefined;
    }
    const base = cwd.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop()?.toLowerCase();
    return base === identity.slice(identity.indexOf('/') + 1) ? identity : undefined;
};

/** Every `github:owner/repo` identity a catalog card answers to (its repository, id or clone URI). */
const projectCloneIdentities = (project: MobileProjectEntry): string[] => [
    project.github ? `github:${project.github.owner}/${project.github.name}` : undefined,
    project.id,
    project.uri?.toString(),
].map(key => qaapProjectRemovalIdentity(key))
    .filter((identity): identity is string => !!identity?.startsWith('github:'));

/**
 * Source clone (`parallelBaseCwd`) of the task worktree at `uri`, from the conversations run in it, or
 * `undefined` when `uri` is not a known task worktree.
 */
export const worktreeSourceCwdOf = (
    uri: { toString(): string } | undefined,
    summaries: readonly QaapAgentConversationSummaryDTO[],
): string | undefined => {
    const key = uriKey(uri);
    if (!key) {
        return undefined;
    }
    return summaries.find(summary => !!summary.cwd && !!summary.parallelBaseCwd
        && uriKey(FileUri.create(summary.cwd)) === key)?.parallelBaseCwd;
};

/**
 * Add a synthetic project for every conversation cwd that no catalog project covers, so authenticated
 * history stays reachable before the repository catalog loads. Worktree conversations (cwd is a hash
 * directory under the worktrees root, `parallelBaseCwd` is the source repo) are named
 * `<projectName>_<n>` instead of the hash; existing synthetic entries are relabelled in place so a
 * label that arrives later (e.g. after a server backfill) replaces the hash.
 *
 * @param isRemovalPending projects the user is deleting right now — never re-synthesized from the
 *        thread store while the optimistic delete is in flight.
 * @param removedProjects identities the user removed (see `qaapProjectRemovalIdentity`): conversations whose
 *        cwd (or worktree source, `parallelBaseCwd`) is in such a clone never bring its card back, and a
 *        catalog or cached card of a worktree checked out from such a clone is dropped.
 *
 * Archived conversations never add a card: the hub does not list them, and the server archives the
 * conversations of a removed project, whose card they would otherwise bring back.
 *
 * A cwd is covered by a catalog card when both resolve to the same canonical `github:owner/repo`
 * identity, not only when the URIs are byte-identical: a github card without a clone URI yet, a
 * conversation recorded under the legacy flat clone path (`repos/<owner>/<repo>`) while the card
 * carries the per-user one (`repos/users/<login>/<owner>/<repo>`), a trailing slash or a casing
 * difference all used to synthesize a second card with the same name next to the real one.
 */
export const mergeConversationCwdProjects = (
    projects: readonly MobileProjectEntry[],
    summaries: readonly QaapAgentConversationSummaryDTO[],
    isRemovalPending: (projectId: string, uri: { toString(): string }) => boolean = () => false,
    removedProjects: ReadonlySet<string> = new Set(),
): MobileProjectEntry[] => {
    const inRemovedProject = (cwd: string | undefined): boolean => {
        const identity = removedProjects.size > 0 ? qaapProjectRemovalIdentity(cwd) : undefined;
        return !!identity && removedProjects.has(identity);
    };
    // Synthetic `ws:` cards (from an earlier merge) never claim: the deduplicated catalog keeps a `ws:`
    // card next to a github card of the same repo only when the `ws:` one was synthesized here.
    const catalogIdentities = new Set(projects
        .filter(project => project.isCurrent || !project.id.startsWith('ws:'))
        .flatMap(projectCloneIdentities));
    const coveredByCatalog = (cwd: string | undefined): boolean => {
        const identity = cloneRootIdentity(cwd);
        return !!identity && catalogIdentities.has(identity);
    };
    const byUri = new Map<string, MobileProjectEntry>();
    for (const project of projects) {
        const key = uriKey(project.uri);
        if (key && !byUri.has(key)) {
            byUri.set(key, project);
        }
    }
    const labelsByCwd = resolveQaapWorktreeLabelsByCwd(summaries, baseCwd => byUri.get(uriKey(FileUri.create(baseCwd))!)?.name);
    const labelsByUri = new Map<string, string>();
    for (const [cwd, label] of labelsByCwd) {
        labelsByUri.set(uriKey(FileUri.create(cwd))!, label);
    }
    const labelFor = (uri: { toString(): string } | undefined): string | undefined => {
        const key = uriKey(uri);
        return key ? labelsByUri.get(key) : undefined;
    };

    const worktreeSources = new Map<string, string>();
    for (const summary of summaries) {
        if (summary.cwd && summary.parallelBaseCwd) {
            worktreeSources.set(uriKey(FileUri.create(summary.cwd))!, summary.parallelBaseCwd);
        }
    }

    const merged = projects.flatMap(project => {
        if (!project.id.startsWith('ws:')) {
            return [project];
        }
        const key = uriKey(project.uri);
        const worktreeSourceCwd = key ? worktreeSources.get(key) : undefined;
        // Before the current-card shortcut: a worktree open right now must not keep a removed source's card.
        if (inRemovedProject(worktreeSourceCwd) || inRemovedProject(project.uri?.path.toString())) {
            return [];
        }
        if (project.isCurrent) {
            return [project];
        }
        if (coveredByCatalog(project.uri?.path.toString())) {
            return [];
        }
        const label = labelFor(project.uri);
        const relabelled = label && label !== project.name ? { ...project, name: label } : project;
        return [worktreeSourceCwd && worktreeSourceCwd !== relabelled.worktreeSourceCwd ? { ...relabelled, worktreeSourceCwd } : relabelled];
    });
    const seen = new Set(merged.map(project => uriKey(project.uri)).filter((key): key is string => !!key));
    for (const summary of summaries) {
        if (!summary.cwd || summary.archived || inRemovedProject(summary.cwd) || inRemovedProject(summary.parallelBaseCwd)) {
            continue;
        }
        const uri = FileUri.create(summary.cwd);
        const key = uriKey(uri)!;
        if (seen.has(key) || coveredByCatalog(summary.cwd)) {
            continue;
        }
        const id = conversationCwdProjectId(summary.cwd);
        if (isRemovalPending(id, uri)) {
            continue;
        }
        seen.add(key);
        merged.push({
            id, name: labelFor(uri) ?? uri.path.base, uri, ...(summary.parallelBaseCwd ? { worktreeSourceCwd: summary.parallelBaseCwd } : {}),
            color: 'var(--theia-descriptionForeground)', branch: '', status: 'idle',
            task: '', progress: 0, agents: [], lastActive: '', tokens: '—', cost: '—', pinned: false, isCurrent: false
        });
    }
    return merged;
};
