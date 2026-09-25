// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import type { MobileProjectsTranscriptMessagesArtifactsUiContext } from './mobile-projects-transcript-messages-artifacts-ui-context';
import {
    ensureTranscriptStreamStallWatchExtracted,
    stopTranscriptStreamStallWatchExtracted,
} from './mobile-projects-transcript-messages-artifacts-ui-timeline';

/** Real 1 s ticker: wait just past one tick. */
const afterTick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 1150));

describe('transcript stream-stall watch lifecycle', function (): void {
    this.timeout(10_000);

    let disableJSDOM: (() => void) | undefined;
    let synced: HTMLElement[];
    let host: { transcriptLastConv?: { id: string; status: string } };
    let ctx: MobileProjectsTranscriptMessagesArtifactsUiContext;

    beforeEach(() => {
        disableJSDOM = enableJSDOM();
        // jsdom reports `prerender`; the watch only syncs a visible document.
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
        synced = [];
        host = { transcriptLastConv: { id: 'conv-a', status: 'streaming' } };
        ctx = {
            host,
            syncTranscriptStreamStallChrome: (row: HTMLElement) => { synced.push(row); },
        } as unknown as MobileProjectsTranscriptMessagesArtifactsUiContext;
    });

    afterEach(() => {
        stopTranscriptStreamStallWatchExtracted(ctx);
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    const streamingRow = (): HTMLElement => {
        const row = document.createElement('div');
        row.className = 'theia-mobile-agent-transcript-msg theia-mod-streaming';
        document.body.append(row);
        return row;
    };

    it('syncs every watched row from one shared ticker and stops on dispose', async () => {
        const first = streamingRow();
        const second = streamingRow();
        ensureTranscriptStreamStallWatchExtracted(ctx, first);
        ensureTranscriptStreamStallWatchExtracted(ctx, second);
        ensureTranscriptStreamStallWatchExtracted(ctx, first);
        await afterTick();
        expect(synced).to.deep.equal([first, second]);

        stopTranscriptStreamStallWatchExtracted(ctx);
        expect(first.dataset.transcriptStallWatch).to.equal(undefined);
        synced.length = 0;
        await afterTick();
        expect(synced).to.deep.equal([]);
    });

    it('drops detached rows and rows of a previous conversation, then stops itself', async () => {
        const detached = streamingRow();
        const stale = streamingRow();
        ensureTranscriptStreamStallWatchExtracted(ctx, detached);
        ensureTranscriptStreamStallWatchExtracted(ctx, stale);
        detached.remove();
        host.transcriptLastConv = { id: 'conv-b', status: 'streaming' };
        await afterTick();
        expect(synced).to.deep.equal([]);
        expect(stale.dataset.transcriptStallWatch).to.equal(undefined);

        // The ticker is gone: a new row starts a fresh one bound to the current conversation.
        const current = streamingRow();
        ensureTranscriptStreamStallWatchExtracted(ctx, current);
        await afterTick();
        expect(synced).to.deep.equal([current]);
    });

    it('stops quietly when the DOM globals are torn down under a pending tick', async () => {
        const row = streamingRow();
        const view = row.ownerDocument.defaultView!;
        const errors: unknown[] = [];
        view.addEventListener('error', event => errors.push((event as ErrorEvent).error ?? (event as ErrorEvent).message));
        ensureTranscriptStreamStallWatchExtracted(ctx, row);
        disableJSDOM!();
        disableJSDOM = undefined;
        await afterTick();
        expect(errors).to.deep.equal([]);
        expect(synced).to.deep.equal([]);
    });
});
