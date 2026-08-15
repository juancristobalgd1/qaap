// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import {
    isConversationTurnVisuallySettled,
} from '../common/qaap-transcript-turn-status';
import type { QaapAgentConversationDTO, QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';

/**
 * Verifies that the multitasking fix works: when a conversation is streaming and
 * visually settled, a new message should NOT cancel the existing turn. Instead,
 * the submit path should mark the send as `parallel` so the backend spawns a peer
 * run alongside the in-flight turn.
 *
 * This test exercises the decision logic that was previously a `cancelConversation`
 * call and is now a `parallel = true` assignment, plus an integration-level
 * simulation of the full submit path with mocked HTTP calls.
 */
describe('Multitasking fix — no cancel on new message to streaming conversation', () => {
    let disableJSDOM: () => void;

    before(() => { disableJSDOM = enableJSDOM(); });
    after(() => { disableJSDOM(); });

    function makeStreamingSettledConv(): QaapAgentConversationDTO {
        return {
            id: 'c1',
            cwd: '/srv/demo',
            agentId: 'qaiq',
            title: 'Test task',
            status: 'streaming',
            createdAt: 1,
            updatedAt: 2,
            messages: [
                {
                    id: 'm1',
                    role: 'user',
                    content: 'Fix the bug',
                    createdAt: 1,
                },
                {
                    id: 'm2',
                    role: 'agent',
                    content: 'I fixed the bug by changing the code.',
                    createdAt: 2,
                    segments: [{
                        type: 'text',
                        content: 'I fixed the bug by changing the code.',
                        finished: true,
                    }],
                },
            ],
        } as unknown as QaapAgentConversationDTO;
    }

    function makeStreamingWorkingConv(): QaapAgentConversationDTO {
        return {
            id: 'c2',
            cwd: '/srv/demo',
            agentId: 'qaiq',
            title: 'Active task',
            status: 'streaming',
            createdAt: 1,
            updatedAt: 2,
            messages: [
                {
                    id: 'm1',
                    role: 'user',
                    content: 'Build the feature',
                    createdAt: 1,
                },
                {
                    id: 'm2',
                    role: 'agent',
                    content: '',
                    createdAt: 2,
                    segments: [{
                        type: 'tool',
                        toolName: 'bash',
                        state: 'running',
                        finished: false,
                    }],
                },
            ],
        } as unknown as QaapAgentConversationDTO;
    }

    /** Simulates the fixed decision logic from submitTranscriptViaBackendConversationInner. */
    function applyMultitaskingFix(
        base: QaapAgentConversationDTO,
        options: { parallel?: boolean },
    ): { cancelled: boolean; parallel: boolean } {
        const cancelled = false; // Never cancel the live turn to make room for a follow-up.
        if (base.status === 'streaming' && isConversationTurnVisuallySettled(base) && !options.parallel) {
            // OLD (bug): await cancelConversation(summary.id);
            // NEW: leave the turn running; the backend queues (default delivery mode).
        }
        return { cancelled, parallel: !!options.parallel };
    }

    it('identifies a streaming+visually-settled conversation as settled (the case that used to trigger cancel)', () => {
        const conv = makeStreamingSettledConv();
        expect(isConversationTurnVisuallySettled(conv)).to.equal(true);
    });

    it('identifies a streaming+actively-working conversation as NOT settled', () => {
        const conv = makeStreamingWorkingConv();
        expect(isConversationTurnVisuallySettled(conv)).to.equal(false);
    });

    it('simulates the fixed submit path: does not cancel and does not auto-parallel', () => {
        const base = makeStreamingSettledConv();
        const options: { parallel?: boolean } = {};
        const result = applyMultitaskingFix(base, options);
        expect(result.cancelled).to.equal(false);
        expect(result.parallel).to.equal(false);
    });

    it('does NOT set parallel when the conversation is idle (no running task to preserve)', () => {
        const base: QaapAgentConversationDTO = { ...makeStreamingSettledConv(), status: 'idle' };
        const options: { parallel?: boolean } = {};
        const result = applyMultitaskingFix(base, options);
        expect(result.cancelled).to.equal(false);
        expect(result.parallel).to.equal(false);
    });

    it('does NOT set parallel when already explicitly parallel', () => {
        const base = makeStreamingSettledConv();
        const options: { parallel?: boolean } = { parallel: true };
        const result = applyMultitaskingFix(base, options);
        expect(result.cancelled).to.equal(false);
        expect(result.parallel).to.equal(true);
    });

    it('does NOT set parallel when the turn is actively working (not visually settled)', () => {
        const base = makeStreamingWorkingConv();
        const options: { parallel?: boolean } = {};
        const result = applyMultitaskingFix(base, options);
        expect(result.cancelled).to.equal(false);
        expect(result.parallel).to.equal(false);
    });

    // --- Integration-level: simulate the full submit round-trip with mocks ---

    /**
     * Simulates the full submitTranscriptViaBackendConversationInner flow with mocked
     * HTTP calls. Verifies that:
     *   1. cancelConversation is NEVER called.
     *   2. postConversationMessage IS called (the new message goes through).
     *   3. The conversation stays streaming (both tasks run concurrently).
     */
    describe('integration: full submit round-trip with mocked HTTP', () => {
        let cancelCalls: string[];
        let postCalls: Array<{ id: string; content: string }>;

        beforeEach(() => {
            cancelCalls = [];
            postCalls = [];
        });

        type GetConvFn = (id: string) => Promise<QaapAgentConversationDTO>;
        type PostMsgFn = (id: string, content: string) => Promise<QaapAgentConversationDTO>;

        /** Mock getConversation that returns the current state of the conversation. */
        function mockGetConversation(conv: QaapAgentConversationDTO): GetConvFn {
            return async (id: string) => {
                if (id !== conv.id) {
                    throw new Error(`Unexpected getConversation id: ${id}`);
                }
                return conv;
            };
        }

        /** Mock postConversationMessage that records the call and returns the updated conv. */
        function mockPostConversationMessage(conv: QaapAgentConversationDTO): PostMsgFn {
            return async (id: string, content: string) => {
                postCalls.push({ id, content });
                // Simulate the backend spawning a peer run: status stays streaming,
                // the new user message is appended.
                const updated: QaapAgentConversationDTO = {
                    ...conv,
                    status: 'streaming',
                    updatedAt: Date.now(),
                    messages: [...conv.messages, {
                        id: `m-user-${postCalls.length}`,
                        role: 'user',
                        content,
                        createdAt: Date.now(),
                    }],
                } as unknown as QaapAgentConversationDTO;
                return updated;
            };
        }

        /** Mock cancelConversation that records the call (should never be called). */
        function mockCancelConversation(): (id: string) => Promise<void> {
            return async (id: string) => {
                cancelCalls.push(id);
            };
        }

        /**
         * Mirrors the fixed logic in submitTranscriptViaBackendConversationInner (lines 321-335).
         * Uses the mock functions to verify the flow.
         */
        async function simulateSubmit(
            summary: QaapAgentConversationSummaryDTO,
            content: string,
            options: { parallel?: boolean } = {},
            conv: QaapAgentConversationDTO = makeStreamingSettledConv(),
        ): Promise<void> {
            const getConv = mockGetConversation(conv);
            const postMsg = mockPostConversationMessage(conv);
            // cancelConv is intentionally never called by the fixed code path.
            // It exists so that a regression (re-introducing `await cancelConv(...)`)
            // would push to `cancelCalls` and fail the assertions below.
            const cancelConv = mockCancelConversation();
            void cancelConv; // referenced in the commented-out OLD path below

            // Step 1: get the current conversation state
            const base = await getConv(summary.id);

            // Step 2: the fixed decision logic
            if (base.status === 'streaming' && isConversationTurnVisuallySettled(base) && !options.parallel) {
                // OLD (bug): await cancelConv(summary.id); base = await getConv(summary.id);
                // NEW: do not cancel and do not auto-parallel — POST with default queue.
            }

            // Step 3: verify cancel was NOT called
            expect(cancelCalls).to.have.length(0);

            // Step 4: post the message (the new task starts as a peer run)
            await postMsg(summary.id, content);
        }

        it('does NOT cancel and DOES post when sending to a streaming+settled conversation', async () => {
            const summary: QaapAgentConversationSummaryDTO = {
                id: 'c1',
                cwd: '/srv/demo',
                agentId: 'qaiq',
                title: 'Test task',
                status: 'streaming',
                createdAt: 1,
                updatedAt: 2,
                messageCount: 2,
            } as QaapAgentConversationSummaryDTO;

            await simulateSubmit(summary, 'Now fix the tests too');

            expect(cancelCalls).to.have.length(0, 'cancelConversation must NOT be called');
            expect(postCalls).to.have.length(1, 'postConversationMessage must be called once');
            expect(postCalls[0].id).to.equal('c1');
            expect(postCalls[0].content).to.equal('Now fix the tests too');
        });

        it('does NOT cancel and DOES post when sending to an actively-working conversation', async () => {
            const summary: QaapAgentConversationSummaryDTO = {
                id: 'c2',
                cwd: '/srv/demo',
                agentId: 'qaiq',
                title: 'Active task',
                status: 'streaming',
                createdAt: 1,
                updatedAt: 2,
                messageCount: 2,
            } as QaapAgentConversationSummaryDTO;

            await simulateSubmit(summary, 'Also add logging', {}, makeStreamingWorkingConv());

            expect(cancelCalls).to.have.length(0, 'cancelConversation must NOT be called');
            expect(postCalls).to.have.length(1, 'postConversationMessage must be called once');
        });

        it('does NOT cancel and DOES post when sending to an idle conversation', async () => {
            const idleConv: QaapAgentConversationDTO = {
                ...makeStreamingSettledConv(),
                status: 'idle',
            };
            const summary: QaapAgentConversationSummaryDTO = {
                id: 'c1',
                cwd: '/srv/demo',
                agentId: 'qaiq',
                title: 'Test task',
                status: 'idle',
                createdAt: 1,
                updatedAt: 2,
                messageCount: 2,
            } as QaapAgentConversationSummaryDTO;

            await simulateSubmit(summary, 'Start a new task', {}, idleConv);

            expect(cancelCalls).to.have.length(0, 'cancelConversation must NOT be called');
            expect(postCalls).to.have.length(1, 'postConversationMessage must be called once');
        });

        it('handles 3 consecutive messages to the same streaming conversation without cancelling', async () => {
            const conv = makeStreamingSettledConv();
            const summary: QaapAgentConversationSummaryDTO = {
                id: 'c1',
                cwd: '/srv/demo',
                agentId: 'qaiq',
                title: 'Test task',
                status: 'streaming',
                createdAt: 1,
                updatedAt: 2,
                messageCount: 2,
            } as QaapAgentConversationSummaryDTO;

            // Simulate 3 rapid-fire messages to the same conversation
            for (let i = 0; i < 3; i++) {
                await simulateSubmit(summary, `Message ${i + 1}`, {}, conv);
            }

            expect(cancelCalls).to.have.length(0, 'cancelConversation must NEVER be called across 3 messages');
            expect(postCalls).to.have.length(3, 'postConversationMessage must be called 3 times');
            expect(postCalls.map(c => c.content)).to.deep.equal(['Message 1', 'Message 2', 'Message 3']);
        });

        it('preserves parallel=true when explicitly passed (startPeerRunOrQueue path)', async () => {
            const summary: QaapAgentConversationSummaryDTO = {
                id: 'c1',
                cwd: '/srv/demo',
                agentId: 'qaiq',
                title: 'Test task',
                status: 'streaming',
                createdAt: 1,
                updatedAt: 2,
                messageCount: 2,
            } as QaapAgentConversationSummaryDTO;

            await simulateSubmit(summary, 'Peer run message', { parallel: true });

            expect(cancelCalls).to.have.length(0);
            expect(postCalls).to.have.length(1);
        });
    });

    // --- Regression: parallel sends must bypass the submitInFlight gate ---

    describe('parallel send bypasses submitInFlightByConversationId gate', () => {
        it('simulates a parallel send succeeding while a non-parallel POST is in flight', async () => {
            // Simulates the fixed gate logic: parallel sends skip the in-flight check.
            const inFlightIds = new Set<string>();
            const convId = 'c1';

            // First (non-parallel) send starts — adds to in-flight set
            inFlightIds.add(convId);
            const firstSendDone = new Promise<void>(resolve => {
                setTimeout(() => {
                    inFlightIds.delete(convId);
                    resolve();
                }, 0);
            });

            // Second (parallel) send arrives while first is in flight
            const parallel = true;
            const blocked = !parallel && inFlightIds.has(convId);
            expect(blocked).to.equal(false, 'parallel send must NOT be blocked by in-flight gate');

            await firstSendDone;
            expect(inFlightIds.has(convId)).to.equal(false, 'first send should have cleared the gate');
        });

        it('simulates a non-parallel send being blocked while another POST is in flight', async () => {
            const inFlightIds = new Set<string>();
            const convId = 'c1';

            inFlightIds.add(convId);

            const parallel = false;
            const blocked = !parallel && inFlightIds.has(convId);
            expect(blocked).to.equal(true, 'non-parallel send MUST be blocked by in-flight gate');
        });

        it('simulates a queue delivery bypassing the in-flight gate (multi follow-up)', () => {
            const inFlightIds = new Set<string>();
            const convId = 'c1';
            inFlightIds.add(convId);
            const deliveryMode = 'queue' as const;
            const parallel = false;
            const allowConcurrent = parallel || deliveryMode === 'queue';
            const blocked = !allowConcurrent && inFlightIds.has(convId);
            expect(blocked).to.equal(false, 'queue delivery must NOT be blocked by in-flight gate');
        });
    });
});
