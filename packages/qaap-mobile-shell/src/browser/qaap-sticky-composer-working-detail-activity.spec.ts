// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import type { QaapAgentConversationDTO, QaapAgentMessageSegmentDTO } from '../common/qaap-agent-conversation-client';
import type { WorkHubTeamMember } from '../common/qaap-work-hub-team';
import {
    buildWorkingAgentDetailActivityFeed,
    renderWorkingAgentDetailActivityFeed,
    resolveWorkingAgentDetailActivityFeedFromConversation,
} from './qaap-sticky-composer-working-detail-activity';

describe('qaap-sticky-composer-working-detail-activity', () => {
    let disableJSDOM: () => void;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM();
    });

    function member(partial: Partial<WorkHubTeamMember> & Pick<WorkHubTeamMember, 'id' | 'title'>): WorkHubTeamMember {
        return {
            kind: 'conversation',
            projectName: 'Demo',
            cwd: '/srv/demo',
            agentId: 'qaiq',
            state: 'streaming',
            childCount: 0,
            createdAt: 1,
            updatedAt: 2,
            conversationId: partial.id,
            ...partial,
        };
    }

    it('builds Thought briefly + Explored + feed rows from segments', () => {
        const segments: QaapAgentMessageSegmentDTO[] = [
            { type: 'thinking', content: 'I should inspect the working detail panel first.' },
            {
                type: 'tool',
                name: 'Read',
                args: JSON.stringify({ path: 'a.ts' }),
                toolUseId: 't1',
                finished: true,
                result: 'ok',
            },
            {
                type: 'tool',
                name: 'Grep',
                args: JSON.stringify({ pattern: 'detail' }),
                toolUseId: 't2',
                finished: true,
                result: 'ok',
            },
            {
                type: 'tool',
                name: 'Read',
                args: JSON.stringify({ path: 'b.ts' }),
                toolUseId: 't3',
                finished: false,
            },
        ];
        const feed = buildWorkingAgentDetailActivityFeed(segments, { streaming: true });
        expect(feed.thoughtTitle).to.equal('Thought briefly');
        expect(feed.thoughtText).to.contain('inspect the working detail panel');
        expect(feed.exploredSummary).to.match(/Explored/);
        expect(feed.exploredSummary).to.match(/file/);
        expect(feed.liveLabel).to.be.a('string').and.not.equal('');
        expect(feed.items.length).to.be.greaterThan(0);
        expect(feed.items.some(item => item.verb === 'Thinking')).to.equal(false);

        const root = renderWorkingAgentDetailActivityFeed(feed);
        expect(root.querySelector('.qaap-working-agents-detail-thought-title')?.textContent)
            .to.equal('Thought briefly');
        expect(root.querySelector('.qaap-working-agents-detail-explored')?.textContent)
            .to.match(/Explored/);
        expect(root.querySelector('.qaap-working-agents-detail-live-label')).to.not.equal(null);
        expect(root.querySelectorAll('.qaap-working-agents-detail-activity-row').length)
            .to.be.greaterThan(0);
    });

    it('surfaces Planning next moves as the live line while streaming without tools', () => {
        const feed = buildWorkingAgentDetailActivityFeed([
            { type: 'thinking', content: 'Need a plan before editing.' },
        ], { streaming: true });
        expect(feed.thoughtText).to.contain('Need a plan before editing');
        expect(feed.liveLabel).to.equal('Planning next moves');
    });

    it('falls back to activityLabel when conversation document is missing', () => {
        const feed = resolveWorkingAgentDetailActivityFeedFromConversation(
            undefined,
            member({ id: 'c1', title: 'Task', activityLabel: 'Editing files' }),
        );
        expect(feed?.liveLabel).to.equal('Editing files');
        expect(feed?.items).to.deep.equal([]);
    });

    it('surfaces running command for VPS tasks without conversation segments', () => {
        const feed = resolveWorkingAgentDetailActivityFeedFromConversation(
            undefined,
            member({
                id: 'task-1',
                title: 'npm run test',
                kind: 'leader-task',
                state: 'running',
                taskId: 'task-1',
                command: 'npm run test',
                activityLabel: undefined,
                conversationId: undefined,
            }),
        );
        expect(feed?.liveLabel).to.equal('Running command');
        expect(feed?.liveDetail).to.equal('npm run test');
        expect(feed?.items.length).to.equal(1);
        expect(feed?.items[0]?.detail).to.equal('npm run test');
        expect(feed?.items[0]?.state).to.equal('running');

        const root = renderWorkingAgentDetailActivityFeed(feed!);
        expect(root.textContent).to.contain('Running command');
        expect(root.textContent).to.contain('npm run test');
        expect(root.textContent).to.not.match(/^Working$/);
    });

    it('treats command-like titles as running commands when activityLabel is generic Working', () => {
        const feed = resolveWorkingAgentDetailActivityFeedFromConversation(
            undefined,
            member({
                id: 'c-cmd',
                title: 'npm run test',
                activityLabel: 'Working',
                state: 'streaming',
            }),
        );
        expect(feed?.liveLabel).to.equal('Running command');
        expect(feed?.liveDetail).to.equal('npm run test');
        expect(feed?.items.some(item => item.detail === 'npm run test')).to.equal(true);
    });

    it('prefers liveSegments when the cached document has no agent segments yet', () => {
        const document = {
            id: 'c1',
            cwd: '/srv/demo',
            status: 'streaming',
            agentId: 'qaiq',
            title: 'npm run test',
            createdAt: 1,
            updatedAt: 2,
            messages: [
                { id: 'u1', role: 'user', content: 'run tests', createdAt: 1 },
            ],
        } as unknown as QaapAgentConversationDTO;
        const feed = resolveWorkingAgentDetailActivityFeedFromConversation(
            document,
            member({ id: 'c1', title: 'npm run test', activityLabel: 'Working' }),
            {
                liveSegments: [
                    { type: 'thinking', content: 'I will run the unit tests.' },
                    {
                        type: 'tool',
                        name: 'Bash',
                        args: JSON.stringify({ command: 'npm run test' }),
                        toolUseId: 'b1',
                        finished: false,
                    },
                ],
            },
        );
        expect(feed?.thoughtText).to.contain('run the unit tests');
        expect(feed?.liveLabel).to.be.a('string').and.not.equal('Working');
        expect(feed?.items.length).to.be.greaterThan(0);
    });

    it('reads the latest agent message from a conversation document', () => {
        const document = {
            id: 'c1',
            cwd: '/srv/demo',
            status: 'streaming',
            agentId: 'qaiq',
            title: 'Working detail',
            createdAt: 1,
            updatedAt: 2,
            messages: [
                {
                    id: 'u1',
                    role: 'user',
                    content: 'hi',
                    createdAt: 1,
                },
                {
                    id: 'a1',
                    role: 'agent',
                    content: '',
                    createdAt: 2,
                    segments: [
                        { type: 'thinking', content: 'Brief plan.' },
                        {
                            type: 'tool',
                            name: 'Glob',
                            args: JSON.stringify({ pattern: '**/*.ts' }),
                            toolUseId: 'g1',
                            finished: true,
                            result: 'ok',
                        },
                    ],
                },
            ],
        } as unknown as QaapAgentConversationDTO;
        const feed = resolveWorkingAgentDetailActivityFeedFromConversation(
            document,
            member({ id: 'c1', title: 'Working detail' }),
        );
        expect(feed?.thoughtText).to.contain('Brief plan');
        expect(feed?.exploredSummary).to.match(/Explored/);
    });
});
