// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();
const browserGlobals = globalThis as unknown as { DragEvent?: unknown };
if (!browserGlobals.DragEvent) {
    browserGlobals.DragEvent = class DragEvent { };
}

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { ExecutionSurfaceTabId } from '@theia/qaap-shared-core/lib/common/qaap-execution-surface-tabs';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import {
    MobileProjectsTranscriptSurfacesUi,
    type MobileProjectsTranscriptSurfacesHost,
} from './mobile-projects-transcript-surfaces-ui';
import type { MobileProjectsTranscriptHistoryUi } from '@theia/qaap-transcript/lib/browser/mobile-projects-transcript-history-ui';
import type { QaapMonorepoAppCandidate } from '@theia/qaap-shared-core/lib/browser/qaap-project-bootstrap-types';
import type { QaapAgentConversationDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { MobileSnackbar } from '@theia/qaap-mobile-shell/lib/browser/mobile-snackbar';
import * as sinon from 'sinon';
import { fallBackFromSupersededTranscriptPreviewExtracted } from './mobile-projects-transcript-surfaces-ui-timeline';
import { USER_NAVIGATED_PREVIEW_CLASS } from './mobile-projects-transcript-surfaces-ui-tool-pills';
import { TRANSCRIPT_PREVIEW_TAB_PROBE_MAX_MS, TRANSCRIPT_PREVIEW_TAB_PROBE_MS } from './mobile-projects-transcript-surfaces-ui-activity';
import { firstInPriorityOrder } from './mobile-projects-transcript-surfaces-ui-thought-brief';
import { TRANSCRIPT_PREVIEW_IDENTITY_WATCH_MAX_MS } from './mobile-projects-transcript-surfaces-ui-timeline';
import { TRANSCRIPT_PREVIEW_IDENTITY_WATCH_MS } from './mobile-projects-transcript-surfaces-ui';
import { useSuiteJSDOM } from './test/qaap-jsdom-suite';

disableImportJSDOM();

const historyUiStub = {} as unknown as MobileProjectsTranscriptHistoryUi;

class TestTranscriptSurfacesUi extends MobileProjectsTranscriptSurfacesUi {
    pickApp(apps: readonly QaapMonorepoAppCandidate[]): Promise<QaapMonorepoAppCandidate | undefined> {
        return this.pickTranscriptPreviewApp(apps);
    }
}

class SwitchTrackingTranscriptSurfacesUi extends MobileProjectsTranscriptSurfacesUi {
    switchCalls = 0;

    override switchTranscriptPreviewApp(): Promise<void> {
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

    useSuiteJSDOM();

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
        });
        const ui = new MobileProjectsTranscriptSurfacesUi(host, historyUiStub);

        ui.syncHeaderPreviewRunButton(project, summary);

        expect(setExecutionSurfaceTabCalls).to.deep.equal([]);
        expect(showOnlyExecutionSurfaceTabCalls).to.deep.equal([]);
        expect(host.headerPreviewRunHost.hidden).to.equal(false);
        const previewButton = host.headerPreviewRunHost.querySelector<HTMLButtonElement>('.theia-mobile-transcript-preview-run');
        expect(previewButton).to.not.equal(null);
        expect(previewButton?.title).to.equal('Navegador');
        expect(previewButton?.getAttribute('aria-label')).to.equal('Navegador');
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

    useSuiteJSDOM();

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

    useSuiteJSDOM();

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

const PREVIEW_URL = 'http://localhost/qaap-dev/5173/';

function idleConversation(): QaapAgentConversationDTO {
    return { ...sampleSummary(), status: 'idle', messages: [] } as unknown as QaapAgentConversationDTO;
}

/** Preview-tab host after the agent finished: nothing mounted yet, the project knows its preview URL. */
function buildIdlePreviewHost(activeTab: ExecutionSurfaceTabId = 'preview'): MobileProjectsTranscriptSurfacesHost {
    const { host } = buildSyncHeaderPreviewHost({ activeTab });
    const transcriptPreviewHost = document.createElement('div');
    document.body.append(transcriptPreviewHost);
    Object.assign(host, {
        transcriptSheet: true,
        transcriptPreviewHost,
        transcriptOpenSummaryId: sampleSummary().id,
        transcriptLastConv: idleConversation(),
        projects: [{ ...sampleProject(), previewUrl: PREVIEW_URL }],
    });
    return host;
}

class ProbeTrackingTranscriptSurfacesUi extends MobileProjectsTranscriptSurfacesUi {
    refreshCalls = 0;

    override async refreshTranscriptPreviewTabProbe(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): Promise<void> {
        this.refreshCalls += 1;
        this.scheduleTranscriptPreviewTabProbe(project, summary);
    }
}

describe('MobileProjectsTranscriptSurfacesUi — Preview tab probe after the turn', () => {

    useSuiteJSDOM();

    let delays: number[];
    let pending: (() => void) | undefined;
    let originalSetTimeout: typeof window.setTimeout;

    beforeEach(() => {
        delays = [];
        pending = undefined;
        originalSetTimeout = window.setTimeout;
        window.setTimeout = ((handler: () => void, delay?: number) => {
            delays.push(delay ?? 0);
            pending = handler;
            return delays.length;
        }) as typeof window.setTimeout;
    });

    afterEach(() => {
        window.setTimeout = originalSetTimeout;
        document.body.replaceChildren();
    });

    function tick(): void {
        const handler = pending;
        pending = undefined;
        handler?.();
    }

    it('keeps probing an empty visible Preview tab while a dev server is expected', () => {
        const host = buildIdlePreviewHost();
        const ui = new MobileProjectsTranscriptSurfacesUi(host, historyUiStub);

        expect(ui.shouldKeepTranscriptPreviewTabProbe(sampleProject(), sampleSummary(), idleConversation())).to.equal(true);
    });

    it('stops once the Preview tab is hidden, the preview is suppressed, or nothing is expected', () => {
        const project = sampleProject();
        const summary = sampleSummary();
        const hidden = new MobileProjectsTranscriptSurfacesUi(buildIdlePreviewHost('messages'), historyUiStub);
        expect(hidden.shouldKeepTranscriptPreviewTabProbe(project, summary, idleConversation())).to.equal(false);

        const suppressedHost = buildIdlePreviewHost();
        suppressedHost.transcriptPreviewSuppressedByUser = true;
        const suppressed = new MobileProjectsTranscriptSurfacesUi(suppressedHost, historyUiStub);
        expect(suppressed.shouldKeepTranscriptPreviewTabProbe(project, summary, idleConversation())).to.equal(false);

        const nothingHost = buildIdlePreviewHost();
        (nothingHost as unknown as { projects: MobileProjectEntry[] }).projects = [project];
        const nothing = new MobileProjectsTranscriptSurfacesUi(nothingHost, historyUiStub);
        expect(nothing.shouldKeepTranscriptPreviewTabProbe(project, summary, idleConversation())).to.equal(false);
    });

    it('backs the idle probe off up to the ceiling and restarts it for another conversation', () => {
        const host = buildIdlePreviewHost();
        const ui = new ProbeTrackingTranscriptSurfacesUi(host, historyUiStub);
        const project = sampleProject();
        const summary = sampleSummary();

        ui.scheduleTranscriptPreviewTabProbe(project, summary);
        for (let i = 0; i < 6; i++) {
            tick();
        }

        expect(delays[0]).to.equal(TRANSCRIPT_PREVIEW_TAB_PROBE_MS);
        expect(delays).to.deep.equal([...delays].sort((a, b) => a - b));
        expect(delays[delays.length - 1]).to.equal(TRANSCRIPT_PREVIEW_TAB_PROBE_MAX_MS);

        const otherSummary = { ...summary, id: 'conv-2' };
        host.transcriptOpenSummaryId = otherSummary.id;
        ui.scheduleTranscriptPreviewTabProbe(project, otherSummary);
        expect(delays[delays.length - 1]).to.equal(TRANSCRIPT_PREVIEW_TAB_PROBE_MS);
    });
});

class FallbackTrackingTranscriptSurfacesUi extends MobileProjectsTranscriptSurfacesUi {
    rediscoveries = 0;

    override disposeTranscriptEmbeddedPreview(): void {
        this.host.transcriptEmbeddedPreview = undefined;
    }

    override mountTranscriptEmptyPreview(host: HTMLElement): void {
        const root = document.createElement('div');
        root.classList.add('theia-mod-empty-preview');
        host.append(root);
        this.host.transcriptEmbeddedPreview = { root } as unknown as MobileProjectsTranscriptSurfacesHost['transcriptEmbeddedPreview'];
    }

    override async discoverAndMountTranscriptPreviewIfReady(): Promise<void> {
        this.rediscoveries += 1;
    }
}

describe('MobileProjectsTranscriptSurfacesUi — superseded preview fallback', () => {

    useSuiteJSDOM();

    let snackbar: sinon.SinonStub;

    beforeEach(() => {
        snackbar = sinon.stub(MobileSnackbar, 'show');
    });

    afterEach(() => {
        snackbar.restore();
        document.body.replaceChildren();
    });

    function mountLiveRoot(ui: MobileProjectsTranscriptSurfacesUi, previewHost: HTMLElement, ...classes: string[]): HTMLElement {
        const root = document.createElement('div');
        root.classList.add(...classes);
        previewHost.append(root);
        ui.host.transcriptEmbeddedPreview = { root } as unknown as MobileProjectsTranscriptSurfacesHost['transcriptEmbeddedPreview'];
        return root;
    }

    it('blanks a superseded live page with a notice and rediscovers', () => {
        const host = buildIdlePreviewHost();
        const ui = new FallbackTrackingTranscriptSurfacesUi(host, historyUiStub);
        const previewHost = host.transcriptPreviewHost!;
        const live = mountLiveRoot(ui, previewHost);

        fallBackFromSupersededTranscriptPreviewExtracted(ui, previewHost, host.projects[0], sampleSummary(), PREVIEW_URL);

        expect(live.isConnected).to.equal(false);
        expect(host.transcriptEmbeddedPreview?.root.classList.contains('theia-mod-empty-preview')).to.equal(true);
        expect(host.projects[0].previewUrl).to.equal(undefined);
        expect(snackbar.calledOnce).to.equal(true);
        expect(snackbar.firstCall.args[1]).to.include({ kind: 'warning' });
        expect(ui.rediscoveries).to.equal(1);
    });

    it('offers a Retry action that mounts the project\'s current preview', async () => {
        const host = buildIdlePreviewHost();
        const ui = new FallbackTrackingTranscriptSurfacesUi(host, historyUiStub);
        ui.transcriptPreviewProjectId = sampleProject().id;
        Object.assign(host, { projectsService: { recordProjectPreviewUrl: () => Promise.resolve() } });
        const mounted: string[] = [];
        ui.discoverProjectDevPreviewUrl = async () => 'http://localhost/qaap-dev/5174/';
        ui.tryMountProjectScopedPreview = async (_host, _project, _summary, _latest, url) => {
            mounted.push(url);
        };
        const previewHost = host.transcriptPreviewHost!;
        mountLiveRoot(ui, previewHost);

        fallBackFromSupersededTranscriptPreviewExtracted(ui, previewHost, host.projects[0], sampleSummary(), PREVIEW_URL);
        const options = snackbar.firstCall.args[1] as { actionLabel?: string; onAction?: () => void };
        expect(options.actionLabel).to.be.a('string').and.not.equal('');
        options.onAction?.();
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mounted).to.deep.equal(['http://localhost/qaap-dev/5174/']);
        expect(host.projects[0].previewUrl).to.equal('http://localhost/qaap-dev/5174/');
    });

    it('offers to restart the dev server when Retry finds nothing running', async () => {
        const host = buildIdlePreviewHost();
        const ui = new FallbackTrackingTranscriptSurfacesUi(host, historyUiStub);
        ui.transcriptPreviewProjectId = sampleProject().id;
        const requests: Array<{ readonly allowAgentFallback?: boolean } | undefined> = [];
        ui.discoverProjectDevPreviewUrl = async () => undefined;
        ui.requestTranscriptPreview = async (_project, _summary, options) => {
            requests.push(options);
        };
        const previewHost = host.transcriptPreviewHost!;
        mountLiveRoot(ui, previewHost);

        fallBackFromSupersededTranscriptPreviewExtracted(ui, previewHost, host.projects[0], sampleSummary(), PREVIEW_URL);
        (snackbar.firstCall.args[1] as { onAction?: () => void }).onAction?.();
        await new Promise(resolve => setTimeout(resolve, 0));

        const restart = snackbar.secondCall.args[1] as { kind?: string; actionLabel?: string; onAction?: () => void };
        expect(restart.kind).to.equal('warning');
        expect(restart.actionLabel).to.be.a('string').and.not.equal('');
        restart.onAction?.();
        expect(requests).to.deep.equal([{ allowAgentFallback: false }]);
    });

    it('keeps a URL the user navigated to by hand, without a notice', () => {
        const host = buildIdlePreviewHost();
        const ui = new FallbackTrackingTranscriptSurfacesUi(host, historyUiStub);
        const previewHost = host.transcriptPreviewHost!;
        const live = mountLiveRoot(ui, previewHost, USER_NAVIGATED_PREVIEW_CLASS);

        fallBackFromSupersededTranscriptPreviewExtracted(ui, previewHost, host.projects[0], sampleSummary(), PREVIEW_URL);

        expect(host.transcriptEmbeddedPreview?.root).to.equal(live);
        expect(live.isConnected).to.equal(true);
        expect(snackbar.called).to.equal(false);
    });

    it('does not announce anything when only the empty state is replaced', () => {
        const host = buildIdlePreviewHost();
        const ui = new FallbackTrackingTranscriptSurfacesUi(host, historyUiStub);
        const previewHost = host.transcriptPreviewHost!;
        mountLiveRoot(ui, previewHost, 'theia-mod-empty-preview');

        fallBackFromSupersededTranscriptPreviewExtracted(ui, previewHost, host.projects[0], sampleSummary(), PREVIEW_URL);

        expect(snackbar.called).to.equal(false);
        expect(ui.rediscoveries).to.equal(1);
    });
});

class DiscoveryCountingTranscriptSurfacesUi extends MobileProjectsTranscriptSurfacesUi {
    discoveries = 0;

    override resolveTranscriptPreviewUrl(): string | undefined {
        return undefined;
    }

    override async discoverProjectDevPreviewUrl(): Promise<string | undefined> {
        this.discoveries += 1;
        return undefined;
    }
}

describe('MobileProjectsTranscriptSurfacesUi — idle preview discovery', () => {

    useSuiteJSDOM();

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('reuses a recent discovery miss on idle probe ticks', async () => {
        const host = buildIdlePreviewHost();
        const ui = new DiscoveryCountingTranscriptSurfacesUi(host, historyUiStub);

        await ui.discoverAndMountTranscriptPreviewIfReady(sampleProject(), sampleSummary());
        await ui.discoverAndMountTranscriptPreviewIfReady(sampleProject(), sampleSummary());
        expect(ui.discoveries).to.equal(1);

        ui.transcriptPreviewIdleDiscovery.clear();
        await ui.discoverAndMountTranscriptPreviewIfReady(sampleProject(), sampleSummary());
        expect(ui.discoveries).to.equal(2);
    });

    it('always discovers afresh while a preview request is in flight', async () => {
        const host = buildIdlePreviewHost();
        host.transcriptPreviewRequestPending = true;
        const ui = new DiscoveryCountingTranscriptSurfacesUi(host, historyUiStub);

        await ui.discoverAndMountTranscriptPreviewIfReady(sampleProject(), sampleSummary());
        await ui.discoverAndMountTranscriptPreviewIfReady(sampleProject(), sampleSummary());
        expect(ui.discoveries).to.equal(2);
    });
});

describe('firstInPriorityOrder', () => {

    it('returns the earliest hit in list order even when a later item answers first', async () => {
        const delays = [30, 5, 1, 1];
        const result = await firstInPriorityOrder([0, 1, 2, 3], 4, async index => {
            await new Promise(resolve => setTimeout(resolve, delays[index]));
            return index >= 1 ? `hit-${index}` : undefined;
        });
        expect(result).to.equal('hit-1');
    });

    it('keeps at most `concurrency` probes in flight and stops launching after the answer', async () => {
        let inFlight = 0;
        let maxInFlight = 0;
        const started: number[] = [];
        const result = await firstInPriorityOrder(Array.from({ length: 12 }, (_, index) => index), 3, async index => {
            started.push(index);
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise(resolve => setTimeout(resolve, 1));
            inFlight -= 1;
            return index === 4 ? 'found' : undefined;
        });
        expect(result).to.equal('found');
        expect(maxInFlight).to.equal(3);
        expect(started.length).to.be.lessThan(12);
    });

    it('treats a rejected probe as a miss and resolves undefined when nothing hits', async () => {
        const result = await firstInPriorityOrder([1, 2, 3], 2, async index => {
            if (index === 2) {
                throw new Error('probe failed');
            }
            return undefined;
        });
        expect(result).to.equal(undefined);
    });
});

describe('MobileProjectsTranscriptSurfacesUi — preview identity watch backoff', () => {

    useSuiteJSDOM();

    let delays: number[];
    let originalSetTimeout: typeof window.setTimeout;

    beforeEach(() => {
        delays = [];
        originalSetTimeout = window.setTimeout;
        window.setTimeout = ((_handler: () => void, delay?: number) => {
            delays.push(delay ?? 0);
            return delays.length;
        }) as typeof window.setTimeout;
    });

    afterEach(() => {
        window.setTimeout = originalSetTimeout;
    });

    it('backs off while the mount stays healthy and resets on any other reschedule', () => {
        const ui = new MobileProjectsTranscriptSurfacesUi(buildIdlePreviewHost(), historyUiStub);
        const project = sampleProject();

        ui.scheduleTranscriptPreviewIdentityWatch(project);
        ui.scheduleTranscriptPreviewIdentityWatch(project, true);
        ui.scheduleTranscriptPreviewIdentityWatch(project, true);
        ui.scheduleTranscriptPreviewIdentityWatch(project, true);
        ui.scheduleTranscriptPreviewIdentityWatch(project);

        expect(delays).to.deep.equal([
            TRANSCRIPT_PREVIEW_IDENTITY_WATCH_MS,
            TRANSCRIPT_PREVIEW_IDENTITY_WATCH_MS * 2,
            TRANSCRIPT_PREVIEW_IDENTITY_WATCH_MAX_MS,
            TRANSCRIPT_PREVIEW_IDENTITY_WATCH_MAX_MS,
            TRANSCRIPT_PREVIEW_IDENTITY_WATCH_MS,
        ]);
    });
});
