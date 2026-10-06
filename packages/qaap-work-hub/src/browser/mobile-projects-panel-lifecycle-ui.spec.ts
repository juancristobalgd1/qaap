// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { Disposable } from '@theia/core/lib/common/disposable';
import {
    MobileProjectsPanelLifecycleUi,
    type MobileProjectsPanelLifecycleHost,
} from './mobile-projects-panel-lifecycle-ui';
import type { QaapConversationChangeEvent } from '@theia/qaap-shared-core/lib/common/qaap-conversation-change';
import type { MobileProjectsHubView } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { MobileProjectsConversationFlags } from '@theia/qaap-shared-core/lib/browser/mobile-projects-conversation-flags';
import {
    MobileProjectsConversationIndexUi,
    type MobileProjectsConversationIndexHost,
} from '@theia/qaap-shared-core/lib/browser/mobile-projects-conversation-index-ui';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';
import { MobileProjectsUnreadTrackerUi } from './mobile-projects-unread-tracker-ui';

disableImportJSDOM();

describe('mobile-projects-panel-lifecycle-ui live refresh', () => {

    function createHost(overrides: Partial<MobileProjectsPanelLifecycleHost> = {}): MobileProjectsPanelLifecycleHost & {
        renderListCalls: number;
        scheduleRenderListCalls: number;
        refreshChromeCalls: number;
        patchRowCalls: number;
    } {
        const renderListCalls = { value: 0 };
        const scheduleRenderListCalls = { value: 0 };
        const refreshChromeCalls = { value: 0 };
        const patchRowCalls = { value: 0 };
        const host: MobileProjectsPanelLifecycleHost & {
            renderListCalls: number;
            scheduleRenderListCalls: number;
            refreshChromeCalls: number;
            patchRowCalls: number;
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
            shouldUseAgentsHubLanding: () => false,
            isAgentsHubExecutionSurfaceReady: () => true,
            ensureAgentsHubExecutionShellRendered: () => undefined,
            refreshWorkHubConversationChrome: () => { refreshChromeCalls.value++; },
            patchWorkHubConversationRowInPlace: () => { patchRowCalls.value++; },
            touchProjectActivityByConversationId: () => undefined,
            mergeInboxPullRequests: polled => polled,
            updateTasksAttentionChrome: () => undefined,
            cardMenuUi: { closeCardMenu: () => undefined } as MobileProjectsPanelLifecycleHost['cardMenuUi'],
            syncWorkHubProjectSkillRoots: () => undefined,
            get renderListCalls() { return renderListCalls.value; },
            get scheduleRenderListCalls() { return scheduleRenderListCalls.value; },
            get refreshChromeCalls() { return refreshChromeCalls.value; },
            get patchRowCalls() { return patchRowCalls.value; },
            ...overrides,
        };
        return host;
    }

    it('coalesces conversation ticks into scheduleRenderList on the tasks hub', () => {
        const onDidChangeDetailEmitter = new Emitter<QaapConversationChangeEvent>();
        const host = createHost({
            conversations: {
                warmLiveTransport: () => undefined,
                onDidChange: Event.None,
                onDidChangeDetail: onDidChangeDetailEmitter.event,
                onDidReceiveMessage: Event.None,
                onDidReceiveParallelRun: Event.None,
                onDidReceiveTransportActivity: Event.None,
                onDidReconnectTransport: Event.None,
                onDidReceivePendingQueue: Event.None,
            } as MobileProjectsPanelLifecycleHost['conversations'],
        });
        const ui = new MobileProjectsPanelLifecycleUi(host);
        ui.subscribeToActiveTasks();

        const tick: QaapConversationChangeEvent = { kind: 'updated', conversationId: 'c1', cwd: '/repo', changedFields: ['status'] };
        onDidChangeDetailEmitter.fire(tick);
        onDidChangeDetailEmitter.fire(tick);
        onDidChangeDetailEmitter.fire(tick);

        expect(host.scheduleRenderListCalls).to.equal(3);
        expect(host.renderListCalls).to.equal(0);
        expect(host.refreshChromeCalls).to.equal(0);
    });

    it('patches only the affected row on a preview-only tick instead of rebuilding the list', () => {
        const onDidChangeDetailEmitter = new Emitter<QaapConversationChangeEvent>();
        const host = createHost({
            conversations: {
                warmLiveTransport: () => undefined,
                onDidChange: Event.None,
                onDidChangeDetail: onDidChangeDetailEmitter.event,
                onDidReceiveMessage: Event.None,
                onDidReceiveParallelRun: Event.None,
                onDidReceiveTransportActivity: Event.None,
                onDidReconnectTransport: Event.None,
                onDidReceivePendingQueue: Event.None,
            } as MobileProjectsPanelLifecycleHost['conversations'],
        });
        const ui = new MobileProjectsPanelLifecycleUi(host);
        ui.subscribeToActiveTasks();

        // turnProgress/activityLabel are preview-only fields → single-row patch, no list rebuild.
        onDidChangeDetailEmitter.fire({
            kind: 'message_delta',
            conversationId: 'c1',
            cwd: '/repo',
            changedFields: ['turnProgress', 'updatedAt'],
        });

        expect(host.patchRowCalls).to.equal(1);
        expect(host.refreshChromeCalls).to.equal(1);
        expect(host.scheduleRenderListCalls).to.equal(0);
        expect(host.renderListCalls).to.equal(0);
    });

    it('does not patch inbox rows on a preview-only tick while a transcript covers them', () => {
        const onDidChangeDetailEmitter = new Emitter<QaapConversationChangeEvent>();
        const host = createHost({
            shouldSkipFullRenderListOnConversationTick: () => true,
            conversations: {
                warmLiveTransport: () => undefined,
                onDidChange: Event.None,
                onDidChangeDetail: onDidChangeDetailEmitter.event,
                onDidReceiveMessage: Event.None,
                onDidReceiveParallelRun: Event.None,
                onDidReceiveTransportActivity: Event.None,
                onDidReconnectTransport: Event.None,
                onDidReceivePendingQueue: Event.None,
            } as MobileProjectsPanelLifecycleHost['conversations'],
        });
        const ui = new MobileProjectsPanelLifecycleUi(host);
        ui.subscribeToActiveTasks();

        onDidChangeDetailEmitter.fire({
            kind: 'message_delta',
            conversationId: 'c1',
            cwd: '/repo',
            changedFields: ['turnProgress'],
        });

        expect(host.patchRowCalls).to.equal(0);
        expect(host.refreshChromeCalls).to.equal(1);
    });

    it('refreshes chrome instead of scheduling hub list rebuild while transcript is open', () => {
        const onDidChangeDetailEmitter = new Emitter<QaapConversationChangeEvent>();
        const host = createHost({
            shouldSkipFullRenderListOnConversationTick: () => true,
            conversations: {
                warmLiveTransport: () => undefined,
                onDidChange: Event.None,
                onDidChangeDetail: onDidChangeDetailEmitter.event,
                onDidReceiveMessage: Event.None,
                onDidReceiveParallelRun: Event.None,
                onDidReceiveTransportActivity: Event.None,
                onDidReconnectTransport: Event.None,
                onDidReceivePendingQueue: Event.None,
            } as MobileProjectsPanelLifecycleHost['conversations'],
        });
        const ui = new MobileProjectsPanelLifecycleUi(host);
        ui.subscribeToActiveTasks();

        onDidChangeDetailEmitter.fire({ kind: 'updated', conversationId: 'c1', cwd: '/repo' });

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

    it('forces the agents execution shell when a visible agents landing has no painted surface', () => {
        let ensureCalls = 0;
        const host = createHost({
            visible: true,
            homeMode: true,
            hubView: 'tasks',
            shouldUseAgentsHubLanding: () => true,
            isAgentsHubExecutionSurfaceReady: () => false,
            ensureAgentsHubExecutionShellRendered: () => { ensureCalls++; },
        });
        const ui = new MobileProjectsPanelLifecycleUi(host);

        (ui as unknown as { ensureVisibleAgentsHubShell(): void }).ensureVisibleAgentsHubShell();

        expect(ensureCalls).to.equal(1);
    });

    describe('unread dot while the conversation is open', () => {

        useSuiteJSDOM();

        beforeEach(() => {
            window.localStorage.clear();
        });

        function agentReply(updatedAt: number): QaapAgentConversationSummaryDTO {
            return {
                id: 'c1',
                cwd: '/repo',
                agentId: 'codex',
                title: 'Task',
                status: 'streaming',
                createdAt: 1,
                updatedAt,
                messageCount: 2,
                lastMessagePreview: 'Working on it',
                lastMessageRole: 'agent',
            };
        }

        function createUnreadFixture(): {
            host: ReturnType<typeof createHost>;
            flags: MobileProjectsConversationFlags;
            tick(updatedAt: number): void;
            isUnread(): boolean;
        } {
            const onDidChangeDetailEmitter = new Emitter<QaapConversationChangeEvent>();
            const store = new Map<string, QaapAgentConversationSummaryDTO>([['c1', agentReply(10)]]);
            const flags = new MobileProjectsConversationFlags();
            const host = createHost({
                conversationFlags: flags,
                conversations: {
                    warmLiveTransport: () => undefined,
                    findSummaryById: (id: string) => store.get(id),
                    onDidChange: Event.None,
                    onDidChangeDetail: onDidChangeDetailEmitter.event,
                    onDidReceiveMessage: Event.None,
                    onDidReceiveParallelRun: Event.None,
                    onDidReceiveTransportActivity: Event.None,
                    onDidReconnectTransport: Event.None,
                    onDidReceivePendingQueue: Event.None,
                } as unknown as MobileProjectsPanelLifecycleHost['conversations'],
            });
            host.unreadTrackerUi = new MobileProjectsUnreadTrackerUi({
                conversationFlags: flags,
                conversations: { findSummaryById: id => store.get(id) },
                get transcriptOpenSummaryId(): string | undefined { return host.transcriptOpenSummaryId; },
                transcriptOpenSummary: undefined,
                get visible(): boolean { return host.visible; },
            });
            new MobileProjectsPanelLifecycleUi(host).subscribeToActiveTasks();
            const indexUi = new MobileProjectsConversationIndexUi({ conversationFlags: flags } as unknown as MobileProjectsConversationIndexHost);
            return {
                host,
                flags,
                tick: updatedAt => {
                    store.set('c1', agentReply(updatedAt));
                    onDidChangeDetailEmitter.fire({ kind: 'updated', conversationId: 'c1', cwd: '/repo', changedFields: ['updatedAt'] });
                },
                isUnread: () => indexUi.isConversationUnread(store.get('c1')!),
            };
        }

        it('keeps the dot off while the agent keeps writing in the open conversation', () => {
            const { host, tick, isUnread } = createUnreadFixture();
            host.transcriptOpenSummaryId = 'c1';
            host.unreadTrackerUi!.markConversationOpened(agentReply(10));
            expect(isUnread()).to.equal(false);

            tick(20);
            tick(30);

            expect(isUnread()).to.equal(false);
        });

        it('shows the dot again for an agent reply that lands after the conversation was closed', () => {
            const { host, tick, isUnread } = createUnreadFixture();
            host.transcriptOpenSummaryId = 'c1';
            host.unreadTrackerUi!.markConversationOpened(agentReply(10));
            tick(20);
            host.unreadTrackerUi!.markOpenConversationClosed();
            host.transcriptOpenSummaryId = undefined;
            expect(isUnread()).to.equal(false);

            tick(40);

            expect(isUnread()).to.equal(true);
        });

        it('does not acknowledge replies while the Work Hub is hidden', () => {
            const { host, tick, isUnread } = createUnreadFixture();
            host.transcriptOpenSummaryId = 'c1';
            host.unreadTrackerUi!.markConversationOpened(agentReply(10));
            host.visible = false;

            tick(20);

            expect(isUnread()).to.equal(true);
        });

        it('repaints the row as soon as a read mark changes', () => {
            const { host, flags } = createUnreadFixture();
            const patchesBefore = host.patchRowCalls;
            const chromeBefore = host.refreshChromeCalls;

            flags.markRead('c1', 50);

            expect(host.patchRowCalls).to.equal(patchesBefore + 1);
            expect(host.refreshChromeCalls).to.equal(chromeBefore + 1);
        });

        it('repaints the sessions sidebar row when a read mark changes, so opening another task leaves no stale dot', () => {
            const { host, flags } = createUnreadFixture();
            let sidebarRefreshes = 0;
            host.sessionsSidebar = {
                isVisible: () => true,
                isPullRequestsVisible: () => false,
                refreshList: () => { sidebarRefreshes++; },
                scheduleRefreshList: () => { sidebarRefreshes++; },
            } as unknown as MobileProjectsPanelLifecycleHost['sessionsSidebar'];

            flags.markRead('c1', 50);

            expect(sidebarRefreshes).to.equal(1);
        });
    });
});
