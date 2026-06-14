// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { Disposable } from '@theia/core/lib/common/disposable';
import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import {
    MobileProjectsAgentsHubInlineUi,
    type MobileProjectsAgentsHubInlineHost,
} from './mobile-projects-agents-hub-inline-ui';

describe('mobile-projects-agents-hub-inline-ui', () => {

    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    function createHost(overrides: Partial<MobileProjectsAgentsHubInlineHost> = {}): MobileProjectsAgentsHubInlineHost {
        const scroll = document.createElement('div');
        return {
            homeMode: true,
            hubView: 'tasks',
            visible: true,
            scroll,
            root: document.createElement('div'),
            projects: [],
            tasksFirstLoadPending: false,
            agentsHubLegacyInbox: false,
            agentsHubSelectedProjectId: undefined,
            agentsHubShellActive: false,
            agentsHubInlineActive: false,
            agentsHubInlineChatHost: undefined,
            agentsHubInlineTranscriptRoot: undefined,
            agentsHubInlineExecutionRoot: undefined,
            agentsHubInlineTabStrip: undefined,
            replacingTranscriptSheet: false,
            transcriptOpenSummaryId: undefined,
            transcriptOpenSummary: undefined,
            transcriptOpenProject: undefined,
            transcriptSheet: undefined,
            transcriptTabStrip: undefined,
            sessionsSidebar: undefined,
            transcriptLastStatus: undefined,
            transcriptLastFingerprint: undefined,
            transcriptLastConv: undefined,
            transcriptLastSseDeltaAt: undefined,
            transcriptChatHost: undefined,
            transcriptPlanHost: undefined,
            transcriptReviewHost: undefined,
            transcriptPreviewHost: undefined,
            transcriptFilesHost: undefined,
            transcriptTerminalHost: undefined,
            transcriptComposerHost: undefined,
            transcriptComposerProject: undefined,
            transcriptComposerSummary: undefined,
            transcriptComposerMountKey: undefined,
            transcriptComposerContext: [],
            transcriptComposerPinnedAgentId: undefined,
            transcriptComposerAgentModel: undefined,
            transcriptComposerModeId: undefined,
            transcriptComposerApprovalPolicyId: undefined,
            transcriptComposerPrefsConvId: undefined,
            transcriptComposerDraft: '',
            transcriptComposerDraftPersistTimer: undefined,
            transcriptComposerPrefsPersistTimer: undefined,
            transcriptUserScrollPinDispose: Disposable.NULL,
            transcriptTheiaSessionByConversationId: new Map(),
            transcriptUi: {} as MobileProjectsAgentsHubInlineHost['transcriptUi'],
            tasksHubUi: {} as MobileProjectsAgentsHubInlineHost['tasksHubUi'],
            headerExecutionTabsHost: document.createElement('div'),
            preparedCwdByProjectId: new Map(),
            projectsService: {} as MobileProjectsAgentsHubInlineHost['projectsService'],
            transcriptSheetUi: {} as MobileProjectsAgentsHubInlineHost['transcriptSheetUi'],
            executionSurfaceTabsUi: {} as MobileProjectsAgentsHubInlineHost['executionSurfaceTabsUi'],
            transcriptComposerUi: {} as MobileProjectsAgentsHubInlineHost['transcriptComposerUi'],
            transcriptStickyComposerUi: {} as MobileProjectsAgentsHubInlineHost['transcriptStickyComposerUi'],
            transcriptHeaderUi: { refreshTranscriptExecutionChrome: () => undefined } as unknown as MobileProjectsAgentsHubInlineHost['transcriptHeaderUi'],
            transcriptLiveUi: {} as MobileProjectsAgentsHubInlineHost['transcriptLiveUi'],
            transcriptMessagesUi: {} as MobileProjectsAgentsHubInlineHost['transcriptMessagesUi'],
            renderHeader: () => undefined,
            renderSubtitle: () => undefined,
            renderList: () => undefined,
            stickyComposerRenderUi: {} as MobileProjectsAgentsHubInlineHost['stickyComposerRenderUi'],
            detachTranscriptReviewWidget: () => undefined,
            disposeTranscriptEmbeddedPreview: () => undefined,
            notifyWorkspaceHubBottomBarRefresh: () => undefined,
            resolveHomePinnedProject: () => undefined,
            updateTasksAttentionChrome: () => undefined,
            conversationsForProject: () => [],
            conversationIndexUi: {
                conversationsForProject: () => [],
            } as unknown as MobileProjectsAgentsHubInlineHost['conversationIndexUi'],
            onNewClick: async () => undefined,
            onStartNewProject: async () => undefined,
            onOpenLocalWorkspaceFolder: async () => undefined,
            ...overrides,
        };
    }

    it('shows add-repository onboarding when no project is available', () => {
        const host = createHost();
        const ui = new MobileProjectsAgentsHubInlineUi(host);
        ui.renderAgentsHubExecutionShell();
        expect(host.scroll.querySelector('.theia-mobile-agents-hub-onboarding')).to.not.equal(null);
        expect(host.scroll.querySelector('.theia-mobile-agents-hub-onboarding-btn.theia-mod-primary')).to.not.equal(null);
        expect(host.scroll.textContent).to.include('Add repository');
        expect(host.scroll.textContent).to.include('Start new project');
    });

    const openSummary = (): QaapAgentConversationSummaryDTO => ({
        id: 'conv-open',
        cwd: '/tmp/demo',
        agentId: 'task',
        title: 'Fix login',
        status: 'streaming',
        createdAt: 1,
        updatedAt: 2,
        messageCount: 3,
    });

    it('skips full hub list rebuild when transcript overlay is open on any hub view', () => {
        const ui = new MobileProjectsAgentsHubInlineUi(createHost({
            hubView: 'review',
            transcriptSheet: document.createElement('div'),
            transcriptOpenSummaryId: 'conv-open',
            transcriptOpenSummary: openSummary(),
        }));
        expect(ui.shouldSkipFullRenderListOnConversationTick()).to.equal(true);
    });

    it('does not skip hub list rebuild when transcript overlay is closed', () => {
        const ui = new MobileProjectsAgentsHubInlineUi(createHost({
            hubView: 'review',
            transcriptOpenSummaryId: 'conv-open',
            transcriptOpenSummary: openSummary(),
        }));
        expect(ui.shouldSkipFullRenderListOnConversationTick()).to.equal(false);
    });

    it('schedules sidebar refresh instead of immediate rebuild during chrome refresh', () => {
        let scheduleCalls = 0;
        let refreshCalls = 0;
        const ui = new MobileProjectsAgentsHubInlineUi(createHost({
            sessionsSidebar: {
                isVisible: () => true,
                refreshList: () => { refreshCalls++; },
                scheduleRefreshList: () => { scheduleCalls++; },
            },
        }));
        ui.refreshWorkHubConversationChrome();
        expect(scheduleCalls).to.equal(1);
        expect(refreshCalls).to.equal(0);
    });
});
