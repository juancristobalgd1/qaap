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

export function cancelRunExtracted(ctx: any, id: string, userMessageId: string): QaapAgentConversation | undefined {
        const conv = ctx.conversations.get(id);
        if (!conv) {
            return undefined;
        }
        const userMessage = conv.messages.find(message => message.id === userMessageId && message.role === 'user');
        const taskId = userMessage?.taskId;
        if (!taskId) {
            return conv;
        }
        const ref = ctx.taskToConversation.get(taskId);
        ctx.taskRunner.cancel(taskId);
        for (const subtask of collectSubtasksForLeader(taskId, ctx.taskRunner.list())) {
            if (subtask.state === 'running') {
                ctx.taskRunner.cancel(subtask.id);
            }
        }
        const agentMessageId = ref?.agentMessageId;
        let next = ctx.appendRunCancelledTrace(conv, agentMessageId, 'Turn cancelled.');
        next = ctx.finalizeStreamingAgentMessage(next, agentMessageId, 'Turn cancelled.');
        next = {
            ...next,
            // Excludes this run itself, so the session stays streaming while peers work on.
            status: ctx.settleStatusForRun(id, taskId, 'idle'),
            updatedAt: Date.now(),
        };
        ctx.taskToConversation.delete(taskId);
        ctx.conversations.set(id, next);
        ctx.publishFinalizedAgentMessage(id, next, agentMessageId);
        ctx.fire({ type: 'updated', conversation: toConversationSummary(next) });
        void ctx.persist();
        return next;
}

export function updateExtracted(ctx: any, id: string, request: QaapUpdateAgentConversationRequest): QaapAgentConversation | undefined {
        const conv = ctx.conversations.get(id);
        if (!conv) {
            return undefined;
        }
        const patch: { -readonly [K in keyof QaapAgentConversation]?: QaapAgentConversation[K] } = {};
        if (request.title !== undefined) {
            const title = request.title.trim();
            if (!title) {
                return undefined;
            }
            patch.title = title;
        }
        if (request.priority !== undefined) {
            patch.priority = request.priority || undefined;
        }
        if (request.paused !== undefined) {
            patch.paused = request.paused || undefined;
            if (request.paused && conv.status === 'streaming') {
                const lastUser = [...conv.messages].reverse().find(m => m.role === 'user' && m.taskId);
                if (lastUser?.taskId) {
                    ctx.taskRunner.cancel(lastUser.taskId);
                }
                patch.status = 'idle';
            }
        }
        if (request.archived !== undefined) {
            patch.archived = request.archived || undefined;
        }
        if (request.autoApprove !== undefined) {
            patch.autoApprove = request.autoApprove ? undefined : false;
        }
        if (request.linkedPullRequest !== undefined) {
            patch.linkedPullRequest = request.linkedPullRequest ?? undefined;
        }
        if (request.agent !== undefined) {
            const normalized = ctx.taskRunner.normalizeAgentId(request.agent);
            if (!normalized) {
                return undefined;
            }
            patch.agentId = normalized;
            if (normalized !== conv.agentId && request.agentModel === undefined) {
                patch.agentModel = undefined;
                patch.qaiqModel = undefined;
            }
        }
        if (request.agentModel !== undefined) {
            const turnAgentId = patch.agentId ?? conv.agentId;
            if (agentSupportsModelPicker(turnAgentId)) {
                patch.agentModel = request.agentModel;
                patch.qaiqModel = request.agentModel;
            }
        }
        if (request.interactionModeId !== undefined) {
            const modeId = request.interactionModeId.trim();
            patch.interactionModeId = modeId || undefined;
        }
        if (request.approvalPolicyId !== undefined) {
            const policyId = request.approvalPolicyId.trim();
            patch.approvalPolicyId = policyId || undefined;
        }
        if (request.toolApprovalRules !== undefined) {
            patch.toolApprovalRules = {
                shell: request.toolApprovalRules.shell === true,
                network: request.toolApprovalRules.network === true,
            };
        }
        if (Object.keys(patch).length === 0) {
            return conv;
        }
        const next: QaapAgentConversation = { ...conv, ...patch, updatedAt: Date.now() };
        ctx.conversations.set(id, next);
        ctx.fire({ type: 'updated', conversation: toConversationSummary(next) });
        void ctx.persist();
        return next;
}

export function forkExtracted(ctx: any, id: string): QaapAgentConversation | undefined {
        const conv = ctx.conversations.get(id);
        if (!conv) {
            return undefined;
        }
        const now = Date.now();
        const forked: QaapAgentConversation = {
            ...conv,
            id: randomUUID(),
            title: `${conv.title} fork`,
            status: 'idle',
            createdAt: now,
            updatedAt: now,
            forkedFromId: conv.id,
            messages: conv.messages.map(message => ({
                ...message,
                id: randomUUID(),
                taskId: undefined,
                error: undefined,
            })),
        };
        ctx.conversations.set(forked.id, forked);
        ctx.fire({ type: 'created', conversation: toConversationSummary(forked) });
        void ctx.persist();
        return forked;
}

export function deleteExtracted(ctx: any, id: string): boolean {
        const conv = ctx.conversations.get(id);
        if (!conv) {
            return false;
        }
        ctx.conversations.delete(id);
        for (const [taskId, ref] of ctx.taskToConversation) {
            if (ref.conversationId === id) {
                ctx.taskToConversation.delete(taskId);
            }
        }
        ctx.fire({ type: 'deleted', conversationId: id, cwd: conv.cwd });
        void fsp.rm(ctx.visualEvidenceDirectory(id), { recursive: true, force: true }).catch(() => undefined);
        void ctx.persist();
        return true;
}

export function resolveVisualEvidenceTargetExtracted(ctx: any, conv: QaapAgentConversation,
        targetAgentMessageId: string | undefined,): QaapAgentMessage | undefined {
        return resolveVisualEvidenceTargetHelper(conv, targetAgentMessageId);
}

export function attachVisualVerificationBlockExtracted(ctx: any, conv: QaapAgentConversation,
        target: QaapAgentMessage,
        markdown: string,): QaapAgentConversation {
        const evidenceBlock = `---\n\n${markdown}`;
        const next: QaapAgentConversation = {
            ...conv,
            updatedAt: Date.now(),
            messages: conv.messages.map(message => message.id === target.id
                ? {
                    ...message,
                    content: `${message.content.trimEnd()}\n\n${evidenceBlock}`,
                    segments: message.segments?.length
                        ? [...message.segments, { type: 'text', content: evidenceBlock }]
                        : message.segments,
                }
                : message),
        };
        ctx.conversations.set(conv.id, next);
        ctx.publishFinalizedAgentMessage(conv.id, next, target.id);
        ctx.fire({ type: 'updated', conversation: toConversationSummary(next) });
        void ctx.persist();
        return next;
}

export function resolveVisualRepairSourceUserMessageExtracted(ctx: any, conv: QaapAgentConversation,
        target: QaapAgentMessage,): QaapAgentMessage | undefined {
        return resolveVisualRepairSourceUserMessageHelper(conv, target);
}

export async function failVisualRepairLoopExtracted(ctx: any, conv: QaapAgentConversation,
        sourceUserMessage: QaapAgentMessage,
        target: QaapAgentMessage,
        reason: string,): Promise<QaapAgentConversation> {
        const failed = ctx.markTurnFailed(conv, {
            userMessageId: sourceUserMessage.id,
            agentMessageId: target.id,
            reason,
            failureBody: target.content,
        });
        const next: QaapAgentConversation = {
            ...failed.conv,
            status: 'failed',
            updatedAt: Date.now(),
            messages: failed.conv.messages.map(message => message.id === target.id && message.role === 'agent'
                ? appendTracePreviewFailureEvent(message, reason)
                : message),
        };
        ctx.conversations.set(conv.id, next);
        ctx.publishFinalizedAgentMessage(conv.id, next, target.id, sourceUserMessage.turnAgentId);
        ctx.fire({ type: 'updated', conversation: toConversationSummary(next) });
        await ctx.persist();
        return next;
}

export async function continueVisualRepairLoopExtracted(ctx: any, conversationId: string,
        sourceAgentMessageId: string,): Promise<QaapAgentConversation | undefined> {
        let conv = ctx.conversations.get(conversationId);
        if (!conv || conv.status === 'failed' || conv.paused) {
            return conv;
        }
        const target = conv.messages.find(message => message.id === sourceAgentMessageId && message.role === 'agent');
        if (!target?.content.includes(QAAP_VISUAL_REPAIR_REQUIRED_MARKER)) {
            return conv;
        }
        // One failure report can arrive from the frontend and headless runner at nearly the same
        // time. A persisted child turns every replay into a read-only return.
        if (conv.messages.some(message =>
            message.role === 'user' && message.visualRepairSourceAgentMessageId === sourceAgentMessageId
        )) {
            return conv;
        }
        const sourceUserMessage = ctx.resolveVisualRepairSourceUserMessage(conv, target);
        if (!sourceUserMessage) {
            return conv;
        }
        const rootUserMessageId = sourceUserMessage.visualRepairRootMessageId
            ?? sourceUserMessage.autoContinueRootMessageId
            ?? sourceUserMessage.id;
        const attempts = ctx.countVisualRepairAttempts(conv, rootUserMessageId);
        if (attempts >= MAX_VISUAL_REPAIR_ATTEMPTS) {
            return ctx.failVisualRepairLoop(conv, sourceUserMessage, target, nls.localize(
                'qaap/visualRepair/exhausted',
                'Visual verification is still failing after {0} automatic repair attempts. The app is not render-ready.',
                MAX_VISUAL_REPAIR_ATTEMPTS,
            ));
        }
        if (!ctx.hasLoopSpawnBudget(rootUserMessageId)) {
            return ctx.failVisualRepairLoop(conv, sourceUserMessage, target, nls.localize(
                'qaap/visualRepair/sharedBudgetExhausted',
                'Visual verification failed and the turn has exhausted its safe automatic retry budget. The app is not render-ready.',
            ));
        }
        // Persist evidence BEFORE any new process. If the backend dies here, restoreFromDisk finds
        // this marker again and resumes exactly one repair; if it dies after the child is persisted,
        // the source-message dedupe above prevents a second one.
        await ctx.persist();
        conv = ctx.conversations.get(conversationId);
        const latestTarget = conv?.messages.find(message => message.id === sourceAgentMessageId && message.role === 'agent');
        if (!conv || conv.status !== 'idle' || conv.paused || !latestTarget
            || conv.messages[conv.messages.length - 1]?.id !== sourceAgentMessageId
            || conv.messages.some(message =>
                message.role === 'user' && message.visualRepairSourceAgentMessageId === sourceAgentMessageId
            )) {
            // A user follow-up/cancel/pause won the race while evidence flushed. Never layer an
            // autonomous repair over their newer intent.
            return conv;
        }
        const attempt = attempts + 1;
        const turnAgentId = sourceUserMessage.turnAgentId ?? conv.agentId;
        ctx.recordLoopSpawn(rootUserMessageId);
        const next = ctx.postUserMessage(
            conversationId,
            ctx.buildVisualRepairPrompt(latestTarget, attempt),
            turnAgentId,
            sourceUserMessage.turnAgentModel
            ?? (conv.agentId === turnAgentId ? conv.agentModel ?? conv.qaiqModel : undefined),
            conv.autoApprove,
            conv.interactionModeId,
            conv.approvalPolicyId,
            conv.toolApprovalRules,
            undefined,
            {
                autoContinueRootMessageId: rootUserMessageId,
                clientMessageId: `visual-repair:${sourceAgentMessageId}:${attempt}`,
                visualRepair: { rootUserMessageId, attempt, sourceAgentMessageId },
            },
        );
        await ctx.persist();
        return next;
}

export async function recordVisualVerificationExtracted(ctx: any, conversationId: string,
        result: QaapPreviewVisualValidationResult,
        png: Buffer,
        targetAgentMessageId?: string,
        previewUrl?: string,): Promise<QaapAgentConversation | undefined> {
        const conv = ctx.conversations.get(conversationId);
        if (!conv || png.length === 0) {
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
            const evidenceId = randomUUID();
            const directory = ctx.visualEvidenceDirectory(conversationId);
            await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
            await fsp.writeFile(path.join(directory, `${evidenceId}.png`), png, { mode: 0o600 });
            const imageUrl = `${QAAP_AGENT_CONVERSATION_API_PATH}/${encodeURIComponent(conversationId)}`
                + `/visual-verifications/${encodeURIComponent(evidenceId)}`;
            const next = ctx.attachVisualVerificationBlock(conv, target, buildQaapVisualVerificationMarkdown(imageUrl, result, previewUrl));
            return result.status === 'failed'
                ? await ctx.continueVisualRepairLoop(conversationId, target.id)
                : next;
        } finally {
            ctx.visualVerificationInFlight.delete(conversationId);
        }
}

export async function recordVisualVerificationVideoExtracted(ctx: any, conversationId: string,
        videoEvidenceId: string,
        steps: readonly { label: string; result: QaapPreviewVisualValidationResult }[],
        targetAgentMessageId: string,
        previewUrl?: string,): Promise<QaapAgentConversation | undefined> {
        const conv = ctx.conversations.get(conversationId);
        if (!conv || !/^[a-f\d-]{36}$/i.test(videoEvidenceId)) {
            return undefined;
        }
        if (!fs.existsSync(path.join(ctx.visualEvidenceDirectory(conversationId), `${videoEvidenceId}.webm`))) {
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
            const videoUrl = `${QAAP_AGENT_CONVERSATION_API_PATH}/${encodeURIComponent(conversationId)}`
                + `/visual-verifications/${encodeURIComponent(videoEvidenceId)}.webm`;
            const next = ctx.attachVisualVerificationBlock(conv, target, buildQaapVisualVideoMarkdown(videoUrl, steps, previewUrl));
            void ctx.sweepUnreferencedVisualEvidence(conversationId).catch(() => undefined);
            return steps.some(step => step.result.status === 'failed')
                ? await ctx.continueVisualRepairLoop(conversationId, target.id)
                : next;
        } finally {
            ctx.visualVerificationInFlight.delete(conversationId);
        }
}
