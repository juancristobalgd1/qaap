// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { FileUri } from '@theia/core/lib/common/file-uri';
import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import { resolveQaapWorktreeLabelsByCwd } from '@theia/qaap-shared-core/lib/common/qaap-worktree-label';

/** Id of the synthetic sidebar project that stands for a conversation cwd. */
export const conversationCwdProjectId = (cwd: string): string => `ws:${FileUri.create(cwd).toString()}`;

const uriKey = (uri: { toString(): string } | undefined): string | undefined => uri?.toString().toLowerCase();

/**
 * Add a synthetic project for every conversation cwd that no catalog project covers, so authenticated
 * history stays reachable before the repository catalog loads. Worktree conversations (cwd is a hash
 * directory under the worktrees root, `parallelBaseCwd` is the source repo) are named
 * `<projectName>_<n>` instead of the hash; existing synthetic entries are relabelled in place so a
 * label that arrives later (e.g. after a server backfill) replaces the hash.
 *
 * @param isRemovalPending projects the user is deleting right now — never re-synthesized from the
 *        thread store while the optimistic delete is in flight.
 */
export const mergeConversationCwdProjects = (
    projects: readonly MobileProjectEntry[],
    summaries: readonly QaapAgentConversationSummaryDTO[],
    isRemovalPending: (projectId: string, uri: { toString(): string }) => boolean = () => false,
): MobileProjectEntry[] => {
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

    const merged = projects.map(project => {
        if (!project.id.startsWith('ws:') || project.isCurrent) {
            return project;
        }
        const label = labelFor(project.uri);
        return label && label !== project.name ? { ...project, name: label } : project;
    });
    const seen = new Set(merged.map(project => uriKey(project.uri)).filter((key): key is string => !!key));
    for (const summary of summaries) {
        if (!summary.cwd) {
            continue;
        }
        const uri = FileUri.create(summary.cwd);
        const key = uriKey(uri)!;
        if (seen.has(key)) {
            continue;
        }
        const id = conversationCwdProjectId(summary.cwd);
        if (isRemovalPending(id, uri)) {
            continue;
        }
        seen.add(key);
        merged.push({
            id, name: labelFor(uri) ?? uri.path.base, uri,
            color: 'var(--theia-descriptionForeground)', branch: '', status: 'idle',
            task: '', progress: 0, agents: [], lastActive: '', tokens: '—', cost: '—', pinned: false, isCurrent: false
        });
    }
    return merged;
};
