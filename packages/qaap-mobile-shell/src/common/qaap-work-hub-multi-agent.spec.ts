// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    buildTeamTree,
    collectAgentMembers,
    countRunningTeamMembers,
} from './qaap-work-hub-team';
import { buildWorkHubSessionsSidebarFingerprint } from './qaap-work-hub-sessions-sidebar-fingerprint';
import { QaapChatViewStreamUpdateScheduler } from './qaap-chat-view-stream-update-scheduler';

describe('qaap-work-hub-multi-agent scenarios', () => {

  it('same project: one leader conversation hides duplicate leader task and nests subtasks', () => {
        const members = collectAgentMembers({
            conversations: [{
                projectId: 'qaap',
                projectName: 'qaap-mobile-shell',
                cwd: '/srv/qaap-mobile-shell',
                id: 'conv-leader',
                agentId: 'qaiq',
                title: 'Refactor Work Hub perf',
                status: 'streaming',
                createdAt: 1000,
                updatedAt: 5000,
            }],
            tasks: [
                { id: 'task-leader', title: 'Leader VPS', command: 'qaiq', cwd: '/srv/qaap-mobile-shell', state: 'running', createdAt: 1000 },
                { id: 'sub-css', title: 'CSS pass', command: 'codex', cwd: '/srv/qaap-mobile-shell', state: 'running', createdAt: 1100, parentId: 'task-leader' },
                { id: 'sub-test', title: 'Test pass', command: 'codex', cwd: '/srv/qaap-mobile-shell', state: 'running', createdAt: 1200, parentId: 'task-leader' },
                { id: 'sub-docs', title: 'Docs pass', command: 'claude', cwd: '/srv/qaap-mobile-shell', state: 'running', createdAt: 1300, parentId: 'task-leader' },
            ],
        });

        expect(members.filter(m => m.kind === 'conversation')).to.have.length(1);
        expect(members.filter(m => m.kind === 'leader-task')).to.have.length(0);
        expect(members.filter(m => m.kind === 'subtask')).to.have.length(3);
        expect(members.find(m => m.id === 'conv-leader')?.childCount).to.equal(3);

        const tree = buildTeamTree(members);
        expect(tree.roots.map(r => r.id)).to.deep.equal(['conv-leader']);
        expect(tree.childrenByParent.get('conv-leader')?.map(c => c.id)).to.deep.equal([
            'sub-css',
            'sub-test',
            'sub-docs',
        ]);
    });

    it('same project: multiple parallel streaming conversations surface independently', () => {
        const members = collectAgentMembers({
            conversations: [
                {
                    projectId: 'qaap',
                    projectName: 'qaap-mobile-shell',
                    cwd: '/srv/qaap-mobile-shell',
                    id: 'conv-a',
                    agentId: 'qaiq',
                    title: 'Agent A — inbox',
                    status: 'streaming',
                    createdAt: 1000,
                    updatedAt: 2000,
                },
                {
                    projectId: 'qaap',
                    projectName: 'qaap-mobile-shell',
                    cwd: '/srv/qaap-mobile-shell',
                    id: 'conv-b',
                    agentId: 'codex',
                    title: 'Agent B — sidebar',
                    status: 'streaming',
                    createdAt: 1100,
                    updatedAt: 2100,
                },
                {
                    projectId: 'qaap',
                    projectName: 'qaap-mobile-shell',
                    cwd: '/srv/qaap-mobile-shell',
                    id: 'conv-idle',
                    agentId: 'claude',
                    title: 'Done earlier',
                    status: 'idle',
                    createdAt: 900,
                    updatedAt: 1500,
                },
            ],
            tasks: [],
        });

        expect(members.map(m => m.id)).to.deep.equal(['conv-a', 'conv-b']);
        expect(countRunningTeamMembers(members)).to.equal(2);
    });

    it('multiple projects: aggregates running agents per repo without cross-project bleed', () => {
        const members = collectAgentMembers({
            conversations: [
                {
                    projectId: 'p-shell',
                    projectName: 'qaap-mobile-shell',
                    cwd: '/srv/qaap-mobile-shell',
                    id: 'conv-shell',
                    agentId: 'qaiq',
                    title: 'Shell perf',
                    status: 'streaming',
                    createdAt: 1000,
                    updatedAt: 2000,
                },
                {
                    projectId: 'p-cloud',
                    projectName: 'qaap-cloud-workspace',
                    cwd: '/srv/qaap-cloud-workspace',
                    id: 'conv-cloud',
                    agentId: 'codex',
                    title: 'Parallel runs API',
                    status: 'streaming',
                    createdAt: 1000,
                    updatedAt: 2000,
                },
                {
                    projectId: 'p-product',
                    projectName: 'qaap-product',
                    cwd: '/srv/qaap-product',
                    id: 'conv-product',
                    agentId: 'claude',
                    title: 'Theme polish',
                    status: 'streaming',
                    createdAt: 1000,
                    updatedAt: 2000,
                },
            ],
            tasks: [
                { id: 'solo-core', title: 'Core drift', command: 'qaiq', cwd: '/srv/core', state: 'running', createdAt: 1000 },
            ],
        });

        const byProject = new Map(members.map(m => [m.projectName ?? m.cwd, m.id]));
        expect(byProject.get('qaap-mobile-shell')).to.equal('conv-shell');
        expect(byProject.get('qaap-cloud-workspace')).to.equal('conv-cloud');
        expect(byProject.get('qaap-product')).to.equal('conv-product');
        expect(members.some(m => m.kind === 'leader-task' && m.id === 'solo-core')).to.be.true;
        expect(countRunningTeamMembers(members)).to.equal(4);
    });

    it('sessions sidebar fingerprint stays stable when only the open transcript streams', () => {
        const projects = [
            { id: 'p-shell', isCurrent: true },
            { id: 'p-cloud', isCurrent: false },
            { id: 'p-product', isCurrent: false },
        ];
        const conversationsByProject: Record<string, Array<{
            id: string;
            status: string;
            title: string;
            updatedAt: number;
            messageCount: number;
        }>> = {
            'p-shell': [
                { id: 'conv-open', status: 'streaming', title: 'Open transcript', updatedAt: 100, messageCount: 3 },
                { id: 'conv-bg-1', status: 'streaming', title: 'Background A', updatedAt: 90, messageCount: 2 },
                { id: 'conv-bg-2', status: 'streaming', title: 'Background B', updatedAt: 80, messageCount: 1 },
            ],
            'p-cloud': [
                { id: 'conv-cloud', status: 'streaming', title: 'Cloud worker', updatedAt: 70, messageCount: 4 },
            ],
            'p-product': [
                { id: 'conv-product', status: 'idle', title: 'Idle', updatedAt: 60, messageCount: 0 },
            ],
        };

        const input = {
            query: '',
            transcriptOpenSummaryId: 'conv-open',
            expandedProjectIds: new Set<string>(),
            visibleConversationCountByProjectId: new Map<string, number>(),
            projects,
            conversationsForProject: (projectId: string) => conversationsByProject[projectId] ?? [],
            pinnedConversationIds: new Set<string>(),
        };

        const before = buildWorkHubSessionsSidebarFingerprint(input);
        const afterStreamingTick = buildWorkHubSessionsSidebarFingerprint({
            ...input,
            conversationsForProject: projectId => (conversationsByProject[projectId] ?? []).map(conversation => (
                conversation.id === 'conv-open'
                    ? { ...conversation, messageCount: conversation.messageCount + 1, updatedAt: conversation.updatedAt + 1 }
                    : conversation
            )),
        });
        expect(afterStreamingTick).to.not.equal(before);

        const sidebarWhileTranscriptOpen = buildWorkHubSessionsSidebarFingerprint({
            ...input,
            conversationsForProject: projectId => (conversationsByProject[projectId] ?? []).map(conversation => (
                conversation.id === 'conv-open'
                    ? { ...conversation, messageCount: conversation.messageCount + 50, updatedAt: conversation.updatedAt + 50 }
                    : conversation
            )),
        });
        const unrelatedProjectsUnchanged = ['p-cloud', 'p-product'].every(projectId => {
            const left = (input.conversationsForProject(projectId)).map(c => `${c.id}:${c.messageCount}`);
            const right = buildWorkHubSessionsSidebarFingerprint({
                ...input,
                conversationsForProject: pid => pid === projectId
                    ? input.conversationsForProject(pid)
                    : (conversationsByProject[pid] ?? []).map(conversation => (
                        conversation.id === 'conv-open'
                            ? { ...conversation, messageCount: conversation.messageCount + 50 }
                            : conversation
                    )),
            });
            void right;
            const updated = (conversationsByProject[projectId] ?? []).map(c => `${c.id}:${c.messageCount}`);
            return left.join('|') === updated.join('|');
        });
        expect(unrelatedProjectsUnchanged).to.be.true;
        expect(sidebarWhileTranscriptOpen).to.not.equal(before);
    });

    it('coalesces hub list rebuilds when many agents tick on multiple projects in one frame', () => {
        let renderListCalls = 0;
        let rafCallback: (() => void) | undefined;
        const scheduler = new QaapChatViewStreamUpdateScheduler(
            () => { renderListCalls++; },
            () => 0,
            {
                scheduleFrame: callback => {
                    rafCallback = callback;
                    return 1;
                },
                cancelFrame: () => {
                    rafCallback = undefined;
                },
                setTimeout: () => 0 as unknown as ReturnType<typeof setTimeout>,
                clearTimeout: () => undefined,
            },
        );

        const projectCount = 3;
        const agentsPerProject = 4;
        for (let project = 0; project < projectCount; project++) {
            for (let agent = 0; agent < agentsPerProject; agent++) {
                scheduler.schedule();
            }
        }
        expect(renderListCalls).to.equal(0);
        rafCallback?.();
        expect(renderListCalls).to.equal(1);
        expect(scheduler.getFlushCount()).to.equal(1);
    });
});
