// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { FileUri } from '@theia/core/lib/common/file-uri';
import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import { resolveQaapWorktreeLabelsByCwd } from '@theia/qaap-shared-core/lib/common/qaap-worktree-label';
import { qaapProjectRemovalIdentity } from '@theia/qaap-shared-core/lib/common/qaap-project-removal-identity';
import { qaapCloneRootIdentity, qaapProjectCloneIdentities } from '@theia/qaap-shared-core/lib/common/qaap-project-clone-identity';

/** Id of the synthetic sidebar project that stands for a conversation cwd. */
export const conversationCwdProjectId = (cwd: string): string => `ws:${FileUri.create(cwd).toString()}`;

// Trailing separators are dropped: `…/repo/` and `…/repo` are the same folder.
const uriKey = (uri: { toString(): string } | undefined): string | undefined => uri?.toString().toLowerCase().replace(/\/+$/, '');

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
    // `MobileProjectsConversationIndexUi.conversationsForProject` lists a claimed cwd's conversations
    // under the claiming card through the same `qaapProjectCloneIdentities` rule, so none is hidden.
    const catalogIdentities = new Set(projects.flatMap(qaapProjectCloneIdentities));
    const coveredByCatalog = (cwd: string | undefined): boolean => {
        const identity = qaapCloneRootIdentity(cwd);
        return !!identity && catalogIdentities.has(identity);
    };
    // The card of the workspace open right now also claims, so it is matched against the other cards only.
    const nonSyntheticIdentities = new Set(projects.filter(project => !project.id.startsWith('ws:')).flatMap(qaapProjectCloneIdentities));
    const absorbedCurrentIdentities = new Set<string>();
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

    // NEVER list a project twice. A task worktree (cwd under the worktrees root, `parallelBaseCwd` = its source clone)
    // is not a project: its conversations are listed under the source project's card (conversationsForProject →
    // getVariantsForBaseCwd). Only a worktree whose source has no card at all keeps a `<project>_<n>` card, so its
    // conversations stay reachable.
    const sourceCardKeys = new Set(projects
        .filter(project => !worktreeSources.has(uriKey(project.uri) ?? ''))
        .map(project => uriKey(project.uri))
        .filter((key): key is string => !!key));
    const sourceHasCard = (baseCwd: string | undefined): boolean => !!baseCwd
        && (sourceCardKeys.has(uriKey(FileUri.create(baseCwd))!) || coveredByCatalog(baseCwd));

    const merged = projects.flatMap(project => {
        if (!project.id.startsWith('ws:')) {
            return [project];
        }
        const key = uriKey(project.uri);
        const worktreeSourceCwd = key ? worktreeSources.get(key) : undefined;
        if (sourceHasCard(worktreeSourceCwd)) {
            return [];
        }
        // Before the current-card shortcut: a worktree open right now must not keep a removed source's card.
        if (inRemovedProject(worktreeSourceCwd) || inRemovedProject(project.uri?.path.toString())) {
            return [];
        }
        if (project.isCurrent) {
            // The open workspace is a clone of a repository that already has a card: that card becomes the
            // current one instead of listing the same repository twice.
            const identities = qaapProjectCloneIdentities(project);
            if (identities.some(identity => nonSyntheticIdentities.has(identity))) {
                identities.forEach(identity => absorbedCurrentIdentities.add(identity));
                return [];
            }
            return [project];
        }
        if (coveredByCatalog(project.uri?.path.toString())) {
            return [];
        }
        const label = labelFor(project.uri);
        const relabelled = label && label !== project.name ? { ...project, name: label } : project;
        return [worktreeSourceCwd && worktreeSourceCwd !== relabelled.worktreeSourceCwd ? { ...relabelled, worktreeSourceCwd } : relabelled];
    });
    if (absorbedCurrentIdentities.size > 0) {
        for (let index = 0; index < merged.length; index++) {
            const project = merged[index];
            if (!project.isCurrent && qaapProjectCloneIdentities(project).some(identity => absorbedCurrentIdentities.has(identity))) {
                merged[index] = { ...project, isCurrent: true };
            }
        }
    }
    const seen = new Set(merged.map(project => uriKey(project.uri)).filter((key): key is string => !!key));
    for (const summary of summaries) {
        if (!summary.cwd || summary.archived || inRemovedProject(summary.cwd) || inRemovedProject(summary.parallelBaseCwd)) {
            continue;
        }
        const uri = FileUri.create(summary.cwd);
        const key = uriKey(uri)!;
        if (seen.has(key) || coveredByCatalog(summary.cwd) || sourceHasCard(summary.parallelBaseCwd)) {
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
    // Final pass over the whole list (a source card may have been synthesized above): drop every worktree card whose
    // source project has a card. A project is never listed twice.
    const isWorktreeCard = (project: MobileProjectEntry): boolean => !!project.worktreeSourceCwd || worktreeSources.has(uriKey(project.uri) ?? '');
    const finalSourceKeys = new Set(merged.filter(project => !isWorktreeCard(project))
        .map(project => uriKey(project.uri))
        .filter((key): key is string => !!key));
    return merged.filter(project => {
        if (!project.id.startsWith('ws:') || !isWorktreeCard(project)) {
            return true;
        }
        const source = project.worktreeSourceCwd ?? worktreeSources.get(uriKey(project.uri) ?? '');
        return !source || !(finalSourceKeys.has(uriKey(FileUri.create(source))!) || coveredByCatalog(source));
    });
};
