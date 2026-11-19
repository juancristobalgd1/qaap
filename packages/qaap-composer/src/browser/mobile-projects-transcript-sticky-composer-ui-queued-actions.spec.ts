// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { TranscriptFollowUpQueue } from '@theia/qaap-transcript-overlay/lib/common/qaap-transcript-follow-up-queue';
import type { QaapAgentConversationSummaryDTO, QaapPendingUserMessageDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import type { MobileProjectsTranscriptStickyComposerUiContext } from './mobile-projects-transcript-sticky-composer-ui-context';

describe('mobile-projects-transcript-sticky-composer-ui queued transcript actions', () => {
    let disableJSDOM: () => void;
    let timelineModule: typeof import('./mobile-projects-transcript-sticky-composer-ui-timeline');
    let activityStackModule: typeof import('./qaap-sticky-composer-activity-stack');

    const summary = { id: 'conv-1' } as QaapAgentConversationSummaryDTO;
    const project = { id: 'project-1' } as MobileProjectEntry;

    before(() => {
        disableJSDOM = enableJSDOM();
        timelineModule = require('./mobile-projects-transcript-sticky-composer-ui-timeline');
        activityStackModule = require('./qaap-sticky-composer-activity-stack');
    });

    after(() => {
        disableJSDOM();
    });

    function createCtx(): {
        ctx: MobileProjectsTranscriptStickyComposerUiContext;
        queue: TranscriptFollowUpQueue;
        cancelled: [string, string][];
        counters: { syncs: number; refreshes: number; remounts: number };
        host: Record<string, unknown>;
    } {
        const queue = new TranscriptFollowUpQueue();
        const cancelled: [string, string][] = [];
        const counters = { syncs: 0, refreshes: 0, remounts: 0 };
        const host: Record<string, unknown> = {
            transcriptFollowUpQueue: queue,
            transcriptComposerSummary: summary,
            transcriptComposerProject: project,
            transcriptComposerDraft: '',
            transcriptComposerContext: [],
            transcriptMessagesUi: {
                cancelQueuedMessage: async (conversationId: string, messageId: string) => { cancelled.push([conversationId, messageId]); },
                dispatchQueuedMessage: async () => undefined,
            },
        };
        const ctx = {
            host,
            syncTranscriptQueuedFollowUpBubbles: () => { counters.syncs++; },
            refreshComposerActivityStack: () => { counters.refreshes++; },
            remountTranscriptStickyComposer: () => { counters.remounts++; },
        } as unknown as MobileProjectsTranscriptStickyComposerUiContext;
        return { ctx, queue, cancelled, counters, host };
    }

    it('removes a local queued message from the queue and cancels its server copy', async () => {
        const { ctx, queue, cancelled, counters } = createCtx();
        queue.enqueue(summary.id, { draft: 'hold', serverPendingId: 'srv-1' });
        const pending = { id: 'srv-1', content: 'hold', createdAt: 1 } as QaapPendingUserMessageDTO;

        await timelineModule.handleTranscriptQueuedMessageActionExtracted(ctx, summary.id, pending, 'remove');

        expect(queue.peek(summary.id)).to.have.length(0);
        expect(cancelled).to.deep.equal([[summary.id, 'srv-1']]);
        expect(counters.syncs).to.equal(1);
    });

    it('edit returns a local queued message to the composer and drops it from the queue', async () => {
        const { ctx, queue, host, counters } = createCtx();
        queue.enqueue(summary.id, { draft: 'edit me' });
        const pending = { id: 'local-queue-0-abc', content: 'edit me', createdAt: 1 } as QaapPendingUserMessageDTO;

        await timelineModule.handleTranscriptQueuedMessageActionExtracted(ctx, summary.id, pending, 'edit');

        expect(host.transcriptComposerDraft).to.equal('edit me');
        expect(queue.peek(summary.id)).to.have.length(0);
        expect(counters.remounts).to.equal(1);
    });

    it('acts on a server-only queued row through the durable queue', async () => {
        const { ctx, cancelled } = createCtx();
        const pending = { id: 'srv-9', content: 'after reload', createdAt: 1 } as QaapPendingUserMessageDTO;

        await timelineModule.handleTranscriptQueuedMessageActionExtracted(ctx, summary.id, pending, 'remove');

        expect(cancelled).to.deep.equal([[summary.id, 'srv-9']]);
    });

    it('no longer exports the composer queue tray', () => {
        expect(activityStackModule).to.not.have.property('renderStickyComposerActivityStack');
        expect(activityStackModule).to.not.have.property('buildStickyComposerActivityStackFingerprint');
        expect(activityStackModule).to.not.have.property('patchStickyComposerActivityStack');
    });
});
