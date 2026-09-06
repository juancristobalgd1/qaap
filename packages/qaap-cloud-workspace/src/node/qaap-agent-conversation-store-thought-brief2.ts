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

export async function resumeInterruptedTurnViaGraphExtracted(ctx: any, conv: QaapAgentConversation,
        turnUserMessage: QaapAgentMessage,
        rootUserMessage: QaapAgentMessage,
        turnAgentId: string,
        nowMs: number,): Promise<boolean> {
        const runs = ctx.workflowRuns!;
        const conversationId = conv.id;
        const userMessageId = turnUserMessage.id;
        const rootUserMessageId = rootUserMessage.id;
        const nextResumeCount = (rootUserMessage.restartResumeCount ?? 0) + 1;
        let record = ctx.findLiveChatTurnRun(conv, rootUserMessageId);
        if (!record) {
            record = await runs.adoptRun(buildChatTurnWorkflow(), {
                cwd: conv.cwd,
                ownerLogin: conv.ownerLogin,
                inputs: { conversationId, rootUserMessageId },
                seedNodeId: QAAP_CHAT_TURN_NODE,
                // The run's ledger carries the ceiling across governance changes: visits = 1 + the
                // resumes the projection already recorded before this run existed.
                seedVisits: 1 + (rootUserMessage.restartResumeCount ?? 0),
                deadExternalId: turnUserMessage.taskId,
                budget: resolveChatTurnRunBudget(MAX_RESTART_RESUMES),
            });
        }
        const nodeId = record.run.active[0] ?? QAAP_CHAT_TURN_NODE;
        // Belt and braces with the projection guard the caller already applied: if the RUN's own
        // ledger says the ceiling is spent, settle its failure edge and hand the conversation to
        // the sweep — never spawn on a counter that disagrees.
        if (Math.max(0, (record.run.visits[nodeId] ?? 1) - 1) >= MAX_RESTART_RESUMES) {
            await runs.report(conv.ownerLogin, record.run.id, nodeId, 'fail').catch(() => undefined);
            return false;
        }
        // THE transition: `turn --resume:restart--> turn`. report() persists the incremented visit
        // and the trace entry before resolving, so the spawn below can never outrun the ledger.
        const advanced = await runs.report(conv.ownerLogin, record.run.id, nodeId, 'resume:restart');
        if (!advanced.dispatch.includes(nodeId)) {
            // The visit backstop refused the re-visit (budget-exhausted): the run is terminal.
            return false;
        }
        // Data plane, mirroring the imperative branch: drop the orphaned partial agent output,
        // clear the dead task link, stamp the projected counter, persist BEFORE spawning.
        const lastMessage = conv.messages[conv.messages.length - 1];
        const agentMessageId = lastMessage?.role === 'agent' ? lastMessage.id : undefined;
        const messages = conv.messages
            .filter(message => message.id !== agentMessageId)
            .map(message => {
                let next = message;
                if (message.id === userMessageId) {
                    next = { ...next, error: undefined, taskId: undefined };
                }
                if (message.id === rootUserMessageId) {
                    next = { ...next, restartResumeCount: nextResumeCount };
                }
                return next;
            });
        const resumeConv: QaapAgentConversation = { ...conv, status: 'streaming', updatedAt: nowMs, messages };
        ctx.conversations.set(conversationId, resumeConv);
        await ctx.persist();
        let spawned: QaapAgentTask;
        try {
            spawned = ctx.taskRunner.create(
                ctx.buildTaskCreateRequest(resumeConv, turnAgentId, undefined, userMessageId),
                resumeConv.ownerLogin,
            );
        } catch {
            // cwd gone / runner refused: settle the run's failure edge and degrade to the manual
            // "Retry to continue" flow. Ledger and projection both already persisted, so this
            // turn will not be retried automatically again.
            await runs.report(conv.ownerLogin, record.run.id, nodeId, 'fail').catch(() => undefined);
            ctx.interruptStreamingTurnForRestart(conversationId, nowMs);
            return true;
        }
        await runs.attachDispatch(conv.ownerLogin, record.run.id, nodeId, 'agent', spawned.id).catch(() => undefined);
        ctx.chatTurnRunByTask.set(spawned.id, { runId: record.run.id, ownerLogin: conv.ownerLogin, nodeId });
        const messagesWithTask = resumeConv.messages.map(message => message.id === userMessageId
            ? { ...message, taskId: spawned.id, turnAgentId: spawned.agentId ?? turnAgentId }
            : message);
        const nextConv = { ...resumeConv, messages: messagesWithTask };
        ctx.conversations.set(conversationId, nextConv);
        ctx.taskToConversation.set(spawned.id, {
            conversationId,
            userMessageId,
            turnAgentId: spawned.agentId ?? turnAgentId,
        });
        ctx.fire({ type: 'updated', conversation: toConversationSummary(nextConv) });
        void ctx.persist();
        console.warn(
            `[qaap-agent-conversation-resume] auto-resumed conversation ${conversationId} after restart `
            + `via chat-turn run ${record.run.id} (attempt ${nextResumeCount}/${MAX_RESTART_RESUMES}).`,
        );
        return true;
}

export function settleChatTurnRunExtracted(ctx: any, task: QaapAgentTask, outcome: QaapWorkflowNodeOutcome = resolveChatTurnOutcome(task.state)): void {
        const governed = ctx.chatTurnRunByTask.get(task.id);
        if (!governed) {
            return;
        }
        ctx.chatTurnRunByTask.delete(task.id);
        void ctx.workflowRuns?.report(governed.ownerLogin, governed.runId, governed.nodeId, outcome)
            .catch(error => console.warn('[qaap-agent-conversation-store] failed to settle a chat-turn run:', error));
}

export function findLiveChatTurnRunExtracted(ctx: any, conv: QaapAgentConversation, rootUserMessageId: string): QaapPersistedWorkflowRun | undefined {
        return ctx.workflowRuns?.listUnfinished(conv.ownerLogin).find(candidate =>
            candidate.def.id === QAAP_CHAT_TURN_WORKFLOW_ID
            && candidate.inputs.conversationId === conv.id
            && candidate.inputs.rootUserMessageId === rootUserMessageId);
}

export function countDurableLoopSpawnsExtracted(ctx: any, conv: QaapAgentConversation,
        rootUserMessageId: string,
        record: QaapPersistedWorkflowRun | undefined,): number {
        return countDurableLoopSpawnsHelper(conv, rootUserMessageId, record);
}

export async function maybeRetryTurnWithFallbackModelViaGraphExtracted(ctx: any, conversationId: string,
        userMessageId: string,
        agentMessageId: string | undefined,
        task: QaapAgentTask,
        conv: QaapAgentConversation,
        agentMessage: QaapAgentMessage | undefined,
        turnAgentId: string,
        startSha?: string,): Promise<boolean> {
        if (!agentSupportsModelPicker(turnAgentId)) {
            return false;
        }
        // Same retriability contract as the imperative branch — including the quota exclusion,
        // which is neither of these classifications.
        const toolSupportFailure = agentTurnHasRetryableToolSupportFailure(agentMessage);
        const retryableFailedState = task.state === 'failed'
            && (agentTurnHasRetryableEmptyOutput(agentMessage)
                || agentTurnHasRetryableModelFailure(agentMessage));
        if (!toolSupportFailure && !retryableFailedState) {
            return false;
        }
        const runs = ctx.workflowRuns!;
        const loopBudgetKey = ctx.resolveLoopBudgetKey(conv, userMessageId);
        let record = ctx.findLiveChatTurnRun(conv, loopBudgetKey);
        // Shared-ceiling parity: the stricter of the run's own trace and the in-memory counter
        // (a turn may have spent spawns imperatively before the flag flip, or via auto-continue).
        const spent = Math.max(
            ctx.countDurableLoopSpawns(conv, loopBudgetKey, record),
            ctx.loopSpawnCountByUserMessage.get(loopBudgetKey) ?? 0,
        );
        if (spent >= MAX_LOOP_SPAWNS_PER_USER_MESSAGE) {
            ctx.modelFallbackTriedByUserMessage.delete(loopBudgetKey);
            return false;
        }
        const turnUserMessage = conv.messages.find(message => message.id === userMessageId && message.role === 'user');
        const currentModel = turnUserMessage?.turnAgentModel
            ?? resolveTaskAgentModel(task)
            ?? (conv.agentId === turnAgentId ? conv.agentModel ?? conv.qaiqModel : undefined);
        // Durable tried-set first; the in-memory map only adds what this process learned before
        // the run existed.
        const tried = new Set<string>([
            ...ctx.readTriedFallbackModels(record),
            ...(ctx.modelFallbackTriedByUserMessage.get(loopBudgetKey) ?? []),
        ]);
        const currentKey = agentModelKey(currentModel);
        if (currentKey) {
            tried.add(currentKey);
        }
        const nextModel = resolveNextFallbackAgentModel(turnAgentId, currentModel, tried);
        if (!nextModel) {
            ctx.modelFallbackTriedByUserMessage.delete(loopBudgetKey);
            return false;
        }
        if (!record) {
            const rootUserMessage = conv.messages.find(message => message.id === loopBudgetKey && message.role === 'user');
            try {
                record = await runs.adoptRun(buildChatTurnWorkflow(), {
                    cwd: conv.cwd,
                    ownerLogin: conv.ownerLogin,
                    inputs: { conversationId, rootUserMessageId: loopBudgetKey },
                    seedNodeId: QAAP_CHAT_TURN_NODE,
                    seedVisits: 1 + (rootUserMessage?.restartResumeCount ?? 0),
                    deadExternalId: task.id,
                    budget: resolveChatTurnRunBudget(MAX_RESTART_RESUMES),
                });
            } catch (error) {
                // Ledger unavailable (owner at the run cap with nothing reapable): the retry is
                // still owed to the user — degrade to the imperative branch rather than dropping it.
                console.warn('[qaap-agent-conversation-fallback] could not adopt a chat-turn run; using the imperative retry:', error);
                return ctx.maybeRetryTurnWithFallbackModel(
                    conversationId, userMessageId, agentMessageId, task, conv, agentMessage, turnAgentId, startSha,
                );
            }
        }
        const nodeId = record.run.active[0] ?? QAAP_CHAT_TURN_NODE;
        const nextKey = agentModelKey(nextModel);
        const triedWithNext = [...tried, ...(nextKey && !tried.has(nextKey) ? [nextKey] : [])];
        let advanced;
        try {
            advanced = await runs.report(
                conv.ownerLogin, record.run.id, nodeId, 'retry:model', undefined,
                { key: QAAP_CHAT_TURN_TRIED_MODELS_ARTIFACT, value: JSON.stringify(triedWithNext) },
                nls.localize('qaap/chatTurn/retryingModel', 'Retrying with the next curated model.'),
            );
        } catch (error) {
            // Preserve the old task's claim so the deferred settle can close this run. A transient
            // ledger failure must not also deny the user the established imperative fallback.
            console.warn('[qaap-agent-conversation-fallback] could not persist the graph retry; using the imperative retry:', error);
            return ctx.maybeRetryTurnWithFallbackModel(
                conversationId, userMessageId, agentMessageId, task, conv, agentMessage, turnAgentId, startSha,
            );
        }
        // The decision is durably the graph's: steal the deferred terminal settle only AFTER the
        // retry edge reached disk, never while a failed report could still need the old claim.
        ctx.chatTurnRunByTask.delete(task.id);
        const fallbackNodeId = advanced.dispatch[0];
        if (!fallbackNodeId) {
            // The visit backstop refused the re-entry; the run is settled and the turn fails normally.
            return false;
        }
        // Data plane, mirroring the imperative branch: drop the partial agent message, re-seal
        // the user message with the next model, spawn, re-link, publish.
        const messages = conv.messages
            .filter(message => message.id !== agentMessageId)
            .map(message => message.id === userMessageId
                ? {
                    ...message,
                    error: undefined,
                    taskId: undefined,
                    turnAgentId,
                    turnAgentModel: nextModel,
                }
                : message);
        const retryConv: QaapAgentConversation = {
            ...conv,
            status: 'streaming',
            updatedAt: Date.now(),
            messages,
            ...(conv.agentId === turnAgentId ? { agentModel: nextModel, qaiqModel: nextModel } : {}),
        };
        let spawned: QaapAgentTask;
        try {
            spawned = ctx.taskRunner.create(
                ctx.buildTaskCreateRequest(retryConv, turnAgentId, undefined, userMessageId),
                retryConv.ownerLogin,
            );
        } catch {
            // Same degradation as the imperative branch (return false → the failure flow marks the
            // turn). Settle the run's failure edge so the ledger never waits on an unstarted node.
            await runs.report(conv.ownerLogin, record.run.id, fallbackNodeId, 'fail').catch(() => undefined);
            return false;
        }
        ctx.recordLoopSpawn(loopBudgetKey);
        ctx.modelFallbackTriedByUserMessage.set(loopBudgetKey, new Set(triedWithNext));
        await runs.attachDispatch(conv.ownerLogin, record.run.id, fallbackNodeId, 'agent', spawned.id).catch(() => undefined);
        ctx.chatTurnRunByTask.set(spawned.id, { runId: record.run.id, ownerLogin: conv.ownerLogin, nodeId: fallbackNodeId });
        const messagesWithTask = retryConv.messages.map(message => message.id === userMessageId
            ? {
                ...message,
                taskId: spawned.id,
                turnAgentId: spawned.agentId ?? turnAgentId,
                turnAgentModel: nextModel,
            }
            : message);
        const nextConv = { ...retryConv, messages: messagesWithTask };
        ctx.conversations.set(conversationId, nextConv);
        // Same SSE contract as the imperative branch: the re-attributed user message is the only
        // carrier of the new provenance for tabs that do not poll.
        const resealedUserMessage = messagesWithTask.find(message => message.id === userMessageId);
        if (resealedUserMessage) {
            ctx.fire({ type: 'message', conversationId, cwd: nextConv.cwd, message: resealedUserMessage });
        }
        ctx.fire({ type: 'updated', conversation: toConversationSummary(nextConv) });
        ctx.taskToConversation.set(spawned.id, {
            conversationId,
            userMessageId,
            turnAgentId: spawned.agentId ?? turnAgentId,
            startSha,
        });
        void ctx.persist();
        console.warn(
            `[qaap-agent-conversation-fallback] retrying turn ${userMessageId} of ${conversationId} `
            + `with the next curated model via chat-turn run ${record.run.id}.`,
        );
        return true;
}

export async function reapOrphanedChatTurnRunsExtracted(ctx: any): Promise<void> {
        const runs = ctx.workflowRuns;
        if (!runs) {
            return;
        }
        for (const record of runs.listAllUnfinished()) {
            if (record.def.id !== QAAP_CHAT_TURN_WORKFLOW_ID) {
                continue;
            }
            const conversationId = record.inputs.conversationId;
            const conv = conversationId ? ctx.conversations.get(conversationId) : undefined;
            if (conv?.status === 'streaming') {
                continue; // still governed — the resume path owns it
            }
            for (const nodeId of record.run.active) {
                await runs.report(
                    record.ownerLogin, record.run.id, nodeId, 'fail', undefined, undefined,
                    'Conversation settled while the backend was down.',
                ).catch(() => undefined);
            }
        }
}

export function interruptStreamingTurnForRestartExtracted(ctx: any, conversationId: string, nowMs: number): boolean {
        const conv = ctx.conversations.get(conversationId);
        if (!conv || conv.status !== 'streaming') {
            return false;
        }
        const reason = 'The backend restarted while this turn was in progress, so it was interrupted. Retry to continue.';
        const lastUser = [...conv.messages].reverse().find(message => message.role === 'user');
        const lastMessage = conv.messages[conv.messages.length - 1];
        const agentMessageId = lastMessage?.role === 'agent' ? lastMessage.id : undefined;
        const withTrace = ctx.appendRunCancelledTrace(conv, agentMessageId, reason);
        const finalized = ctx.finalizeStreamingAgentMessage(withTrace, agentMessageId, reason);
        const failed = ctx.markTurnFailed(finalized, {
            userMessageId: lastUser?.id ?? lastMessage?.id ?? '',
            agentMessageId,
            reason,
        });
        ctx.conversations.set(conversationId, { ...failed.conv, updatedAt: nowMs });
        return true;
}

export async function persistExtracted(ctx: any): Promise<void> {
    ctx.persistChain = (ctx.persistChain ?? Promise.resolve()).catch(() => undefined).then(async () => {
        try {
            await fsp.mkdir(STORE_DIR, { recursive: true });
            await writeJsonAtomic(INDEX_PATH, [...ctx.conversations.values()]);
            ctx.persistFailureLoggedAtMs = 0;
        } catch (error) {
            // Best-effort persistence, but a swallowed error hides disk-full/corruption; surface it
            // at most once a minute so the failure is visible without flooding the log.
            const now = Date.now();
            if (now - ctx.persistFailureLoggedAtMs > 60_000) {
                ctx.persistFailureLoggedAtMs = now;
                console.warn('[qaap-agent-conversation-store] failed to persist conversations:', error);
            }
        }
    });
    return ctx.persistChain;
}

export function captureCheckpointExtracted(ctx: any, cwd: string,
        conversationId: string,
        messageId: string,
        label: string,
        stats?: { added: number; removed: number },): QaapConversationCheckpoint | undefined {
        const tmpIndex = path.join(os.tmpdir(), `qaap-ckpt-${randomUUID()}.index`);
        const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
        try {
            // Seed the throwaway index from HEAD when a commit exists (best-effort; empty repo is fine).
            ctx.mutatingGitSync(cwd, ['read-tree', 'HEAD'], env);
            if (ctx.mutatingGitSync(cwd, ['add', '-A'], env).status !== 0) {
                return undefined;
            }
            const tree = ctx.mutatingGitSync(cwd, ['write-tree'], env);
            const treeId = tree.status === 0 ? tree.stdout.trim() : '';
            if (!treeId) {
                return undefined;
            }
            const commitRes = ctx.mutatingGitSync(
                cwd,
                ['-c', 'user.email=qaap@local', '-c', 'user.name=qaap', 'commit-tree', treeId, '-m', `qaap checkpoint: ${label}`],
                env,
            );
            const commit = commitRes.status === 0 ? commitRes.stdout.trim() : '';
            if (!commit) {
                return undefined;
            }
            const ref = `refs/qaap/checkpoints/${conversationId}/${messageId}-${Date.now()}`;
            ctx.mutatingGitSync(cwd, ['update-ref', ref, commit]);
            return { id: randomUUID(), messageId, label, commit, ref, capturedAt: Date.now(), added: stats?.added, removed: stats?.removed };
        } catch {
            return undefined;
        } finally {
            try {
                fs.rmSync(tmpIndex, { force: true });
            } catch { /* ignore */ }
        }
}

