// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import {
    buildMissionControlItems,
    classifyMissionControlLane,
    classifyMissionControlSurface,
    filterMissionControlItems,
    shouldUseMissionControlLanding,
    type MissionControlItem,
} from './mobile-work-mission-control';

function summary(overrides: Partial<QaapAgentConversationSummaryDTO> = {}): QaapAgentConversationSummaryDTO {
    return {
        id: 'c1',
        cwd: '/home/user/app',
        agentId: 'shell',
        title: 'Task',
        status: 'idle',
        createdAt: 1,
        updatedAt: 2,
        messageCount: 4,
        lastMessageRole: 'agent',
        ...overrides,
    };
}

describe('classifyMissionControlLane', () => {
    it('classifies a streaming turn as running, regardless of unread', () => {
        expect(classifyMissionControlLane(summary({ status: 'streaming' }), false)).to.equal('running');
        expect(classifyMissionControlLane(summary({ status: 'streaming' }), true)).to.equal('running');
    });

    it('classifies an active goal loop as running even when idle', () => {
        expect(classifyMissionControlLane(summary({ status: 'idle', goalLoopPhase: 'verifying' }), false)).to.equal('running');
    });

    it('classifies a blocked goal loop as needs-you', () => {
        expect(classifyMissionControlLane(summary({ status: 'idle', goalLoopPhase: 'blocked' }), false)).to.equal('needs-you');
    });

    it('classifies a failed conversation as needs-you', () => {
        expect(classifyMissionControlLane(summary({ status: 'failed' }), false)).to.equal('needs-you');
    });

    it('classifies a user-flagged priority conversation as needs-you', () => {
        expect(classifyMissionControlLane(summary({ priority: true }), false)).to.equal('needs-you');
    });

    it('classifies an unread idle turn where the agent spoke last as needs-you', () => {
        expect(classifyMissionControlLane(summary({ lastMessageRole: 'agent' }), true)).to.equal('needs-you');
    });

    it('classifies a read idle conversation as done', () => {
        expect(classifyMissionControlLane(summary({ lastMessageRole: 'agent' }), false)).to.equal('done');
    });

    it('does not flag an unread idle turn where the user spoke last', () => {
        expect(classifyMissionControlLane(summary({ lastMessageRole: 'user' }), true)).to.equal('done');
    });

    it('does not flag an empty conversation', () => {
        expect(classifyMissionControlLane(summary({ messageCount: 0 }), true)).to.equal('done');
    });

    it('keeps a paused conversation out of needs-you even when unread', () => {
        expect(classifyMissionControlLane(summary({ paused: true }), true)).to.equal('done');
    });
});

describe('classifyMissionControlSurface', () => {
    it('classifies a local Theia chat as chat', () => {
        expect(classifyMissionControlSurface({ source: 'theia-chat' })).to.equal('chat');
    });

    it('classifies a VPS agent conversation as task', () => {
        expect(classifyMissionControlSurface({ source: 'qaap-agent' })).to.equal('task');
    });

    it('classifies anything linked to a pull request as pr, even a VPS task', () => {
        expect(classifyMissionControlSurface({ source: 'qaap-agent', linkedPullRequest: { number: 7 } })).to.equal('pr');
    });
});

describe('filterMissionControlItems', () => {
    function item(overrides: Partial<MissionControlItem>): MissionControlItem {
        return {
            key: 'k', conversationId: 'c', projectId: 'p', projectName: 'app', projectColor: '#fff',
            title: 't', lane: 'done', surface: 'task', updatedAt: 0, hasPullRequest: false,
            ...overrides,
        };
    }
    const items: MissionControlItem[] = [
        item({ key: '1', lane: 'needs-you', surface: 'task' }),
        item({ key: '2', lane: 'needs-you', surface: 'pr', hasPullRequest: true }),
        item({ key: '3', lane: 'running', surface: 'chat' }),
        item({ key: '4', lane: 'done', surface: 'task' }),
    ];

    it('returns everything when both axes are all', () => {
        expect(filterMissionControlItems(items, 'all', 'all')).to.have.length(4);
    });

    it('filters by lane', () => {
        expect(filterMissionControlItems(items, 'needs-you', 'all').map(i => i.key)).to.deep.equal(['1', '2']);
    });

    it('filters by surface', () => {
        expect(filterMissionControlItems(items, 'all', 'task').map(i => i.key)).to.deep.equal(['1', '4']);
    });

    it('intersects lane and surface', () => {
        expect(filterMissionControlItems(items, 'needs-you', 'pr').map(i => i.key)).to.deep.equal(['2']);
    });
});

describe('buildMissionControlItems', () => {
    it('builds cross-project rows with lane and surface classification', () => {
        const items = buildMissionControlItems({
            projects: [{
                id: 'p1', name: 'app', color: '#f00', branch: 'main', status: 'idle', task: '',
                progress: 0, agents: [], lastActive: '', tokens: '', cost: '', pinned: false, isCurrent: false,
            }],
            conversationsForProject: () => [summary({
                id: 'c1',
                title: 'Fix bug',
                status: 'streaming',
                source: 'qaap-agent',
            })],
            isConversationUnread: () => false,
            resolveAgentLabel: id => `@${id}`,
        });
        expect(items).to.have.length(1);
        expect(items[0].key).to.equal('p1:c1');
        expect(items[0].lane).to.equal('running');
        expect(items[0].surface).to.equal('task');
        expect(items[0].agentLabel).to.equal('@shell');
    });

    it('skips empty idle conversations', () => {
        const items = buildMissionControlItems({
            projects: [{
                id: 'p1', name: 'app', color: '#f00', branch: 'main', status: 'idle', task: '',
                progress: 0, agents: [], lastActive: '', tokens: '', cost: '', pinned: false, isCurrent: false,
            }],
            conversationsForProject: () => [summary({ messageCount: 0, status: 'idle' })],
            isConversationUnread: () => false,
            resolveAgentLabel: id => id,
        });
        expect(items).to.have.length(0);
    });
});

describe('shouldUseMissionControlLanding', () => {
    it('is false until mission control is opened from the sidebar', () => {
        expect(shouldUseMissionControlLanding({
            homeMode: true,
            hubView: 'tasks',
            agentsHubLegacyInbox: false,
            missionControlLandingActive: false,
        })).to.equal(false);
    });

    it('is true on the tasks hub after the sidebar entry is selected', () => {
        expect(shouldUseMissionControlLanding({
            homeMode: true,
            hubView: 'tasks',
            agentsHubLegacyInbox: false,
            missionControlLandingActive: true,
        })).to.equal(true);
    });

    it('is false on the repos hub', () => {
        expect(shouldUseMissionControlLanding({
            homeMode: true,
            hubView: 'repos',
            agentsHubLegacyInbox: false,
            missionControlLandingActive: true,
        })).to.equal(false);
    });
});
