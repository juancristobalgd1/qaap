// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Agentic workspace contract #1:
 * When a turn is visually complete but the VPS task is still attached (status=streaming),
 * every UI surface must agree on "settled/finalizing" — never show live-working chrome.
 */

import { expect } from 'chai';
import type { QaapAgentConversationDTO } from './qaap-agent-conversation-client';
import { resolveTranscriptStreamHealth } from './qaap-transcript-stream-health';
import {
    isConversationTurnVisuallySettled,
    isTranscriptAgentTailStreaming,
    isTranscriptSummaryAgentWorking,
    resolveTranscriptEffectiveStatus,
} from './qaap-transcript-turn-status';

const visuallyCompleteStreamingTurn = (): QaapAgentConversationDTO => ({
    id: 'mockup-turn',
    cwd: '/repo',
    agentId: 'qaiq',
    title: 'Mockup · Add tests',
    status: 'streaming',
    createdAt: 1,
    updatedAt: 100,
    messages: [
        { id: 'u1', role: 'user', content: 'Add tests for the most important slices', createdAt: 2 },
        {
            id: 'a1',
            role: 'agent',
            content: 'Done — replaced startup.test.ts with real tests.',
            createdAt: 90,
            segments: [
                {
                    type: 'tool',
                    toolUseId: 'edit-1',
                    name: 'Edit',
                    args: '{}',
                    finished: true,
                },
                {
                    type: 'tool',
                    toolUseId: 'verify-1',
                    name: 'Bash',
                    args: '{"command":"npm test"}',
                    finished: true,
                    result: 'OK',
                },
                { type: 'text', content: 'Done — replaced startup.test.ts with real tests.' },
            ],
        },
    ],
});

describe('qaap-transcript-agentic-settle-contract', () => {

    it('maps backend streaming + finished turn to settled effective status', () => {
        const conv = visuallyCompleteStreamingTurn();
        expect(isConversationTurnVisuallySettled(conv)).to.equal(true);
        expect(resolveTranscriptEffectiveStatus(conv)).to.equal('settled');
    });

    it('does not treat settled turns as agent-working for composer chrome', () => {
        const conv = visuallyCompleteStreamingTurn();
        const summary = { id: conv.id, status: 'streaming' as const };
        expect(isTranscriptSummaryAgentWorking(summary, conv)).to.equal(false);
        expect(isTranscriptSummaryAgentWorking({ id: conv.id, status: 'settled' }, undefined)).to.equal(false);
    });

    it('does not keep transcript tail in streaming rendering mode once settled', () => {
        const conv = visuallyCompleteStreamingTurn();
        expect(isTranscriptAgentTailStreaming(conv)).to.equal(false);
    });

    it('does not run client stream-health timeout while effectively settled', () => {
        const conv = visuallyCompleteStreamingTurn();
        const health = resolveTranscriptStreamHealth({
            streaming: resolveTranscriptEffectiveStatus(conv) === 'streaming',
            lastProgressAtMs: 0,
            lastTransportEventAtMs: 0,
            segments: conv.messages.at(-1)?.segments ?? [],
            now: 120_000,
        });
        expect(health.stalled).to.equal(false);
        expect(health.timedOut).to.equal(false);
    });
});
