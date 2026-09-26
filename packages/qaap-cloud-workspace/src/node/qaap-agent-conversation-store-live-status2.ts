// Extracted from qaap-agent-conversation-store.ts
import type { QaapAgentConversationStoreContext } from './qaap-agent-conversation-store-context';

import { randomUUID } from 'crypto';

import type { QaapLinkedPullRequest } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';

import { QaapAgentConversation, QaapAgentConversationEvent, QaapAgentMessage, toConversationSummary } from '../common/qaap-agent-conversation';

import { DEFAULT_QAAP_CONTEXT_WINDOW, totalTokensFromContextUsage } from '@theia/qaap-shared-core/lib/common/qaap-agent-context-usage';

import { autoContinueAllowedForInteraction } from '@theia/qaap-transcript/lib/common/qaap-agent-turn-completion';

import { buildConversationAgentPrompt } from '../common/qaap-agent-conversation-prompt';

import { isTeamSynthesisUserMessage } from '../common/qaap-team-mailbox';

import type { QaapAgentTask } from '../common/qaap-agent-task';

import { countCompressedWireFields, logQaapStreamMetrics } from '@theia/qaap-shared-core/lib/common/qaap-agent-stream-metrics';

import { buildAgentMessageFromQaapAgUiReducer, reduceQaapAgUiTranscriptEvent, type QaapAgUiEvent } from '@theia/qaap-shared-core/lib/common/qaap-ag-ui-transcript-adapter';

import { backfillConversationTraceEvents } from '@theia/qaap-shared-core/lib/common/qaap-transcript-trace-backfill';
import type { QaapAgentConversationDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';

import { QAAP_VISUAL_REPAIR_REQUIRED_MARKER } from '@theia/qaap-shared-core/lib/common/qaap-visual-verification';

import { resolveRunAgentMessageId as resolveRunAgentMessageIdHelper, sweepZombieStreamingTurns as sweepZombieStreamingTurnsHelper, forceStopZombieTurn as forceStopZombieTurnHelper, fireAgentMessageWireUpdate as fireAgentMessageWireUpdateHelper } from './qaap-agent-conversation-store-helpers';

import { backfillQaapWorktreeOrdinals, parseQaapWorktreeOrdinalHighWater, QAAP_WORKTREE_ORDINAL_HIGH_WATER_KEY } from './qaap-worktree-ordinal-allocator';
import { STREAMING_PERSIST_DEBOUNCE_MS, TURN_WATCHDOG_SWEEP_MS, QAAP_AUTO_RESUME_TURNS_ENABLED, MAX_RESTART_RESUMES } from './qaap-agent-conversation-store-constants';

export function buildPromptExtracted(ctx: QaapAgentConversationStoreContext, conv: QaapAgentConversation, turnAgentId = conv.agentId): string {
    const lastUser = conv.messages[conv.messages.length - 1];
    const skipDelegation = isTeamSynthesisUserMessage(lastUser.content);
    const compaction = conv.contextCompaction?.status === 'complete' && conv.contextCompaction.summary?.trim()
        ? conv.contextCompaction
        : undefined;
    const historyStart = compaction?.compactedMessageCount ?? 0;
    const history = conv.messages.slice(historyStart, -1);
    const latestUser = ctx.stripLeadingAgentMention(lastUser.content);
    if (history.length === 0) {
        const prompt = compaction
            ? `${ctx.contextPreambleWithCompaction(conv.contextPreamble, compaction.summary!)}\n\nNow respond to the latest user message:\n\nUSER: ${latestUser}`
            : latestUser;
        return skipDelegation ? prompt : ctx.appendTeamDelegation(prompt, turnAgentId);
    }
    const transcript = buildConversationAgentPrompt({
        history,
        latestUserContent: latestUser,
        contextPreamble: compaction
            ? ctx.contextPreambleWithCompaction(conv.contextPreamble, compaction.summary!)
            : conv.contextPreamble,
        contextWindowSize: conv.contextWindowSize,
    });
    return skipDelegation ? transcript : ctx.appendTeamDelegation(transcript, turnAgentId);
}

export function resolveRunAgentMessageIdExtracted(ctx: QaapAgentConversationStoreContext, conv: QaapAgentConversation,
    run: { readonly userMessageId: string; readonly agentMessageId?: string }, ): string | undefined {
    return resolveRunAgentMessageIdHelper(conv, run);
}

export function applyAgUiTranscriptEventExtracted(ctx: QaapAgentConversationStoreContext, conversationId: string,
    event: QaapAgUiEvent,
    /** Mutated in place: an agent message created here is written back onto the run's ref. */
    run?: { readonly userMessageId: string; readonly turnAgentId?: string; agentMessageId?: string }, ): QaapAgentConversation | undefined {
    const conv = ctx.conversations.get(conversationId);
    if (!conv) {
        return undefined;
    }
    const now = Date.now();
    let agentMessageId = run
        ? ctx.resolveRunAgentMessageId(conv, run)
        : conv.messages[conv.messages.length - 1]?.role === 'agent'
            ? conv.messages[conv.messages.length - 1].id
            : undefined;
    let messages = conv.messages;
    if (!agentMessageId) {
        agentMessageId = randomUUID();
        const seed: QaapAgentMessage = {
            id: agentMessageId,
            role: 'agent',
            content: '',
            traceEvents: [],
            createdAt: now,
            ...(run ? { runUserMessageId: run.userMessageId } : {}),
        };
        messages = [...conv.messages, seed];
        if (run) {
            run.agentMessageId = agentMessageId;
        }
        ctx.agUiReducerByAgentMessageId.delete(agentMessageId);
    }
    const previousReducer = ctx.agUiReducerByAgentMessageId.get(agentMessageId);
    const previousMessage = messages.find(message => message.id === agentMessageId);
    const agentId = run?.turnAgentId
        ?? (previousMessage ? ctx.resolveAgentIdForAgentMessage(conv, previousMessage) : conv.agentId);
    const { next: reducer } = reduceQaapAgUiTranscriptEvent(previousReducer, event, {
        agentMessageId,
        createdAt: previousMessage?.createdAt ?? now,
        agentId,
    });
    ctx.agUiReducerByAgentMessageId.set(agentMessageId, reducer);
    const rebuilt = buildAgentMessageFromQaapAgUiReducer(
        reducer,
        previousMessage?.createdAt ?? now,
    );
    // The reducer only knows the trace, so it rebuilds the message from scratch every tick.
    // Which run owns the message, and whether that run is still live, are not part of that
    // trace — carry both across, or they would survive exactly until the next event arrived.
    // `runActive` is carried, never re-asserted: once the turn settles and clears it, a late
    // event must not resurrect the marker.
    const runOwner = previousMessage?.runUserMessageId ?? run?.userMessageId;
    const agentMessage: QaapAgentMessage = {
        ...rebuilt,
        ...(runOwner ? { runUserMessageId: runOwner } : {}),
        ...(previousMessage?.runActive ? { runActive: true } : {}),
        ...(previousMessage?.runFinishedAt !== undefined ? { runFinishedAt: previousMessage.runFinishedAt } : {}),
    };
    messages = messages.map(message => message.id === agentMessageId ? agentMessage : message);
    const next: QaapAgentConversation = {
        ...conv,
        status: 'streaming',
        updatedAt: now,
        messages,
        ...(totalTokensFromContextUsage(conv.contextUsage) === 0 ? { contextUsageEstimated: true } : {}),
        contextWindowSize: conv.contextWindowSize ?? DEFAULT_QAAP_CONTEXT_WINDOW,
    };
    ctx.conversations.set(conversationId, next);
    ctx.fireAgentMessageWireUpdate(conversationId, next.cwd, agentId, agentMessage);
    ctx.fire({ type: 'updated', conversation: toConversationSummary(next) });
    ctx.schedulePersist();
    // Optimization A: drain queued messages at tool-round boundaries. When a tool
    // call completes (TOOL_CALL_END or TOOL_CALL_RESULT), inject pending follow-ups
    // into the live stream-json agent so the next LLM round sees them.
    if (event.type === 'TOOL_CALL_END' || event.type === 'TOOL_CALL_RESULT') {
        ctx.maybeDrainAtToolRoundBoundary(conversationId);
    }
    return next;
}

export function clearAgUiReducerExtracted(ctx: QaapAgentConversationStoreContext, agentMessageId: string | undefined): void {
    if (agentMessageId) {
        ctx.agUiReducerByAgentMessageId.delete(agentMessageId);
    }
}

export function stageWireMetricsBaselineExtracted(ctx: QaapAgentConversationStoreContext, conversationId: string,
    messageId: string,
    baseline: QaapAgentConversationEvent, ): void {
    ctx.wireMetricsBaselines.set(`${conversationId}:${messageId}`, baseline);
}

export function recordStreamMetricsExtracted(ctx: QaapAgentConversationStoreContext, event: QaapAgentConversationEvent): void {
    const conversationId = event.type === 'message' || event.type === 'message_delta'
        ? event.conversationId
        : event.type === 'updated' || event.type === 'created'
            ? event.conversation.id
            : undefined;
    if (!conversationId) {
        return;
    }
    const baselineKey = event.type === 'message_delta'
        ? `${event.conversationId}:${event.messageId}`
        : event.type === 'message'
            ? `${event.conversationId}:${event.message.id}`
            : undefined;
    const baseline = baselineKey ? ctx.wireMetricsBaselines.get(baselineKey) : undefined;
    if (baselineKey) {
        ctx.wireMetricsBaselines.delete(baselineKey);
    }
    ctx.streamMetrics.recordWireEvent(conversationId, event.type, event, {
        uncompressedPayload: baseline,
        compressedFieldCount: countCompressedWireFields(event),
    });
    if (event.type === 'updated' && event.conversation.status !== 'streaming') {
        logQaapStreamMetrics(ctx.streamMetrics.finishTurn(conversationId));
    }
}

export function fireAgentMessageWireUpdateExtracted(ctx: QaapAgentConversationStoreContext, conversationId: string,
    cwd: string,
    agentId: string,
    message: QaapAgentMessage,
    options?: { forceFullMessage?: boolean }, ): void {
    fireAgentMessageWireUpdateHelper(conversationId, cwd, agentId, message, options, {
        lastWireMessageById: ctx.lastWireMessageById,
        stageWireMetricsBaseline: (cid, mid, evt) => ctx.stageWireMetricsBaseline(cid, mid, evt),
        fire: e => ctx.fire(e),
    });
}

export function schedulePersistExtracted(ctx: QaapAgentConversationStoreContext): void {
    if (ctx.persistTimer !== undefined) {
        return;
    }
    ctx.persistTimer = setTimeout(() => {
        ctx.persistTimer = undefined;
        void ctx.persist();
    }, STREAMING_PERSIST_DEBOUNCE_MS);
}

export function flushPersistExtracted(ctx: QaapAgentConversationStoreContext): void {
    if (ctx.persistTimer !== undefined) {
        clearTimeout(ctx.persistTimer);
        ctx.persistTimer = undefined;
    }
    void ctx.persist();
}

export function tryAutoLinkConversationToGitBranchExtracted(ctx: QaapAgentConversationStoreContext, conv: QaapAgentConversation): QaapAgentConversation | undefined {
    if (conv.linkedPullRequest?.number) {
        return undefined;
    }
    const repo = ctx.parseGithubRepoFromCwd(conv.cwd);
    const branch = ctx.readGitBranch(conv.cwd);
    if (!repo || !branch) {
        return undefined;
    }
    const link: QaapLinkedPullRequest = {
        ...conv.linkedPullRequest,
        owner: repo.owner,
        repo: repo.name,
        branch,
    };
    if (conv.linkedPullRequest
        && conv.linkedPullRequest.owner === link.owner
        && conv.linkedPullRequest.repo === link.repo
        && conv.linkedPullRequest.branch === link.branch) {
        return undefined;
    }
    return { ...conv, linkedPullRequest: link, updatedAt: Date.now() };
}

export function cwdMatchesGithubRepoExtracted(ctx: QaapAgentConversationStoreContext, cwd: string, owner: string, repo: string): boolean {
    const parsed = ctx.parseGithubRepoFromCwd(cwd);
    if (!parsed) {
        return false;
    }
    return parsed.owner.toLowerCase() === owner.toLowerCase()
        && parsed.name.toLowerCase() === repo.toLowerCase();
}

/** Runs one restore phase without allowing a corrupt conversation to abort the remaining set. */
export async function runQaapConversationRestoreStep<T extends { readonly id: string }>(
    conversations: Iterable<T>,
    phase: string,
    step: (conversation: T) => Promise<boolean>,
): Promise<boolean> {
    let changedAny = false;
    for (const conversation of conversations) {
        try {
            changedAny = await step(conversation) || changedAny;
        } catch (error) {
            console.warn(`[qaap-conversation-store] ${phase} failed for ${conversation.id}:`, error);
        }
    }
    return changedAny;
}

export async function restoreFromDiskExtracted(ctx: QaapAgentConversationStoreContext): Promise<void> {
    try {
        const store = ctx.getSqliteStore();
        try {
            store.migrateLegacy<QaapAgentConversation[]>(raw => [['conversations', JSON.parse(raw) as QaapAgentConversation[]]]);
        } catch {
            // A malformed legacy file must not hide valid SQLite state.
        }
        const stored = store.get<QaapAgentConversation[]>('conversations') ?? [];
        let anyChanged = false;
        for (const conv of stored) {
            // Leave a persisted 'streaming' status as-is here — sweepZombieStreamingTurns below
            // (run once every restart, after every conversation is loaded) force-stops any turn
            // that already exceeded the max duration with a proper failed/error trace. A restart
            // always drops the live task handle, so a turn still within budget can never complete
            // on its own either; that case is finalized as interrupted (also with a visible trace)
            // via interruptStreamingTurnForRestart rather than silently reset to 'idle'.
            // See the identical cast/comment in qaap-agent-conversation-store-render2.ts#getExtracted:
            // trace-backfill helpers are typed against the client QaapAgentConversationDTO but only
            // read/spread fields structurally shared with the server QaapAgentConversation.
            const { conversation, changed } = backfillConversationTraceEvents(conv as unknown as QaapAgentConversationDTO);
            ctx.conversations.set(conversation.id, conversation as unknown as QaapAgentConversation);
            if (changed) {
                anyChanged = true;
            }
        }
        const highWater = ctx.worktreeOrdinalHighWater;
        if (highWater) {
            for (const [key, value] of parseQaapWorktreeOrdinalHighWater(store.get(QAAP_WORKTREE_ORDINAL_HIGH_WATER_KEY))) {
                highWater.set(key, Math.max(value, highWater.get(key) ?? 0));
            }
        }
        // Freeze `<projectName>_<n>` labels of worktree conversations created before ordinals existed.
        if (backfillQaapWorktreeOrdinals(ctx)) {
            anyChanged = true;
        }
        const now = Date.now();
        // First try to auto-resume turns the restart interrupted (bounded, persisted counter).
        // A turn that resumes gets a live task, so the sweep below skips it (getActiveTaskIds guard).
        const resumedAny = await runQaapConversationRestoreStep(
            [...ctx.conversations.values()] as QaapAgentConversation[],
            'restart resume',
            async conv => conv.status === 'streaming' && ctx.maybeAutoResumeInterruptedTurn(conv.id, now),
        );
        const sweptAny = ctx.sweepZombieStreamingTurns(now, { resetSurvivorsToIdle: true });
        // Evidence is persisted before its repair process is spawned. A hard kill in that
        // narrow gap therefore leaves an idle tail with `[QAAP repair required]`; resume it
        // here through the same idempotent loop instead of silently abandoning the result.
        const visualRepairResumedAny = await runQaapConversationRestoreStep(
            [...ctx.conversations.values()] as QaapAgentConversation[],
            'visual repair resume',
            async conv => {
                const last = conv.messages[conv.messages.length - 1];
                if (conv.status !== 'idle' || last?.role !== 'agent'
                    || !last.content.includes(QAAP_VISUAL_REPAIR_REQUIRED_MARKER)) {
                    return false;
                }
                const before = ctx.conversations.get(conv.id);
                const after = await ctx.continueVisualRepairLoop(conv.id, last.id);
                return after !== before;
            },
        );
        if (ctx.isTurnGraphEnabled()) {
            // After resume and sweep have settled every conversation's fate, close graph runs
            // whose turn is no longer live (lost terminal report, deleted conversation).
            await ctx.reapOrphanedChatTurnRuns().catch((error: unknown) => {
                console.warn('[qaap-conversation-store] orphaned graph-run reap failed:', error);
            });
        }
        if (anyChanged || resumedAny || sweptAny || visualRepairResumedAny) {
            await ctx.persist();
        }
    } catch {
        /* no prior conversations */
    }
}

export function startTurnWatchdogExtracted(ctx: QaapAgentConversationStoreContext): void {
    if (ctx.turnWatchdogTimer !== undefined) {
        return;
    }
    ctx.turnWatchdogTimer = setInterval(() => {
        ctx.sweepZombieStreamingTurns(Date.now());
    }, TURN_WATCHDOG_SWEEP_MS);
    ctx.turnWatchdogTimer.unref?.();
}

export function sweepZombieStreamingTurnsExtracted(ctx: QaapAgentConversationStoreContext, nowMs: number, options?: { readonly resetSurvivorsToIdle?: boolean }): boolean {
    return sweepZombieStreamingTurnsHelper(nowMs, options, {
        conversations: ctx.conversations,
        turnHasPendingApproval: c => ctx.turnHasPendingApproval(c),
        forceStopZombieTurn: (id, elapsed, max) => ctx.forceStopZombieTurn(id, elapsed, max),
        getActiveTaskIdsForConversation: id => ctx.getActiveTaskIdsForConversation(id),
        interruptStreamingTurnForRestart: (id, t) => ctx.interruptStreamingTurnForRestart(id, t),
        flushPersist: () => ctx.flushPersist(),
    });
}

export function forceStopZombieTurnExtracted(ctx: QaapAgentConversationStoreContext, conversationId: string, elapsedMs: number, maxTurnMinutes: number): boolean {
    return forceStopZombieTurnHelper(conversationId, elapsedMs, maxTurnMinutes, {
        conversations: ctx.conversations,
        taskToConversation: ctx.taskToConversation,
        taskRunner: ctx.taskRunner,
        appendRunCancelledTrace: (c, aid, r) => ctx.appendRunCancelledTrace(c, aid, r),
        finalizeStreamingAgentMessage: (c, aid, r) => ctx.finalizeStreamingAgentMessage(c, aid, r),
        markTurnFailed: (c, info) => ctx.markTurnFailed(c, info),
        publishFinalizedAgentMessage: (id, c, aid) => ctx.publishFinalizedAgentMessage(id, c, aid),
        fire: e => ctx.fire(e),
    });
}

export async function maybeAutoResumeInterruptedTurnExtracted(ctx: QaapAgentConversationStoreContext, conversationId: string, nowMs: number): Promise<boolean> {
    if (!QAAP_AUTO_RESUME_TURNS_ENABLED || MAX_RESTART_RESUMES <= 0) {
        return false;
    }
    const conv = ctx.conversations.get(conversationId);
    if (!conv || conv.status !== 'streaming') {
        return false;
    }
    // A turn deliberately paused on a human decision (plan/ask mode, request-approval /
    // manual-approve) must NOT be relaunched as an autonomous run — that would execute the very
    // tool the user was about to approve or reject. Same guard as maybeAutoContinueIncompleteTurn.
    if (!autoContinueAllowedForInteraction(conv)) {
        return false;
    }
    const turnUserMessage = [...conv.messages].reverse().find(message => message.role === 'user' && message.taskId)
        ?? [...conv.messages].reverse().find(message => message.role === 'user');
    const turnAgentId = turnUserMessage?.turnAgentId ?? conv.agentId;
    if (!turnUserMessage || !turnAgentId) {
        return false;
    }
    const userMessageId = turnUserMessage.id;
    // Charge the counter to the human-authored root so an auto-continue chain shares one budget.
    const rootUserMessageId = ctx.resolveLoopBudgetKey(conv, userMessageId);
    const rootUserMessage = conv.messages.find(message => message.id === rootUserMessageId && message.role === 'user')
        ?? turnUserMessage;
    if ((rootUserMessage.restartResumeCount ?? 0) >= MAX_RESTART_RESUMES) {
        return false;
    }
    if (ctx.isTurnGraphEnabled() && ctx.workflowRuns) {
        return ctx.resumeInterruptedTurnViaGraph(conv, turnUserMessage, rootUserMessage, turnAgentId, nowMs);
    }
    const nextResumeCount = (rootUserMessage.restartResumeCount ?? 0) + 1;
    const lastMessage = conv.messages[conv.messages.length - 1];
    const agentMessageId = lastMessage?.role === 'agent' ? lastMessage.id : undefined;
    // Drop the orphaned partial agent output (the CLI is stateless; context is rebuilt from the
    // conversation), clear the dead task link, and stamp the incremented resume counter.
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
    // Persist the incremented counter BEFORE spawning. persist() is best-effort/async, so if we
    // spawned first and the container were OOM-killed again before the counter reached disk, the
    // next boot would read the stale lower count and resume forever. Awaiting the flush here makes
    // progress monotonic under a hard kill: each turn resumes at most MAX_RESTART_RESUMES times
    // across ALL restarts.
    ctx.conversations.set(conversationId, resumeConv);
    await ctx.persist();
    let spawned: QaapAgentTask;
    try {
        spawned = ctx.taskRunner.create(
            ctx.buildTaskCreateRequest(resumeConv, turnAgentId, undefined, userMessageId),
            resumeConv.ownerLogin,
        );
    } catch {
        // cwd gone / runner refused: degrade to the manual "Retry to continue" flow. The counter
        // is already persisted, so this turn will not be retried automatically again.
        ctx.interruptStreamingTurnForRestart(conversationId, nowMs);
        return true;
    }
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
        + `(attempt ${nextResumeCount}/${MAX_RESTART_RESUMES}).`,
    );
    return true;
}
