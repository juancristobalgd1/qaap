// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { Disposable } from '@theia/core/lib/common/disposable';
import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import type { MobileProjectEntry } from './mobile-projects-types';
import { MobileProjectsTranscriptSheetUi, type MobileProjectsTranscriptSheetHost } from './mobile-projects-transcript-sheet-ui';
import type { WorkHubTranscriptBridge } from './work-hub-transcript-bridge';

describe('MobileProjectsTranscriptSheetUi', () => {

    beforeEach(() => {
        if (typeof HTMLElement === 'undefined') {
            enableJSDOM();
        }
        document.body.replaceChildren();
    });

    function summary(overrides: Partial<QaapAgentConversationSummaryDTO> = {}): QaapAgentConversationSummaryDTO {
        return {
            id: 'conv-1',
            cwd: '/workspace',
            agentId: 'codex',
            title: 'Thread',
            status: 'streaming',
            createdAt: 1,
            updatedAt: 2,
            messageCount: 1,
            lastMessagePreview: 'Build the feature',
            lastMessageRole: 'user',
            ...overrides,
        };
    }

    function project(): MobileProjectEntry {
        return {
            id: 'project-1',
            cwd: '/workspace',
            label: 'Workspace',
        } as unknown as MobileProjectEntry;
    }

    function createHost(): MobileProjectsTranscriptSheetHost {
        const calls: string[] = [];
        return {
            replacingTranscriptSheet: false,
            transcriptSheet: undefined,
            transcriptChatHost: undefined,
            transcriptChatInputHost: undefined,
            transcriptComposerSizeDispose: Disposable.NULL,
            transcriptTabStrip: undefined,
            transcriptReviewHost: undefined,
            transcriptPreviewHost: undefined,
            transcriptFilesHost: undefined,
            transcriptTerminalHost: undefined,
            transcriptTerminalToolbar: undefined,
            transcriptTerminalSlider: undefined,
            transcriptTerminalDots: undefined,
            verifyResults: [],
            verifyChecksCwd: undefined,
            verifyChecksLoading: false,
            verifyRunning: false,
            verifyAutoAttempts: 0,
            transcriptHistoryPanelOpen: false,
            transcriptHistoryCommits: [],
            transcriptHistoryBranch: undefined,
            transcriptHistoryError: undefined,
            transcriptHistoryQuery: '',
            transcriptHistoryRoot: undefined,
            transcriptHistoryLoading: false,
            transcriptLastStatus: undefined,
            transcriptOpenSummaryId: undefined,
            transcriptOpenSummary: undefined,
            transcriptOpenProject: undefined,
            transcriptLastFingerprint: undefined,
            transcriptComposerPrefsConvId: undefined,
            transcriptComposerHost: undefined,
            transcriptComposerMountKey: undefined,
            transcriptComposerProject: undefined,
            transcriptComposerSummary: undefined,
            transcriptComposerContext: [],
            transcriptComposerPinnedAgentId: undefined,
            transcriptComposerAgentModel: undefined,
            transcriptComposerModeId: undefined,
            transcriptComposerApprovalPolicyId: undefined,
            transcriptComposerDraft: '',
            transcriptComposerDraftPersistTimer: undefined,
            transcriptComposerPrefsPersistTimer: undefined,
            transcriptFollowUpFlushInFlight: false,
            transcriptFollowUpQueue: { clear: () => undefined } as never,
            transcriptLastConv: undefined,
            transcriptLastSseDeltaAt: undefined,
            transcriptLastStreamProgressAt: undefined,
            transcriptHeaderSubtitle: undefined,
            transcriptPreviewRequestRunning: false,
            transcriptPreviewRequestPending: false,
            transcriptChatInputWidget: undefined,
            transcriptChatViewWidget: undefined,
            transcriptSheetDispose: Disposable.NULL,
            transcriptUserScrollPinDispose: Disposable.NULL,
            transcriptTheiaSessionByConversationId: new Map(),
            transcriptUi: { disposeList: () => undefined } as never,
            transcriptComposerUi: { closeTranscriptComposerSheets: () => undefined, refreshTranscriptComposerAgents: () => undefined } as never,
            transcriptStickyComposerUi: {
                flushTranscriptComposerDraft: () => undefined,
                flushTranscriptComposerPrefs: () => undefined,
                mountTranscriptStickyComposer: () => undefined,
            } as never,
            transcriptLiveUi: {
                scheduleTranscriptConversationRefresh: () => calls.push('schedule'),
                applyCachedTranscriptOnOpen: () => false,
                renderOpenTranscriptPlaceholder: () => calls.push('placeholder'),
                refreshOpenTranscriptConversation: () => Promise.resolve(),
                clearTranscriptSemanticProgressClock: () => undefined,
                stopTranscriptLiveWatch: () => undefined,
            } as never,
            transcriptHeaderUi: { resolveTranscriptHeaderTitle: () => 'Thread' } as never,
            executionSurfaceTabsUi: {
                syncHeaderExecutionTabStrip: () => calls.push('sync-tabs'),
                showOnlyExecutionSurfaceTab: () => calls.push('messages'),
                mountTranscriptSurfaceTab: () => calls.push('mount-messages'),
                closeExecutionTabOverflowMenu: () => undefined,
                navigateExecutionSurfaceBack: () => false,
                mountTranscriptExecutionHeader: () => ({ back: document.createElement('button'), tabStrip: document.createElement('div') }),
            } as never,
            agentsHubInlineActive: false,
            conversations: {
                prefetchDocument: () => calls.push('prefetch'),
            } as never,
            visible: true,
            delegate: { onEnterActiveTranscript: () => calls.push('enter') },
            closeExecutionTabOverflowMenu: () => undefined,
            closeParallelSheet: () => undefined,
            detachTranscriptReviewWidget: () => undefined,
            disposeTranscriptEmbeddedPreview: () => undefined,
            detachTranscriptWorkspaceSurfacesFromSheet: () => undefined,
            calls,
        } as MobileProjectsTranscriptSheetHost & { calls: string[] };
    }

    function createWorkHub(): WorkHubTranscriptBridge {
        return {
            isAgentsHubLanding: () => false,
            isProjectDetailView: () => false,
            refreshHubChrome: () => undefined,
            refreshHubBottomBar: () => undefined,
            openInlineTranscript: async () => undefined,
            closeAgentsHubSession: () => undefined,
            teardownAgentsHubShell: () => undefined,
        } as unknown as WorkHubTranscriptBridge;
    }

    it('keeps an empty shell for the open placeholder (no preview message)', () => {
        const ui = new MobileProjectsTranscriptSheetUi(createHost(), createWorkHub());
        const conv = ui.summaryToTranscriptPlaceholder(summary());

        expect(conv.status).to.equal('streaming');
        expect(conv.messages).to.deep.equal([]);
    });

    it('reopens the same mounted conversation without tearing down the sheet', async () => {
        class TestSheetUi extends MobileProjectsTranscriptSheetUi {
            closeCalls = 0;
            override closeTranscriptSheet(): void {
                this.closeCalls++;
            }
        }
        const host = createHost() as MobileProjectsTranscriptSheetHost & { calls: string[] };
        const sheet = document.createElement('div');
        const chatHost = document.createElement('div');
        const chatInputHost = document.createElement('div');
        document.body.append(sheet);
        host.transcriptSheet = sheet;
        host.transcriptChatHost = chatHost;
        host.transcriptChatInputHost = chatInputHost;
        host.transcriptOpenSummaryId = 'conv-1';

        const ui = new TestSheetUi(host, createWorkHub());
        await ui.openTranscriptSheet(project(), summary());

        expect(ui.closeCalls).to.equal(0);
        expect(host.calls).to.include.members(['enter', 'schedule', 'placeholder', 'messages', 'mount-messages', 'prefetch']);
    });

    it('switches a mounted sheet to another conversation without closing the overlay', async () => {
        class TestSheetUi extends MobileProjectsTranscriptSheetUi {
            closeCalls = 0;
            override closeTranscriptSheet(): void {
                this.closeCalls++;
            }
        }
        const host = createHost() as MobileProjectsTranscriptSheetHost & { calls: string[] };
        const sheet = document.createElement('div');
        const backdrop = document.createElement('div');
        backdrop.className = 'theia-mobile-agent-log-backdrop';
        const header = document.createElement('header');
        header.className = 'theia-mobile-agent-log-header';
        const chatHost = document.createElement('div');
        const chatInputHost = document.createElement('div');
        const reviewHost = document.createElement('div');
        const previewHost = document.createElement('div');
        const filesHost = document.createElement('div');
        const terminalHost = document.createElement('div');
        sheet.append(backdrop, header, chatHost, chatInputHost);
        document.body.append(sheet);
        host.transcriptSheet = sheet;
        host.transcriptChatHost = chatHost;
        host.transcriptChatInputHost = chatInputHost;
        host.transcriptReviewHost = reviewHost;
        host.transcriptPreviewHost = previewHost;
        host.transcriptFilesHost = filesHost;
        host.transcriptTerminalHost = terminalHost;
        host.transcriptOpenSummaryId = 'conv-1';
        host.transcriptOpenSummary = summary();
        host.transcriptOpenProject = project();

        const ui = new TestSheetUi(host, createWorkHub());
        await ui.openTranscriptSheet(project(), summary({ id: 'conv-2', title: 'Next thread' }));

        expect(ui.closeCalls).to.equal(0);
        expect(host.transcriptOpenSummaryId).to.equal('conv-2');
        expect(host.calls).to.include.members(['schedule', 'placeholder', 'messages', 'mount-messages', 'prefetch']);
    });

    describe('observeTranscriptComposerSize pill-strip height', () => {
        function invokeObserve(root: HTMLElement, composer: HTMLElement): void {
            const ui = new MobileProjectsTranscriptSheetUi(createHost(), createWorkHub());
            (ui as unknown as { observeTranscriptComposerSize(root: HTMLElement, composer: HTMLElement): void })
                .observeTranscriptComposerSize(root, composer);
        }

        it('publishes 0px when the composer has no changes-pill host', () => {
            const root = document.createElement('div');
            const composer = document.createElement('div');
            document.body.append(root, composer);

            invokeObserve(root, composer);

            expect(root.style.getPropertyValue('--qaap-composer-pill-strip-height')).to.equal('0px');
        });

        it('publishes 0px when the changes-pill host is hidden', () => {
            const root = document.createElement('div');
            const composer = document.createElement('div');
            const pillHost = document.createElement('div');
            pillHost.className = 'theia-mobile-sticky-composer-changes-pill-host';
            pillHost.hidden = true;
            composer.append(pillHost);
            document.body.append(root, composer);

            invokeObserve(root, composer);

            expect(root.style.getPropertyValue('--qaap-composer-pill-strip-height')).to.equal('0px');
        });

        it('publishes the pill-strip height when the changes-pill host is visible', () => {
            const root = document.createElement('div');
            const composer = document.createElement('div');
            const pillHost = document.createElement('div');
            pillHost.className = 'theia-mobile-sticky-composer-changes-pill-host';
            pillHost.getBoundingClientRect = () => ({
                height: 32, width: 100, top: 0, left: 0, right: 100, bottom: 32, x: 0, y: 0, toJSON: () => ({}),
            });
            composer.append(pillHost);
            document.body.append(root, composer);

            invokeObserve(root, composer);

            expect(root.style.getPropertyValue('--qaap-composer-pill-strip-height')).to.equal('32px');
        });
    });

    it('grows empty-chat bottom padding under the sticky composer to cover its overlap', () => {
        const cssPath = path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'mobile-workbench-conversation.css');
        const css = fs.readFileSync(cssPath, 'utf8');
        expect(css).to.match(
            /\.theia-mobile-projects\.theia-mod-sticky-composer \.theia-mobile-agent-transcript\.theia-mod-empty-chat\s*\{\s*padding-bottom:\s*max\(24px,/,
        );
        expect(css).to.match(
            /@media \(max-width: 640px\)[\s\S]*?\.theia-mobile-projects\.theia-mod-sticky-composer \.theia-mobile-agent-transcript\.theia-mod-empty-chat\s*\{\s*padding-bottom:\s*max\(18px,/,
        );
    });
});
