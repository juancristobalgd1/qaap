// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import type { QaapBootstrapPhase } from '@theia/qaap-shared-core/lib/browser/qaap-project-bootstrap-types';
import type { MobileProjectsTranscriptStickyComposerUiContext } from './mobile-projects-transcript-sticky-composer-ui-context';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

/**
 * The composer "Open preview" health check used to probe `/qaap-dev/api/probe/<port>` forever (every
 * 5 s plus on every activity refresh) for a port announced in an old turn, even with no preview open.
 */
describe('mobile-projects-transcript-sticky-composer preview probe gating', () => {

    useSuiteJSDOM();

    let renderModule: typeof import('./mobile-projects-transcript-sticky-composer-ui-render');
    const candidate = 'http://localhost:3000/qaap-dev/5173/';
    const project = { id: 'shadcn-landing-page', name: 'shadcn-landing-page' } as MobileProjectEntry;
    let originalFetch: typeof fetch;
    let probeCalls: string[];
    let probeReady: boolean;

    before(() => {
        // @lumino/dragdrop reads DragEvent at module load; jsdom does not provide it.
        const globals = globalThis as unknown as { DragEvent?: unknown };
        if (!globals.DragEvent) {
            globals.DragEvent = class DragEvent { };
        }
        renderModule = require('./mobile-projects-transcript-sticky-composer-ui-render');
    });

    // jsdom reports `prerender` unless told otherwise; the probe only runs for a visible tab.
    const setVisibility = (state: 'visible' | 'hidden'): void => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    };

    beforeEach(() => {
        setVisibility('visible');
        originalFetch = globalThis.fetch;
        probeCalls = [];
        probeReady = false;
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            probeCalls.push(String(input));
            return {
                ok: true,
                json: async () => ({ ready: probeReady, previewUrl: probeReady ? candidate : '' }),
            } as Response;
        }) as typeof fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        delete (document as unknown as { visibilityState?: string }).visibilityState;
    });

    interface PreviewProbeHarness {
        readonly ctx: MobileProjectsTranscriptStickyComposerUiContext & Record<string, unknown>;
        readonly scheduled: Array<number | undefined>;
        readonly refreshes: () => number;
        phase: QaapBootstrapPhase;
    }

    function createHarness(phase: QaapBootstrapPhase): PreviewProbeHarness {
        const scheduled: Array<number | undefined> = [];
        let refreshCount = 0;
        const harness = { scheduled, refreshes: () => refreshCount, phase } as PreviewProbeHarness;
        const ctx: Record<string, unknown> = {
            host: {
                transcriptComposerProject: project,
                transcriptComposerHost: { isConnected: true },
                projectBootstrap: { reconcileSupersededPreviewClaim: async () => false },
                transcriptPreviewRequestRunning: false,
                transcriptPreviewRequestPending: false,
            },
            verifiedComposerPreview: undefined,
            composerPreviewProbeInFlight: undefined,
            composerPreviewLastCheckedAt: 0,
            composerPreviewHealthTimer: undefined,
            composerPreviewProbeCandidate: undefined,
            composerPreviewProbeFailures: 0,
            composerPreviewNextProbeAt: 0,
            composerPreviewVisibilityDispose: undefined,
            resolveComposerPreviewRuntime: () => ({
                projectId: project.id,
                dependenciesInstalled: false,
                phase: harness.phase,
                fallbackPreviewUrls: [candidate],
            }),
            isTranscriptStickyComposerAgentWorking: () => false,
            refreshComposerActivityStack: () => { refreshCount++; },
            clearComposerPreviewHealthTimer: () => { ctx.composerPreviewHealthTimer = undefined; },
            // Record instead of arming real timers so the test stays deterministic.
            scheduleComposerPreviewHealthCheck: (_projectId: string, delayMs?: number) => {
                scheduled.push(delayMs);
                ctx.composerPreviewHealthTimer = 1;
            },
            syncComposerPreviewAvailability: (p: MobileProjectEntry, c: string | undefined) =>
                renderModule.syncComposerPreviewAvailabilityExtracted(typed, p, c),
            resumeComposerPreviewProbeWhenVisible: (projectId: string) =>
                renderModule.resumeComposerPreviewProbeWhenVisibleExtracted(typed, projectId),
            runComposerPreviewHealthCheck: (projectId: string) =>
                renderModule.runComposerPreviewHealthCheckExtracted(typed, projectId),
        };
        const typed = ctx as unknown as MobileProjectsTranscriptStickyComposerUiContext & Record<string, unknown>;
        (harness as { ctx: unknown }).ctx = typed;
        return harness;
    }

    async function sync(harness: PreviewProbeHarness): Promise<void> {
        renderModule.syncComposerPreviewAvailabilityExtracted(harness.ctx, project, candidate);
        await harness.ctx.composerPreviewProbeInFlight;
    }

    it('verifies a historical port once and stops polling when no preview is starting', async () => {
        const harness = createHarness('idle');
        await sync(harness);
        expect(probeCalls).to.have.length(1);
        expect(probeCalls[0]).to.contain('/qaap-dev/api/probe/5173');
        expect(harness.scheduled).to.deep.equal([], 'no periodic health check without an active preview');

        // Activity refreshes / SSE ticks re-enter sync: the failed-probe backoff gates them.
        await sync(harness);
        await sync(harness);
        expect(probeCalls).to.have.length(1);

        // Once the backoff window has elapsed an event may verify again (and backs off further).
        harness.ctx.composerPreviewNextProbeAt = Date.now() - 1;
        await sync(harness);
        expect(probeCalls).to.have.length(2);
        expect(harness.ctx.composerPreviewProbeFailures).to.equal(2);
        expect(harness.ctx.composerPreviewNextProbeAt).to.be.greaterThan(Date.now() + 3_000);
    });

    it('keeps probing a starting preview with exponential backoff', async () => {
        const harness = createHarness('starting');
        await sync(harness);
        harness.ctx.composerPreviewNextProbeAt = 0;
        await sync(harness);
        expect(probeCalls).to.have.length(2);
        expect(harness.scheduled).to.deep.equal([2_000, 4_000]);
    });

    it('returns to the regular health cadence once the preview answers ready', async () => {
        const harness = createHarness('running');
        probeReady = true;
        await sync(harness);
        expect(harness.scheduled).to.deep.equal([undefined]);
        expect(harness.refreshes()).to.equal(1, 'the Open preview pill appears once');
        expect(harness.ctx.composerPreviewProbeFailures).to.equal(0);
    });

    it('does not probe while the tab is hidden and resumes when it becomes visible', async () => {
        const harness = createHarness('starting');
        setVisibility('hidden');
        await sync(harness);
        expect(probeCalls).to.have.length(0);
        expect(harness.ctx.composerPreviewVisibilityDispose).to.be.a('function');

        setVisibility('visible');
        document.dispatchEvent(new window.Event('visibilitychange'));
        await harness.ctx.composerPreviewProbeInFlight;
        expect(probeCalls).to.have.length(1);
        expect(harness.ctx.composerPreviewVisibilityDispose).to.equal(undefined);
    });

    it('rejects a bare-port probe claimed by another root/worktree instead of polling it every 5 s', async () => {
        const harness = createHarness('idle');
        harness.ctx.host.transcriptComposerSummary = {
            id: 'conv-kalea',
            cwd: '/workspace/repos/users/alice/alice/kalea',
        } as unknown as typeof harness.ctx.host.transcriptComposerSummary;
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            probeCalls.push(String(input));
            return {
                ok: true,
                json: async () => ({
                    ready: true,
                    previewId: 'u-alice-w-tmp-other-worktree',
                    previewUrl: 'https://other.qaaq-preview.duckdns.org/',
                    conversationId: 'conv-other-worktree',
                    root: '/tmp/qaap-worktrees/alice/ff61881d',
                }),
            } as Response;
        }) as typeof fetch;

        await sync(harness);

        expect(harness.ctx.verifiedComposerPreview).to.equal(undefined);
        expect(harness.scheduled).to.deep.equal([]);
        expect(harness.ctx.composerPreviewProbeFailures).to.equal(1);
    });

    it('drops stale previewStarting flags once the live preview is verified', () => {
        const streamingModule: typeof import('./mobile-projects-transcript-sticky-composer-ui-streaming') =
            require('./mobile-projects-transcript-sticky-composer-ui-streaming');
        const harness = createHarness('running');
        const verifiedUrl = 'http://localhost:3000/qaap-preview/u-alice-w-app-x-1/';
        harness.ctx.host.transcriptPreviewRequestRunning = true;
        harness.ctx.host.transcriptPreviewRequestPending = true;
        harness.ctx.host.transcriptLastConv = {
            id: 'conv-1',
            status: 'idle',
            messages: [],
        } as unknown as typeof harness.ctx.host.transcriptLastConv;
        harness.ctx.verifiedComposerPreview = {
            projectId: project.id,
            url: verifiedUrl,
            candidate: verifiedUrl,
            verifiedAt: Date.now(),
        };
        harness.ctx.resolveComposerPreviewRuntime = () => ({
            projectId: project.id,
            projectCwd: '/workspace/app',
            bootstrapRoot: '/workspace/app',
            dependenciesInstalled: true,
            phase: 'running',
            previewUrl: verifiedUrl,
        });
        harness.ctx.resolveComposerActivityFilesForStack = () => ({ files: [] });
        harness.ctx.refreshComposerActivityGitFilesIfNeeded = async () => undefined;
        harness.ctx.hasComposerFileActivity = () => true;
        harness.ctx.hasComposerCommittableChangesFromGit = () => false;
        harness.ctx.peekTranscriptComposerChangedFilesExpanded = () => false;
        harness.ctx.syncComposerPreviewAvailability = () => undefined;

        const opts = streamingModule.buildTranscriptComposerActivityOptionsExtracted(
            harness.ctx,
            project,
            { id: 'conv-1', cwd: '/workspace/app' } as unknown as Parameters<typeof streamingModule.buildTranscriptComposerActivityOptionsExtracted>[2],
        );

        expect(opts.previewStarting).to.equal(false);
        expect(opts.onOpenPreview).to.be.a('function');
    });

    it('returns empty workspace changed files after commit even when summary.baselineCommit still diffs committed history', async () => {
        const requestedUrls: string[] = [];
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            const url = String(input);
            requestedUrls.push(url);
            if (url.includes('baseCommit=')) {
                return {
                    ok: true,
                    json: async () => ({
                        files: [{ path: 'server.js', status: 'M', adds: 5, dels: 1, staged: false }],
                    }),
                } as Response;
            }
            // Working tree is clean after Approve & Commit.
            return {
                ok: true,
                json: async () => ({ files: [] }),
            } as Response;
        }) as typeof fetch;

        const ctx = {
            resolveComposerWorkspaceRoot: () => '/workspace/todo',
            mapGitChangedFileToComposerView: (file: { path: string; staged: boolean }) => ({
                path: file.path,
                kind: 'edited' as const,
                staged: file.staged,
            }),
        } as unknown as MobileProjectsTranscriptStickyComposerUiContext;

        const files = await renderModule.fetchWorkspaceChangedFilesExtracted(
            ctx,
            project,
            { id: 'conv-1', cwd: '/workspace/todo', baselineCommit: 'a'.repeat(40) } as unknown as Parameters<typeof renderModule.fetchWorkspaceChangedFilesExtracted>[2],
        );

        expect(files).to.deep.equal([]);
        expect(requestedUrls).to.have.length(1);
        expect(requestedUrls[0]).to.not.include('baseCommit=');
    });

    it('preserves working-tree staged flags and excludes already-committed baseline files when scoping to baselineCommit', async () => {
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('baseCommit=')) {
                return {
                    ok: true,
                    json: async () => ({
                        files: [
                            { path: 'committed.js', status: 'M', adds: 2, dels: 0, staged: false },
                            { path: 'staged.js', status: 'M', adds: 4, dels: 1, staged: false },
                        ],
                    }),
                } as Response;
            }
            return {
                ok: true,
                json: async () => ({
                    files: [
                        { path: 'staged.js', status: 'M', adds: 4, dels: 1, staged: true },
                        { path: 'pre-task-dirt.js', status: 'M', adds: 1, dels: 0, staged: false },
                    ],
                }),
            } as Response;
        }) as typeof fetch;

        const ctx = {
            resolveComposerWorkspaceRoot: () => '/workspace/todo',
            mapGitChangedFileToComposerView: (file: { path: string; staged: boolean }) => ({
                path: file.path,
                kind: 'edited' as const,
                staged: file.staged,
            }),
        } as unknown as MobileProjectsTranscriptStickyComposerUiContext;

        const files = await renderModule.fetchWorkspaceChangedFilesExtracted(
            ctx,
            project,
            { id: 'conv-1', cwd: '/workspace/todo', baselineCommit: 'b'.repeat(40) } as unknown as Parameters<typeof renderModule.fetchWorkspaceChangedFilesExtracted>[2],
        );

        expect(files).to.deep.equal([{ path: 'staged.js', kind: 'edited', staged: true }]);
    });
});
