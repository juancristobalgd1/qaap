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
