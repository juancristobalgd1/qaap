// Extracted from qaap-agent-conversation-store.ts
import type { QaapAgentConversationStoreContext } from './qaap-agent-conversation-store-context';

import { nls } from '@theia/core/lib/common/nls';

import { randomUUID } from 'crypto';

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { QAAP_AGENT_CONVERSATION_API_PATH, QaapAgentConversation, QaapAgentMessage, QaapUpdateAgentConversationRequest, toConversationSummary } from '../common/qaap-agent-conversation';

import { agentSupportsModelPicker } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-task-client';

import { collectSubtasksForLeader } from '../common/qaap-team-mailbox';

import { appendTracePreviewFailureEvent } from '@theia/qaap-mobile-shell/lib/common/qaap-transcript-trace-lifecycle';

import { QAAP_VISUAL_REPAIR_REQUIRED_MARKER, agentMessageHasVisualVerificationMarker, buildQaapVisualVerificationMarkdown, buildQaapVisualVideoMarkdown, type QaapPreviewVisualValidationResult } from '@theia/qaap-mobile-shell/lib/common/qaap-visual-verification';

import { resolveVisualEvidenceTarget as resolveVisualEvidenceTargetHelper, resolveVisualRepairSourceUserMessage as resolveVisualRepairSourceUserMessageHelper } from './qaap-agent-conversation-store-visual';

import { MAX_VISUAL_REPAIR_ATTEMPTS } from './qaap-agent-conversation-store-constants';

export function cancelRunExtracted(ctx: QaapAgentConversationStoreContext, id: string, userMessageId: string): QaapAgentConversation | undefined {
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

export function updateExtracted(ctx: QaapAgentConversationStoreContext, id: string, request: QaapUpdateAgentConversationRequest): QaapAgentConversation | undefined {
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

export function forkExtracted(ctx: QaapAgentConversationStoreContext, id: string): QaapAgentConversation | undefined {
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

export function deleteExtracted(ctx: QaapAgentConversationStoreContext, id: string): boolean {
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

export function resolveVisualEvidenceTargetExtracted(ctx: QaapAgentConversationStoreContext, conv: QaapAgentConversation,
        targetAgentMessageId: string | undefined, ): QaapAgentMessage | undefined {
        return resolveVisualEvidenceTargetHelper(conv, targetAgentMessageId);
}

export function attachVisualVerificationBlockExtracted(ctx: QaapAgentConversationStoreContext, conv: QaapAgentConversation,
        target: QaapAgentMessage,
        markdown: string, ): QaapAgentConversation {
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

export function resolveVisualRepairSourceUserMessageExtracted(ctx: QaapAgentConversationStoreContext, conv: QaapAgentConversation,
        target: QaapAgentMessage, ): QaapAgentMessage | undefined {
        return resolveVisualRepairSourceUserMessageHelper(conv, target);
}

export async function failVisualRepairLoopExtracted(ctx: QaapAgentConversationStoreContext, conv: QaapAgentConversation,
        sourceUserMessage: QaapAgentMessage,
        target: QaapAgentMessage,
        reason: string, ): Promise<QaapAgentConversation> {
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

export async function continueVisualRepairLoopExtracted(ctx: QaapAgentConversationStoreContext, conversationId: string,
        sourceAgentMessageId: string, ): Promise<QaapAgentConversation | undefined> {
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

export async function recordVisualVerificationExtracted(ctx: QaapAgentConversationStoreContext, conversationId: string,
        result: QaapPreviewVisualValidationResult,
        png: Buffer,
        targetAgentMessageId?: string,
        previewUrl?: string, ): Promise<QaapAgentConversation | undefined> {
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

export async function recordVisualVerificationVideoExtracted(ctx: QaapAgentConversationStoreContext, conversationId: string,
        videoEvidenceId: string,
        steps: readonly { label: string; result: QaapPreviewVisualValidationResult }[],
        targetAgentMessageId: string,
        previewUrl?: string, ): Promise<QaapAgentConversation | undefined> {
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
