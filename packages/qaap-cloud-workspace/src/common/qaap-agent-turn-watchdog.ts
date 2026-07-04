// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentConversation } from './qaap-agent-conversation';

/** Env var overriding how long a conversation may stay continuously `'streaming'` before the watchdog force-stops it. */
export const QAAP_MAX_TURN_MINUTES_ENV = 'QAAP_MAX_TURN_MINUTES';

/** Generous default: long agent tasks can legitimately run tens of minutes, but never unbounded. */
export const DEFAULT_QAAP_MAX_TURN_MINUTES = 45;

/** Floor so a misconfigured tiny value cannot trip the watchdog during normal turns. */
export const MIN_QAAP_MAX_TURN_MINUTES = 5;

/**
 * Resolve the configured max turn duration (in minutes) from a raw env value.
 *
 * Falls back to {@link DEFAULT_QAAP_MAX_TURN_MINUTES} when the value is missing or unparsable,
 * and clamps anything below {@link MIN_QAAP_MAX_TURN_MINUTES} up to that floor.
 */
export function resolveQaapMaxTurnMinutes(rawEnvValue: string | undefined): number {
    const trimmed = rawEnvValue?.trim();
    if (!trimmed) {
        return DEFAULT_QAAP_MAX_TURN_MINUTES;
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(parsed)) {
        return DEFAULT_QAAP_MAX_TURN_MINUTES;
    }
    return Math.max(MIN_QAAP_MAX_TURN_MINUTES, parsed);
}

/** One `'streaming'` conversation's turn-start timestamp, as seen by a watchdog sweep. */
export interface QaapStreamingTurnSnapshot {
    readonly conversationId: string;
    readonly streamingSinceMs: number;
}

/**
 * Pure decision: given the conversations currently marked `'streaming'` and when each turn
 * started, which conversation ids have run longer than the configured max and must be
 * force-settled by the watchdog.
 */
export function findExpiredStreamingTurns(
    streaming: readonly QaapStreamingTurnSnapshot[],
    nowMs: number,
    maxTurnMinutes: number,
): string[] {
    const maxMs = Math.max(MIN_QAAP_MAX_TURN_MINUTES, maxTurnMinutes) * 60 * 1000;
    return streaming
        .filter(turn => nowMs - turn.streamingSinceMs >= maxMs)
        .map(turn => turn.conversationId);
}

/**
 * When the current turn (if any) started, derived from the persisted conversation itself —
 * no separate timestamp needs to be stored. The turn's user message carries the `taskId` and its
 * `createdAt` is the moment the turn began; that survives restarts because messages are persisted
 * with the conversation.
 */
export function resolveStreamingSinceMs(
    conv: Pick<QaapAgentConversation, 'status' | 'messages' | 'updatedAt'>,
): number | undefined {
    if (conv.status !== 'streaming') {
        return undefined;
    }
    const lastUserWithTask = [...conv.messages].reverse().find(message => message.role === 'user' && message.taskId);
    if (lastUserWithTask) {
        return lastUserWithTask.createdAt;
    }
    // Defensive fallback — a streaming conversation should always have a task-linked user message.
    const lastUser = [...conv.messages].reverse().find(message => message.role === 'user');
    return lastUser?.createdAt ?? conv.updatedAt;
}

/** Human-readable duration for the auto-stop message, e.g. `"2 hours 5 minutes"` or `"47 minutes"`. */
export function formatQaapTurnWatchdogDuration(elapsedMs: number): string {
    const totalMinutes = Math.max(1, Math.round(elapsedMs / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const parts: string[] = [];
    if (hours > 0) {
        parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
    }
    if (minutes > 0 || hours === 0) {
        parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
    }
    return parts.join(' ');
}

/**
 * Backend-facing message recorded on the turn when the watchdog force-stops it. Backend messages
 * are plain English (only frontend strings go through `nls.localize`).
 */
export function buildQaapTurnWatchdogMessage(elapsedMs: number): string {
    return `Stopped automatically after ${formatQaapTurnWatchdogDuration(elapsedMs)}: the turn exceeded the maximum allowed time.`;
}
