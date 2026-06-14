// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { Disposable } from '@theia/core/lib/common/disposable';
import {
    MobileProjectsPanelLifecycleUi,
    type MobileProjectsPanelLifecycleHost,
} from './mobile-projects-panel-lifecycle-ui';
import type { MobileProjectsHubView } from './mobile-projects-types';

describe('mobile-projects-panel-lifecycle-ui live refresh', () => {

    function createHost(overrides: Partial<MobileProjectsPanelLifecycleHost> = {}): MobileProjectsPanelLifecycleHost & {
        renderListCalls: number;
        scheduleRenderListCalls: number;
        refreshChromeCalls: number;
    } {
        const renderListCalls = { value: 0 };
        const scheduleRenderListCalls = { value: 0 };
        const refreshChromeCalls = { value: 0 };
        const host: MobileProjectsPanelLifecycleHost & {
            renderListCalls: number;
            scheduleRenderListCalls: number;
            refreshChromeCalls: number;
        } = {
            visible: true,
            homeMode: true,
            hubView: 'tasks' as MobileProjectsHubView,
            tasksHubSurface: 'task',
            filter: 'all',
            projects: [],
            transcriptSheet: undefined,
            transcriptChatHost: undefined,
            transcriptLastConv: undefined,
            agentsHubInlineActive: false,
            transcriptOpenSummaryId: undefined,
            tasksFirstLoadPending: false,
            tasksFirstLoadFallback: undefined,
            inboxPullRequests: [],
            inboxPullRequestsLoaded: false,
            routinesRefreshTimer: undefined,
            chatServiceRefreshHandle: undefined,
            chatSessionModelDisposables: new Map(),
            chatSessionProjectIds: new Map(),
            sessionsSidebar: undefined,
            stickyComposerFabLiftObserver: undefined,
            openRepoDialog: undefined,
            root: {} as HTMLElement,
            accountAvatar: {} as HTMLElement,
            accountBtn: {} as HTMLButtonElement,
            dragDismissDispose: Disposable.NULL,
            pullToRefreshDispose: Disposable.NULL,
            activeTasksDispose: Disposable.NULL,
            conversationsDispose: Disposable.NULL,
            inboxStreamDispose: Disposable.NULL,
            chatServiceDispose: Disposable.NULL,
            transcriptWorkspaceSurfaces: { disposeAll: () => undefined } as MobileProjectsPanelLifecycleHost['transcriptWorkspaceSurfaces'],
            onDocumentPointerDown: () => undefined,
            onAuthSessionChanged: () => undefined,
            onAccountClick: () => undefined,
            activeTasks: undefined,
            conversations: undefined,
            inboxStream: undefined,
            chatService: undefined,
            projectsService: { loadProjects: async () => [], getFilter: () => 'all' } as unknown as MobileProjectsPanelLifecycleHost['projectsService'],
            delegate: { onDismiss: () => undefined },
            transcriptComposerUi: { closeTranscriptComposerSheets: () => undefined } as MobileProjectsPanelLifecycleHost['transcriptComposerUi'],
            transcriptLiveUi: { ensureTranscriptConversationRefresh: () => undefined, handleTranscriptSseMessage: () => undefined } as unknown as MobileProjectsPanelLifecycleHost['transcriptLiveUi'],
            transcriptSheetUi: { closeTranscriptSheet: () => undefined } as MobileProjectsPanelLifecycleHost['transcriptSheetUi'],
            closeRoutineEditor: () => undefined,
            closeCardMenu: () => undefined,
            stickyComposerSheetsUi: { closeStickyComposerSheets: () => undefined } as MobileProjectsPanelLifecycleHost['stickyComposerSheetsUi'],
            workHubSearchUi: { closeWorkHubSearchQuickPick: () => undefined } as MobileProjectsPanelLifecycleHost['workHubSearchUi'],
            chatServiceSummariesUi: { refreshChatServiceSessionSummaries: async () => undefined } as MobileProjectsPanelLifecycleHost['chatServiceSummariesUi'],
            disposeTranscriptTerminalSlides: () => undefined,
            detachDiffReviewWidget: () => undefined,
            ensureOverlayUi: () => ({
                team: { renderTeamSection: () => undefined },
                parallel: { applyParallelRunStats: () => undefined },
            }),
            hubQueryUi: {
                isTasksHubView: () => true,
            } as MobileProjectsPanelLifecycleHost['hubQueryUi'],
            refreshDiffHubView: async () => undefined,
            refreshTasksHubApprovals: () => undefined,
            refreshInboxPullRequests: async () => undefined,
            refreshHomeHubData: () => undefined,
            render: () => undefined,
            renderList: () => { renderListCalls.value++; },
            scheduleRenderList: () => { scheduleRenderListCalls.value++; },
            renderSubtitle: () => undefined,
            renderFilters: () => undefined,
            stickyComposerRenderUi: { renderStickyComposer: () => undefined } as MobileProjectsPanelLifecycleHost['stickyComposerRenderUi'],
            syncLandingHubListChrome: () => undefined,
            markTasksFirstLoadComplete: () => undefined,
            maybeInstallWorkHubPerfProbe: () => undefined,
            shouldSkipFullRenderListOnConversationTick: () => false,
            shouldUseMissionControlLanding: () => false,
            refreshWorkHubConversationChrome: () => { refreshChromeCalls.value++; },
            mergeInboxPullRequests: polled => polled,
            updateTasksAttentionChrome: () => undefined,
            cardMenuUi: { closeCardMenu: () => undefined } as MobileProjectsPanelLifecycleHost['cardMenuUi'],
            get renderListCalls() { return renderListCalls.value; },
            get scheduleRenderListCalls() { return scheduleRenderListCalls.value; },
            get refreshChromeCalls() { return refreshChromeCalls.value; },
            ...overrides,
        };
        return host;
    }

    it('coalesces conversation ticks into scheduleRenderList on the tasks hub', () => {
        const onDidChangeEmitter = new Emitter<void>();
        const host = createHost({
            conversations: {
                warmLiveTransport: () => undefined,
                onDidChange: onDidChangeEmitter.event,
                onDidReceiveMessage: Event.None,
                onDidReceiveParallelRun: Event.None,
            } as MobileProjectsPanelLifecycleHost['conversations'],
        });
        const ui = new MobileProjectsPanelLifecycleUi(host);
        ui.subscribeToActiveTasks();

        onDidChangeEmitter.fire(undefined);
        onDidChangeEmitter.fire(undefined);
        onDidChangeEmitter.fire(undefined);

        expect(host.scheduleRenderListCalls).to.equal(3);
        expect(host.renderListCalls).to.equal(0);
        expect(host.refreshChromeCalls).to.equal(0);
    });

    it('refreshes chrome instead of scheduling hub list rebuild while transcript is open', () => {
        const onDidChangeEmitter = new Emitter<void>();
        const host = createHost({
            shouldSkipFullRenderListOnConversationTick: () => true,
            conversations: {
                warmLiveTransport: () => undefined,
                onDidChange: onDidChangeEmitter.event,
                onDidReceiveMessage: Event.None,
                onDidReceiveParallelRun: Event.None,
            } as MobileProjectsPanelLifecycleHost['conversations'],
        });
        const ui = new MobileProjectsPanelLifecycleUi(host);
        ui.subscribeToActiveTasks();

        onDidChangeEmitter.fire(undefined);

        expect(host.refreshChromeCalls).to.equal(1);
        expect(host.scheduleRenderListCalls).to.equal(0);
        expect(host.renderListCalls).to.equal(0);
    });

    it('skips active task list rebuild while transcript overlay is open on tasks hub', () => {
        const onDidChangeEmitter = new Emitter<void>();
        const host = createHost({
            transcriptSheet: {} as HTMLElement,
            transcriptChatHost: {} as HTMLElement,
            transcriptLastConv: {} as MobileProjectsPanelLifecycleHost['transcriptLastConv'],
            shouldSkipFullRenderListOnConversationTick: () => true,
            activeTasks: {
                onDidChange: onDidChangeEmitter.event,
            } as MobileProjectsPanelLifecycleHost['activeTasks'],
        });
        const ui = new MobileProjectsPanelLifecycleUi(host);
        ui.subscribeToActiveTasks();

        onDidChangeEmitter.fire(undefined);

        expect(host.refreshChromeCalls).to.equal(1);
        expect(host.scheduleRenderListCalls).to.equal(0);
        expect(host.renderListCalls).to.equal(0);
    });
});
