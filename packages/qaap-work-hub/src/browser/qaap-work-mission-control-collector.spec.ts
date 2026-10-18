// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { collectMissionControlItems } from './qaap-work-mission-control-collector';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';

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
});
