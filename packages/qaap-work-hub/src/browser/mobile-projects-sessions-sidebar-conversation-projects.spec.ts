// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { FileUri } from '@theia/core/lib/common/file-uri';
import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import { QaapThreadStore } from '@theia/qaap-shared-core/lib/common/qaap-thread-store';
import { MobileProjectsConversationIndexUi, type MobileProjectsConversationIndexHost } from '@theia/qaap-shared-core/lib/browser/mobile-projects-conversation-index-ui';
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

// Production (juancristobalgd1, Oct 7 2026): after vyyq was removed, its conversations (cwd in the clone,
// or in the task worktree 733cf503 checked out from it) re-created a `ws:` card for it on every merge.
describe('mergeConversationCwdProjects for a removed project', () => {
    const VYYQ = '/workspace/repos/users/juancristobalgd1/juancristobalgd1/vyyq';
    const TASK = '/opt/qaap-runtime/worktrees/juancristobalgd1/733cf503';
    const OTHER = '/workspace/repos/users/juancristobalgd1/juancristobalgd1/other';
    const removed = new Set(['github:juancristobalgd1/vyyq']);

    it('never synthesizes a card from conversations in the removed clone or its worktrees', () => {
        const merged = mergeConversationCwdProjects([], [
            summary('chat', VYYQ, 1),
            summary('sub', `${VYYQ}/web`, 2),
            summary('task', TASK, 3, { parallelBaseCwd: VYYQ, worktreeOrdinal: 1 }),
            summary('other', OTHER, 4),
        ], () => false, removed);

        expect(merged.map(project => project.id)).to.deep.equal([conversationCwdProjectId(OTHER)]);
    });

    // Same account: the archived conversation 5e9656ec of task worktree 733cf503 (checked out from vyyq,
    // ordinal 1) kept a cached `ws:` card labelled vyyq_1 alive; removing it brought it straight back.
    const LIVE_WT = '/tmp/qaap-worktrees/juancristobalgd1/733cf503';
    const archivedTask = summary('5e9656ec', LIVE_WT, 3, { parallelBaseCwd: VYYQ, worktreeOrdinal: 1, archived: true });
    const cachedCard = (cwd: string): MobileProjectEntry => ({
        ...baseProject(FileUri.create(cwd).path.base), id: conversationCwdProjectId(cwd), uri: FileUri.create(cwd),
    });

    it('never synthesizes a card from an archived conversation', () => {
        const merged = mergeConversationCwdProjects([], [
            summary('archived', OTHER, 1, { archived: true }),
            { ...archivedTask, parallelBaseCwd: OTHER },
        ]);

        expect(merged).to.deep.equal([]);
    });

    it('drops a cached card of a worktree whose source project was removed', () => {
        const merged = mergeConversationCwdProjects([cachedCard(LIVE_WT), cachedCard(OTHER)], [archivedTask], () => false, removed);

        expect(merged.map(project => project.id)).to.deep.equal([conversationCwdProjectId(OTHER)]);
    });

    it('drops the current card of a worktree whose source project was removed', () => {
        const merged = mergeConversationCwdProjects([{ ...cachedCard(LIVE_WT), isCurrent: true }, cachedCard(OTHER)], [archivedTask], () => false, removed);

        expect(merged.map(project => project.id)).to.deep.equal([conversationCwdProjectId(OTHER)]);
    });

    it('remembers the source of a worktree card, so removing it can resolve the source repository', () => {
        const merged = mergeConversationCwdProjects([cachedCard(LIVE_WT)], [{ ...archivedTask, archived: false }]);

        expect(merged.map(project => [project.name, project.worktreeSourceCwd])).to.deep.equal([['vyyq_1', VYYQ]]);
    });
});

describe('mergeConversationCwdProjects canonical project identity', () => {
    // Production layout: per-user clones under `repos/users/<login>/<owner>/<repo>`.
    const CLONE = '/workspace/repos/users/jcristgd/juancristobalgd1/OpenDots';
    const LEGACY_CLONE = '/workspace/repos/juancristobalgd1/OpenDots';

    const githubCard = (uri?: string): MobileProjectEntry => ({
        ...baseProject('OpenDots'),
        id: 'github:juancristobalgd1/OpenDots',
        uri: uri ? FileUri.create(uri) : undefined,
        github: { owner: 'juancristobalgd1', name: 'OpenDots', fullName: 'juancristobalgd1/OpenDots', htmlUrl: '', private: false },
    });
    const names = (projects: readonly MobileProjectEntry[]): string[] => projects.map(project => project.name);

    it('does not add a second card for a repo whose github card has no clone URI yet', () => {
        const merged = mergeConversationCwdProjects([githubCard()], [summary('a', CLONE, 1)]);

        expect(names(merged)).to.deep.equal(['OpenDots']);
        expect(merged[0].id).to.equal('github:juancristobalgd1/OpenDots');
    });

    it('does not add a second card for a conversation recorded under the legacy flat clone path', () => {
        const merged = mergeConversationCwdProjects([githubCard(CLONE)], [summary('old', LEGACY_CLONE, 1), summary('new', CLONE, 2)]);

        expect(names(merged)).to.deep.equal(['OpenDots']);
    });

    it('ignores a trailing slash and casing differences in the conversation cwd', () => {
        const merged = mergeConversationCwdProjects([githubCard(CLONE)], [
            summary('slash', `${CLONE}/`, 1),
            summary('case', CLONE.toLowerCase(), 2),
        ]);

        expect(names(merged)).to.deep.equal(['OpenDots']);
    });

    it('drops a card synthesized before the catalog loaded once the github card for that repo arrives', () => {
        const stale = mergeConversationCwdProjects([], [summary('a', CLONE, 1)]);
        expect(names(stale)).to.deep.equal(['OpenDots']);

        const merged = mergeConversationCwdProjects([githubCard(), ...stale], [summary('a', CLONE, 1)]);

        expect(merged.map(project => project.id)).to.deep.equal(['github:juancristobalgd1/OpenDots']);
    });

    /** Conversation ids each sidebar card lists, through the real per-card query over a real thread store. */
    const listedSummariesByCard = (
        projects: readonly MobileProjectEntry[],
        summaries: readonly QaapAgentConversationSummaryDTO[],
    ): Map<string, QaapAgentConversationSummaryDTO[]> => {
        const threadStore = new QaapThreadStore();
        for (const entry of summaries) {
            threadStore.upsertSummary(entry);
        }
        const index = new MobileProjectsConversationIndexUi({
            chatService: undefined,
            conversationFlags: undefined,
            preparedCwdByProjectId: new Map(),
            projectsService: { getProjectCwd: (project: MobileProjectEntry) => project.uri?.path.toString() },
            conversations: {
                threadStore,
                getConversationsForCwd: (cwd: string) => threadStore.getSummariesForCwd(cwd),
                findConversationsForProject: () => [],
            },
            activeTasks: undefined,
            chatServiceSessionSummariesByProjectId: new Map(),
            chatServiceSummariesUi: { isChatSessionWorking: () => false, isChatSessionWaitingForInput: () => false },
        } as unknown as MobileProjectsConversationIndexHost);
        const merged = mergeConversationCwdProjects(projects, summaries);
        return new Map(merged.map(project => [project.id, index.conversationsForProject(project)]));
    };
    const listedByCard = (projects: readonly MobileProjectEntry[], summaries: readonly QaapAgentConversationSummaryDTO[]): Map<string, string[]> =>
        new Map([...listedSummariesByCard(projects, summaries)].map(([id, listed]) => [id, listed.map(entry => entry.id).sort()]));

    it('lists conversations of a legacy, trailing-slash or re-cased cwd under the canonical card, each exactly once', () => {
        const summaries = [
            summary('new', CLONE, 1),
            summary('old', LEGACY_CLONE, 2),
            summary('slash', `${CLONE}/`, 3),
            summary('case', CLONE.toLowerCase(), 4),
        ];

        const listed = listedByCard([githubCard(CLONE)], summaries);

        expect([...listed.keys()]).to.deep.equal(['github:juancristobalgd1/OpenDots']);
        expect(listed.get('github:juancristobalgd1/OpenDots')).to.deep.equal(['case', 'new', 'old', 'slash']);
    });

    it('lists every clone path under a github card that has no clone URI yet', () => {
        const listed = listedByCard([githubCard()], [summary('new', CLONE, 1), summary('old', LEGACY_CLONE, 2)]);

        expect([...listed.entries()]).to.deep.equal([['github:juancristobalgd1/OpenDots', ['new', 'old']]]);
    });

    it('keeps the conversations of a fork and of a folder below the root on their own cards only', () => {
        const fork = '/workspace/repos/users/jcristgd/someone-else/OpenDots';
        const subfolder = `${CLONE}/packages/web`;

        const listed = listedByCard([githubCard(CLONE)], [summary('new', CLONE, 1), summary('fork', fork, 2), summary('sub', subfolder, 3)]);

        expect([...listed.entries()]).to.deep.equal([
            ['github:juancristobalgd1/OpenDots', ['new']],
            [conversationCwdProjectId(fork), ['fork']],
            [conversationCwdProjectId(subfolder), ['sub']],
        ]);
    });

    it('keeps the real cwd on a conversation listed under the canonical card (open / retry / delete act on it)', () => {
        const listed = listedSummariesByCard([githubCard(CLONE)], [summary('new', CLONE, 1), summary('old', LEGACY_CLONE, 2)]);

        const cwdById = new Map(listed.get('github:juancristobalgd1/OpenDots')!.map(entry => [entry.id, entry.cwd]));
        expect(cwdById.get('old')).to.equal(LEGACY_CLONE);
        expect(cwdById.get('new')).to.equal(CLONE);
    });

    it('keeps a same-named repository of another owner and a folder below the clone root', () => {
        const fork = '/workspace/repos/users/jcristgd/someone-else/OpenDots';
        const subfolder = `${CLONE}/packages/web`;
        const merged = mergeConversationCwdProjects([githubCard(CLONE)], [summary('fork', fork, 1), summary('sub', subfolder, 2)]);

        expect(merged.map(project => project.uri?.path.toString())).to.deep.equal([CLONE, fork, subfolder]);
    });
});
