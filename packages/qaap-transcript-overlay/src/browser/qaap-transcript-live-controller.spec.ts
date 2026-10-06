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

    describe('active-task fallback poll', () => {

        interface FakeTimer { at: number; handler: () => void }
        let now = 0;
        let timers = new Map<number, FakeTimer>();
        let nextTimerId = 1;
        const realSetTimeout = globalThis.setTimeout;
        const realClearTimeout = globalThis.clearTimeout;
        const realDateNow = Date.now;

        const advance = async (ms: number): Promise<void> => {
            const until = now + ms;
            await Promise.resolve();
            await Promise.resolve();
            for (;;) {
                const due = [...timers.entries()]
                    .filter(([, timer]) => timer.at <= until)
                    .sort((a, b) => a[1].at - b[1].at)[0];
                if (!due) {
                    break;
                }
                timers.delete(due[0]);
                now = due[1].at;
                due[1].handler();
                await Promise.resolve();
                await Promise.resolve();
            }
            now = until;
        };

        beforeEach(() => {
            now = 1_000_000;
            timers = new Map();
            nextTimerId = 1;
            Date.now = () => now;
            globalThis.setTimeout = ((handler: () => void, delay?: number) => {
                const id = nextTimerId++;
                timers.set(id, { at: now + (delay ?? 0), handler });
                return id;
            }) as unknown as typeof setTimeout;
            globalThis.clearTimeout = ((id: number) => { timers.delete(id); }) as unknown as typeof clearTimeout;
        });

        afterEach(() => {
            globalThis.setTimeout = realSetTimeout;
            globalThis.clearTimeout = realClearTimeout;
            Date.now = realDateNow;
        });

        function createPolledController(state: { lastConv: QaapAgentConversationDTO | undefined; sseAt?: number }): {
            controller: QaapTranscriptLiveController;
            forcePolls: number[];
            dispose: () => void;
        } {
            const forcePolls: number[] = [];
            const changeEmitter = new Emitter<void>();
            const controller = new QaapTranscriptLiveController({
                isDocumentVisible: () => true,
                isWatching: () => true,
                getOpenSummary: () => summary(),
                setOpenSummary: () => undefined,
                getLastConv: () => state.lastConv,
                setLastConv: next => { state.lastConv = next; },
                getLastSseDeltaAt: () => state.sseAt,
                setLastSseDeltaAt: at => { state.sseAt = at; },
                findSummaryById: () => summary(),
                refreshConversation: async options => {
                    if (options?.forcePoll) {
                        forcePolls.push(now);
                    }
                },
                renderConversation: () => undefined,
                onApprovalRefresh: () => undefined,
                conversationsOnDidChange: changeEmitter.event,
            });
            return {
                controller,
                forcePolls,
                dispose: () => {
                    controller.dispose();
                    changeEmitter.dispose();
                },
            };
        }

        it('keeps polling while the conversation has not loaded yet, then refetches once it streams', async () => {
            const state: { lastConv: QaapAgentConversationDTO | undefined } = { lastConv: undefined };
            const { controller, forcePolls, dispose } = createPolledController(state);
            controller.watch('conv-1');
            await advance(3_500);
            state.lastConv = conv({ status: 'streaming' });
            const before = forcePolls.length;
            await advance(6_000);
            expect(forcePolls.length).to.be.greaterThan(before);
            dispose();
        });

        it('ensureActivePoll re-arms the poll after a follow-up into an idle task', async () => {
            const state: { lastConv: QaapAgentConversationDTO | undefined } = { lastConv: conv({ status: 'idle' }) };
            const { controller, forcePolls, dispose } = createPolledController(state);
            controller.watch('conv-1');
            await advance(10_000);
            const idleCount = forcePolls.length;
            controller.ensureActivePoll();
            state.lastConv = conv({ status: 'streaming' });
            await advance(3_100);
            expect(forcePolls.length).to.be.greaterThan(idleCount);
            dispose();
        });

        it('backs off from 3s to 5s while live events are silent and stops once the turn settles', async () => {
            const state: { lastConv: QaapAgentConversationDTO | undefined } = { lastConv: conv({ status: 'streaming' }) };
            const { controller, forcePolls, dispose } = createPolledController(state);
            const start = Date.now();
            controller.watch('conv-1');
            await advance(30_000);
            const gaps = forcePolls.map((at, index) => at - (index === 0 ? start : forcePolls[index - 1]));
            expect(gaps.slice(0, 4)).to.deep.equal([3_000, 4_000, 5_000, 5_000]);
            state.lastConv = conv({ status: 'idle' });
            await advance(5_000);
            const settledCount = forcePolls.length;
            await advance(60_000);
            expect(forcePolls.length).to.equal(settledCount);
            expect(timers.size).to.equal(0);
            dispose();
        });

        it('does not poll while live deltas keep arriving', async () => {
            const state: { lastConv: QaapAgentConversationDTO | undefined; sseAt?: number } = { lastConv: conv({ status: 'streaming' }) };
            const { controller, forcePolls, dispose } = createPolledController(state);
            controller.watch('conv-1');
            for (let i = 0; i < 20; i++) {
                state.sseAt = Date.now();
                await advance(1_000);
            }
            expect(forcePolls).to.deep.equal([]);
            dispose();
        });

        it('rehydrates from the server when the tab becomes visible, even if the local copy looks idle', async () => {
            const state: { lastConv: QaapAgentConversationDTO | undefined } = { lastConv: conv({ status: 'idle' }) };
            const { controller, forcePolls, dispose } = createPolledController(state);
            controller.watch('conv-1');
            await advance(1_000);
            controller.handleDocumentVisible();
            await advance(0);
            expect(forcePolls.length).to.equal(1);
            dispose();
        });

        it('reports which conversation it is watching', () => {
            const { controller, dispose } = createPolledController({ lastConv: undefined });
            controller.watch('conv-1');
            expect(controller.isWatchingConversation('conv-1')).to.equal(true);
            expect(controller.isWatchingConversation('pending-new-chat-1')).to.equal(false);
            dispose();
        });
    });
});
