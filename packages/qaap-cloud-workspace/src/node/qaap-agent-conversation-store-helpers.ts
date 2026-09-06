// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// Pure conversation mutation helpers extracted from QaapAgentConversationStore.
// These functions operate only on their parameters and do not access instance state.

import { randomUUID } from 'crypto';
import * as path from 'path';
import {
    toConversationSummary,
    type QaapAgentConversation,
    type QaapAgentConversationCwdGroup,
    type QaapAgentConversationEvent,
    type QaapAgentMessage,
    type QaapConversationCheckpoint,
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
import {
    parseAgentLogForTranscript,
    createAgentStreamAccumulator,
    type QaapAgentStreamAccumulator,
} from '@theia/qaap-mobile-shell/lib/common/qaap-cli-transcript-stream';
import {
    createAgUiCliStreamEmitter,
    type QaapCliAgUiStreamEmitter,
} from '@theia/qaap-mobile-shell/lib/common/qaap-cli-ag-ui-stream';
import {
    DEFAULT_QAAP_CONTEXT_WINDOW,
    estimateConversationTokensFromMessages,
    totalTokensFromContextUsage,
} from '@theia/qaap-mobile-shell/lib/common/qaap-agent-context-usage';
import type { QaapConversationTaskRef } from './qaap-agent-conversation-store-constants';
import type { QaapPersistedWorkflowRun } from './qaap-workflow-run-store';
import { mergeAccumulatorTraceEvents } from '@theia/qaap-mobile-shell/lib/common/qaap-cli-transcript-stream';
import { preferTraceFirstAgentMessageStorage, materializeAgentMessageForApi } from '@theia/qaap-mobile-shell/lib/common/qaap-transcript-trace-backfill';
import {
    computeAgentMessageWireDelta,
    toAgentMessageWirePayload,
    toAgentMessageWireSnapshot,
    type QaapAgentMessageWireSnapshot,
} from '@theia/qaap-mobile-shell/lib/common/qaap-agent-message-wire-delta';
import {
    compressAgentMessageForWire,
    compressAgentMessageWireDeltaForWire,
} from './qaap-agent-message-wire-compress';
import {
    contextCompactionMessageText as contextCompactionMessageTextHelper,
    readTriedFallbackModels as readTriedFallbackModelsHelper,
    countAutoContinueAttempts as countAutoContinueAttemptsHelper,
} from './qaap-agent-conversation-store-utils';
import {
    autoContinueAllowedForInteraction,
    buildAgentAutoContinuePrompt,
    buildDevPreviewAutoContinueExhaustedReason,
    isIncompleteAgentTurn,
} from '@theia/qaap-mobile-shell/lib/common/qaap-agent-turn-completion';
import { messageRequestsDevPreview } from '@theia/qaap-mobile-shell/lib/common/qaap-transcript-preview-offer';
import { QAAP_AGENT_AUTO_CONTINUE_ENABLED } from './qaap-agent-conversation-store-constants';
import {
    partitionConversationHistory,
    shouldCompressConversationPrompt,
} from '../common/qaap-agent-conversation-prompt';
import type { QaapContextCompaction } from '../common/qaap-agent-conversation';
import {
    QAAP_MAX_TURN_MINUTES_ENV,
    buildQaapTurnWatchdogMessage,
    findExpiredStreamingTurns,
    resolveQaapMaxTurnMinutes,
    resolveStreamingSinceMs,
    type QaapStreamingTurnSnapshot,
} from '../common/qaap-agent-turn-watchdog';
import { collectSubtasksForLeader } from '../common/qaap-team-mailbox';

export function clearRunActive(
    conv: QaapAgentConversation,
    agentMessageId: string | undefined,
): QaapAgentConversation {
    if (!agentMessageId) {
        return conv;
    }
    return {
        ...conv,
        messages: conv.messages.map(message => message.id === agentMessageId && message.role === 'agent'
            ? { ...message, runActive: undefined, runFinishedAt: message.runFinishedAt ?? Date.now() }
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

// ─── DI-extracted methods (second pass) ──────────────────────────────────────

export function listAllGroupedByCwd(
    conversations: Map<string, QaapAgentConversation>,
): QaapAgentConversationCwdGroup[] {
    const buckets = new Map<string, QaapAgentConversation[]>();
    for (const conv of conversations.values()) {
        const list = buckets.get(conv.cwd);
        if (list) {
            list.push(conv);
        } else {
            buckets.set(conv.cwd, [conv]);
        }
    }
    const groups: QaapAgentConversationCwdGroup[] = [];
    for (const [cwd, list] of buckets) {
        list.sort((a, b) => b.updatedAt - a.updatedAt);
        groups.push({
            cwd,
            projectName: path.basename(cwd) || cwd,
            streamingCount: list.reduce((n, c) => n + (c.status === 'streaming' ? 1 : 0), 0),
            conversations: list.map(toConversationSummary),
        });
    }
    groups.sort((a, b) => (b.conversations[0]?.updatedAt ?? 0) - (a.conversations[0]?.updatedAt ?? 0));
    return groups;
}

export function hasActiveTaskForUserMessage(
    taskToConversation: Map<string, QaapConversationTaskRef>,
    conversationId: string,
    userMessageId: string,
    exceptTaskId: string,
): boolean {
    for (const [taskId, ref] of taskToConversation) {
        if (taskId !== exceptTaskId
            && ref.conversationId === conversationId
            && ref.userMessageId === userMessageId) {
            return true;
        }
    }
    return false;
}

export function finalizeTurnContextUsage(
    conv: QaapAgentConversation,
    taskId: string,
    agentStreamByTaskId: Map<string, QaapAgentStreamAccumulator>,
): QaapAgentConversation {
    let next = conv;
    const stream = agentStreamByTaskId.get(taskId);
    const turnUsage = stream?.getTurnUsage?.();
    if (turnUsage) {
        next = {
            ...next,
            contextUsage: turnUsage,
            contextUsageEstimated: undefined,
        };
    }
    if (totalTokensFromContextUsage(next.contextUsage) === 0) {
        const estimated = estimateConversationTokensFromMessages(next.messages, next.contextPreamble);
        if (estimated > 0) {
            next = { ...next, contextUsageEstimated: true };
        }
    }
    return {
        ...next,
        contextWindowSize: next.contextWindowSize ?? DEFAULT_QAAP_CONTEXT_WINDOW,
    };
}

export function ensureAgentStream(
    taskId: string,
    agentId: string,
    agentStreamByTaskId: Map<string, QaapAgentStreamAccumulator>,
): QaapAgentStreamAccumulator | undefined {
    let stream = agentStreamByTaskId.get(taskId);
    if (!stream) {
        stream = createAgentStreamAccumulator(agentId);
        if (stream) {
            agentStreamByTaskId.set(taskId, stream);
        }
    }
    return stream;
}

export function ensureAgUiStream(
    taskId: string,
    agentId: string,
    agUiStreamByTaskId: Map<string, QaapCliAgUiStreamEmitter>,
): QaapCliAgUiStreamEmitter {
    let emitter = agUiStreamByTaskId.get(taskId);
    if (!emitter) {
        const created = createAgUiCliStreamEmitter(agentId);
        if (!created) {
            throw new Error(`No AG-UI CLI stream emitter for agent: ${agentId}`);
        }
        emitter = created;
        agUiStreamByTaskId.set(taskId, emitter);
    }
    return emitter;
}

export function buildContextCompactionSummary(messages: readonly QaapAgentMessage[]): string {
    const lines: string[] = [
        'Automatic context compaction summary. Use this as the authoritative memory for earlier turns.',
    ];
    let lastRole: 'User' | 'Assistant' | undefined;
    for (const message of messages) {
        const body = contextCompactionMessageTextHelper(message);
        if (!body) {
            continue;
        }
        const role = message.role === 'user' ? 'User' : 'Assistant';
        const prefix = role === lastRole ? '-' : `${role}:`;
        lines.push(`${prefix} ${body}`);
        lastRole = role;
        if (lines.join('\n').length > 5_500) {
            lines.push('…');
            break;
        }
    }
    return lines.join('\n');
}

export function countDurableLoopSpawns(
    conv: QaapAgentConversation,
    rootUserMessageId: string,
    record: QaapPersistedWorkflowRun | undefined,
): number {
    const trace = record?.trace ?? [];
    const fallbackTraceCount = trace.filter(entry => entry.outcome === 'retry:model').length;
    const continueTraceCount = trace.filter(entry => entry.outcome === 'continue:auto').length;
    const uniqueTriedModels = new Set(readTriedFallbackModelsHelper(record)).size;
    const fallbackArtifactCount = Math.max(0, uniqueTriedModels - 1);
    const projectedContinueCount = countAutoContinueAttemptsHelper(conv, rootUserMessageId);
    return Math.max(fallbackTraceCount, fallbackArtifactCount)
        + Math.max(continueTraceCount, projectedContinueCount);
}

// ─── DI-extracted methods (third pass) ───────────────────────────────────────

export interface AutoContinueDeps {
    resolveLoopBudgetKey(conv: QaapAgentConversation, userMessageId: string): string;
    countAutoContinueAttempts(conv: QaapAgentConversation, rootUserMessageId: string): number;
    hasLoopSpawnBudget(rootUserMessageId: string): boolean;
    recordLoopSpawn(rootUserMessageId: string): void;
    postAutoContinueMessage(conversationId: string, prompt: string, conv: QaapAgentConversation, rootUserMessageId: string, turnAgentId: string, turnAgentModel: QaapAgentMessage['turnAgentModel']): void;
    reportPreviewBootstrapFailure(conversationId: string, reason: string): void;
}

export function maybeAutoContinueIncompleteTurn(
    conversationId: string,
    conv: QaapAgentConversation,
    userMessageId: string,
    agentMessageId: string | undefined,
    turnAgentId: string | undefined,
    deps: AutoContinueDeps,
): void {
    if (!QAAP_AGENT_AUTO_CONTINUE_ENABLED) {
        return;
    }
    const userMessage = conv.messages.find(message => message.id === userMessageId);
    const agentMessage = agentMessageId
        ? conv.messages.find(message => message.id === agentMessageId)
        : [...conv.messages].reverse().find(message =>
            message.role === 'agent' && message.runUserMessageId === userMessageId
        );
    if (!userMessage || !agentMessage || agentMessage.role !== 'agent' || conv.status !== 'idle') {
        return;
    }
    const resolvedTurnAgentId = turnAgentId ?? userMessage.turnAgentId ?? conv.agentId;
    // Only auto-continue in the fully-autonomous agent contract. plan/ask modes and
    // request-approval / manual-approve turns are deliberate stops the user opted into —
    // re-posting a "keep working" prompt there contradicts the chosen interaction mode.
    if (!autoContinueAllowedForInteraction(conv)) {
        return;
    }
    if (!isIncompleteAgentTurn(userMessage.content, agentMessage)) {
        return;
    }
    const rootUserMessageId = deps.resolveLoopBudgetKey(conv, userMessageId);
    const rootUserMessage = conv.messages.find(message => message.id === rootUserMessageId && message.role === 'user') ?? userMessage;
    const attempts = deps.countAutoContinueAttempts(conv, rootUserMessageId);
    if (attempts >= 2 || !deps.hasLoopSpawnBudget(rootUserMessageId)) {
        if (attempts >= 2 && messageRequestsDevPreview(rootUserMessage.content)) {
            deps.reportPreviewBootstrapFailure(conversationId, buildDevPreviewAutoContinueExhaustedReason());
        }
        return;
    }
    deps.recordLoopSpawn(rootUserMessageId);
    try {
        deps.postAutoContinueMessage(
            conversationId,
            buildAgentAutoContinuePrompt(rootUserMessage.content),
            conv,
            rootUserMessageId,
            resolvedTurnAgentId,
            userMessage.turnAgentModel,
        );
    } catch {
        /* turn already replaced or cancelled */
    }
}

// ─── DI-extracted: prepareContextCompactionForTurn (3 this. refs) ────────────

export interface PrepareContextCompactionForTurnDeps {
    conversations: Map<string, QaapAgentConversation>;
    fire(event: QaapAgentConversationEvent): void;
    buildContextCompactionSummary(messages: readonly QaapAgentMessage[]): string;
}

export function prepareContextCompactionForTurn(
    conv: QaapAgentConversation,
    deps: PrepareContextCompactionForTurnDeps,
): QaapAgentConversation {
    if (conv.messages.length < 6 || !shouldCompressConversationPrompt(conv.messages, conv.contextPreamble, conv.contextWindowSize)) {
        return conv;
    }
    const lastUser = conv.messages[conv.messages.length - 1];
    if (lastUser?.role !== 'user') {
        return conv;
    }
    const history = conv.messages.slice(0, -1);
    const { compressed } = partitionConversationHistory(history);
    if (compressed.length === 0) {
        return conv;
    }
    const existing = conv.contextCompaction;
    if (existing?.status === 'complete' && existing.compactedMessageCount >= compressed.length && existing.summary?.trim()) {
        return conv;
    }
    const now = Date.now();
    const running: QaapContextCompaction = {
        status: 'running',
        startedAt: now,
        compactedMessageCount: compressed.length,
        sourceMessageCount: conv.messages.length,
    };
    const withRunning: QaapAgentConversation = {
        ...conv,
        contextCompaction: running,
        updatedAt: now,
    };
    deps.conversations.set(conv.id, withRunning);
    deps.fire({ type: 'updated', conversation: toConversationSummary(withRunning) });

    return {
        ...withRunning,
        contextCompaction: {
            ...running,
            status: 'complete',
            summary: deps.buildContextCompactionSummary(compressed),
            completedAt: Date.now(),
        },
        contextUsageEstimated: true,
        contextWindowSize: conv.contextWindowSize ?? DEFAULT_QAAP_CONTEXT_WINDOW,
        updatedAt: Date.now(),
    };
}

// ─── DI-extracted: sweepZombieStreamingTurns + forceStopZombieTurn ───────────

export interface SweepZombieStreamingTurnsDeps {
    conversations: Map<string, QaapAgentConversation>;
    turnHasPendingApproval(conv: QaapAgentConversation): boolean;
    forceStopZombieTurn(conversationId: string, elapsedMs: number, maxTurnMinutes: number): boolean;
    getActiveTaskIdsForConversation(conversationId: string): readonly string[];
    interruptStreamingTurnForRestart(conversationId: string, nowMs: number): boolean;
    flushPersist(): void;
}

export function sweepZombieStreamingTurns(
    nowMs: number,
    options: { readonly resetSurvivorsToIdle?: boolean } | undefined,
    deps: SweepZombieStreamingTurnsDeps,
): boolean {
    const maxTurnMinutes = resolveQaapMaxTurnMinutes(process.env[QAAP_MAX_TURN_MINUTES_ENV]);
    const streaming: QaapStreamingTurnSnapshot[] = [];
    for (const conv of deps.conversations.values()) {
        if (conv.status !== 'streaming') {
            continue;
        }
        // A turn paused on a pending approval is NOT a zombie — the user is being asked to
        // approve a tool. Force-failing it at the watchdog with a misleading "exceeded max time"
        // message punishes a present user who simply took a while to decide; the task idle-timer
        // already makes the same exception. Pending requests only exist while the runner is up,
        // so a stale post-restart turn (runner empty) is still reset/finalized normally. (REL-5)
        if (deps.turnHasPendingApproval(conv)) {
            continue;
        }
        const streamingSinceMs = resolveStreamingSinceMs(conv);
        if (streamingSinceMs !== undefined) {
            streaming.push({ conversationId: conv.id, streamingSinceMs });
        }
    }
    const expiredIds = new Set(findExpiredStreamingTurns(streaming, nowMs, maxTurnMinutes));
    let changed = false;
    for (const turn of streaming) {
        if (expiredIds.has(turn.conversationId)) {
            if (deps.forceStopZombieTurn(turn.conversationId, nowMs - turn.streamingSinceMs, maxTurnMinutes)) {
                changed = true;
            }
        } else if (options?.resetSurvivorsToIdle) {
            // A turn auto-resumed earlier in the same restore now owns a live task, so it is no
            // longer a zombie — leave it running instead of interrupting it. (taskToConversation
            // starts empty on boot, so only just-resumed turns have an entry here.)
            if (deps.getActiveTaskIdsForConversation(turn.conversationId).length > 0) {
                continue;
            }
            if (deps.interruptStreamingTurnForRestart(turn.conversationId, nowMs)) {
                changed = true;
            }
        }
    }
    if (changed) {
        deps.flushPersist();
    }
    return changed;
}

export interface ForceStopZombieTurnDeps {
    conversations: Map<string, QaapAgentConversation>;
    taskToConversation: Map<string, { agentMessageId?: string }>;
    taskRunner: { cancel(taskId: string): void; list(): readonly QaapAgentTask[] };
    appendRunCancelledTrace(conv: QaapAgentConversation, agentMessageId: string | undefined, reason: string): QaapAgentConversation;
    finalizeStreamingAgentMessage(conv: QaapAgentConversation, agentMessageId: string | undefined, reason: string): QaapAgentConversation;
    markTurnFailed(conv: QaapAgentConversation, info: { userMessageId: string; agentMessageId: string | undefined; reason: string }): { conv: QaapAgentConversation; agentMessageId?: string };
    publishFinalizedAgentMessage(conversationId: string, conv: QaapAgentConversation, agentMessageId: string | undefined): void;
    fire(event: QaapAgentConversationEvent): void;
}

export function forceStopZombieTurn(
    conversationId: string,
    elapsedMs: number,
    maxTurnMinutes: number,
    deps: ForceStopZombieTurnDeps,
): boolean {
    const conv = deps.conversations.get(conversationId);
    if (!conv || conv.status !== 'streaming') {
        return false;
    }
    const reason = buildQaapTurnWatchdogMessage(elapsedMs);
    const lastUser = [...conv.messages].reverse().find(message => message.role === 'user' && message.taskId);
    const turnRef = lastUser?.taskId ? deps.taskToConversation.get(lastUser.taskId) : undefined;
    if (lastUser?.taskId) {
        deps.taskRunner.cancel(lastUser.taskId);
        for (const subtask of collectSubtasksForLeader(lastUser.taskId, deps.taskRunner.list())) {
            if (subtask.state === 'running') {
                deps.taskRunner.cancel(subtask.id);
            }
        }
    }
    // Re-read: cancelling the task above can synchronously settle it through the normal
    // task-outcome path first (generic "Turn cancelled." reason) — our watchdog message
    // below is the one that should stick, so it must be layered on top of the latest state.
    const latest = deps.conversations.get(conversationId) ?? conv;
    const agentMessageId = turnRef?.agentMessageId
        ?? (latest.messages[latest.messages.length - 1]?.role === 'agent'
            ? latest.messages[latest.messages.length - 1].id
            : undefined);
    const withTrace = deps.appendRunCancelledTrace(latest, agentMessageId, reason);
    const finalized = deps.finalizeStreamingAgentMessage(withTrace, agentMessageId, reason);
    const failed = deps.markTurnFailed(finalized, {
        userMessageId: lastUser?.id ?? latest.messages[latest.messages.length - 1]?.id ?? '',
        agentMessageId,
        reason,
    });
    const resolvedAgentMessageId = failed.agentMessageId ?? agentMessageId;
    const next: QaapAgentConversation = { ...failed.conv, updatedAt: Date.now() };
    deps.conversations.set(conversationId, next);
    deps.publishFinalizedAgentMessage(conversationId, next, resolvedAgentMessageId);
    deps.fire({ type: 'updated', conversation: toConversationSummary(next) });
    console.warn(
        `[qaap-agent-conversation-watchdog] auto-stopped conversation ${conversationId} `
        + `after ${elapsedMs}ms streaming (max ${maxTurnMinutes}m).`,
    );
    return true;
}

// ─── DI-extracted: applyAccumulatorStructuredOutput (6 this. refs) ────────────

export interface ApplyAccumulatorStructuredOutputDeps {
    conversations: Map<string, QaapAgentConversation>;
    agentStreamByTaskId: Map<string, QaapAgentStreamAccumulator>;
    taskToConversation: Map<string, QaapConversationTaskRef>;
    fireAgentMessageWireUpdate(conversationId: string, cwd: string, agentId: string, message: QaapAgentMessage): void;
    fire(event: QaapAgentConversationEvent): void;
    schedulePersist(): void;
}

export function applyAccumulatorStructuredOutput(
    taskId: string,
    ref: QaapConversationTaskRef,
    agentId: string,
    deps: ApplyAccumulatorStructuredOutputDeps,
): void {
    const conv = deps.conversations.get(ref.conversationId);
    const stream = deps.agentStreamByTaskId.get(taskId);
    if (!conv || !stream) {
        return;
    }
    const segments = [...stream.getSegments()];
    const content = stream.getDisplayText();
    const now = Date.now();
    const existingAgentMessage = ref.agentMessageId
        ? conv.messages.find(message => message.id === ref.agentMessageId)
        : undefined;
    const traceEvents = mergeAccumulatorTraceEvents(existingAgentMessage?.traceEvents, stream);
    if (!content && segments.length === 0 && traceEvents.length === 0) {
        return;
    }
    let agentMessageId = ref.agentMessageId;
    let messages: QaapAgentMessage[];
    if (!agentMessageId) {
        agentMessageId = randomUUID();
        ref.agentMessageId = agentMessageId;
        deps.taskToConversation.set(taskId, ref);
        const message: QaapAgentMessage = preferTraceFirstAgentMessageStorage(materializeAgentMessageForApi({
            id: agentMessageId,
            role: 'agent',
            content: content || '…',
            segments,
            ...(traceEvents ? { traceEvents } : {}),
            createdAt: now,
            /** See the sibling creation site: the run this message belongs to. */
            runUserMessageId: ref.userMessageId,
            /** See the sibling creation site: live-run marker for the per-run stop. */
            runActive: true,
        }));
        messages = [...conv.messages, message];
        deps.fireAgentMessageWireUpdate(conv.id, conv.cwd, agentId, message);
    } else {
        messages = conv.messages.map(message => message.id === agentMessageId
            ? preferTraceFirstAgentMessageStorage(materializeAgentMessageForApi({
                ...message,
                content: content || message.content,
                segments: segments.length > 0 ? segments : message.segments,
                ...(traceEvents ? { traceEvents } : {}),
            }))
            : message
        );
        const updated = messages.find(message => message.id === agentMessageId);
        if (updated) {
            deps.fireAgentMessageWireUpdate(conv.id, conv.cwd, agentId, updated);
        }
    }
    const next: QaapAgentConversation = {
        ...conv,
        status: 'streaming',
        updatedAt: now,
        messages,
        ...(totalTokensFromContextUsage(conv.contextUsage) === 0 ? { contextUsageEstimated: true } : {}),
        contextWindowSize: conv.contextWindowSize ?? DEFAULT_QAAP_CONTEXT_WINDOW,
    };
    deps.conversations.set(conv.id, next);
    deps.fire({ type: 'updated', conversation: toConversationSummary(next) });
    deps.schedulePersist();
}

// ─── DI-extracted: fireAgentMessageWireUpdate (4 this. refs) ─────────────────

export interface FireAgentMessageWireUpdateDeps {
    lastWireMessageById: Map<string, QaapAgentMessageWireSnapshot>;
    stageWireMetricsBaseline(conversationId: string, messageId: string, event: QaapAgentConversationEvent): void;
    fire(event: QaapAgentConversationEvent): void;
}

export function fireAgentMessageWireUpdate(
    conversationId: string,
    cwd: string,
    agentId: string,
    message: QaapAgentMessage,
    options: { forceFullMessage?: boolean } | undefined,
    deps: FireAgentMessageWireUpdateDeps,
): void {
    const snapshot = toAgentMessageWireSnapshot(message);
    if (options?.forceFullMessage) {
        deps.lastWireMessageById.set(message.id, snapshot);
        const wireMessage = {
            type: 'message' as const,
            conversationId,
            cwd,
            message,
        };
        deps.stageWireMetricsBaseline(conversationId, message.id, wireMessage);
        deps.fire({
            ...wireMessage,
            message: compressAgentMessageForWire(toAgentMessageWirePayload(message)),
        });
        return;
    }
    const previous = deps.lastWireMessageById.get(message.id);
    const delta = computeAgentMessageWireDelta(previous, snapshot, agentId);
    if (delta.kind === 'noop') {
        return;
    }
    deps.lastWireMessageById.set(message.id, snapshot);
    if (delta.kind === 'message_start' || delta.kind === 'replace') {
        const wireMessage = {
            type: 'message' as const,
            conversationId,
            cwd,
            message: delta.message,
        };
        deps.stageWireMetricsBaseline(conversationId, message.id, wireMessage);
        deps.fire({
            ...wireMessage,
            message: compressAgentMessageForWire(delta.message),
        });
        return;
    }
    const wireDelta = {
        type: 'message_delta' as const,
        conversationId,
        cwd,
        messageId: message.id,
        delta,
    };
    deps.stageWireMetricsBaseline(conversationId, message.id, wireDelta);
    deps.fire({
        ...wireDelta,
        delta: compressAgentMessageWireDeltaForWire(delta),
    });
}
