// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { FileUri } from '@theia/core/lib/common/file-uri';
import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import { conversationCwdProjectId, mergeConversationCwdProjects } from './mobile-projects-sessions-sidebar-conversation-projects';

const BASE = '/workspace/repos/alice/claude-of-duty';
const WT1 = '/tmp/qaap-worktrees/alice/e895ac21';
const WT2 = '/tmp/qaap-worktrees/alice/bcd8daa6';

const summary = (id: string, cwd: string, createdAt: number, extra: Partial<QaapAgentConversationSummaryDTO> = {}): QaapAgentConversationSummaryDTO => ({
    id,
    cwd,
    agentId: 'qaiq',
    title: id,
    status: 'idle',
    createdAt,
    updatedAt: createdAt,
    messageCount: 1,
    ...extra,
} as QaapAgentConversationSummaryDTO);

const baseProject = (name: string): MobileProjectEntry => ({
    id: 'github:alice/claude-of-duty',
    name,
    uri: FileUri.create(BASE),
    color: '#000', branch: 'main', status: 'idle', task: '', progress: 0, agents: [],
    lastActive: '—', tokens: '—', cost: '—', pinned: false, isCurrent: false,
});

describe('mergeConversationCwdProjects', () => {
    it('names worktree projects <projectName>_<n> instead of the hash directory', () => {
        const merged = mergeConversationCwdProjects([baseProject('claude-of-duty')], [
            summary('base-chat', BASE, 1),
            summary('wt1', WT1, 2, { parallelBaseCwd: BASE, worktreeOrdinal: 1 }),
            summary('wt2', WT2, 3, { parallelBaseCwd: BASE, worktreeOrdinal: 2 }),
        ]);
        expect(merged.map(project => project.name)).to.deep.equal(['claude-of-duty', 'claude-of-duty_1', 'claude-of-duty_2']);
        // The hash stays the internal key (project id / uri).
        expect(merged[1].id).to.equal(conversationCwdProjectId(WT1));
        expect(merged[1].uri?.path.base).to.equal('e895ac21');
    });

    it('uses the source project display name and relabels existing hash-named entries', () => {
        const stale = mergeConversationCwdProjects([baseProject('Claude of Duty')], [summary('wt1', WT1, 2)]);
        expect(stale[1].name).to.equal('e895ac21');
        const relabelled = mergeConversationCwdProjects(stale, [summary('wt1', WT1, 2, { parallelBaseCwd: BASE, worktreeOrdinal: 1 })]);
        expect(relabelled.map(project => project.name)).to.deep.equal(['Claude of Duty', 'Claude of Duty_1']);
    });

    it('derives labels for legacy worktrees without a persisted ordinal (creation order)', () => {
        const merged = mergeConversationCwdProjects([], [
            summary('late', WT2, 20, { parallelBaseCwd: BASE }),
            summary('early', WT1, 10, { parallelBaseCwd: BASE }),
        ]);
        const byBase = new Map(merged.map(project => [project.uri?.path.base, project.name]));
        expect(byBase.get('e895ac21')).to.equal('claude-of-duty_1');
        expect(byBase.get('bcd8daa6')).to.equal('claude-of-duty_2');
    });

    it('does not resurrect a project whose removal is pending', () => {
        const pending = conversationCwdProjectId(WT1);
        const merged = mergeConversationCwdProjects([], [summary('wt1', WT1, 2, { parallelBaseCwd: BASE, worktreeOrdinal: 1 })], id => id === pending);
        expect(merged).to.deep.equal([]);
    });

    it('does not re-synthesize a catalog project being deleted from its own conversations', () => {
        const pendingUri = FileUri.create(BASE).toString().toLowerCase();
        const merged = mergeConversationCwdProjects([], [summary('base-chat', BASE, 1)],
            (_id, uri) => uri.toString().toLowerCase() === pendingUri);
        expect(merged).to.deep.equal([]);
    });
});
