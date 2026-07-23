// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import { expect } from 'chai';
import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import type { ExecutionSurfaceTabId } from '../common/qaap-execution-surface-tabs';
import type { MobileProjectEntry } from './mobile-projects-types';
import {
    MobileProjectsTranscriptSurfacesUi,
    type MobileProjectsTranscriptSurfacesHost,
} from './mobile-projects-transcript-surfaces-ui';
import type { MobileProjectsTranscriptHistoryUi } from './mobile-projects-transcript-history-ui';

const historyUiStub = {} as unknown as MobileProjectsTranscriptHistoryUi;

function sampleProject(): MobileProjectEntry {
    return {
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
}

function sampleSummary(): QaapAgentConversationSummaryDTO {
    return {
        id: 'conv-1',
        cwd: '/tmp/demo',
        agentId: 'codex',
        title: 'Demo',
        status: 'streaming',
        createdAt: 1,
        updatedAt: 2,
        messageCount: 1,
    };
}

function buildSyncHeaderPreviewHost(options: {
    activeTab?: ExecutionSurfaceTabId;
    transcriptPreviewRequestPending?: boolean;
    transcriptPreviewRequestRunning?: boolean;
} = {}): {
    host: MobileProjectsTranscriptSurfacesHost;
    setExecutionSurfaceTabCalls: ExecutionSurfaceTabId[];
    showOnlyExecutionSurfaceTabCalls: ExecutionSurfaceTabId[];
} {
    let activeTab: ExecutionSurfaceTabId = options.activeTab ?? 'messages';
    const setExecutionSurfaceTabCalls: ExecutionSurfaceTabId[] = [];
    const showOnlyExecutionSurfaceTabCalls: ExecutionSurfaceTabId[] = [];
    const headerPreviewRunHost = document.createElement('div');
    headerPreviewRunHost.hidden = true;
    const host = {
        headerPreviewRunHost,
        headerFilesMoreHost: document.createElement('div'),
        root: document.createElement('div'),
        transcriptPreviewRequestPending: options.transcriptPreviewRequestPending ?? false,
        transcriptPreviewRequestRunning: options.transcriptPreviewRequestRunning ?? false,
        transcriptPreviewSuppressedByUser: false,
        transcriptOpenProject: sampleProject(),
        transcriptOpenSummary: sampleSummary(),
        executionSurfaceTabsUi: {
            executionSurfaceTabForProject: () => activeTab,
            activeExecutionTab: () => activeTab,
            setExecutionSurfaceTab: (_project: MobileProjectEntry, tab: ExecutionSurfaceTabId) => {
                setExecutionSurfaceTabCalls.push(tab);
                activeTab = tab;
            },
            showOnlyExecutionSurfaceTab: (tab: ExecutionSurfaceTabId) => {
                showOnlyExecutionSurfaceTabCalls.push(tab);
                activeTab = tab;
            },
        },
    } as unknown as MobileProjectsTranscriptSurfacesHost;
    return { host, setExecutionSurfaceTabCalls, showOnlyExecutionSurfaceTabCalls };
}

describe('MobileProjectsTranscriptSurfacesUi — syncHeaderPreviewRunButton', () => {

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('does not switch to preview when pending and user is on messages tab', () => {
        const project = sampleProject();
        const summary = sampleSummary();
        const { host, setExecutionSurfaceTabCalls, showOnlyExecutionSurfaceTabCalls } = buildSyncHeaderPreviewHost({
            activeTab: 'messages',
            transcriptPreviewRequestPending: true,
        });
        const ui = new MobileProjectsTranscriptSurfacesUi(host, historyUiStub);

        ui.syncHeaderPreviewRunButton(project, summary);

        expect(setExecutionSurfaceTabCalls).to.not.include('preview');
        expect(showOnlyExecutionSurfaceTabCalls).to.not.include('preview');
        expect(host.executionSurfaceTabsUi.activeExecutionTab(project)).to.equal('messages');
        expect(host.headerPreviewRunHost.hidden).to.equal(true);
        expect(host.headerPreviewRunHost.querySelector('.theia-mobile-transcript-preview-run')).to.equal(null);
    });

    it('does not switch to preview when running and user is on messages tab', () => {
        const project = sampleProject();
        const summary = sampleSummary();
        const { host, setExecutionSurfaceTabCalls, showOnlyExecutionSurfaceTabCalls } = buildSyncHeaderPreviewHost({
            activeTab: 'messages',
            transcriptPreviewRequestRunning: true,
        });
        const ui = new MobileProjectsTranscriptSurfacesUi(host, historyUiStub);

        ui.syncHeaderPreviewRunButton(project, summary);

        expect(setExecutionSurfaceTabCalls).to.not.include('preview');
        expect(showOnlyExecutionSurfaceTabCalls).to.not.include('preview');
        expect(host.executionSurfaceTabsUi.activeExecutionTab(project)).to.equal('messages');
    });

    it('mounts the header play control when already on preview tab', () => {
        const project = sampleProject();
        const summary = sampleSummary();
        const { host, setExecutionSurfaceTabCalls, showOnlyExecutionSurfaceTabCalls } = buildSyncHeaderPreviewHost({
            activeTab: 'preview',
            transcriptPreviewRequestPending: true,
        });
        const ui = new MobileProjectsTranscriptSurfacesUi(host, historyUiStub);

        ui.syncHeaderPreviewRunButton(project, summary);

        expect(setExecutionSurfaceTabCalls).to.deep.equal([]);
        expect(showOnlyExecutionSurfaceTabCalls).to.deep.equal([]);
        expect(host.headerPreviewRunHost.hidden).to.equal(false);
        expect(host.headerPreviewRunHost.querySelector('.theia-mobile-transcript-preview-run')).to.not.equal(null);
    });
});
