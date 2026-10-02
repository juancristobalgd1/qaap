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
});
