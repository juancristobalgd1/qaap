// Extracted from qaap-agent-conversation-store.ts
import { buildAgentClosingReport, shouldSurfaceAgentClosingReport, type QaapAgentClosingDiffSummary, type QaapAgentClosingReport } from '../common/qaap-agent-closing-report';
import type { QaapAgentConversationStoreContext } from './qaap-agent-conversation-store-context';

import { QaapAgentConversation, QaapAgentMessage, QaapAgentTurnVerdict, QaapConversationCheckpoint, toConversationSummary } from '../common/qaap-agent-conversation';

import { usesAgUiCliTranscriptStream, usesStructuredAgentTranscript } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';

import { isHostedCodexUsage } from '../common/qaap-billing-plans';

import { QaapPlanLimit } from '@theia/qaap-adapters/lib/common/qaap-plan-limit';

import { isQaiqProviderKeyMissingFailure, localizeAgentFailureMessage, resolveAgentTurnFailureMessage } from '@theia/qaap-shared-core/lib/common/qaap-agent-failure-message';

import { resolveAgentLogDisplayText } from '@theia/qaap-shared-core/lib/common/qaap-cli-transcript-stream';

import { resolveChatTurnOutcome } from '../common/qaap-chat-turn-workflow';

import type { QaapWorkflowNodeOutcome } from '../common/qaap-workflow-ir';

import type { QaapAgentTask } from '../common/qaap-agent-task';

import { buildAgentMessageFromAgUiStructuredLog } from '@theia/qaap-shared-core/lib/common/qaap-ag-ui-transcript-adapter';

import { agentTurnHasRetryableToolSupportFailure } from '../common/qaap-agent-model-fallback';

import { agentMessageHasStructuredTrace, isPlaceholderAgentContent, syncSettledTraceEventsOnMessage } from '@theia/qaap-transcript/lib/common/qaap-transcript-trace-lifecycle';

import { materializeAgentMessageForApi } from '@theia/qaap-shared-core/lib/common/qaap-transcript-trace-backfill';

import { resolveStructuredParsedTraceEvents as resolveStructuredParsedTraceEventsHelper } from './qaap-agent-conversation-store-utils';

import { agentVisibleLog, applyAccumulatorStructuredOutput as applyAccumulatorStructuredOutputHelper } from './qaap-agent-conversation-store-helpers';

import { type QaapConversationTaskRef } from './qaap-agent-conversation-store-constants';
import { publishDiscardCheckpointAfterExit } from './qaap-agent-conversation-store-pre-turn-checkpoint';

export function applyAccumulatorStructuredOutputExtracted(ctx: QaapAgentConversationStoreContext, taskId: string,
    ref: QaapConversationTaskRef,
    agentId: string, ): void {
    applyAccumulatorStructuredOutputHelper(taskId, ref, agentId, {
        conversations: ctx.conversations,
        agentStreamByTaskId: ctx.agentStreamByTaskId,
        taskToConversation: ctx.taskToConversation,
        fireAgentMessageWireUpdate: (cid, cwd, aid, msg) => ctx.fireAgentMessageWireUpdate(cid, cwd, aid, msg),
        fire: e => ctx.fire(e),
        schedulePersist: () => ctx.schedulePersist(),
    });
}

export function backfillAgentMessageFromStructuredLogExtracted(ctx: QaapAgentConversationStoreContext, message: QaapAgentMessage,
    agentId: string,
    log: string, ): QaapAgentMessage {
    if (message.role !== 'agent'
        || agentMessageHasStructuredTrace(message)
        || (message.segments?.length ?? 0) > 0
        || !isPlaceholderAgentContent(message.content)) {
        return message;
    }
    const parsed = ctx.parseStructuredLog(agentId, log);
    if (parsed?.segments?.length || parsed?.traceEvents?.length) {
        return materializeAgentMessageForApi({
            ...message,
            content: parsed.content || message.content,
            segments: parsed.segments,
            traceEvents: ctx.resolveStructuredParsedTraceEvents(message, parsed),
        });
    }
    const replayed = buildAgentMessageFromAgUiStructuredLog(agentId, message.id, message.createdAt, log);
    if (replayed?.traceEvents?.length) {
        return materializeAgentMessageForApi({
            ...message,
            content: replayed.content || message.content,
            traceEvents: replayed.traceEvents,
        });
    }
    if (parsed?.content?.trim()) {
        return { ...message, content: parsed.content };
    }
    return message;
}

export function resolveStructuredParsedTraceEventsExtracted(ctx: QaapAgentConversationStoreContext, message: QaapAgentMessage,
    parsed: {
        segments?: QaapAgentMessage['segments'];
        traceEvents?: QaapAgentMessage['traceEvents'];
    }, ): QaapAgentMessage['traceEvents'] {
    return resolveStructuredParsedTraceEventsHelper(message, parsed);
}

/** Diff stats + checkpoint captured for a delivered turn (git side of the settle). */
interface QaapTurnGitState {
    readonly gitStats?: { added: number; removed: number; files?: number };
    readonly checkpoint?: QaapConversationCheckpoint;
}

/**
 * Same git sequence as before (numstat diff, then the throwaway-index checkpoint), but async and
 * serialized per repository so two settles (peer runs) or a concurrent rewind never interleave.
 * Failures are non-fatal: a turn without stats/checkpoint still settles.
 */
async function captureTurnGitState(ctx: QaapAgentConversationStoreContext, conversationId: string,
    userMessageId: string, startSha: string | undefined): Promise<QaapTurnGitState | undefined> {
    const conv = ctx.conversations.get(conversationId);
    if (!conv) {
        return undefined;
    }
    const cwd = conv.cwd;
    const userMessage = conv.messages.find(m => m.id === userMessageId);
    const label = userMessage ? ctx.checkpointLabel(userMessage.content ?? '') : 'Turn';
    try {
        return await ctx.runSerializedGit(cwd, async () => {
            const gitStats = await ctx.computeGitDiffStats(cwd, startSha);
            const checkpoint = await ctx.captureCheckpoint(cwd, conversationId, userMessageId, label, gitStats);
            return { gitStats, checkpoint };
        });
    } catch {
        return undefined;
    }
}

/**
 * Hand the settle-time facts the runner cannot see — this turn's diff and the blocked signal — to
 * the runner, which re-folds the task's closing report. Returns the latest task, or undefined when
 * the runner keeps no report for it.
 */
function recordClosingReportFacts(ctx: QaapAgentConversationStoreContext, taskId: string,
    diff: QaapAgentClosingDiffSummary | undefined, blockedNeed: string | undefined): QaapAgentTask | undefined {
    let latest: QaapAgentTask | undefined;
    if (diff) {
        latest = ctx.taskRunner.recordTaskClosingDiff?.(taskId, diff);
    }
    if (blockedNeed !== undefined) {
        latest = ctx.taskRunner.markTaskBlocked(taskId, blockedNeed) ?? latest;
    }
    return latest;
}

/** The checkpoint was captured ahead of the tool-support reroute; drop its ref so it does not leak. */
function discardUnrecordedCheckpoint(ctx: QaapAgentConversationStoreContext, cwd: string, checkpoint: QaapConversationCheckpoint | undefined): void {
    if (!checkpoint) {
        return;
    }
    void ctx.runSerializedGit(cwd, () => ctx.discardCheckpointRef(cwd, checkpoint.ref)).catch(() => undefined);
}

export async function applyTaskOutcomeExtracted(ctx: QaapAgentConversationStoreContext, ref: QaapConversationTaskRef,
    task: QaapAgentTask, ): Promise<QaapWorkflowNodeOutcome> {
    const { conversationId, userMessageId, agentMessageId, turnAgentId, startSha } = ref;
    const convSnapshot = ctx.conversations.get(conversationId);
    if (!convSnapshot) {
        return resolveChatTurnOutcome(task.state);
    }
    // Defense-in-depth: a newer task may have superseded this one — but only when it took
    // over the SAME user turn (that is what the model-fallback retry does). Peer runs started
    // by the user carry a different user message and are not superseding anything, so with
    // in-session multitasking "some other task is active" can no longer mean "stale".
    if (ctx.hasActiveTaskForUserMessage(conversationId, userMessageId, task.id)) {
        ctx.agentStreamByTaskId.delete(task.id);
        ctx.agUiStreamByTaskId.delete(task.id);
        return resolveChatTurnOutcome(task.state);
    }
    const usageFinalized = ctx.finalizeTurnContextUsage(convSnapshot, task.id, turnAgentId);
    ctx.agentStreamByTaskId.delete(task.id);
    ctx.agUiStreamByTaskId.delete(task.id);
    if (
        task.ownerLogin
        && ctx.billingStore
        && usageFinalized.contextUsage
        && !usageFinalized.contextUsageEstimated
    ) {
        const modelId = task.agentModel?.modelId ?? task.qaiqModel?.modelId;
        const usesUserCodexSession = ctx.taskRunner?.isAgentConnected?.(turnAgentId, task.ownerLogin) === true;
        if (isHostedCodexUsage(turnAgentId, modelId) && !usesUserCodexSession) {
            void ctx.billingStore.debitHostedUsage(
                task.ownerLogin,
                modelId!,
                usageFinalized.contextUsage.inputTokens,
                usageFinalized.contextUsage.outputTokens,
            ).catch(() => undefined);
        }
    }
    const conv = ctx.conversations.get(conversationId);
    if (!conv) {
        return resolveChatTurnOutcome(task.state);
    }
    let withUsageBaseline: QaapAgentConversation = {
        ...conv,
        contextUsage: usageFinalized.contextUsage,
        contextUsageEstimated: usageFinalized.contextUsageEstimated,
        contextWindowSize: usageFinalized.contextWindowSize,
    };
    // The turn watchdog stops a run as `interrupted` and records its own timeout reason and trace
    // right after this synchronous settle; the run otherwise settles like a stop (no fallback model,
    // no failure reason derived from the log). No await may precede this check: the watchdog's
    // marker is only set while its synchronous cancel() runs and is cleared right after.
    const pausedByWatchdog = task.state === 'interrupted' && ctx.turnWatchdogPausedTaskIds.has(task.id);
    if (task.state === 'cancelled' || pausedByWatchdog) {
        const cancelledReason = 'Turn cancelled.';
        const withCancelledTrace = pausedByWatchdog
            ? withUsageBaseline
            : ctx.appendRunCancelledTrace(withUsageBaseline, agentMessageId, cancelledReason);
        const finalized = ctx.finalizeStreamingAgentMessage(withCancelledTrace, agentMessageId, cancelledReason);
        const next: QaapAgentConversation = {
            ...finalized,
            status: ctx.settleStatusForRun(conversationId, task.id, 'idle'),
            updatedAt: Date.now(),
        };
        ctx.publishFinalizedAgentMessage(conversationId, next, agentMessageId, turnAgentId);
        // Do not auto-synthesize after a cancelled leader — that would spawn a new turn
        // right after the user hit Stop (and feels like cancel "did nothing").
        ctx.conversations.set(conversationId, next);
        ctx.fire({ type: 'updated', conversation: toConversationSummary(next) });
        ctx.flushPersist();
        ctx.pendingTeamSynthesisForLeader.delete(task.id);
        // Drain any user messages that were queued (delivery mode 'queue') while the agent
        // was running. The cancelled turn settled to 'idle', so the queue can now flush.
        if (next.status === 'idle') {
            ctx.drainPendingMessages(conversationId);
        }
        ctx.notifyGoalLoopTurnSettled({ conversationId, userMessageId, task, outcome: 'cancelled' });
        // Offer "Discard changes" only once the stopping agent can no longer write.
        void publishDiscardCheckpointAfterExit(ctx, conversationId, userMessageId, [task.id])
            .catch(error => console.warn('[qaap-agent-conversation-store] failed to publish the discard checkpoint:', error));
        return 'blocked';
    }
    const detail = await ctx.taskRunner.detail(task.id);
    // The reply is the agent's own output: post-agent phases (reviewer, verification command) append to
    // this same log, and their text must neither decide the outcome nor appear in the transcript.
    const rawLog = ctx.filterAgentLogChunk((detail?.log ?? '').trim());
    const log = agentVisibleLog(rawLog);
    const postAgentOutputDropped = log !== rawLog;
    // 'completed_with_warnings' (clean exit, verification still red) is a delivered turn:
    // it takes the success path below — with a warning trace instead of the failure flow.
    // Exception: CLI blocking failures that still exit 0 — auth/session (Sign-in card),
    // and quota/rate-limit (Task failed dialog). Antigravity often prints a plain
    // "Individual quota reached…" line and exits 0; never treat that as success.
    const completedAuthFailureReason = (task.state === 'completed' || task.state === 'completed_with_warnings')
        ? ctx.resolveCompletedTurnAuthFailureReason(log, turnAgentId)
        : undefined;
    const deliveredTurn = (task.state === 'completed' || task.state === 'completed_with_warnings') && !completedAuthFailureReason;
    // Diff stats + checkpoint run BEFORE the re-read below, as async git on the per-repository
    // chain: a settle must never block the shared backend, and everything after the re-read
    // stays synchronous so no peer-run write can land between the baseline and the final set.
    const turnGit = deliveredTurn
        ? await captureTurnGitState(ctx, conversationId, userMessageId, startSha)
        : undefined;
    // Re-read across the awaits: with in-session multitasking a PEER run can stream into this
    // same conversation while we wait for the task detail / git, and everything below derives
    // what it writes back from this baseline. Keeping the pre-await snapshot would silently drop
    // the other agent's output (read-modify-write over one shared conversation record).
    const latest = ctx.conversations.get(conversationId);
    if (!latest) {
        return resolveChatTurnOutcome(task.state);
    }
    withUsageBaseline = {
        ...latest,
        contextUsage: usageFinalized.contextUsage,
        contextUsageEstimated: usageFinalized.contextUsageEstimated,
        contextWindowSize: usageFinalized.contextWindowSize,
    };
    const streamingAgent = agentMessageId
        ? withUsageBaseline.messages.find(message => message.id === agentMessageId)
        : undefined;
    const skipLogReparse = agentMessageHasStructuredTrace(streamingAgent)
        || (usesStructuredAgentTranscript(turnAgentId) && (
            (streamingAgent?.segments?.length ?? 0) > 0
            || (streamingAgent?.traceEvents?.length ?? 0) > 0
        ));
    const structuredParsed = log && !skipLogReparse ? ctx.parseStructuredLog(turnAgentId, log) : undefined;
    if (!deliveredTurn) {
        let convForFailure = withUsageBaseline;
        let agentMessageForFailure = streamingAgent;
        if (agentMessageId && log && streamingAgent?.role === 'agent' && !agentMessageHasStructuredTrace(streamingAgent)) {
            const backfilled = materializeAgentMessageForApi(syncSettledTraceEventsOnMessage(
                ctx.backfillAgentMessageFromStructuredLog(streamingAgent, turnAgentId, log),
            ));
            agentMessageForFailure = backfilled;
            convForFailure = {
                ...withUsageBaseline,
                messages: withUsageBaseline.messages.map(message => message.id === agentMessageId
                    ? backfilled
                    : message),
            };
        }
        // The task marker covers live refusals; the log line covers a task restored without it.
        if (!isQaiqProviderKeyMissingFailure(log) && await ctx.maybeRetryTurnWithFallback(
            conversationId,
            userMessageId,
            agentMessageId,
            task,
            convForFailure,
            agentMessageForFailure,
            turnAgentId,
            startSha,
        )) {
            // A successful graph retry stole the task claim; an imperative degradation leaves
            // the old run terminally failed. Either way, a remaining claim must not say success.
            return 'fail';
        }
        // A billing/plan denial is written to the log with a machine-readable tag; keep it verbatim so the
        // transcript card can offer Upgrade/Top up instead of a generic quota message.
        const planLimitReason = log && QaapPlanLimit.parse(log) ? log.trim().split('\n')[0] : undefined;
        const reason = completedAuthFailureReason ?? planLimitReason ?? resolveAgentTurnFailureMessage(log, {
            state: task.state === 'interrupted' ? 'interrupted' : 'failed',
            exitCode: task.exitCode,
            agentMessage: agentMessageForFailure,
            agentId: turnAgentId,
        });
        const failureBody = log ? resolveAgentLogDisplayText(turnAgentId, log) : '';
        const failed = ctx.markTurnFailed(convForFailure, {
            userMessageId,
            agentMessageId,
            reason,
            failureBody,
            status: ctx.settleStatusForRun(conversationId, task.id, 'failed'),
        });
        const resolvedAgentMessageId = failed.agentMessageId ?? agentMessageId;
        const finalized = ctx.finalizeStreamingAgentMessage(failed.conv, resolvedAgentMessageId, reason);
        ctx.publishFinalizedAgentMessage(conversationId, finalized, resolvedAgentMessageId, turnAgentId);
        ctx.finishLeaderTurnAndMaybeSynthesize(conversationId, task.id, finalized);
        // Drain queued messages even on failure — the conversation is in 'failed' status which
        // can accept follow-ups, and the user may have queued a "try a different approach" message.
        if (finalized.status === 'failed' || finalized.status === 'idle') {
            ctx.drainPendingMessages(conversationId);
        }
        ctx.notifyGoalLoopTurnSettled({ conversationId, userMessageId, task, outcome: 'failed', detail: reason });
        return 'fail';
    }
    let withReply: QaapAgentConversation;
    if (agentMessageId && structuredParsed) {
        const messages = withUsageBaseline.messages.map(message => message.id === agentMessageId
            ? syncSettledTraceEventsOnMessage({
                ...message,
                content: structuredParsed.content || message.content,
                segments: structuredParsed.segments,
                traceEvents: ctx.resolveStructuredParsedTraceEvents(message, structuredParsed),
            })
            : message
        );
        withReply = {
            ...withUsageBaseline,
            status: ctx.settleStatusForRun(conversationId, task.id, 'idle'),
            updatedAt: Date.now(),
            messages,
        };
    } else if (agentMessageId) {
        const messages = withUsageBaseline.messages.map(message => {
            if (message.id !== agentMessageId || message.role !== 'agent') {
                return message;
            }
            const backfilled = log
                ? ctx.backfillAgentMessageFromStructuredLog(message, turnAgentId, log)
                : message;
            let settled = backfilled;
            if (postAgentOutputDropped) {
                // The live stream already wrote the reviewer's text into this message; rebuild the reply
                // from the agent-only log so the settled transcript never shows review output as the reply.
                const agentReply = resolveAgentLogDisplayText(turnAgentId, log).trim();
                if (agentReply) {
                    settled = { ...settled, content: agentReply };
                }
            }
            if (log && usesAgUiCliTranscriptStream(turnAgentId)
                && !agentMessageHasStructuredTrace(settled)
                && (settled.segments?.length ?? 0) === 0) {
                const replayed = buildAgentMessageFromAgUiStructuredLog(
                    turnAgentId, message.id, message.createdAt, log,
                );
                if (replayed?.traceEvents?.length) {
                    settled = materializeAgentMessageForApi({
                        ...settled,
                        content: replayed.content || settled.content,
                        traceEvents: replayed.traceEvents,
                    });
                }
            }
            return materializeAgentMessageForApi(syncSettledTraceEventsOnMessage(settled));
        });
        withReply = {
            ...withUsageBaseline,
            status: ctx.settleStatusForRun(conversationId, task.id, 'idle'),
            updatedAt: Date.now(),
            messages,
        };
    } else {
        const displayText = log ? resolveAgentLogDisplayText(turnAgentId, log) : '';
        const body = structuredParsed?.content?.trim() || displayText || '(agent produced no output)';
        const reply = ctx.appendAgentReply(
            { ...withUsageBaseline, status: ctx.settleStatusForRun(conversationId, task.id, 'idle') },
            body,
            userMessageId,
        );
        if (structuredParsed?.segments?.length) {
            const messages = reply.messages.map((message, index, all) => {
                if (index === all.length - 1 && message.role === 'agent') {
                    return syncSettledTraceEventsOnMessage({
                        ...message,
                        segments: structuredParsed.segments,
                        traceEvents: ctx.resolveStructuredParsedTraceEvents(message, structuredParsed),
                    });
                }
                return message;
            });
            withReply = { ...reply, messages };
        } else {
            withReply = reply;
        }
    }
    // A "successful" turn that ran no tools but answered with tool-call-shaped JSON is the
    // silent signature of a model without native function calling: the CLI exits 0, so the
    // failure branch above never sees it. Reroute into the model fallback, or fail it typed.
    const settledAgentMessage = agentMessageId
        ? withReply.messages.find(message => message.id === agentMessageId && message.role === 'agent')
        : [...withReply.messages].reverse().find(message => message.role === 'agent');
    if (settledAgentMessage && agentTurnHasRetryableToolSupportFailure(settledAgentMessage)) {
        if (await ctx.maybeRetryTurnWithFallback(
            conversationId,
            userMessageId,
            settledAgentMessage.id,
            task,
            withReply,
            settledAgentMessage,
            turnAgentId,
            startSha,
        )) {
            discardUnrecordedCheckpoint(ctx, withReply.cwd, turnGit?.checkpoint);
            return 'fail';
        }
        discardUnrecordedCheckpoint(ctx, withReply.cwd, turnGit?.checkpoint);
        const reason = localizeAgentFailureMessage('tool_unsupported');
        const failed = ctx.markTurnFailed(withReply, {
            userMessageId,
            agentMessageId: settledAgentMessage.id,
            reason,
            status: ctx.settleStatusForRun(conversationId, task.id, 'failed'),
        });
        const resolvedAgentMessageId = failed.agentMessageId ?? settledAgentMessage.id;
        const finalized = ctx.finalizeStreamingAgentMessage(failed.conv, resolvedAgentMessageId, reason);
        ctx.publishFinalizedAgentMessage(conversationId, finalized, resolvedAgentMessageId, turnAgentId);
        ctx.finishLeaderTurnAndMaybeSynthesize(conversationId, task.id, finalized);
        ctx.notifyGoalLoopTurnSettled({ conversationId, userMessageId, task, outcome: 'failed', detail: reason });
        return 'fail';
    }
    const gitStats = turnGit?.gitStats;
    if (gitStats) {
        withReply = { ...withReply, gitDiffAdded: gitStats.added, gitDiffRemoved: gitStats.removed };
    }
    const checkpoint = turnGit?.checkpoint;
    if (checkpoint) {
        withReply = { ...withReply, checkpoints: [...(withReply.checkpoints ?? []), checkpoint] };
        withReply = ctx.appendCheckpointTrace(withReply, agentMessageId, checkpoint);
    }
    // One closing trace instead of a verification warning, a review note and a blocked note: the
    // runner folds verification, review, blocked signal and this turn's diff into the task's
    // closing report, and the transcript shows that report whenever it is not a clean completion.
    // Blocked still wins over the warning in the headline; the checks/review lines keep both facts.
    const blockedNeed = ctx.detectAgentBlockedNeed(withReply, agentMessageId);
    // A failed git side (turnGit undefined) leaves the diff unmeasured; no stats from a working git
    // side means the turn changed no line.
    const closingDiff = turnGit ? turnGit.gitStats ?? { added: 0, removed: 0 } : undefined;
    const closingTask = recordClosingReportFacts(ctx, task.id, closingDiff, blockedNeed);
    // Fallback for a runner that kept no report (a test double): same fold, same inputs.
    const closingReport = closingTask?.closingReport ?? buildAgentClosingReport({
        state: blockedNeed !== undefined ? 'blocked' : task.state,
        exitCode: task.exitCode,
        verification: task.verification,
        review: task.review,
        blockedNeed,
        diff: closingDiff,
    });
    if (closingReport && shouldSurfaceAgentClosingReport(closingReport)) {
        withReply = ctx.appendClosingReportTrace(withReply, agentMessageId, closingReport);
    }
    withReply = recordTurnVerdict(withReply, userMessageId, task, blockedNeed, Date.now(), closingReport);
    const finalizedAgentMessageId = settledAgentMessage?.id ?? agentMessageId;
    withReply = ctx.clearRunActive(withReply, finalizedAgentMessageId);
    ctx.conversations.set(conversationId, withReply);
    ctx.publishFinalizedAgentMessage(conversationId, withReply, finalizedAgentMessageId, turnAgentId);
    ctx.modelFallbackTriedByUserMessage.delete(ctx.resolveLoopBudgetKey(withReply, userMessageId));
    ctx.finishLeaderTurnAndMaybeSynthesize(conversationId, task.id, withReply);
    if (blockedNeed !== undefined) {
        // The agent explicitly asked for the user — the task was reclassified above; never
        // auto-continue on top of a question only the user can answer.
        ctx.notifyGoalLoopTurnSettled({ conversationId, userMessageId, task, outcome: 'blocked', detail: blockedNeed });
        return 'blocked';
    }
    if (task.state === 'completed_with_warnings') {
        // The backend verification loop already spent its fix-turn budget on this turn; the
        // text-heuristic auto-continue is blind to that verdict and would just re-prompt
        // "keep going" on top of a known-red build. Leave the decision to the user.
        // Drain queued messages before returning — the turn settled to 'idle'.
        if (withReply.status === 'idle') {
            ctx.drainPendingMessages(conversationId);
        }
        // An active goal loop still gets the turn: its verify phase reads the red verdict and
        // re-prompts with the failing check instead of a blind "keep going".
        ctx.notifyGoalLoopTurnSettled({ conversationId, userMessageId, task, outcome: 'success' });
        return 'success:warned';
    }
    // Drain any user messages that were queued (delivery mode 'queue') while the agent was
    // running. The turn settled to 'idle', so the queue can now flush. If auto-continue
    // fires below, it will set status back to 'streaming' and the drain will be a no-op
    // (it only fires when status is 'idle').
    if (withReply.status === 'idle') {
        ctx.drainPendingMessages(conversationId);
    }
    // An active goal loop takes precedence over the text-heuristic auto-continue: the loop
    // verifies and evaluates the turn itself and decides the next prompt.
    if (!ctx.notifyGoalLoopTurnSettled({ conversationId, userMessageId, task, outcome: 'success' })) {
        ctx.maybeAutoContinueIncompleteTurn(
            conversationId,
            withReply,
            userMessageId,
            finalizedAgentMessageId,
            turnAgentId,
        );
    }
    return 'success';
}

export async function maybeRetryTurnWithFallbackExtracted(ctx: QaapAgentConversationStoreContext, conversationId: string,
    userMessageId: string,
    agentMessageId: string | undefined,
    task: QaapAgentTask,
    conv: QaapAgentConversation,
    agentMessage: QaapAgentMessage | undefined,
    turnAgentId: string,
    startSha?: string, ): Promise<boolean> {
    // Refused before spawn for a missing provider key: every fallback model of the same agent would
    // be refused the same way, each one a new task record, transcript churn and failure push.
    if (task.preflightFailure === 'provider_key_missing') {
        return false;
    }
    if (ctx.isTurnGraphEnabled() && ctx.workflowRuns) {
        return ctx.maybeRetryTurnWithFallbackModelViaGraph(
            conversationId, userMessageId, agentMessageId, task, conv, agentMessage, turnAgentId, startSha,
        );
    }
    return ctx.maybeRetryTurnWithFallbackModel(
        conversationId, userMessageId, agentMessageId, task, conv, agentMessage, turnAgentId, startSha,
    );
}

/**
 * Persists how the turn settled on its user message (task outcome, verification, review), so task
 * pull requests read the verdict from the conversation even after the task runner pruned the task or
 * the backend restarted.
 */
export function recordTurnVerdict(
    conv: QaapAgentConversation,
    userMessageId: string,
    task: Pick<QaapAgentTask, 'state' | 'verification' | 'review' | 'readOnlyWorkspace'>,
    blockedNeed: string | undefined,
    now: number = Date.now(),
    closingReport?: QaapAgentClosingReport,
): QaapAgentConversation {
    const turnVerdict: QaapAgentTurnVerdict = {
        taskState: blockedNeed !== undefined ? 'blocked' : task.state,
        ...(task.verification ? { verification: task.verification } : {}),
        ...(task.review ? { review: task.review } : {}),
        ...(blockedNeed !== undefined ? { blockedNeed } : {}),
        ...(task.readOnlyWorkspace ? { readOnly: true } : {}),
        ...(closingReport ? { closingReport } : {}),
        settledAt: now,
    };
    return {
        ...conv,
        messages: conv.messages.map(message => message.id === userMessageId && message.role === 'user' ? { ...message, turnVerdict } : message),
    };
}
