// Extracted from qaap-agent-conversation-store.ts
import type { QaapAgentConversationStoreContext } from './qaap-agent-conversation-store-context';

import { randomUUID } from 'crypto';

import * as fs from 'fs';
import * as path from 'path';
import { QAAP_AGENT_CONVERSATION_API_PATH, QaapAgentConversation, QaapAgentMessage, QaapCreateAgentConversationRequest, toConversationSummary } from '../common/qaap-agent-conversation';

import { usesAgUiCliTranscriptStream, usesStructuredAgentTranscript } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';

import { DEFAULT_QAAP_CONTEXT_WINDOW, totalTokensFromContextUsage } from '@theia/qaap-shared-core/lib/common/qaap-agent-context-usage';

import { areAllSubtasksSettled, buildTeamSynthesisUserMessage, collectSubtasksForLeader, countFailedSubtasks, formatSubtaskMailboxMessage } from '../common/qaap-team-mailbox';

import type { QaapAgentTask, QaapAgentTaskEvent } from '../common/qaap-agent-task';

import { QaapConversationStreamMetricsCollector } from '@theia/qaap-shared-core/lib/common/qaap-agent-stream-metrics';

import { preferTraceFirstAgentMessageStorage } from '@theia/qaap-shared-core/lib/common/qaap-transcript-trace-backfill';

import { mergeAccumulatorTraceEvents } from '@theia/qaap-shared-core/lib/common/qaap-cli-transcript-stream';

import { mergeSegmentTraceEvents } from '@theia/qaap-shared-core/lib/common/qaap-transcript-trace-model';

import { agentMessageHasVisualVerificationMarker, buildQaapVisualFlowMarkdown, buildQaapVisualVerificationFailureMarkdown, type QaapPreviewVisualValidationResult, type QaapVisualFlowStepEvidence } from '@theia/qaap-shared-core/lib/common/qaap-visual-verification';

import { type ComposerGitActionDisplayMetadata } from '@theia/qaap-shared-core/lib/common/qaap-composer-git-action-display';

import { parseStructuredLog as parseStructuredLogHelper } from './qaap-agent-conversation-store-helpers';

import { recordGitAction as recordGitActionHelper } from './qaap-agent-conversation-store-helpers2';

import { type QaapConversationTaskRef } from './qaap-agent-conversation-store-constants';

export async function recordVisualVerificationFlowExtracted(ctx: QaapAgentConversationStoreContext, conversationId: string,
        steps: readonly { label: string; evidenceId: string; result: QaapPreviewVisualValidationResult }[],
        targetAgentMessageId: string,
        previewUrl?: string, ): Promise<QaapAgentConversation | undefined> {
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

export async function recordVisualVerificationFailureExtracted(ctx: QaapAgentConversationStoreContext, conversationId: string,
        reason: string,
        targetAgentMessageId: string, ): Promise<QaapAgentConversation | undefined> {
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

export function recordGitActionExtracted(ctx: QaapAgentConversationStoreContext, conversationId: string,
        metadata: ComposerGitActionDisplayMetadata,
        options: {
            readonly messageId?: string;
            readonly replaceMessageId?: string;
        } = {}, ): QaapAgentConversation | undefined {
        return recordGitActionHelper(conversationId, metadata, options, {
            getConversation: id => ctx.conversations.get(id),
            setConversation: (id, c) => ctx.conversations.set(id, c),
            fire: e => ctx.fire(e),
            persist: () => ctx.persist(),
        });
}

export function readVisualVerificationExtracted(ctx: QaapAgentConversationStoreContext, conversationId: string, evidenceId: string): Buffer | undefined {
        if (!ctx.conversations.has(conversationId) || !/^[a-f\d-]{36}$/i.test(evidenceId)) {
            return undefined;
        }
        try {
            return fs.readFileSync(path.join(ctx.visualEvidenceDirectory(conversationId), `${evidenceId}.png`));
        } catch {
            return undefined;
        }
}

export function onTaskChangedExtracted(ctx: QaapAgentConversationStoreContext, event: QaapAgentTaskEvent): void {
        if (event.type === 'reordered') {
            return;
        }
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

export function recordTaskLatencyMarksExtracted(ctx: QaapAgentConversationStoreContext, conversationId: string, task: QaapAgentTask): void {
        for (const [mark, at] of Object.entries(task.latencyMarks ?? {})) {
            ctx.streamMetrics.recordLatencyMark(
                conversationId,
                mark as Parameters<QaapConversationStreamMetricsCollector['recordLatencyMark']>[1],
                at,
            );
        }
}

export function recordSubmitLatencyMarksExtracted(ctx: QaapAgentConversationStoreContext, conversationId: string,
        latencyMarks: QaapCreateAgentConversationRequest['latencyMarks'] | undefined, ): void {
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

export async function deliverSubtaskMailboxExtracted(ctx: QaapAgentConversationStoreContext, task: QaapAgentTask): Promise<void> {
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

export function resolveLeaderTaskIdExtracted(ctx: QaapAgentConversationStoreContext, task: QaapAgentTask): string | undefined {
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

export function findConversationIdForLeaderTaskExtracted(ctx: QaapAgentConversationStoreContext, leaderTaskId: string): string | undefined {
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

export function maybeTriggerTeamSynthesisExtracted(ctx: QaapAgentConversationStoreContext, leaderTaskId: string, conversationId: string): void {
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

export function finishLeaderTurnAndMaybeSynthesizeExtracted(ctx: QaapAgentConversationStoreContext, conversationId: string,
        leaderTaskId: string,
        next: QaapAgentConversation, ): void {
        ctx.conversations.set(conversationId, next);
        ctx.fire({ type: 'updated', conversation: toConversationSummary(next) });
        ctx.flushPersist();
        ctx.pendingTeamSynthesisForLeader.delete(leaderTaskId);
        ctx.maybeTriggerTeamSynthesis(leaderTaskId, conversationId);
}

export function applyTaskOutputExtracted(ctx: QaapAgentConversationStoreContext, taskId: string,
        ref: QaapConversationTaskRef,
        chunk: string, ): void {
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

export function applyAgUiTaskOutputExtracted(ctx: QaapAgentConversationStoreContext, taskId: string,
        ref: QaapConversationTaskRef,
        chunk: string,
        agentId: string, ): void {
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

export function parseStructuredLogExtracted(ctx: QaapAgentConversationStoreContext, agentId: string,
        log: string, ): {
        content: string;
        segments: QaapAgentMessage['segments'];
        traceEvents: QaapAgentMessage['traceEvents'];
    } | undefined {
        return parseStructuredLogHelper(agentId, log);
}
