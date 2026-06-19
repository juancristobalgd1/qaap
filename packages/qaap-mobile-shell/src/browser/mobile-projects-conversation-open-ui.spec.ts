// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    MobileProjectsConversationOpenUi,
    type MobileProjectsConversationOpenHost,
} from './mobile-projects-conversation-open-ui';
import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import type { MobileProjectEntry } from './mobile-projects-types';

describe('mobile-projects-conversation-open-ui', () => {

    const project = {
        id: 'proj-1',
        name: 'demo',
        isCurrent: true,
    } as MobileProjectEntry;

    const summary: QaapAgentConversationSummaryDTO = {
        id: 'conv-1',
        cwd: '/tmp/demo',
        agentId: 'task',
        title: 'Fix bug',
        status: 'idle',
        createdAt: 1,
        updatedAt: 2,
        messageCount: 1,
    };

    function createHost(calls: string[]): MobileProjectsConversationOpenHost {
        return {
            conversations: {
                prefetchDocument: () => { calls.push('prefetchDocument'); },
            } as unknown as MobileProjectsConversationOpenHost['conversations'],
            conversationFlags: {
                markRead: () => { calls.push('markRead'); },
            } as unknown as MobileProjectsConversationOpenHost['conversationFlags'],
            homeMode: true,
            hubView: 'tasks',
            agentsHubSelectedProjectId: undefined,
            transcriptLastConv: undefined,
            transcriptLastFingerprint: undefined,
            transcriptLastStreamProgressAt: undefined,
            transcriptLastSseDeltaAt: undefined,
            delegate: {
                onDismiss: () => undefined,
                onEnterWorkHubConversation: () => { calls.push('onEnterWorkHubConversation'); },
            },
            conversationsForProject: () => [summary],
            closeCardMenu: () => undefined,
            executionSurfaceTabsUi: {
                setExecutionSurfaceTab: () => { calls.push('setExecutionSurfaceTab'); },
            } as unknown as MobileProjectsConversationOpenHost['executionSurfaceTabsUi'],
            transcriptSheetUi: {
                openTranscriptSheet: async () => { calls.push('openTranscriptSheet'); },
            } as unknown as MobileProjectsConversationOpenHost['transcriptSheetUi'],
            transcriptLiveUi: {} as MobileProjectsConversationOpenHost['transcriptLiveUi'],
            hide: () => undefined,
            conversationIndexUi: {
                conversationsForProject: () => [summary],
            } as unknown as MobileProjectsConversationOpenHost['conversationIndexUi'],
            cardMenuUi: {
                closeCardMenu: () => { calls.push('closeCardMenu'); },
            } as unknown as MobileProjectsConversationOpenHost['cardMenuUi'],
            shouldUseAgentsHubLanding: () => true,
            isProjectDetailView: () => false,
            selectHubLandingView: () => undefined,
            refreshWorkHubConversationChrome: () => { calls.push('refreshWorkHubConversationChrome'); },
        };
    }

    it('isolates Work Hub from IDE panels before opening a conversation', async () => {
        const calls: string[] = [];
        const ui = new MobileProjectsConversationOpenUi(createHost(calls));

        await ui.openConversationSummary(project, summary);

        expect(calls.indexOf('onEnterWorkHubConversation')).to.be.lessThan(calls.indexOf('openTranscriptSheet'));
        expect(calls).to.include('refreshWorkHubConversationChrome');
    });
});
