// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    onTranscriptPreviewStartStalledExtracted,
    relaunchPendingTranscriptPreviewAfterSettleExtracted,
} from './mobile-projects-transcript-live-ui-streaming';
import type { MobileProjectsTranscriptLiveUiContext } from './mobile-projects-transcript-live-ui-context';

interface FakeHost {
    transcriptOpenProject?: { id: string; previewUrl?: string };
    transcriptOpenSummary?: { id: string };
    transcriptLastConv?: { id: string; status: string; messages: unknown[] };
    transcriptPreviewRequestPending: boolean;
    transcriptPreviewRequestRunning: boolean;
    transcriptPreviewSuppressedByUser: boolean;
    projectBootstrap?: { phase?: string };
    requestTranscriptPreview?: () => void;
    transcriptStickyComposerUi: { refreshComposerActivityStack: () => void };
    transcriptHeaderUi: { refreshTranscriptExecutionChrome: () => void };
}

/** A context holding only what the pill helpers read; the watchdog is counted, not timed. */
function createContext(overrides: Partial<FakeHost> = {}): { ctx: MobileProjectsTranscriptLiveUiContext; disarms: () => number; refreshes: () => number } {
    let disarmCount = 0;
    let refreshCount = 0;
    const host: FakeHost = {
        transcriptOpenProject: { id: 'project-1' },
        transcriptOpenSummary: { id: 'conv-1' },
        transcriptLastConv: { id: 'conv-1', status: 'idle', messages: [] },
        transcriptPreviewRequestPending: true,
        transcriptPreviewRequestRunning: false,
        transcriptPreviewSuppressedByUser: false,
        transcriptStickyComposerUi: { refreshComposerActivityStack: () => { refreshCount++; } },
        transcriptHeaderUi: { refreshTranscriptExecutionChrome: () => { refreshCount++; } },
        ...overrides,
    };
    const ctx = {
        host,
        previewStartingWatchdog: { disarm: () => { disarmCount++; }, arm: () => undefined, progress: () => undefined },
    } as unknown as MobileProjectsTranscriptLiveUiContext;
    return { ctx, disarms: () => disarmCount, refreshes: () => refreshCount };
}

describe('transcript preview pill', () => {
    it('retires the pill when the chat turn failed and nothing will resolve the request', () => {
        const { ctx, disarms } = createContext({ transcriptLastConv: { id: 'conv-1', status: 'failed', messages: [] } });

        relaunchPendingTranscriptPreviewAfterSettleExtracted(ctx);

        expect(ctx.host.transcriptPreviewRequestPending).to.equal(false);
        expect(ctx.host.transcriptPreviewRequestRunning).to.equal(false);
        expect(disarms()).to.equal(1);
    });

    it('retires a stalled request that has no URL and no progress', () => {
        const { ctx, disarms, refreshes } = createContext();

        onTranscriptPreviewStartStalledExtracted(ctx);

        expect(ctx.host.transcriptPreviewRequestPending).to.equal(false);
        expect(disarms()).to.equal(1);
        expect(refreshes()).to.equal(2);
    });

    it('keeps a stalled request when a preview URL already answers', () => {
        const { ctx, disarms } = createContext({ transcriptOpenProject: { id: 'project-1', previewUrl: 'http://localhost:3000/qaap-preview/x/' } });

        onTranscriptPreviewStartStalledExtracted(ctx);

        expect(ctx.host.transcriptPreviewRequestPending).to.equal(true);
        expect(disarms()).to.equal(0);
    });

    it('leaves a request that a Qaap launch owns to that launch', () => {
        const { ctx, disarms } = createContext({ transcriptPreviewRequestRunning: true });

        onTranscriptPreviewStartStalledExtracted(ctx);

        expect(ctx.host.transcriptPreviewRequestPending).to.equal(true);
        expect(disarms()).to.equal(0);
    });
});
