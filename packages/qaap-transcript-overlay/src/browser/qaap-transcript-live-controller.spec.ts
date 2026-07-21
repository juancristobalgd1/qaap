// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { Emitter } from '@theia/core/lib/common/event';
import type { QaapAgentConversationDTO, QaapAgentConversationSummaryDTO } from '../common/qaap-transcript-agent-types';
import { QaapTranscriptLiveController } from './qaap-transcript-live-controller';
import {
    enableTranscriptRenderMetrics,
    getTranscriptRenderMetricsSnapshot,
    resetTranscriptRenderMetrics,
} from '../common/qaap-transcript-render-metrics';

const summary = (partial: Partial<QaapAgentConversationSummaryDTO> = {}): QaapAgentConversationSummaryDTO => ({
    id: 'conv-1',
    cwd: '/repo',
    agentId: 'qaiq',
    title: 'Test',
    status: 'streaming',
    createdAt: 1,
    updatedAt: 10,
    messageCount: 1,
    ...partial,
});

const conv = (partial: Partial<QaapAgentConversationDTO> = {}): QaapAgentConversationDTO => ({
    id: 'conv-1',
    cwd: '/repo',
    agentId: 'qaiq',
    title: 'Test',
    status: 'streaming',
    createdAt: 1,
    updatedAt: 10,
    messages: [{ id: 'u1', role: 'user', content: 'hi', createdAt: 5 }],
    ...partial,
});

describe('QaapTranscriptLiveController', () => {
    beforeEach(() => {
        (global as unknown as { window: typeof globalThis }).window = globalThis;
        enableTranscriptRenderMetrics(true);
        resetTranscriptRenderMetrics();
    });

    afterEach(() => {
        resetTranscriptRenderMetrics();
        enableTranscriptRenderMetrics(false);
    });

    it('handleSummaryUpdated updates conv state but skips render for a metadata-only SSE tick while streaming', () => {
        // `updatedAt` alone is no longer part of the transcript fingerprint (see
        // qaap-transcript-incremental-update#fingerprintConversationHeader): a summary tick that only
        // bumps `updatedAt` with byte-identical messages must not force a DOM rebuild every tick.
        let rendered = 0;
        let lastConv = conv();
        const changeEmitter = new Emitter<void>();
        const controller = new QaapTranscriptLiveController({
            isWatching: () => true,
            getOpenSummary: () => summary(),
            setOpenSummary: () => undefined,
            getLastConv: () => lastConv,
            setLastConv: next => { if (next) { lastConv = next; } },
            getLastSseDeltaAt: () => Date.now(),
            setLastSseDeltaAt: () => undefined,
            findSummaryById: () => summary(),
            refreshConversation: async () => undefined,
            renderConversation: () => { rendered += 1; },
            onApprovalRefresh: () => undefined,
            conversationsOnDidChange: changeEmitter.event,
        });
        controller.handleSummaryUpdated(summary({ updatedAt: 11 }));
        expect(rendered).to.equal(0);
        expect(lastConv.updatedAt).to.equal(11);
        const metrics = getTranscriptRenderMetricsSnapshot();
        expect(metrics.sse_summary_metadata_skip).to.equal(1);
        expect(metrics.sse_summary_fingerprint_check).to.equal(0);
        controller.dispose();
        changeEmitter.dispose();
    });

    it('handleSummaryUpdated falls back to the fingerprint path when summary message count is ahead', () => {
        let rendered = 0;
        let lastConv = conv();
        const changeEmitter = new Emitter<void>();
        const controller = new QaapTranscriptLiveController({
            isWatching: () => true,
            getOpenSummary: () => summary(),
            setOpenSummary: () => undefined,
            getLastConv: () => lastConv,
            setLastConv: next => { if (next) { lastConv = next; } },
            getLastSseDeltaAt: () => Date.now(),
            setLastSseDeltaAt: () => undefined,
            findSummaryById: () => summary(),
            refreshConversation: async () => undefined,
            renderConversation: () => { rendered += 1; },
            onApprovalRefresh: () => undefined,
            conversationsOnDidChange: changeEmitter.event,
        });
        controller.handleSummaryUpdated(summary({ messageCount: 2, updatedAt: 11 }));
        expect(rendered).to.equal(0);
        const metrics = getTranscriptRenderMetricsSnapshot();
        expect(metrics.sse_summary_metadata_skip).to.equal(0);
        expect(metrics.sse_summary_fingerprint_check).to.equal(1);
        controller.dispose();
        changeEmitter.dispose();
    });

    it('handleSummaryUpdated forces a refetch when the conversation settles', async () => {
        let refreshCalls = 0;
        let settled = 0;
        let lastConv = conv();
        const changeEmitter = new Emitter<void>();
        const controller = new QaapTranscriptLiveController({
            // Deterministic regardless of any global `document` a sibling spec
            // file's jsdom lifecycle may have left in place — jsdom's default
            // `document.visibilityState` is 'prerender', not 'visible', which
            // would otherwise make `refreshNow()` skip silently depending on
            // test run order (see the isDocumentVisible fallback in the
            // controller). This test is about the settle-refetch behavior, not
            // document visibility, so pin it explicitly.
            isDocumentVisible: () => true,
            isWatching: () => true,
            getOpenSummary: () => summary({ status: 'idle' }),
            setOpenSummary: () => undefined,
            getLastConv: () => lastConv,
            setLastConv: next => { if (next) { lastConv = next; } },
            getLastSseDeltaAt: () => Date.now(),
            setLastSseDeltaAt: () => undefined,
            findSummaryById: () => summary({ status: 'idle' }),
            refreshConversation: async () => { refreshCalls += 1; },
            renderConversation: () => undefined,
            onApprovalRefresh: () => undefined,
            onStatusSettled: () => { settled += 1; },
            conversationsOnDidChange: changeEmitter.event,
        });
        (controller as unknown as { watchedConversationId: string }).watchedConversationId = 'conv-1';
        controller.handleSummaryUpdated(summary({ status: 'idle' }));
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(refreshCalls).to.be.greaterThan(0);
        expect(settled).to.equal(1);
        expect(lastConv.status).to.equal('idle');
        controller.dispose();
        changeEmitter.dispose();
    });

    it('handleSummaryUpdated force-polls when visual verification pending clears while idle', async () => {
        let forcePollCalls = 0;
        let openSummary = summary({ status: 'idle', visualVerificationPending: true });
        let lastConv = conv({ status: 'idle' });
        const changeEmitter = new Emitter<void>();
        const controller = new QaapTranscriptLiveController({
            isDocumentVisible: () => true,
            isWatching: () => true,
            getOpenSummary: () => openSummary,
            setOpenSummary: next => { openSummary = next; },
            getLastConv: () => lastConv,
            setLastConv: next => { if (next) { lastConv = next; } },
            getLastSseDeltaAt: () => Date.now(),
            setLastSseDeltaAt: () => undefined,
            findSummaryById: () => openSummary,
            refreshConversation: async options => {
                if (options?.forcePoll) {
                    forcePollCalls += 1;
                }
            },
            renderConversation: () => undefined,
            onApprovalRefresh: () => undefined,
            conversationsOnDidChange: changeEmitter.event,
        });
        (controller as unknown as { watchedConversationId: string }).watchedConversationId = 'conv-1';
        controller.handleSummaryUpdated(summary({
            status: 'idle',
            visualVerificationPending: undefined,
            updatedAt: 20,
        }));
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(forcePollCalls).to.be.greaterThan(0);
        expect(openSummary.visualVerificationPending).to.equal(undefined);
        controller.dispose();
        changeEmitter.dispose();
    });

    it('streaming fallback poll refetches when SSE is silent', async function (): Promise<void> {
        this.timeout(6_000);
        let refreshCalls = 0;
        let lastConv = conv();
        const changeEmitter = new Emitter<void>();
        const controller = new QaapTranscriptLiveController({
            // See the comment in the "forces a refetch when the conversation
            // settles" test above: pin document visibility so the fallback
            // poll's refetch isn't silently skipped by a sibling spec file's
            // leaked jsdom `document` (default visibilityState 'prerender').
            isDocumentVisible: () => true,
            isWatching: () => true,
            getOpenSummary: () => summary(),
            setOpenSummary: () => undefined,
            getLastConv: () => lastConv,
            setLastConv: next => { if (next) { lastConv = next; } },
            getLastSseDeltaAt: () => undefined,
            setLastSseDeltaAt: () => undefined,
            findSummaryById: () => summary(),
            refreshConversation: async options => {
                if (options?.forcePoll) {
                    refreshCalls += 1;
                }
            },
            renderConversation: () => undefined,
            onApprovalRefresh: () => undefined,
            conversationsOnDidChange: changeEmitter.event,
        });
        controller.watch('conv-1');
        await new Promise(resolve => setTimeout(resolve, 4_500));
        expect(refreshCalls).to.be.greaterThan(0);
        controller.dispose();
        changeEmitter.dispose();
    });
});
