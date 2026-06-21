// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { Disposable } from '@theia/core/lib/common/disposable';
import {
    MobileProjectsExecutionSurfaceTabsUi,
    type MobileProjectsExecutionSurfaceTabsHost,
} from './mobile-projects-execution-surface-tabs-ui';
import type { MobileProjectEntry } from './mobile-projects-types';

describe('mobile-projects-execution-surface-tabs-ui', () => {

    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    function createHost(overrides: Partial<MobileProjectsExecutionSurfaceTabsHost> = {}): MobileProjectsExecutionSurfaceTabsHost {
        return {
            executionSurfaceTabByProjectId: new Map(),
            transcriptTabStrip: undefined,
            transcriptSheet: undefined,
            transcriptChatHost: undefined,
            transcriptChatInputHost: undefined,
            transcriptPlanHost: undefined,
            transcriptReviewHost: undefined,
            transcriptPreviewHost: undefined,
            transcriptFilesHost: undefined,
            transcriptTerminalHost: undefined,
            transcriptHeaderSubtitle: undefined,
            transcriptOpenSummary: undefined,
            transcriptOpenProject: undefined,
            transcriptLastConv: undefined,
            projectDetailTabStrip: undefined,
            projectDetailSurfaceTargets: undefined,
            headerExecutionTabsHost: document.createElement('div'),
            headerExecutionTabsProjectId: undefined,
            agentsHubShellActive: true,
            agentsHubInlineTranscriptRoot: undefined,
            agentsHubInlineExecutionRoot: undefined,
            agentsHubInlineTabStrip: undefined,
            stickyComposerHost: document.createElement('div'),
            root: document.createElement('div'),
            scroll: document.createElement('div'),
            executionTabOverflowMenu: undefined,
            executionTabOverflowAnchor: undefined,
            executionTabOverflowDispose: Disposable.NULL,
            expandedId: undefined,
            projectDetailExpandedId: undefined,
            transcriptHeaderUi: {} as MobileProjectsExecutionSurfaceTabsHost['transcriptHeaderUi'],
            transcriptSurfacesUi: {
                suspendTranscriptPreviewIframe: () => undefined,
                updateTranscriptHeader: () => undefined,
                renderPlanTab: () => undefined,
                mountTranscriptReviewWidget: async () => undefined,
                renderPreviewTab: () => undefined,
                ensureTranscriptFilesTab: () => undefined,
                ensureTranscriptTerminalTab: async () => undefined,
                syncExecutionSurfaceChrome: () => undefined,
            } as unknown as MobileProjectsExecutionSurfaceTabsHost['transcriptSurfacesUi'],
            projectDetailUi: {} as MobileProjectsExecutionSurfaceTabsHost['projectDetailUi'],
            ensureAgentsHubExecutionShellRendered: () => undefined,
            appendTranscriptHeaderActions: () => document.createElement('button'),
            renderHeader: () => undefined,
            renderSubtitle: () => undefined,
            stickyComposerRenderUi: {
                renderStickyComposer: () => undefined,
            } as unknown as MobileProjectsExecutionSurfaceTabsHost['stickyComposerRenderUi'],
            resolveAgentsHubShellSummary: () => ({
                id: 'idle',
                cwd: '/tmp/demo',
                agentId: 'task',
                title: 'Idle',
                status: 'idle',
                createdAt: 1,
                updatedAt: 1,
                messageCount: 0,
            }),
            projectNavigationUi: {} as MobileProjectsExecutionSurfaceTabsHost['projectNavigationUi'],
            hubQueryUi: {} as MobileProjectsExecutionSurfaceTabsHost['hubQueryUi'],
            isProjectDetailView: () => false,
            projects: [],
            closeCardMenu: () => undefined,
            cardMenuUi: {
                closeCardMenu: () => undefined,
            } as unknown as MobileProjectsExecutionSurfaceTabsHost['cardMenuUi'],
            isAgentWorking: () => false,
            ...overrides,
        };
    }

    it('rebinds connected WorkHub surface hosts before applying tab visibility', () => {
        const executionRoot = document.createElement('div');
        executionRoot.className = 'theia-mobile-agents-hub-inline-execution';
        const transcriptRoot = document.createElement('div');
        transcriptRoot.className = 'theia-mobile-agents-hub-inline-transcript';
        const chatHost = document.createElement('div');
        chatHost.className = 'theia-mobile-agent-transcript-real-chat';
        transcriptRoot.append(chatHost);
        const filesHost = document.createElement('div');
        filesHost.className = 'theia-mobile-transcript-files-host';
        filesHost.hidden = true;
        const terminalHost = document.createElement('div');
        terminalHost.className = 'theia-mobile-transcript-terminal-host';
        terminalHost.hidden = true;
        executionRoot.append(transcriptRoot, filesHost, terminalHost);
        document.body.append(executionRoot);
        try {
            const staleTerminalHost = document.createElement('div');
            staleTerminalHost.hidden = true;
            const host = createHost({
                agentsHubInlineExecutionRoot: executionRoot,
                transcriptTerminalHost: staleTerminalHost,
            });
            const ui = new MobileProjectsExecutionSurfaceTabsUi(host);

            ui.showOnlyExecutionSurfaceTab('terminal');

            expect(host.transcriptTerminalHost).to.equal(terminalHost);
            expect(terminalHost.hidden).to.equal(false);
            expect(filesHost.hidden).to.equal(true);
            expect(transcriptRoot.hidden).to.equal(true);
            expect(executionRoot.getAttribute('data-active-surface')).to.equal('terminal');
        } finally {
            executionRoot.remove();
        }
    });

    it('allows opening Changes when a streaming turn is visually settled', () => {
        const project: MobileProjectEntry = {
            id: 'p1',
            name: 'Demo',
            color: '#8EB5DC',
            branch: 'main',
            status: 'idle',
            task: '',
            progress: 0,
            agents: [],
            lastActive: 'now',
            tokens: '0',
            cost: '$0',
            pinned: false,
            isCurrent: true,
        };
        const summary = {
            id: 'conv-1',
            cwd: '/tmp/demo',
            agentId: 'task',
            title: 'Build page',
            status: 'streaming' as const,
            createdAt: 1,
            updatedAt: 2,
            messageCount: 2,
        };
        const reviewHost = document.createElement('div');
        const host = createHost({
            transcriptOpenProject: project,
            transcriptOpenSummary: summary,
            transcriptReviewHost: reviewHost,
            transcriptLastConv: {
                id: 'conv-1',
                cwd: '/tmp/demo',
                agentId: 'task',
                title: 'Build page',
                status: 'streaming',
                createdAt: 1,
                updatedAt: 2,
                messages: [{
                    id: 'a1',
                    role: 'agent',
                    content: 'Done.',
                    createdAt: 2,
                }],
            },
            projects: [project],
            isAgentWorking: () => true,
        });
        const ui = new MobileProjectsExecutionSurfaceTabsUi(host);

        ui.selectTranscriptTab('review', project, summary);

        expect(host.executionSurfaceTabByProjectId.get(project.id)).to.equal('review');
        expect(reviewHost.hidden).to.equal(false);
    });
});
