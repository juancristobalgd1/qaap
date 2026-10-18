// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { collectMissionControlItems } from './qaap-work-mission-control-collector';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { QaapTaskPlan } from '@theia/qaap-shared-core/lib/common/qaap-task-plan';
import { buildMissionControlRowFingerprint } from '../common/qaap-work-mission-control-fingerprint';

describe('collectMissionControlItems', () => {

    const project = {
        id: 'p1',
        name: 'qaap-mobile-shell',
        color: '#4a9',
    } as MobileProjectEntry;

    it('groups streaming and unread conversations into running and needs-you lanes', () => {
        const items = collectMissionControlItems({
            projects: [project],
            conversationsForProject: () => [
                {
                    id: 'c-stream',
                    cwd: '/repo',
                    agentId: 'qaiq',
                    title: 'Streaming task',
                    status: 'streaming',
                    createdAt: 1,
                    updatedAt: 100,
                    messageCount: 2,
                },
                {
                    id: 'c-unread',
                    cwd: '/repo',
                    agentId: 'codex',
                    title: 'Unread reply',
                    status: 'idle',
                    createdAt: 1,
                    updatedAt: 90,
                    messageCount: 3,
                    lastMessageRole: 'agent',
                },
                {
                    id: 'c-done',
                    cwd: '/repo',
                    agentId: 'qaiq',
                    title: 'Done task',
                    status: 'idle',
                    createdAt: 1,
                    updatedAt: 80,
                    messageCount: 4,
                    lastMessageRole: 'agent',
                },
            ],
            isUnread: summary => summary.id === 'c-unread',
            resolveAgentLabel: agentId => `@${agentId}`,
        });

        expect(items.map(item => item.conversationId)).to.deep.equal(['c-stream', 'c-unread', 'c-done']);
        expect(items.find(item => item.conversationId === 'c-stream')?.lane).to.equal('running');
        expect(items.find(item => item.conversationId === 'c-unread')?.lane).to.equal('needs-you');
        expect(items.find(item => item.conversationId === 'c-done')?.lane).to.equal('done');
    });

    it('puts a task PR awaiting consent in needs-you with the consent reason, unless "Create PR when done" is off', () => {
        const pr = { owner: 'acme', repo: 'demo', branch: 'qaap/task/c', state: 'awaiting-consent' as const, updatedAt: 1 };
        const base = { cwd: '/repo', agentId: 'qaiq', status: 'idle' as const, createdAt: 1, messageCount: 2, lastMessageRole: 'agent' as const };
        const items = collectMissionControlItems({
            projects: [project],
            conversationsForProject: () => [
                { ...base, id: 'c-consent', title: 'Ready', updatedAt: 10, taskPullRequest: pr },
                { ...base, id: 'c-off', title: 'Opted out', updatedAt: 9, taskPullRequest: pr, taskPullRequestEnabled: false },
                { ...base, id: 'c-signin', title: 'Token', updatedAt: 8, taskPullRequest: { ...pr, state: 'needs-sign-in' as const } },
            ],
            isUnread: () => false,
            resolveAgentLabel: agentId => agentId,
        });
        const consent = items.find(item => item.conversationId === 'c-consent');
        expect(consent?.lane).to.equal('needs-you');
        expect(consent?.pullRequestAttention).to.deep.include({ reason: 'consent', repository: 'acme/demo' });
        const off = items.find(item => item.conversationId === 'c-off');
        expect(off?.lane).to.equal('done');
        expect(off?.pullRequestAttention).to.equal(undefined);
        expect(items.find(item => item.conversationId === 'c-signin')?.pullRequestAttention?.reason).to.equal('sign-in');
    });

    it('applies search, including to worktree threads', () => {
        const items = collectMissionControlItems({
            projects: [project],
            conversationsForProject: () => [
                {
                    id: 'c-variant',
                    cwd: '/tmp/wt',
                    agentId: 'qaiq',
                    title: 'Variant A',
                    status: 'streaming',
                    createdAt: 1,
                    updatedAt: 50,
                    messageCount: 1,
                    worktreeBranch: 'qaap/worktree/abcd1234',
                },
                {
                    id: 'c-match',
                    cwd: '/repo',
                    agentId: 'qaiq',
                    title: 'Sidebar perf',
                    status: 'idle',
                    createdAt: 1,
                    updatedAt: 40,
                    messageCount: 1,
                },
            ],
            isUnread: () => false,
            resolveAgentLabel: agentId => `@${agentId}`,
            query: 'sidebar',
            matchesQuery: (summary, query) => summary.title.toLowerCase().includes(query),
        });

        expect(items).to.have.length(1);
        expect(items[0]?.conversationId).to.equal('c-match');
    });

    it('surfaces quota failures in needs-you lane with localized preview', () => {
        const items = collectMissionControlItems({
            projects: [project],
            conversationsForProject: () => [{
                id: 'c-quota',
                cwd: '/repo',
                agentId: 'qaiq',
                title: 'Sidebar perf',
                status: 'failed',
                createdAt: 1,
                updatedAt: 70,
                messageCount: 2,
                lastMessagePreview: 'insufficient_quota: billing hard limit',
            }],
            isUnread: () => false,
            resolveAgentLabel: agentId => `@${agentId}`,
        });
        const item = items.find(entry => entry.conversationId === 'c-quota');
        expect(item?.lane).to.equal('needs-you');
        expect(item?.failureKind).to.equal('quota');
        expect(item?.preview).to.include('quota');
    });

    describe('task plans', () => {

        const now = 1_000_000;
        const base = { cwd: '/repo', agentId: 'qaiq', createdAt: 1, messageCount: 2, lastMessageRole: 'agent' as const };
        const subtasks = [
            { id: 's1', title: 'API', prompt: 'p', state: 'done' as const, conversationId: 'child-1' },
            { id: 's2', title: 'UI', prompt: 'p', state: 'running' as const, conversationId: 'child-2' },
        ];
        const taskPlan = (state: QaapTaskPlan['state'], extra: Partial<QaapTaskPlan> = {}): QaapTaskPlan =>
            ({ id: 'plan', state, subtasks, autoRun: false, createdAt: 1, updatedAt: 1, ...extra });

        function collect(summaries: QaapAgentConversationSummaryDTO[]): ReturnType<typeof collectMissionControlItems> {
            return collectMissionControlItems({
                projects: [project],
                conversationsForProject: () => summaries,
                isUnread: () => false,
                resolveAgentLabel: agentId => agentId,
                now: () => now,
            });
        }

        it('puts a plan awaiting approval in Needs you with its countdown', () => {
            const [item] = collect([{ ...base, id: 'parent', title: 'Task', status: 'idle', updatedAt: 5,
                taskPlan: taskPlan('awaiting-approval', { autoRun: true, autoRunAt: now + 40_000 }) }]);
            expect(item.lane).to.equal('needs-you');
            expect(item.planLabel).to.equal('Plan ready · runs in 40s');
            const [untimed] = collect([{ ...base, id: 'parent', title: 'Task', status: 'idle', updatedAt: 5, taskPlan: taskPlan('awaiting-approval') }]);
            expect(untimed.planLabel).to.equal('Plan ready');
        });

        it('keeps an idle parent in Running while its subtasks run, and its children as their own rows', () => {
            const items = collect([
                { ...base, id: 'parent', title: 'Task', status: 'idle', updatedAt: 5, taskPlan: taskPlan('running') },
                { ...base, id: 'child-1', title: '1/2 · API', status: 'idle', updatedAt: 4, parentConversationId: 'parent', taskPlanSubtaskId: 's1' },
                { ...base, id: 'child-2', title: 'UI', status: 'streaming', updatedAt: 3, parentConversationId: 'parent', taskPlanSubtaskId: 's2' },
            ]);
            const byId = new Map(items.map(item => [item.conversationId, item]));
            expect(byId.get('parent')).to.include({ lane: 'running', planLabel: 'Subtasks 1/2' });
            // Title prefix first, then the parent plan's subtask index.
            expect(byId.get('child-1')?.subtaskLabel).to.equal('Subtask 1/2');
            expect(byId.get('child-2')).to.include({ lane: 'running', subtaskLabel: 'Subtask 2/2' });
        });

        it('labels integrating and failed plans', () => {
            expect(collect([{ ...base, id: 'p', title: 'T', status: 'idle', updatedAt: 1, taskPlan: taskPlan('integrating') }])[0])
                .to.include({ lane: 'running', planLabel: 'Integrating subtasks' });
            expect(collect([{ ...base, id: 'p', title: 'T', status: 'idle', updatedAt: 1, taskPlan: taskPlan('failed') }])[0].planLabel)
                .to.equal('Plan failed');
            expect(collect([{ ...base, id: 'p', title: 'T', status: 'idle', updatedAt: 1, taskPlan: taskPlan('done') }])[0].planLabel)
                .to.equal(undefined);
        });

        it('changes the row fingerprint when a plan label changes', () => {
            const row = { key: 'k', lane: 'running', title: 'T', updatedAt: 1 };
            expect(buildMissionControlRowFingerprint({ ...row, planLabel: 'Subtasks 1/2' }))
                .to.not.equal(buildMissionControlRowFingerprint({ ...row, planLabel: 'Subtasks 2/2' }));
            expect(buildMissionControlRowFingerprint({ ...row, subtaskLabel: 'Subtask 1/2' }))
                .to.not.equal(buildMissionControlRowFingerprint(row));
        });
    });
});
