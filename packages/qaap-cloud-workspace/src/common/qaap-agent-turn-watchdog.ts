// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    localizeAgentTurnTimeoutMessage,
    type QaapAgentTurnTimeoutCause,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-failure-message';
import type { QaapAgentConversation } from './qaap-agent-conversation';

/** Env var overriding the absolute cap (minutes) a turn may stay `'streaming'`, even while it makes progress. */
export const QAAP_MAX_TURN_MINUTES_ENV = 'QAAP_MAX_TURN_MINUTES';

/** High absolute cap: long agent tasks legitimately run for an hour or more, but never unbounded. */
export const DEFAULT_QAAP_MAX_TURN_MINUTES = 180;

/** Floor so a misconfigured tiny value cannot trip the watchdog during normal turns. */
export const MIN_QAAP_MAX_TURN_MINUTES = 5;

/** Env var overriding how long (minutes) a turn may go without any output before the watchdog pauses it. */
export const QAAP_TURN_IDLE_MINUTES_ENV = 'QAAP_TURN_IDLE_MINUTES';

/** A turn that streamed nothing for this long is stuck, however long it has been running. */
export const DEFAULT_QAAP_TURN_IDLE_MINUTES = 15;

/** Floor for the inactivity timeout: a slow tool call can legitimately stay quiet for minutes. */
export const MIN_QAAP_TURN_IDLE_MINUTES = 5;

/**
 * A turn paused on a pending approval is waiting for the user, so neither the inactivity rule nor
 * the regular cap applies — but it is not kept forever: after this long the run is paused too.
 */
export const QAAP_APPROVAL_WAIT_MAX_MINUTES = 24 * 60;

function resolveMinutesFromEnv(rawEnvValue: string | undefined, fallback: number, floor: number): number {
    const trimmed = rawEnvValue?.trim();
    if (!trimmed) {
        return fallback;
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.max(floor, parsed);
}

/**
 * Resolve the configured absolute turn cap (in minutes) from a raw env value.
 *
 * Falls back to {@link DEFAULT_QAAP_MAX_TURN_MINUTES} when the value is missing or unparsable,
 * and clamps anything below {@link MIN_QAAP_MAX_TURN_MINUTES} up to that floor.
 */
export function resolveQaapMaxTurnMinutes(rawEnvValue: string | undefined): number {
    return resolveMinutesFromEnv(rawEnvValue, DEFAULT_QAAP_MAX_TURN_MINUTES, MIN_QAAP_MAX_TURN_MINUTES);
}

/**
 * Resolve the configured inactivity timeout (in minutes) from a raw env value, falling back to
 * {@link DEFAULT_QAAP_TURN_IDLE_MINUTES} and clamping up to {@link MIN_QAAP_TURN_IDLE_MINUTES}.
 */
export function resolveQaapTurnIdleMinutes(rawEnvValue: string | undefined): number {
    return resolveMinutesFromEnv(rawEnvValue, DEFAULT_QAAP_TURN_IDLE_MINUTES, MIN_QAAP_TURN_IDLE_MINUTES);
}

/** The two watchdog limits, in minutes. */
export interface QaapTurnWatchdogLimits {
    /** Pause a turn that produced no output for this long. */
    readonly idleMinutes: number;
    /** Pause any turn that has been running this long, even with progress. */
    readonly maxTurnMinutes: number;
    /** Cap for a turn waiting on an approval (default {@link QAAP_APPROVAL_WAIT_MAX_MINUTES}). */
    readonly approvalWaitMinutes?: number;
}

/** One `'streaming'` conversation as seen by a watchdog sweep. */
export interface QaapStreamingTurnSnapshot {
    readonly conversationId: string;
    /** When the turn started. */
    readonly streamingSinceMs: number;
    /** Last time the turn produced output (falls back to {@link streamingSinceMs}). */
    readonly lastActivityMs?: number;
    /**
     * The task runner still owns a live process for this turn. Its own no-output timer watches
     * the process's stdout directly, so the watchdog leaves inactivity to it and only applies
     * the absolute cap; the inactivity rule here catches turns whose process is gone.
     */
    readonly hasLiveTask?: boolean;
    /** The turn is paused on a pending approval: only the approval-wait cap applies. */
    readonly awaitingApproval?: boolean;
}

/** A turn the watchdog must pause, and why. */
export interface QaapExpiredStreamingTurn {
    readonly conversationId: string;
    readonly cause: QaapAgentTurnTimeoutCause;
    /** How long the turn has been running. */
    readonly elapsedMs: number;
    /** How long the turn has been silent. */
    readonly idleMs: number;
    /** The limit (minutes) the turn hit, named in the recorded reason. */
    readonly limitMinutes: number;
}

/**
 * Pure decision: which `'streaming'` turns must be paused by the watchdog — those silent for
 * {@link QaapTurnWatchdogLimits.idleMinutes} (unless the runner watches a live process), and
 * every turn past the absolute {@link QaapTurnWatchdogLimits.maxTurnMinutes} cap.
 */
export function findExpiredStreamingTurns(
    streaming: readonly QaapStreamingTurnSnapshot[],
    nowMs: number,
    limits: QaapTurnWatchdogLimits,
): QaapExpiredStreamingTurn[] {
    const maxMs = Math.max(MIN_QAAP_MAX_TURN_MINUTES, limits.maxTurnMinutes) * 60 * 1000;
    const idleMinutes = Math.max(MIN_QAAP_TURN_IDLE_MINUTES, limits.idleMinutes);
    const idleLimitMs = idleMinutes * 60 * 1000;
    const approvalWaitMinutes = Math.max(limits.maxTurnMinutes, limits.approvalWaitMinutes ?? QAAP_APPROVAL_WAIT_MAX_MINUTES);
    const expired: QaapExpiredStreamingTurn[] = [];
    for (const turn of streaming) {
        const elapsedMs = nowMs - turn.streamingSinceMs;
        const idleMs = nowMs - Math.max(turn.streamingSinceMs, turn.lastActivityMs ?? turn.streamingSinceMs);
        const base = { conversationId: turn.conversationId, elapsedMs, idleMs };
        if (turn.awaitingApproval) {
            if (elapsedMs >= approvalWaitMinutes * 60 * 1000) {
                expired.push({ ...base, cause: 'max_duration', limitMinutes: approvalWaitMinutes });
            }
        } else if (elapsedMs >= maxMs) {
            expired.push({ ...base, cause: 'max_duration', limitMinutes: Math.max(MIN_QAAP_MAX_TURN_MINUTES, limits.maxTurnMinutes) });
        } else if (!turn.hasLiveTask && idleMs >= idleLimitMs) {
            expired.push({ ...base, cause: 'idle', limitMinutes: idleMinutes });
        }
    }
    return expired;
}

/**
 * True when a `'streaming'` turn has already run past the absolute cap. Restart auto-resume checks
 * this so it never relaunches a turn the watchdog would pause on its next sweep.
 */
export function hasStreamingTurnReachedCap(
    conv: Pick<QaapAgentConversation, 'status' | 'messages' | 'updatedAt'>,
    nowMs: number,
    maxTurnMinutes: number,
): boolean {
    const since = resolveStreamingSinceMs(conv);
    return since !== undefined && nowMs - since >= Math.max(MIN_QAAP_MAX_TURN_MINUTES, maxTurnMinutes) * 60 * 1000;
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

/**
 * Last time a streaming turn made progress. Every streamed event (text, tool call, trace)
 * rewrites the conversation's `updatedAt`, which is persisted, so this survives restarts.
 *
 * This is deliberately coarse: `updatedAt` also moves for non-agent writes (usage, phase, title).
 * It only drives the idle rule for turns with no live task (orphans, where nothing writes any
 * more). While a task is live the runner's no-output timer decides, and that one counts only
 * agent output — stream-json `system` records such as provider retries do not reset it
 * (`isAgentProgressChunk`).
 */
export function resolveLastTurnActivityMs(
    conv: Pick<QaapAgentConversation, 'status' | 'messages' | 'updatedAt'>,
): number | undefined {
    const since = resolveStreamingSinceMs(conv);
    if (since === undefined) {
        return undefined;
    }
    const lastAgent = [...conv.messages].reverse().find(message => message.role === 'agent');
    return Math.max(since, conv.updatedAt, lastAgent?.createdAt ?? since);
}

/**
 * Reason recorded on a turn the watchdog paused. It is the shared timeout copy, so the turn reads
 * as "Timed out" and offers Continue (see `isAgentTurnInterruptedError`). Rendered in the backend
 * locale; the frontend re-localizes it from the stored English form. It names the configured
 * limit, not the measured time: a turn found hours after it went quiet still reads "15 minutes".
 */
export function buildQaapTurnWatchdogMessage(
    cause: QaapAgentTurnTimeoutCause,
    limits: QaapTurnWatchdogLimits,
    limitMinutes?: number,
): string {
    return localizeAgentTurnTimeoutMessage(cause, limitMinutes ?? (cause === 'idle' ? limits.idleMinutes : limits.maxTurnMinutes));
}
