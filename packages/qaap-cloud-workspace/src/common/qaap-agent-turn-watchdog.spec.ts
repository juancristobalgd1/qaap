// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversation } from './qaap-agent-conversation';
import {
    DEFAULT_QAAP_MAX_TURN_MINUTES,
    MIN_QAAP_MAX_TURN_MINUTES,
    buildQaapTurnWatchdogMessage,
    findExpiredStreamingTurns,
    formatQaapTurnWatchdogDuration,
    resolveQaapMaxTurnMinutes,
    resolveStreamingSinceMs,
} from './qaap-agent-turn-watchdog';

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

describe('findExpiredStreamingTurns', () => {
    const maxMinutes = 45;
    const now = Date.parse('2026-07-02T12:00:00Z');

    it('returns ids whose turn has run at least the max duration', () => {
        const ids = findExpiredStreamingTurns([
            { conversationId: 'fresh', streamingSinceMs: now - 5 * 60 * 1000 },
            { conversationId: 'exactly-at-limit', streamingSinceMs: now - 45 * 60 * 1000 },
            { conversationId: 'zombie-50h', streamingSinceMs: now - 50 * 60 * 60 * 1000 },
        ], now, maxMinutes);
        expect(ids).to.deep.equal(['exactly-at-limit', 'zombie-50h']);
    });

    it('returns an empty list when nothing has expired', () => {
        const ids = findExpiredStreamingTurns([
            { conversationId: 'a', streamingSinceMs: now - 1000 },
            { conversationId: 'b', streamingSinceMs: now - 44 * 60 * 1000 },
        ], now, maxMinutes);
        expect(ids).to.deep.equal([]);
    });

    it('never uses a threshold below the configured floor even if a caller passes a smaller value', () => {
        // 1 minute is below MIN_QAAP_MAX_TURN_MINUTES (5) and must be clamped up to the floor, so a
        // 3-minute-old turn should not be reported as expired even though 3 > 1.
        const ids = findExpiredStreamingTurns([
            { conversationId: 'short-lived', streamingSinceMs: now - 3 * 60 * 1000 },
        ], now, 1);
        expect(ids).to.deep.equal([]);
    });

    it('handles an empty input without error', () => {
        expect(findExpiredStreamingTurns([], now, maxMinutes)).to.deep.equal([]);
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

describe('formatQaapTurnWatchdogDuration', () => {
    it('formats sub-hour durations as minutes only', () => {
        expect(formatQaapTurnWatchdogDuration(47 * 60 * 1000)).to.equal('47 minutes');
        expect(formatQaapTurnWatchdogDuration(1 * 60 * 1000)).to.equal('1 minute');
    });

    it('formats multi-hour durations with both units', () => {
        expect(formatQaapTurnWatchdogDuration(2 * 60 * 60 * 1000 + 5 * 60 * 1000)).to.equal('2 hours 5 minutes');
    });

    it('omits minutes when the duration is an exact number of hours', () => {
        expect(formatQaapTurnWatchdogDuration(3 * 60 * 60 * 1000)).to.equal('3 hours');
    });

    it('renders the reported 50-hour zombie duration', () => {
        expect(formatQaapTurnWatchdogDuration(50 * 60 * 60 * 1000)).to.equal('50 hours');
    });

    it('never reports zero minutes for a sub-minute duration', () => {
        expect(formatQaapTurnWatchdogDuration(500)).to.equal('1 minute');
    });
});

describe('buildQaapTurnWatchdogMessage', () => {
    it('embeds the formatted duration in the standard sentence', () => {
        expect(buildQaapTurnWatchdogMessage(50 * 60 * 60 * 1000)).to.equal(
            'Stopped automatically after 50 hours: the turn exceeded the maximum allowed time.',
        );
    });
});
