// @ts-nocheck
// Extracted from qaap-agent-conversation-store.ts

import { Emitter, Event } from '@theia/core/lib/common/event';
import { nls } from '@theia/core/lib/common/nls';
import { inject, injectable, optional, postConstruct } from '@theia/core/shared/inversify';
import { randomUUID } from 'crypto';
import { spawnSync, SpawnSyncReturns } from 'child_process';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { writeJsonAtomic } from './qaap-write-json-atomic';
import * as os from 'os';
import * as path from 'path';
import type { QaapLinkedPullRequest } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import { isQaapWorkspaceContainerPath, QAAP_CONTAINER_CWD_ERROR } from '@theia/qaap-adapters/lib/common/qaap-workspace-container-path';
import {
    QAAP_AGENT_CONVERSATION_API_PATH,
    QaapAgentConversation,
    QaapAgentConversationCwdGroup,
    QaapAgentConversationEvent,
    QaapAgentConversationStatus,
    QaapAgentConversationSummary,
    QaapAgentMessage,
    QaapConversationCheckpoint,
    QaapCreateAgentConversationRequest,
    QaapLinkConversationsByBranchRequest,
    QaapRenameAgentConversationRequest,
    QaapUpdateAgentConversationRequest,
    toConversationSummary,
} from '../common/qaap-agent-conversation';
import {
    agentSupportsModelPicker,
    resolveQaapAgentMentionToken,
    usesAgUiCliTranscriptStream,
    usesStructuredAgentTranscript,
} from '@theia/qaap-mobile-shell/lib/common/qaap-agent-task-client';
import {
    DEFAULT_QAAP_CONTEXT_WINDOW,
    totalTokensFromContextUsage,
} from '@theia/qaap-mobile-shell/lib/common/qaap-agent-context-usage';
import { localizeAgentFailureMessage, resolveAgentTurnFailureMessage } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-failure-message';
import { qaiqModelSupportsToolCalls } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-tool-support';
import {
    resolveAgentLogDisplayText,
    type QaapAgentStreamAccumulator,
} from '@theia/qaap-mobile-shell/lib/common/qaap-cli-transcript-stream';
import {
    type QaapCliAgUiStreamEmitter,
} from '@theia/qaap-mobile-shell/lib/common/qaap-cli-ag-ui-stream';
import { isConversationTurnVisuallySettled } from '@theia/qaap-mobile-shell/lib/common/qaap-transcript-turn-status';
import {
    autoContinueAllowedForInteraction,
} from '@theia/qaap-mobile-shell/lib/common/qaap-agent-turn-completion';
import { patchConversationAutoApprove } from '../common/qaap-agent-conversation-auto-approve';
import {
    QAAP_CHAT_TURN_NODE,
    QAAP_CHAT_TURN_TRIED_MODELS_ARTIFACT,
    QAAP_CHAT_TURN_WORKFLOW_ID,
    buildChatTurnWorkflow,
    resolveChatTurnOutcome,
    resolveChatTurnRunBudget,
} from '../common/qaap-chat-turn-workflow';
import type { QaapWorkflowNodeOutcome } from '../common/qaap-workflow-ir';
import { QaapPersistedWorkflowRun, QaapWorkflowRunStore } from './qaap-workflow-run-store';
import { appendTeamDelegationToPrompt } from '../common/qaap-team-delegation';
import {
    buildConversationAgentPrompt,
} from '../common/qaap-agent-conversation-prompt';
import { deriveConversationTitle } from '../common/qaap-conversation-title';
import {
    areAllSubtasksSettled,
    buildTeamSynthesisUserMessage,
    collectSubtasksForLeader,
    countFailedSubtasks,
    formatSubtaskMailboxMessage,
    isTeamSynthesisUserMessage,
} from '../common/qaap-team-mailbox';
import { planConversationRewind } from '../common/qaap-agent-conversation-rewind';
import type { QaapParallelRunVariantStats } from '../common/qaap-parallel-run';
import type { QaapAgentTask, QaapAgentTaskEvent, QaapCreateAgentTaskRequest } from '../common/qaap-agent-task';
import { resolveTaskAgentModel } from '../common/qaap-agent-task';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import { QaapTenantSpawnService } from './qaap-tenant-spawn-service';
import { QaapAgentConversationSseBatcher } from '../common/qaap-agent-conversation-sse-batcher';
import {
    QaapConversationStreamMetricsCollector,
    countCompressedWireFields,
    logQaapStreamMetrics,
} from '@theia/qaap-mobile-shell/lib/common/qaap-agent-stream-metrics';
import {
    type QaapAgentMessageWireSnapshot,
} from '@theia/qaap-mobile-shell/lib/common/qaap-agent-message-wire-delta';
import {
    buildAgentMessageFromAgUiStructuredLog,
    buildAgentMessageFromQaapAgUiReducer,
    reduceQaapAgUiTranscriptEvent,
    type QaapAgUiEvent,
    type QaapAgUiTraceReducerState,
} from '@theia/qaap-mobile-shell/lib/common/qaap-ag-ui-transcript-adapter';
import {
    agentModelKey,
    agentTurnHasRetryableEmptyOutput,
    agentTurnHasRetryableModelFailure,
    agentTurnHasRetryableToolSupportFailure,
    resolveNextFallbackAgentModel,
} from '../common/qaap-agent-model-fallback';
import {
    appendTracePreviewFailureEvent,
    agentMessageHasStructuredTrace,
    syncSettledTraceEventsOnMessage,
} from '@theia/qaap-mobile-shell/lib/common/qaap-transcript-trace-lifecycle';
import { backfillConversationTraceEvents, materializeConversationForApiWithChanges, materializeAgentMessageForApi, preferTraceFirstAgentMessageStorage } from '@theia/qaap-mobile-shell/lib/common/qaap-transcript-trace-backfill';
import { mergeAccumulatorTraceEvents } from '@theia/qaap-mobile-shell/lib/common/qaap-cli-transcript-stream';
import { mergeSegmentTraceEvents } from '@theia/qaap-mobile-shell/lib/common/qaap-transcript-trace-model';
import { finalizeUnfinishedAgentToolSegments } from '../common/qaap-agent-transcript-segment-finalize';
import {
    QAAP_VISUAL_REPAIR_REQUIRED_MARKER,
    agentMessageHasVisualVerificationMarker,
    buildQaapVisualFlowMarkdown,
    buildQaapVisualVerificationFailureMarkdown,
    buildQaapVisualVerificationMarkdown,
    buildQaapVisualVideoMarkdown,
    type QaapPreviewVisualValidationResult,
    type QaapVisualFlowStepEvidence,
} from '@theia/qaap-mobile-shell/lib/common/qaap-visual-verification';
import {
    type ComposerGitActionDisplayMetadata,
} from '@theia/qaap-mobile-shell/lib/common/qaap-composer-git-action-display';
import {
    QAAP_MAX_TURN_MINUTES_ENV,
    resolveQaapMaxTurnMinutes,
} from '../common/qaap-agent-turn-watchdog';
import {
    visualEvidenceDirectory as visualEvidenceDirectoryHelper,
    resolveVisualEvidenceTarget as resolveVisualEvidenceTargetHelper,
    resolveVisualRepairSourceUserMessage as resolveVisualRepairSourceUserMessageHelper,
    countVisualRepairAttempts as countVisualRepairAttemptsHelper,
    buildVisualRepairPrompt as buildVisualRepairPromptHelper,
    saveVisualEvidenceImage as saveVisualEvidenceImageHelper,
    saveVisualEvidenceVideo as saveVisualEvidenceVideoHelper,
    resolveVisualVerificationFile as resolveVisualVerificationFileHelper,
    sweepUnreferencedVisualEvidence as sweepUnreferencedVisualEvidenceHelper,
} from './qaap-agent-conversation-store-visual';
import {
    parseGithubRepoFromCwd as parseGithubRepoFromCwdHelper,
    readGitBranch as readGitBranchHelper,
    captureGitSha as captureGitShaHelper,
    computeGitDiffStats as computeGitDiffStatsHelper,
    checkpointLabel as checkpointLabelHelper,
    isDirectory as isDirectoryHelper,
} from './qaap-agent-conversation-store-git';
import {
    resolveStructuredParsedTraceEvents as resolveStructuredParsedTraceEventsHelper,
    resolveLoopBudgetKey as resolveLoopBudgetKeyHelper,
    countAutoContinueAttempts as countAutoContinueAttemptsHelper,
    resolveAgentIdForAgentMessage as resolveAgentIdForAgentMessageHelper,
    contextCompactionMessageText as contextCompactionMessageTextHelper,
    contextPreambleWithCompaction as contextPreambleWithCompactionHelper,
    filterAgentLogChunk as filterAgentLogChunkHelper,
    deriveTitle as deriveTitleHelper,
    isTurnGraphEnabled as isTurnGraphEnabledHelper,
    readTriedFallbackModels as readTriedFallbackModelsHelper,
} from './qaap-agent-conversation-store-utils';
import {
    clearRunActive as clearRunActiveHelper,
    appendRunCancelledTrace as appendRunCancelledTraceHelper,
    detectAgentBlockedNeed as detectAgentBlockedNeedHelper,
    appendReviewTrace as appendReviewTraceHelper,
    appendBlockedTrace as appendBlockedTraceHelper,
    appendVerificationWarningTrace as appendVerificationWarningTraceHelper,
    appendCheckpointTrace as appendCheckpointTraceHelper,
    appendAgentReply as appendAgentReplyHelper,
    resolveCompletedTurnAuthFailureReason as resolveCompletedTurnAuthFailureReasonHelper,
    parseStructuredLog as parseStructuredLogHelper,
    resolveRunAgentMessageId as resolveRunAgentMessageIdHelper,
    listAllGroupedByCwd as listAllGroupedByCwdHelper,
    hasActiveTaskForUserMessage as hasActiveTaskForUserMessageHelper,
    finalizeTurnContextUsage as finalizeTurnContextUsageHelper,
    ensureAgentStream as ensureAgentStreamHelper,
    ensureAgUiStream as ensureAgUiStreamHelper,
    buildContextCompactionSummary as buildContextCompactionSummaryHelper,
    countDurableLoopSpawns as countDurableLoopSpawnsHelper,
    maybeAutoContinueIncompleteTurn as maybeAutoContinueIncompleteTurnHelper,
    prepareContextCompactionForTurn as prepareContextCompactionForTurnHelper,
    sweepZombieStreamingTurns as sweepZombieStreamingTurnsHelper,
    forceStopZombieTurn as forceStopZombieTurnHelper,
    applyAccumulatorStructuredOutput as applyAccumulatorStructuredOutputHelper,
    fireAgentMessageWireUpdate as fireAgentMessageWireUpdateHelper,
} from './qaap-agent-conversation-store-helpers';
import {
    markTurnFailed as markTurnFailedHelper,
    buildTaskCreateRequest as buildTaskCreateRequestHelper,
    recordGitAction as recordGitActionHelper,
} from './qaap-agent-conversation-store-helpers2';
import {
    STORE_DIR,
    STREAMING_PERSIST_DEBOUNCE_MS,
    INDEX_PATH,
    MAX_CONCURRENT_CONVERSATION_RUNS,
    TURN_WATCHDOG_SWEEP_MS,
    QAAP_AUTO_RESUME_TURNS_ENABLED,
    MAX_RESTART_RESUMES,
    MAX_LOOP_SPAWNS_PER_USER_MESSAGE,
    MAX_VISUAL_REPAIR_ATTEMPTS,
    QaapMaxConcurrentRunsError,
    type PostUserMessageInternalOptions,
    type QaapConversationTaskRef,
} from './qaap-agent-conversation-store-constants';

export async function recordVisualVerificationFlowExtracted(ctx: any, conversationId: string,
        steps: readonly { label: string; evidenceId: string; result: QaapPreviewVisualValidationResult }[],
        targetAgentMessageId: string,
        previewUrl?: string,): Promise<QaapAgentConversation | undefined> {
        const conv = ctx.conversations.get(conversationId);
        if (!conv || steps.length === 0) {
            return undefined;
        }
        const target = ctx.resolveVisualEvidenceTarget(conv, targetAgentMessageId);
        if (!target) {
            return undefined;
        }
        if (agentMessageHasVisualVerificationMarker(target)) {
            return conv;
        }
        if (ctx.visualVerificationInFlight.has(conversationId)) {
            return conv;
        }
        ctx.visualVerificationInFlight.add(conversationId);
        try {
            const directory = ctx.visualEvidenceDirectory(conversationId);
            const evidenceSteps: QaapVisualFlowStepEvidence[] = [];
            for (const step of steps) {
                if (!/^[a-f\d-]{36}$/i.test(step.evidenceId)
                    || !fs.existsSync(path.join(directory, `${step.evidenceId}.png`))) {
                    return undefined;
                }
                evidenceSteps.push({
                    label: step.label,
                    imageUrl: `${QAAP_AGENT_CONVERSATION_API_PATH}/${encodeURIComponent(conversationId)}`
                        + `/visual-verifications/${encodeURIComponent(step.evidenceId)}`,
                    result: step.result,
                });
            }
            const next = ctx.attachVisualVerificationBlock(conv, target, buildQaapVisualFlowMarkdown(evidenceSteps, previewUrl));
            void ctx.sweepUnreferencedVisualEvidence(conversationId).catch(() => undefined);
            return evidenceSteps.some(step => step.result.status === 'failed')
                ? await ctx.continueVisualRepairLoop(conversationId, target.id)
                : next;
        } finally {
            ctx.visualVerificationInFlight.delete(conversationId);
        }
}

export async function recordVisualVerificationFailureExtracted(ctx: any, conversationId: string,
        reason: string,
        targetAgentMessageId: string,): Promise<QaapAgentConversation | undefined> {
        const trimmed = reason.trim().slice(0, 500);
        const conv = ctx.conversations.get(conversationId);
        if (!conv || !trimmed) {
            return undefined;
        }
        const target = ctx.resolveVisualEvidenceTarget(conv, targetAgentMessageId);
        if (!target) {
            return undefined;
        }
        if (agentMessageHasVisualVerificationMarker(target) || ctx.visualVerificationInFlight.has(conversationId)) {
            return conv;
        }
        ctx.visualVerificationInFlight.add(conversationId);
        try {
            ctx.attachVisualVerificationBlock(conv, target, buildQaapVisualVerificationFailureMarkdown(trimmed));
            return await ctx.continueVisualRepairLoop(conversationId, target.id);
        } finally {
            ctx.visualVerificationInFlight.delete(conversationId);
        }
}

export function recordGitActionExtracted(ctx: any, conversationId: string,
        metadata: ComposerGitActionDisplayMetadata,
        options: {
            readonly messageId?: string;
            readonly replaceMessageId?: string;
        } = {},): QaapAgentConversation | undefined {
        return recordGitActionHelper(conversationId, metadata, options, {
            getConversation: id => ctx.conversations.get(id),
            setConversation: (id, c) => ctx.conversations.set(id, c),
            fire: e => ctx.fire(e),
            persist: () => ctx.persist(),
        });
}

export function readVisualVerificationExtracted(ctx: any, conversationId: string, evidenceId: string): Buffer | undefined {
        if (!ctx.conversations.has(conversationId) || !/^[a-f\d-]{36}$/i.test(evidenceId)) {
            return undefined;
        }
        try {
            return fs.readFileSync(path.join(ctx.visualEvidenceDirectory(conversationId), `${evidenceId}.png`));
        } catch {
            return undefined;
        }
}

export function onTaskChangedExtracted(ctx: any, event: QaapAgentTaskEvent): void {
        const ref = ctx.taskToConversation.get(event.task.id);
        if (ref) {
            ctx.recordTaskLatencyMarks(ref.conversationId, event.task);
            if (event.type === 'output') {
                ctx.applyTaskOutput(event.task.id, ref, event.chunk);
                return;
            }
            const task = event.task;
            if (task.state === 'running') {
                return; // only react when the turn settles
            }
            ctx.taskToConversation.delete(task.id);
            // The graph settle is DEFERRED until the outcome flow finishes: a retriable failure
            // must become the run's `retry:model` edge (which steals the claim below), never a
            // premature terminal report racing the decision.
            void ctx.applyTaskOutcome(ref, task).then(
                outcome => ctx.settleChatTurnRun(task, outcome),
                error => {
                    // Materialization must not strand the control-plane run. Fall back to the raw
                    // task state when an unexpected projection error prevents finer classification.
                    ctx.settleChatTurnRun(task);
                    console.warn('[qaap-agent-conversation-store] failed to apply a task outcome:', error);
                },
            );
            return;
        }
        if (event.type === 'output' || event.type === 'created') {
            return;
        }
        const task = event.task;
        if (!task.parentId || task.state === 'running') {
            return;
        }
        void ctx.deliverSubtaskMailbox(task);
}

export function recordTaskLatencyMarksExtracted(ctx: any, conversationId: string, task: QaapAgentTask): void {
        for (const [mark, at] of Object.entries(task.latencyMarks ?? {})) {
            ctx.streamMetrics.recordLatencyMark(
                conversationId,
                mark as Parameters<QaapConversationStreamMetricsCollector['recordLatencyMark']>[1],
                at,
            );
        }
}

export function recordSubmitLatencyMarksExtracted(ctx: any, conversationId: string,
        latencyMarks: QaapCreateAgentConversationRequest['latencyMarks'] | undefined,): void {
        for (const [mark, at] of Object.entries(latencyMarks ?? {})) {
            if (typeof at !== 'number' || !Number.isFinite(at)) {
                continue;
            }
            ctx.streamMetrics.recordLatencyMark(
                conversationId,
                mark as Parameters<QaapConversationStreamMetricsCollector['recordLatencyMark']>[1],
                at,
            );
        }
}

export async function deliverSubtaskMailboxExtracted(ctx: any, task: QaapAgentTask): Promise<void> {
        if (ctx.subtaskMailboxDelivered.has(task.id)) {
            return;
        }
        const leaderTaskId = ctx.resolveLeaderTaskId(task);
        const conversationId = leaderTaskId ? ctx.findConversationIdForLeaderTask(leaderTaskId) : undefined;
        if (!conversationId) {
            return;
        }
        const conv = ctx.conversations.get(conversationId);
        if (!conv) {
            return;
        }
        ctx.subtaskMailboxDelivered.add(task.id);
        const detail = await ctx.taskRunner.detail(task.id);
        const log = ctx.filterAgentLogChunk((detail?.log ?? '').trim());
        const leaderUserMessageId = leaderTaskId ? ctx.taskToConversation.get(leaderTaskId)?.userMessageId : undefined;
        const message: QaapAgentMessage = {
            id: randomUUID(),
            role: 'agent',
            content: formatSubtaskMailboxMessage(task, log),
            createdAt: Date.now(),
            // Belongs to the leader's run, which is not necessarily the last user message once a
            // peer run has posted one in the meantime.
            ...(leaderUserMessageId ? { runUserMessageId: leaderUserMessageId } : {}),
        };
        const next: QaapAgentConversation = {
            ...conv,
            messages: [...conv.messages, message],
            updatedAt: Date.now(),
        };
        ctx.conversations.set(conversationId, next);
        ctx.fire({ type: 'message', conversationId, cwd: next.cwd, message });
        ctx.fire({ type: 'updated', conversation: toConversationSummary(next) });
        void ctx.persist();
        if (leaderTaskId) {
            ctx.maybeTriggerTeamSynthesis(leaderTaskId, conversationId);
        }
}

export function resolveLeaderTaskIdExtracted(ctx: any, task: QaapAgentTask): string | undefined {
        let leaderId = task.parentId;
        if (!leaderId) {
            return undefined;
        }
        const visited = new Set<string>();
        while (leaderId && !visited.has(leaderId)) {
            visited.add(leaderId);
            const parent = ctx.findTaskById(leaderId);
            if (parent?.parentId) {
                leaderId = parent.parentId;
            } else {
                return leaderId;
            }
        }
        return undefined;
}

export function findConversationIdForLeaderTaskExtracted(ctx: any, leaderTaskId: string): string | undefined {
        const active = ctx.taskToConversation.get(leaderTaskId);
        if (active) {
            return active.conversationId;
        }
        for (const conv of ctx.conversations.values()) {
            if (conv.messages.some(message => message.role === 'user' && message.taskId === leaderTaskId)) {
                return conv.id;
            }
        }
        return undefined;
}

export function maybeTriggerTeamSynthesisExtracted(ctx: any, leaderTaskId: string, conversationId: string): void {
        if (ctx.teamSynthesisTriggeredForLeader.has(leaderTaskId)) {
            return;
        }
        const conv = ctx.conversations.get(conversationId);
        if (!conv || conv.paused) {
            return;
        }
        const subtasks = collectSubtasksForLeader(leaderTaskId, ctx.taskRunner.list());
        if (!areAllSubtasksSettled(subtasks)) {
            return;
        }
        if (!subtasks.every(subtask => ctx.subtaskMailboxDelivered.has(subtask.id))) {
            return;
        }
        if (conv.status === 'streaming') {
            ctx.pendingTeamSynthesisForLeader.add(leaderTaskId);
            return;
        }
        ctx.pendingTeamSynthesisForLeader.delete(leaderTaskId);
        ctx.teamSynthesisTriggeredForLeader.add(leaderTaskId);
        const synthesisMessage = buildTeamSynthesisUserMessage(subtasks.length, countFailedSubtasks(subtasks));
        try {
            ctx.postUserMessage(conversationId, synthesisMessage);
        } catch {
            ctx.teamSynthesisTriggeredForLeader.delete(leaderTaskId);
        }
}

export function finishLeaderTurnAndMaybeSynthesizeExtracted(ctx: any, conversationId: string,
        leaderTaskId: string,
        next: QaapAgentConversation,): void {
        ctx.conversations.set(conversationId, next);
        ctx.fire({ type: 'updated', conversation: toConversationSummary(next) });
        ctx.flushPersist();
        ctx.pendingTeamSynthesisForLeader.delete(leaderTaskId);
        ctx.maybeTriggerTeamSynthesis(leaderTaskId, conversationId);
}

export function applyTaskOutputExtracted(ctx: any, taskId: string,
        ref: QaapConversationTaskRef,
        chunk: string,): void {
        const conv = ctx.conversations.get(ref.conversationId);
        const filtered = ctx.filterAgentLogChunk(chunk);
        if (!conv || !filtered) {
            return;
        }
        const agentId = ref.turnAgentId;
        if (usesAgUiCliTranscriptStream(agentId)) {
            ctx.applyAgUiTaskOutput(taskId, ref, filtered, agentId);
            return;
        }
        const now = Date.now();
        const usesSegmentStream = usesStructuredAgentTranscript(agentId);
        let content: string;
        let segments: QaapAgentMessage['segments'];
        const stream = ctx.ensureAgentStream(taskId, agentId);
        if (stream) {
            stream.push(filtered);
            segments = [...stream.getSegments()];
            content = stream.getDisplayText();
        } else {
            content = filtered;
            segments = undefined;
        }
        const existingAgentMessage = ref.agentMessageId
            ? conv.messages.find(message => message.id === ref.agentMessageId)
            : undefined;
        const traceEvents = usesSegmentStream && stream
            ? mergeAccumulatorTraceEvents(existingAgentMessage?.traceEvents, stream)
            : usesSegmentStream && segments?.length
                ? mergeSegmentTraceEvents(existingAgentMessage?.traceEvents, segments)
                : undefined;
        if (!content && (!segments || segments.length === 0) && !(traceEvents?.length)) {
            return;
        }
        let agentMessageId = ref.agentMessageId;
        let messages: QaapAgentMessage[];
        if (!agentMessageId) {
            agentMessageId = randomUUID();
            ref.agentMessageId = agentMessageId;
            ctx.taskToConversation.set(taskId, ref);
            const message: QaapAgentMessage = preferTraceFirstAgentMessageStorage({
                id: agentMessageId,
                role: 'agent',
                content: content || '…',
                segments,
                ...(traceEvents ? { traceEvents } : {}),
                createdAt: now,
                // The run that owns this message. Sealed here, at creation, because the append
                // position stops identifying the turn as soon as a peer run interleaves.
                runUserMessageId: ref.userMessageId,
                // Marks the message as the live end of a run. With several agents in one session
                // the conversation status can no longer say which turns are still working, and the
                // per-run stop must only appear on the ones that are.
                runActive: true,
            });
            messages = [...conv.messages, message];
            ctx.fireAgentMessageWireUpdate(conv.id, conv.cwd, agentId, message);
        } else {
            messages = conv.messages.map(message => message.id === agentMessageId
                ? preferTraceFirstAgentMessageStorage({
                    ...message,
                    content: usesSegmentStream ? (content || message.content) : `${message.content}${filtered}`,
                    segments: usesSegmentStream ? (segments ?? message.segments) : undefined,
                    ...(usesSegmentStream && traceEvents ? { traceEvents } : {}),
                })
                : message
            );
            const updated = messages.find(message => message.id === agentMessageId);
            if (updated) {
                ctx.fireAgentMessageWireUpdate(conv.id, conv.cwd, agentId, updated);
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
        ctx.conversations.set(conv.id, next);
        ctx.fire({ type: 'updated', conversation: toConversationSummary(next) });
        ctx.schedulePersist();
}

export function applyAgUiTaskOutputExtracted(ctx: any, taskId: string,
        ref: QaapConversationTaskRef,
        chunk: string,
        agentId: string,): void {
        const usageStream = ctx.ensureAgentStream(taskId, agentId);
        usageStream?.push(chunk);
        const emitter = ctx.ensureAgUiStream(taskId, agentId);
        const events = emitter.push(chunk);
        if (events.length === 0) {
            ctx.applyAccumulatorStructuredOutput(taskId, ref, agentId);
            return;
        }
        let conv = ctx.conversations.get(ref.conversationId);
        if (!conv) {
            return;
        }
        const previousAgentMessageId = ref.agentMessageId;
        for (const event of events) {
            // `ref` is passed (not just its ids) so the event lands on THIS run's agent message
            // and so a message created here is written back onto the ref. Resolving the target
            // from the array tail instead would make every concurrent run of the session
            // converge on whichever agent message happens to be last, merging their output.
            const next = ctx.applyAgUiTranscriptEvent(ref.conversationId, event, ref);
            if (next) {
                conv = next;
            }
        }
        if (ref.agentMessageId !== previousAgentMessageId) {
            ctx.taskToConversation.set(taskId, ref);
        }
}

export function parseStructuredLogExtracted(ctx: any, agentId: string,
        log: string,): {
        content: string;
        segments: QaapAgentMessage['segments'];
        traceEvents: QaapAgentMessage['traceEvents'];
    } | undefined {
        return parseStructuredLogHelper(agentId, log);
}
