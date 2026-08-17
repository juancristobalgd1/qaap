// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();
const browserGlobals = globalThis as unknown as { DragEvent?: unknown };
if (!browserGlobals.DragEvent) {
    browserGlobals.DragEvent = class DragEvent { };
}

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import type { ExecutionSurfaceTabId } from '../common/qaap-execution-surface-tabs';
import type { MobileProjectEntry } from './mobile-projects-types';
import {
    MobileProjectsTranscriptSurfacesUi,
    type MobileProjectsTranscriptSurfacesHost,
} from './mobile-projects-transcript-surfaces-ui';
import type { MobileProjectsTranscriptHistoryUi } from './mobile-projects-transcript-history-ui';
import type { QaapMonorepoAppCandidate } from './qaap-project-bootstrap-types';

const historyUiStub = {} as unknown as MobileProjectsTranscriptHistoryUi;

class TestTranscriptSurfacesUi extends MobileProjectsTranscriptSurfacesUi {
    pickApp(apps: readonly QaapMonorepoAppCandidate[]): Promise<QaapMonorepoAppCandidate | undefined> {
        return this.pickTranscriptPreviewApp(apps);
    }
}

class SwitchTrackingTranscriptSurfacesUi extends MobileProjectsTranscriptSurfacesUi {
    switchCalls = 0;

    protected override switchTranscriptPreviewApp(): Promise<void> {
        this.switchCalls += 1;
        return Promise.resolve();
    }
}

function sampleApps(): QaapMonorepoAppCandidate[] {
    return ['alpha', 'beta'].map((name, index) => ({
        rootUri: new URI(`file:///tmp/demo/apps/${name}`),
        relativePath: `apps/${name}`,
        name,
        kind: 'node-vite',
        devCommand: 'npm run dev',
        devCommandLabel: 'npm run dev',
        expectedPort: 5173 + index,
    }));
}

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
        headerViewModeSwitchHost: document.createElement('div'),
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

    it('shows the selected monorepo app and exposes an explicit switch action', () => {
        const project = sampleProject();
        const summary = sampleSummary();
        const apps = sampleApps();
        const { host } = buildSyncHeaderPreviewHost({ activeTab: 'preview' });
        host.projectBootstrap = {
            getStateSnapshot: () => ({
                phase: 'running',
                descriptor: {
                    rootUri: new URI('file:///tmp/demo'),
                    name: 'demo',
                    kind: 'node-vite',
                    packageManager: 'npm',
                    installCommand: 'npm install',
                    nodeModulesPresent: true,
                    apps,
                },
                selectedApp: apps[0],
                previewUrl: 'http://localhost:5173',
            }),
        } as MobileProjectsTranscriptSurfacesHost['projectBootstrap'];
        const ui = new SwitchTrackingTranscriptSurfacesUi(host, historyUiStub);

        ui.syncHeaderPreviewRunButton(project, summary);

        const switchButton = host.headerPreviewRunHost.querySelector<HTMLButtonElement>(
            '.theia-mobile-transcript-preview-app-switch',
        );
        expect(switchButton?.textContent).to.contain('alpha');
        expect(switchButton?.getAttribute('aria-label')).to.contain('alpha');
        switchButton?.click();
        expect(ui.switchCalls).to.equal(1);
    });
});

describe('MobileProjectsTranscriptSurfacesUi — beginTranscriptDevPreviewRequest', () => {

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('clears a user Stop latch so Run app can remount Preview', () => {
        const project = sampleProject();
        const summary = sampleSummary();
        const { host } = buildSyncHeaderPreviewHost({ activeTab: 'preview' });
        (host as unknown as { projects: MobileProjectEntry[] }).projects = [project];
        host.transcriptPreviewSuppressedByUser = true;
        const ui = new MobileProjectsTranscriptSurfacesUi(host, historyUiStub);

        ui.beginTranscriptDevPreviewRequest(project, summary);

        expect(host.transcriptPreviewSuppressedByUser).to.equal(false);
        expect(host.transcriptPreviewRequestPending).to.equal(true);
        expect(host.transcriptPreviewRequestRunning).to.equal(true);
    });
});

describe('MobileProjectsTranscriptSurfacesUi — monorepo preview picker', () => {

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('shows every runnable app and resolves the selected one', async () => {
        const { host } = buildSyncHeaderPreviewHost();
        const ui = new TestTranscriptSurfacesUi(host, historyUiStub);
        const apps = sampleApps();

        const selectedPromise = ui.pickApp(apps);
        const items = document.querySelectorAll<HTMLButtonElement>('.theia-mobile-transcript-app-picker-item');
        expect(items).to.have.length(2);
        expect(items[0].textContent).to.contain('alpha');
        expect(items[1].textContent).to.contain('apps/beta');
        items[1].click();

        expect(await selectedPromise).to.equal(apps[1]);
        expect(document.querySelector('.theia-mobile-transcript-app-picker')).to.equal(null);
    });

    it('cancels without choosing an arbitrary app when Escape is pressed', async () => {
        const { host } = buildSyncHeaderPreviewHost();
        const ui = new TestTranscriptSurfacesUi(host, historyUiStub);
        const selectedPromise = ui.pickApp(sampleApps());

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        expect(await selectedPromise).to.equal(undefined);
        expect(document.querySelector('.theia-mobile-transcript-app-picker')).to.equal(null);
    });
});
