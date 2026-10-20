// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversation } from './qaap-agent-conversation';
import {
    DEFAULT_QAAP_MAX_TURN_MINUTES,
    DEFAULT_QAAP_TURN_IDLE_MINUTES,
    MIN_QAAP_MAX_TURN_MINUTES,
    MIN_QAAP_TURN_IDLE_MINUTES,
    buildQaapTurnWatchdogMessage,
    findExpiredStreamingTurns,
    resolveLastTurnActivityMs,
    resolveQaapMaxTurnMinutes,
    resolveQaapTurnIdleMinutes,
    resolveStreamingSinceMs,
} from './qaap-agent-turn-watchdog';
import {
    describeAgentTurnFailure,
    detectAgentFailureKind,
    isAgentTurnInterruptedError,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-failure-message';

const MINUTE = 60 * 1000;

describe('resolveQaapMaxTurnMinutes', () => {
    it('falls back to the default when unset', () => {
        expect(resolveQaapMaxTurnMinutes(undefined)).to.equal(DEFAULT_QAAP_MAX_TURN_MINUTES);
        expect(resolveQaapMaxTurnMinutes('')).to.equal(DEFAULT_QAAP_MAX_TURN_MINUTES);
        expect(resolveQaapMaxTurnMinutes('   ')).to.equal(DEFAULT_QAAP_MAX_TURN_MINUTES);
    });

    it('falls back to the default on an unparsable value', () => {
        expect(resolveQaapMaxTurnMinutes('not-a-number')).to.equal(DEFAULT_QAAP_MAX_TURN_MINUTES);
        expect(resolveQaapMaxTurnMinutes('NaN')).to.equal(DEFAULT_QAAP_MAX_TURN_MINUTES);
    });

    it('clamps below-minimum values up to the floor', () => {
        expect(resolveQaapMaxTurnMinutes('0')).to.equal(MIN_QAAP_MAX_TURN_MINUTES);
        expect(resolveQaapMaxTurnMinutes('1')).to.equal(MIN_QAAP_MAX_TURN_MINUTES);
        expect(resolveQaapMaxTurnMinutes('-100')).to.equal(MIN_QAAP_MAX_TURN_MINUTES);
    });

    it('honors a valid configured value at or above the floor', () => {
        expect(resolveQaapMaxTurnMinutes('5')).to.equal(5);
        expect(resolveQaapMaxTurnMinutes('120')).to.equal(120);
        expect(resolveQaapMaxTurnMinutes(' 90 ')).to.equal(90);
    });
});

describe('resolveQaapTurnIdleMinutes', () => {
    it('defaults to 15 minutes and clamps tiny values up to the floor', () => {
        expect(DEFAULT_QAAP_TURN_IDLE_MINUTES).to.equal(15);
        expect(resolveQaapTurnIdleMinutes(undefined)).to.equal(DEFAULT_QAAP_TURN_IDLE_MINUTES);
        expect(resolveQaapTurnIdleMinutes('abc')).to.equal(DEFAULT_QAAP_TURN_IDLE_MINUTES);
        expect(resolveQaapTurnIdleMinutes('1')).to.equal(MIN_QAAP_TURN_IDLE_MINUTES);
        expect(resolveQaapTurnIdleMinutes('30')).to.equal(30);
    });
});

describe('findExpiredStreamingTurns', () => {
    const limits = { idleMinutes: 15, maxTurnMinutes: 180 };
    const now = Date.parse('2026-07-02T12:00:00Z');

    it('keeps a long turn alive while it makes progress (the 46-minute task)', () => {
        expect(DEFAULT_QAAP_MAX_TURN_MINUTES).to.equal(180);
        const ids = findExpiredStreamingTurns([
            { conversationId: 'busy-46m', streamingSinceMs: now - 46 * MINUTE, lastActivityMs: now - 30 * 1000 },
            { conversationId: 'busy-2h', streamingSinceMs: now - 120 * MINUTE, lastActivityMs: now - 14 * MINUTE },
        ], now, limits);
        expect(ids).to.deep.equal([]);
    });

    it('pauses a turn that produced no output for the idle limit', () => {
        const expired = findExpiredStreamingTurns([
            { conversationId: 'silent', streamingSinceMs: now - 40 * MINUTE, lastActivityMs: now - 15 * MINUTE },
            { conversationId: 'never-spoke', streamingSinceMs: now - 16 * MINUTE },
        ], now, limits);
        expect(expired).to.deep.equal([
            { conversationId: 'silent', cause: 'idle', elapsedMs: 40 * MINUTE, idleMs: 15 * MINUTE, limitMinutes: 15 },
            { conversationId: 'never-spoke', cause: 'idle', elapsedMs: 16 * MINUTE, idleMs: 16 * MINUTE, limitMinutes: 15 },
        ]);
    });

    it('spares a turn waiting on an approval up to the 24-hour approval cap, then pauses it', () => {
        const expired = findExpiredStreamingTurns([
            { conversationId: 'deciding', streamingSinceMs: now - 200 * MINUTE, awaitingApproval: true },
            { conversationId: 'abandoned', streamingSinceMs: now - 24 * 60 * MINUTE, awaitingApproval: true },
        ], now, limits);
        expect(expired.map(turn => [turn.conversationId, turn.cause, turn.limitMinutes])).to.deep.equal([['abandoned', 'approval_wait', 24 * 60]]);
    });

    it('names the approval-wait pause in hours, and it reads as a timeout the user can continue', () => {
        const message = buildQaapTurnWatchdogMessage('approval_wait', limits, 24 * 60);
        expect(message).to.equal('Waited 24 hours for your approval. Continue runs it again from your original request.');
        expect(message).not.to.match(/task limit/);
        expect(detectAgentFailureKind(message)).to.equal('timeout');
        expect(isAgentTurnInterruptedError(message)).to.equal(true);
        expect(describeAgentTurnFailure(message)).to.deep.include({ kind: 'timeout', label: 'Timed out', interrupted: true });
    });

    it('leaves inactivity of a live task to the runner, but still applies the absolute cap', () => {
        const expired = findExpiredStreamingTurns([
            { conversationId: 'live-silent', streamingSinceMs: now - 40 * MINUTE, lastActivityMs: now - 30 * MINUTE, hasLiveTask: true },
            { conversationId: 'live-capped', streamingSinceMs: now - 180 * MINUTE, lastActivityMs: now - 1000, hasLiveTask: true },
        ], now, limits);
        expect(expired.map(turn => [turn.conversationId, turn.cause])).to.deep.equal([['live-capped', 'max_duration']]);
    });

    it('reports the absolute cap before inactivity (the 50-hour zombie)', () => {
        const expired = findExpiredStreamingTurns([
            { conversationId: 'zombie-50h', streamingSinceMs: now - 50 * 60 * MINUTE },
        ], now, limits);
        expect(expired.map(turn => turn.cause)).to.deep.equal(['max_duration']);
    });

    it('never uses thresholds below the floors even if a caller passes smaller values', () => {
        const ids = findExpiredStreamingTurns([
            { conversationId: 'short-lived', streamingSinceMs: now - 3 * MINUTE },
        ], now, { idleMinutes: 1, maxTurnMinutes: 1 });
        expect(ids).to.deep.equal([]);
        expect(MIN_QAAP_MAX_TURN_MINUTES).to.equal(5);
    });

    it('handles an empty input without error', () => {
        expect(findExpiredStreamingTurns([], now, limits)).to.deep.equal([]);
    });
});

describe('resolveStreamingSinceMs', () => {
    function conversation(
        status: QaapAgentConversation['status'],
        messages: QaapAgentConversation['messages'],
        updatedAt = 0,
    ): Pick<QaapAgentConversation, 'status' | 'messages' | 'updatedAt'> {
        return { status, messages, updatedAt };
    }

    it('returns undefined when the conversation is not streaming', () => {
        expect(resolveStreamingSinceMs(conversation('idle', [
            { id: 'u1', role: 'user', content: 'hi', createdAt: 100, taskId: 't1' },
        ]))).to.be.undefined;
    });

    it('uses the createdAt of the last task-linked user message', () => {
        const since = resolveStreamingSinceMs(conversation('streaming', [
            { id: 'u1', role: 'user', content: 'first', createdAt: 100, taskId: 't1' },
            { id: 'a1', role: 'agent', content: 'ok', createdAt: 200 },
            { id: 'u2', role: 'user', content: 'second', createdAt: 300, taskId: 't2' },
        ]));
        expect(since).to.equal(300);
    });

    it('falls back to the last user message when none carries a taskId', () => {
        const since = resolveStreamingSinceMs(conversation('streaming', [
            { id: 'u1', role: 'user', content: 'first', createdAt: 100 },
        ]));
        expect(since).to.equal(100);
    });

    it('falls back to updatedAt when there is no user message at all', () => {
        const since = resolveStreamingSinceMs(conversation('streaming', [], 999));
        expect(since).to.equal(999);
    });
});

describe('resolveLastTurnActivityMs', () => {
    it('uses the conversation updatedAt that every streamed event rewrites', () => {
        expect(resolveLastTurnActivityMs({
            status: 'streaming',
            updatedAt: 5000,
            messages: [
                { id: 'u1', role: 'user', content: 'go', createdAt: 100, taskId: 't1' },
                { id: 'a1', role: 'agent', content: '…', createdAt: 200 },
            ],
        })).to.equal(5000);
    });

    it('never reports activity before the turn started', () => {
        expect(resolveLastTurnActivityMs({
            status: 'streaming',
            updatedAt: 50,
            messages: [{ id: 'u1', role: 'user', content: 'go', createdAt: 100, taskId: 't1' }],
        })).to.equal(100);
        expect(resolveLastTurnActivityMs({ status: 'idle', updatedAt: 50, messages: [] })).to.equal(undefined);
    });
});

describe('buildQaapTurnWatchdogMessage', () => {
    const limits = { idleMinutes: 15, maxTurnMinutes: 180 };

    it('records a short timeout the failure copy reads as an interruption (Continue, not Retry)', () => {
        const idle = buildQaapTurnWatchdogMessage('idle', limits);
        expect(idle).to.equal('Timed out after 15 minutes without output. Continue runs it again from your original request.');
        const cap = buildQaapTurnWatchdogMessage('max_duration', limits);
        expect(cap).to.equal('Timed out at the 180-minute task limit. Continue runs it again from your original request.');
        for (const message of [idle, cap]) {
            expect(detectAgentFailureKind(message)).to.equal('timeout');
            expect(isAgentTurnInterruptedError(message)).to.equal(true);
            expect(describeAgentTurnFailure(message)?.label).to.equal('Timed out');
        }
    });
});
