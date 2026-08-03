// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// Pure conversation mutation helpers extracted from QaapAgentConversationStore.
// These functions operate only on their parameters and do not access instance state.

import { randomUUID } from 'crypto';
import type {
    QaapAgentConversation,
    QaapAgentMessage,
    QaapConversationCheckpoint,
} from '../common/qaap-agent-conversation';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import {
    appendTraceBlockedEvent,
    appendTraceCheckpointEvent,
    appendTraceReviewEvent,
    appendTraceRunCancelledEvent,
    appendTraceVerificationWarningEvent,
} from '@theia/qaap-mobile-shell/lib/common/qaap-transcript-trace-lifecycle';
import { parseAgentBlockedSignal } from '../common/qaap-agent-default-workflow';
import {
    detectAgentAuthFailureMode,
    extractAgentAuthLoginChallenge,
    isUnauthenticatedCliDeclaration,
    localizeAgentAuthFailureMessage,
} from '@theia/qaap-mobile-shell/lib/common/qaap-agent-auth-login';
import {
    detectAgentFailureKind,
    resolveAgentTurnFailureMessage,
} from '@theia/qaap-mobile-shell/lib/common/qaap-agent-failure-message';
import { extractAgentTurnError } from '@theia/qaap-mobile-shell/lib/common/qaap-research-agent-log';
import { parseAgentLogForTranscript } from '@theia/qaap-mobile-shell/lib/common/qaap-cli-transcript-stream';

export function clearRunActive(
    conv: QaapAgentConversation,
    agentMessageId: string | undefined,
): QaapAgentConversation {
    if (!agentMessageId) {
        return conv;
    }
    return {
        ...conv,
        messages: conv.messages.map(message => message.id === agentMessageId && message.runActive
            ? { ...message, runActive: undefined }
            : message),
    };
}

export function appendRunCancelledTrace(
    conv: QaapAgentConversation,
    agentMessageId: string | undefined,
    reason: string,
): QaapAgentConversation {
    if (!agentMessageId) {
        return conv;
    }
    return {
        ...conv,
        messages: conv.messages.map(message => message.id === agentMessageId && message.role === 'agent'
            ? appendTraceRunCancelledEvent(message, { reason })
            : message),
    };
}

/**
 * Returns what the agent said it needs when its final message ends with the blocked-signal
 * sentinel (see {@code buildAgentBlockedSignalPromptBlock}), or {@code undefined} otherwise.
 * Checks the streaming agent message when its id is known, else the last agent message; for
 * segment-first agents whose {@code content} is empty, the last text segment is checked.
 */
export function detectAgentBlockedNeed(
    conv: QaapAgentConversation,
    agentMessageId: string | undefined,
): string | undefined {
    const target = (agentMessageId ? conv.messages.find(message => message.id === agentMessageId) : undefined)
        ?? [...conv.messages].reverse().find(message => message.role === 'agent');
    if (!target || target.role !== 'agent') {
        return undefined;
    }
    if (target.content?.trim()) {
        return parseAgentBlockedSignal(target.content);
    }
    const segments = target.segments ?? [];
    for (let i = segments.length - 1; i >= 0; i--) {
        const segment = segments[i];
        if (segment.type === 'text' && segment.content?.trim()) {
            return parseAgentBlockedSignal(segment.content);
        }
    }
    return undefined;
}

export function appendReviewTrace(
    conv: QaapAgentConversation,
    agentMessageId: string | undefined,
    note: string,
): QaapAgentConversation {
    const targetId = agentMessageId ?? conv.messages[conv.messages.length - 1]?.id;
    if (!targetId) {
        return conv;
    }
    return {
        ...conv,
        messages: conv.messages.map(message => message.id === targetId && message.role === 'agent'
            ? appendTraceReviewEvent(message, note)
            : message),
    };
}

export function appendBlockedTrace(
    conv: QaapAgentConversation,
    agentMessageId: string | undefined,
    need: string,
): QaapAgentConversation {
    const targetId = agentMessageId ?? conv.messages[conv.messages.length - 1]?.id;
    if (!targetId) {
        return conv;
    }
    return {
        ...conv,
        messages: conv.messages.map(message => message.id === targetId && message.role === 'agent'
            ? appendTraceBlockedEvent(message, `Blocked — needs your input: ${need}`)
            : message),
    };
}

/**
 * Timeline note for a turn delivered with the backend verification still red
 * ({@code task.state === 'completed_with_warnings'}). Falls back to the last message when the
 * streaming agent message id is gone (e.g. the turn was backfilled from the log).
 */
export function appendVerificationWarningTrace(
    conv: QaapAgentConversation,
    agentMessageId: string | undefined,
    task: QaapAgentTask,
): QaapAgentConversation {
    const targetId = agentMessageId ?? conv.messages[conv.messages.length - 1]?.id;
    if (!targetId) {
        return conv;
    }
    const verification = task.verification;
    const summary = verification?.status === 'failed' ? verification.summary.trim() : '';
    const attempts = verification?.status === 'failed' ? verification.attempts : 0;
    const headline = attempts > 0
        ? `Verification checks are still failing after ${attempts} fix ${attempts === 1 ? 'attempt' : 'attempts'}.`
        : 'Verification checks are failing.';
    const detail = summary.length > 600 ? `${summary.slice(0, 600)}…` : summary;
    const reason = detail ? `${headline}\n${detail}` : headline;
    return {
        ...conv,
        messages: conv.messages.map(message => message.id === targetId && message.role === 'agent'
            ? appendTraceVerificationWarningEvent(message, reason)
            : message),
    };
}

export function appendCheckpointTrace(
    conv: QaapAgentConversation,
    agentMessageId: string | undefined,
    checkpoint: QaapConversationCheckpoint,
): QaapAgentConversation {
    const targetId = agentMessageId ?? conv.messages[conv.messages.length - 1]?.id;
    if (!targetId) {
        return conv;
    }
    return {
        ...conv,
        messages: conv.messages.map(message => message.id === targetId && message.role === 'agent'
            ? appendTraceCheckpointEvent(message, checkpoint)
            : message),
    };
}

export function appendAgentReply(
    conv: QaapAgentConversation,
    content: string,
    /** The run this reply answers — see {@link QaapAgentMessage.runUserMessageId}. */
    runUserMessageId?: string,
): QaapAgentConversation {
    const message: QaapAgentMessage = {
        id: randomUUID(),
        role: 'agent',
        content,
        createdAt: Date.now(),
        ...(runUserMessageId ? { runUserMessageId } : {}),
    };
    return {
        ...conv,
        status: conv.status === 'failed' ? 'failed' : 'idle',
        updatedAt: message.createdAt,
        messages: [...conv.messages, message],
    };
}

/**
 * Detect CLI blocking failures that exit 0 but must still open an interactive
 * failure dialog in Work Hub chat (Sign-in for auth; Task failed for quota /
 * rate limits). Covers stream-json `is_error:true` and plain-text Antigravity
 * quota lines ("Individual quota reached…").
 */
export function resolveCompletedTurnAuthFailureReason(log: string | undefined): string | undefined {
    const trimmed = (log ?? '').trim();
    if (!trimmed) {
        return undefined;
    }
    // A clean exit (exit 0) is a *delivered* turn. It may only be reclassified as an
    // auth/quota failure when the CLI itself DECLARED the failure — never because the
    // raw stdout merely *mentions* auth. The broad session/URL/api-key patterns match
    // file echoes, diffs and the agent's own prose describing login code (e.g. a task
    // that edits `src/auth/login.ts` and writes "OAuth session" / "not logged in" /
    // "user_code"), so scanning the full transcript reclassifies successful turns as a
    // false "Sign in required". The only trustworthy declarations on a clean exit are:
    //   (1) a stream-json `is_error:true` result envelope (extractAgentTurnError), or
    //   (2) for plain-text CLIs, an unmistakable device-code login prompt
    //       (a login URL on a known auth host AND a one-time code).
    const turnError = extractAgentTurnError(trimmed);
    if (turnError) {
        const mode = detectAgentAuthFailureMode(turnError);
        const kind = detectAgentFailureKind(turnError);
        if (mode || kind === 'auth' || kind === 'quota' || kind === 'rate_limit') {
            return resolveAgentTurnFailureMessage(turnError, { state: 'failed' });
        }
    }
    // No structured error envelope: only a genuine device-code login challenge — a login
    // URL on a known auth host *and* a one-time code — is unambiguous enough to fail a
    // clean exit. A bare auth-host link or a loose "not logged in" phrase in prose is not.
    const challenge = extractAgentAuthLoginChallenge(trimmed);
    if (challenge?.url && challenge.userCode) {
        return localizeAgentAuthFailureMessage(challenge);
    }
    // Some CLIs (e.g. Copilot) refuse to run when signed out, printing an unmistakable
    // sign-in instruction to stdout — "No authentication information found … run '/login'
    // … gh auth login" — yet still exit 0, with no stream-json envelope and no device-code
    // URL, so neither branch above catches them and the refusal renders as a normal reply.
    // Only these strong imperative declarations (not a mere mention of auth in prose or tool
    // output) fail an otherwise-delivered turn, so the Work Hub shows the Sign-in card.
    if (isUnauthenticatedCliDeclaration(trimmed)) {
        return localizeAgentAuthFailureMessage({ mode: 'session' });
    }
    // Plain-text quota / rate-limit on a clean exit (e.g. Antigravity "Individual quota
    // reached…") — a short provider-style line, not a long successful transcript that
    // merely mentions "quota" in tool output.
    const kind = detectAgentFailureKind(trimmed);
    if (kind === 'quota' || kind === 'rate_limit') {
        const looksLikeProviderError = !!turnError
            || trimmed.length < 2_000
            || /^(?:Error|error):/m.test(trimmed)
            || /\bIndividual\s+quota\s+reached\b/i.test(trimmed)
            || /\binsufficient[_\s-]?quota\b/i.test(trimmed)
            || /\brate[_\s-]?limit(?:ed|ing)?\b/i.test(trimmed);
        if (looksLikeProviderError) {
            return resolveAgentTurnFailureMessage(trimmed, { state: 'failed' });
        }
    }
    return undefined;
}

export function parseStructuredLog(
    agentId: string,
    log: string,
): {
    content: string;
    segments: QaapAgentMessage['segments'];
    traceEvents: QaapAgentMessage['traceEvents'];
} | undefined {
    const parsed = parseAgentLogForTranscript(agentId, log);
    if (!parsed.segments?.length && !parsed.traceEvents?.length && !parsed.content?.trim()) {
        return undefined;
    }
    return parsed;
}

export function resolveRunAgentMessageId(
    conv: QaapAgentConversation,
    run: { readonly userMessageId: string; readonly agentMessageId?: string },
): string | undefined {
    if (run.agentMessageId && conv.messages.some(message => message.id === run.agentMessageId)) {
        return run.agentMessageId;
    }
    for (let index = conv.messages.length - 1; index >= 0; index--) {
        const message = conv.messages[index];
        if (message.role === 'agent' && message.runUserMessageId === run.userMessageId) {
            return message.id;
        }
    }
    return undefined;
}
