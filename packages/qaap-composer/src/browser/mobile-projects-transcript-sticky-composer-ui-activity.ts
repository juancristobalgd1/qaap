import type { MobileProjectsTranscriptStickyComposerUiContext } from './mobile-projects-transcript-sticky-composer-ui-context';
// Extracted from mobile-projects-transcript-sticky-composer-ui.ts

import { nls } from '@theia/core/lib/common/nls';
import {
    conversationToSummary,
    getConversation,
    isMaxConcurrentRunsError,
    updateConversation,
    type QaapAgentConversationDTO,
    type QaapAgentConversationSummaryDTO,
    type QaapMessageDeliveryMode,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';

import {
    QAAP_COMPOSER_DEFAULT_AGENT_ID,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import { isTranscriptSummaryAgentWorking } from '@theia/qaap-shared-core/lib/common/qaap-transcript-turn-status';
import {
    applyConversationComposerPrefs,
    applyProjectComposerDefaults,
    buildRuntimeComposerPersistPatch,
    extractConversationComposerPrefs,
    extractConversationComposerPrefsFromSummary,
    readConversationComposerDraft,
    writeConversationComposerDraft,
} from '../common/qaap-conversation-composer-state';
import {
    reconcileComposerModeId,
    resolveStickyComposerModes,
} from '@theia/qaap-shared-core/lib/common/qaap-sticky-composer-mode';
import {
    reconcileAgentApprovalPolicyId,
} from '@theia/qaap-shared-core/lib/common/qaap-sticky-composer-approval-policy';
import {
    reconcileAgentToolApprovalRules,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-tool-approval-rules';
import {
    type TranscriptFollowUpEntry,
} from '@theia/qaap-transcript-overlay/lib/common/qaap-transcript-follow-up-queue';
import { isAgentsHubIdleConversationSummary } from '@theia/qaap-shared-core/lib/common/qaap-agents-hub-landing';
import { readProjectComposerDraft } from '../common/qaap-project-composer-draft';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import { MobileSnackbar } from '@theia/qaap-mobile-mechanics/lib/browser/mobile-snackbar';

export async function startPeerRunOrQueueExtracted(ctx: MobileProjectsTranscriptStickyComposerUiContext, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    entry: TranscriptFollowUpEntry,): Promise<boolean> {
    if (await ctx.startIsolatedRunIfRequested(project, entry)) {
        return true;
    }
    // Busy Send queues on the server by default. Alt+Enter / Cmd+Enter set
    // entry.deliveryMode to parallel / interrupt.
    const deliveryMode = (entry as TranscriptFollowUpEntry & { deliveryMode?: QaapMessageDeliveryMode }).deliveryMode ?? 'queue';
    if (deliveryMode === 'parallel') {
        try {
            await ctx.host.submitBackgroundAgentTask(project, entry.draft, {
                openConversation: true,
                forceVps: true,
                worktree: true,
                selectedAgentId: entry.selectedAgentId,
                modeId: entry.modeId,
                autoApprove: entry.autoApprove,
                approvalPolicyId: entry.approvalPolicyId,
                agentModel: ctx.host.transcriptComposerAgentModel,
                variables: entry.variables,
                imagePreviews: entry.imagePreviews,
            });
            MobileSnackbar.show(
                nls.localize(
                    'qaap/mobileProjects/isolatedParallelStarted',
                    'Started in an isolated worktree — the current agent keeps working',
                ),
                { duration: 2600 },
            );
            return true;
        } catch (error) {
            if (!isMaxConcurrentRunsError(error)) {
                const detail = error instanceof Error ? error.message : String(error);
                ctx.host.messageService?.error(nls.localize(
                    'qaap/mobileProjects/transcriptSendFailed', 'Could not send: {0}', detail,
                ));
                return false;
            }
            return ctx.queuePeerRunMessage(summary, entry);
        }
    }
    try {
        const submitted = await ctx.host.submitTranscriptViaBackendConversation(project, summary, entry.draft, {
            selectedAgentId: entry.selectedAgentId,
            modeId: entry.modeId,
            autoApprove: entry.autoApprove,
            approvalPolicyId: entry.approvalPolicyId,
            agentModel: ctx.host.transcriptComposerAgentModel,
            variables: entry.variables,
            imagePreviews: entry.imagePreviews,
            deliveryMode,
        });
        if (!submitted) {
            // Another POST for this conversation was still open (rapid-fire sends): the
            // message never left. Fall back to the local queue — the caller (composer
            // submit path) has NOT cleared the draft yet at this point, so a `false`
            // return here would still let it restore the draft; a `true` return (via the
            // queue) tells it the message is safely held instead and it can clear.
            return ctx.queuePeerRunMessage(summary, entry);
        }
        if (deliveryMode === 'queue') {
            MobileSnackbar.show(
                nls.localize(
                    'qaap/mobileProjects/messageQueued',
                    'Message queued — will be sent when the agent finishes',
                ),
                { duration: 2600 },
            );
        }
        return true;
    } catch (error) {
        if (!isMaxConcurrentRunsError(error)) {
            const detail = error instanceof Error ? error.message : String(error);
            ctx.host.messageService?.error(nls.localize(
                'qaap/mobileProjects/transcriptSendFailed', 'Could not send: {0}', detail,
            ));
            return false;
        }
        // Session is already at the agent limit — hold the message in the queue, where it
        // flushes (or can be dispatched by hand) as soon as one of the runs finishes.
        return ctx.queuePeerRunMessage(summary, entry);
    }
}

export function queuePeerRunMessageExtracted(ctx: MobileProjectsTranscriptStickyComposerUiContext, summary: QaapAgentConversationSummaryDTO,
    entry: TranscriptFollowUpEntry,): boolean {
    if (!ctx.enqueueTranscriptFollowUp(summary.id, entry)) {
        // Queue is full too — the only case where the message cannot be kept anywhere.
        ctx.host.messageService?.error(nls.localize(
            'qaap/mobileProjects/peerRunQueueFull',
            'Could not send: this session already has the maximum number of agents and queued messages.',
        ));
        return false;
    }
    // Show every queued follow-up in the open transcript immediately (Queued footer rows),
    // then expand the composer popover. Mirror POST may still be in flight.
    ctx.syncTranscriptQueuedFollowUpBubbles?.(summary);
    ctx.refreshComposerActivityStack();
    return true;
}

/**
 * Mirror a local composer-queue entry onto durable server `pendingUserMessages` so F5
 * does not drop it. Tags the local entry with {@link TranscriptFollowUpEntry.serverPendingId}
 * so settle flush / Edit / Cancel talk to the same server row.
 *
 * Resolves `false` when the mirror could not be confirmed (POST rejected/skipped, or the
 * server call threw) so the caller can warn that the follow-up only lives in the local
 * queue and may not survive a reload. Resolves `true` once the POST is accepted — including
 * when the local queue entry could not be tagged with a `serverPendingId` (the server still
 * has the message; only the local Edit/Cancel correlation is best-effort).
 */
export async function mirrorFollowUpToServerQueueExtracted(
    ctx: MobileProjectsTranscriptStickyComposerUiContext,
    project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    entry: TranscriptFollowUpEntry,
): Promise<boolean> {
    try {
        const submitted = await ctx.host.submitTranscriptViaBackendConversation(project, summary, entry.draft, {
            selectedAgentId: entry.selectedAgentId,
            modeId: entry.modeId,
            autoApprove: entry.autoApprove,
            approvalPolicyId: entry.approvalPolicyId,
            agentModel: ctx.host.transcriptComposerAgentModel,
            variables: entry.variables,
            imagePreviews: entry.imagePreviews,
            deliveryMode: 'queue',
        });
        if (!submitted) {
            return false;
        }
        const conv = ctx.host.transcriptLastConv;
        if (!conv || conv.id !== summary.id) {
            return true;
        }
        const pending = [...(conv.pendingUserMessages ?? [])]
            .reverse()
            .find(item => item.content === entry.draft || item.content?.endsWith(entry.draft));
        if (!pending) {
            return true;
        }
        const queue = ctx.host.transcriptFollowUpQueue.peek(summary.id);
        for (let index = queue.length - 1; index >= 0; index -= 1) {
            const current = queue[index];
            if (current.draft === entry.draft && !current.serverPendingId) {
                ctx.host.transcriptFollowUpQueue.replaceAt(summary.id, index, {
                    ...current,
                    serverPendingId: pending.id,
                    serverSynced: true,
                });
                ctx.syncTranscriptQueuedFollowUpBubbles?.(summary);
                ctx.refreshComposerActivityStack();
                break;
            }
        }
        return true;
    } catch {
        // Local popover still owns the follow-up; durability is best-effort.
        return false;
    }
}

export async function submitQueuedFollowUpEntryExtracted(ctx: MobileProjectsTranscriptStickyComposerUiContext, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    entry: TranscriptFollowUpEntry,
    options: { readonly parallel?: boolean; readonly deliveryMode?: QaapMessageDeliveryMode } = {},): Promise<void> {
    ctx.host.transcriptFollowUpFlushInFlight = true;
    try {
        await ctx.host.submitTranscriptViaBackendConversation(project, summary, entry.draft, {
            selectedAgentId: entry.selectedAgentId,
            modeId: entry.modeId,
            autoApprove: entry.autoApprove,
            approvalPolicyId: entry.approvalPolicyId,
            agentModel: ctx.host.transcriptComposerAgentModel,
            variables: entry.variables,
            imagePreviews: entry.imagePreviews,
            ...(options.parallel ? { parallel: true } : {}),
            ...(options.deliveryMode ? { deliveryMode: options.deliveryMode } : {}),
        });
    } catch (error) {
        ctx.host.transcriptFollowUpQueue.unshift(summary.id, entry);
        const detail = error instanceof Error ? error.message : String(error);
        ctx.host.messageService?.error(nls.localize(
            'qaap/mobileProjects/transcriptSendFailed', 'Could not send: {0}', detail,
        ));
    } finally {
        ctx.host.transcriptFollowUpFlushInFlight = false;
        ctx.remountTranscriptStickyComposer();
    }
}

export function isTranscriptStickyComposerAgentWorkingExtracted(ctx: MobileProjectsTranscriptStickyComposerUiContext): boolean {
    const summary = ctx.host.transcriptComposerSummary;
    if (!summary || !ctx.host.transcriptComposerHost?.isConnected) {
        return false;
    }
    const conv = ctx.host.transcriptLastConv?.id === summary.id
        ? ctx.host.transcriptLastConv
        : undefined;
    if (isTranscriptSummaryAgentWorking(summary, conv)) {
        return true;
    }
    if (summary.source === 'theia-chat' && ctx.host.chatService) {
        const sessionId = summary.sessionId ?? ctx.host.transcriptTheiaSessionByConversationId.get(summary.id);
        const session = sessionId ? ctx.host.chatService.getSession(sessionId) : undefined;
        if (session && ctx.host.chatServiceSummariesUi.isChatSessionWorking(session)) {
            return true;
        }
    }
    return false;
}

export function stopOpenComposerAgentLikeComposerStopExtracted(ctx: MobileProjectsTranscriptStickyComposerUiContext): boolean {
    let project = ctx.host.transcriptComposerProject
        ?? ctx.host.transcriptOpenProject;
    let summary = ctx.host.transcriptComposerSummary
        ?? ctx.host.transcriptOpenSummary;
    if (!project || !summary) {
        return false;
    }
    if (isAgentsHubIdleConversationSummary(summary)) {
        project = ctx.workHub.resolveShellProject() ?? project;
        summary = ctx.workHub.resolveShellSummary(project) ?? summary;
        if (isAgentsHubIdleConversationSummary(summary)) {
            return false;
        }
    }
    // Mirror composer Stop: cancel even when status briefly lags behind the Stop affordance.
    if (!ctx.isTranscriptStickyComposerAgentWorking() && summary.status !== 'streaming') {
        return false;
    }
    ctx.host.onCancelConversation(project, summary);
    ctx.host.transcriptComposerSendRefresh?.();
    return true;
}

export function applyTranscriptComposerPrefsFromConversationExtracted(ctx: MobileProjectsTranscriptStickyComposerUiContext, conv: QaapAgentConversationDTO,
    project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): void {
    if (summary.source === 'theia-chat' || isAgentsHubIdleConversationSummary(summary)) {
        return;
    }
    ctx.applyTranscriptComposerPrefs(extractConversationComposerPrefs(conv), project, summary, conv.id);
}

export function applyTranscriptComposerPrefsExtracted(ctx: MobileProjectsTranscriptStickyComposerUiContext, prefs: ReturnType<typeof extractConversationComposerPrefs>,
    project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    conversationId: string,): void {
    const cwd = ctx.host.projectsService.getProjectCwd(project) ?? summary.cwd;
    applyConversationComposerPrefs(prefs, cwd, conversationId);
    ctx.host.transcriptComposerPrefsConvId = conversationId;
    ctx.host.transcriptComposerPinnedAgentId = prefs.agentId;
    ctx.host.transcriptComposerAgentModel = prefs.agentModel;
    const modes = resolveStickyComposerModes(prefs.agentId, ctx.host.chatAgentService);
    ctx.host.transcriptComposerModeId = reconcileComposerModeId(
        prefs.interactionModeId,
        modes,
        cwd,
    );
    ctx.host.transcriptComposerApprovalPolicyId = reconcileAgentApprovalPolicyId(
        prefs.approvalPolicyId,
        cwd,
    );
    ctx.host.transcriptComposerToolApprovalRules = prefs.toolApprovalRules;
    ctx.host.transcriptComposerDraft = readConversationComposerDraft(conversationId);
}

export function resetToProjectComposerDefaultsExtracted(ctx: MobileProjectsTranscriptStickyComposerUiContext, project: MobileProjectEntry,
    defaultAgentId: string = QAAP_COMPOSER_DEFAULT_AGENT_ID,): void {
    const cwd = ctx.host.projectsService.getProjectCwd(project);
    const runtime = applyProjectComposerDefaults(cwd, defaultAgentId);
    ctx.host.transcriptComposerPrefsConvId = undefined;
    ctx.host.transcriptComposerPinnedAgentId = runtime.pinnedAgentId;
    ctx.host.transcriptComposerAgentModel = runtime.agentModel;
    const modes = resolveStickyComposerModes(runtime.pinnedAgentId, ctx.host.chatAgentService);
    ctx.host.transcriptComposerModeId = reconcileComposerModeId(runtime.modeId, modes, cwd);
    ctx.host.transcriptComposerApprovalPolicyId = reconcileAgentApprovalPolicyId(
        runtime.approvalPolicyId,
        cwd,
    );
    ctx.host.transcriptComposerToolApprovalRules = runtime.toolApprovalRules;
    ctx.host.transcriptComposerDraft = '';
}

export async function hydrateTranscriptComposerPrefsExtracted(ctx: MobileProjectsTranscriptStickyComposerUiContext, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): Promise<boolean> {
    if (summary.source === 'theia-chat' || isAgentsHubIdleConversationSummary(summary)) {
        return false;
    }
    if (ctx.host.transcriptComposerPrefsConvId === summary.id) {
        return false;
    }
    const prefsFromSummary = extractConversationComposerPrefsFromSummary(summary);
    if (prefsFromSummary && (summary.agentModel ?? summary.qaiqModel ?? summary.interactionModeId)) {
        ctx.applyTranscriptComposerPrefs(prefsFromSummary, project, summary, summary.id);
        return true;
    }
    const conv = ctx.host.transcriptLastConv?.id === summary.id
        ? ctx.host.transcriptLastConv
        : ctx.host.conversations?.threadStore.getDocument(summary.id)
        ?? await getConversation(summary.id).catch(() => undefined);
    if (!conv || conv.id !== summary.id) {
        return false;
    }
    ctx.applyTranscriptComposerPrefsFromConversation(conv, project, summary);
    return true;
}

export function schedulePersistTranscriptComposerDraftExtracted(ctx: MobileProjectsTranscriptStickyComposerUiContext, conversationId: string | undefined): void {
    if (!conversationId) {
        return;
    }
    if (ctx.host.transcriptComposerDraftPersistTimer !== undefined) {
        window.clearTimeout(ctx.host.transcriptComposerDraftPersistTimer);
    }
    ctx.host.transcriptComposerDraftPersistTimer = window.setTimeout(() => {
        ctx.host.transcriptComposerDraftPersistTimer = undefined;
        writeConversationComposerDraft(conversationId, ctx.host.transcriptComposerDraft);
    }, 280);
}

export function flushTranscriptComposerDraftExtracted(ctx: MobileProjectsTranscriptStickyComposerUiContext, conversationId: string | undefined): void {
    if (ctx.host.transcriptComposerDraftPersistTimer !== undefined) {
        window.clearTimeout(ctx.host.transcriptComposerDraftPersistTimer);
        ctx.host.transcriptComposerDraftPersistTimer = undefined;
    }
    if (conversationId) {
        writeConversationComposerDraft(conversationId, ctx.host.transcriptComposerDraft);
    }
}

export function schedulePersistTranscriptComposerPrefsExtracted(ctx: MobileProjectsTranscriptStickyComposerUiContext, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): void {
    if (summary.source === 'theia-chat' || isAgentsHubIdleConversationSummary(summary)) {
        return;
    }
    if (ctx.host.transcriptComposerPrefsPersistTimer !== undefined) {
        window.clearTimeout(ctx.host.transcriptComposerPrefsPersistTimer);
    }
    ctx.host.transcriptComposerPrefsPersistTimer = window.setTimeout(() => {
        ctx.host.transcriptComposerPrefsPersistTimer = undefined;
        void ctx.persistTranscriptComposerPrefs(project, summary);
    }, 320);
}

export async function flushTranscriptComposerPrefsExtracted(ctx: MobileProjectsTranscriptStickyComposerUiContext, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): Promise<void> {
    if (ctx.host.transcriptComposerPrefsPersistTimer !== undefined) {
        window.clearTimeout(ctx.host.transcriptComposerPrefsPersistTimer);
        ctx.host.transcriptComposerPrefsPersistTimer = undefined;
    }
    await ctx.persistTranscriptComposerPrefs(project, summary);
}

export async function persistTranscriptComposerPrefsExtracted(ctx: MobileProjectsTranscriptStickyComposerUiContext, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): Promise<void> {
    if (summary.source === 'theia-chat' || isAgentsHubIdleConversationSummary(summary)) {
        return;
    }
    const agentId = ctx.host.transcriptComposerUi.resolveTranscriptComposerPinnedAgentId(project, summary);
    const cwd = ctx.host.projectsService.getProjectCwd(project) ?? summary.cwd;
    const patch = buildRuntimeComposerPersistPatch(agentId, cwd, {
        agentModel: ctx.host.transcriptComposerAgentModel,
        modeId: ctx.host.transcriptComposerModeId,
        approvalPolicyId: ctx.host.transcriptComposerApprovalPolicyId,
        toolApprovalRules: reconcileAgentToolApprovalRules(
            ctx.host.transcriptComposerApprovalPolicyId,
            cwd,
            ctx.host.transcriptComposerToolApprovalRules,
        ),
    });
    if (Object.keys(patch).length === 0) {
        return;
    }
    try {
        const updated = await updateConversation(summary.id, patch);
        ctx.host.transcriptComposerPrefsConvId = updated.id;
        if (ctx.host.transcriptLastConv?.id === updated.id) {
            ctx.host.transcriptLastConv = updated;
        }
        const updatedSummary = conversationToSummary(updated);
        ctx.host.conversations?.recordSnapshot(updatedSummary);
        if (ctx.host.transcriptOpenSummary?.id === summary.id) {
            ctx.host.transcriptOpenSummary = updatedSummary;
        }
    } catch {
        /* best-effort — composer still works for the current runtime */
    }
}

export async function ensureTranscriptComposerPrefsForMountExtracted(ctx: MobileProjectsTranscriptStickyComposerUiContext, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): Promise<void> {
    if (isAgentsHubIdleConversationSummary(summary)) {
        ctx.host.transcriptComposerAgentModel = undefined;
        // The idle summary id is a shared constant across all projects (not per-conversation), so its
        // draft is persisted per project rather than through the per-conversation draft storage below.
        ctx.host.transcriptComposerDraft = readProjectComposerDraft(project.id, ctx.host.transcriptComposerDraft);
        return;
    }
    if (summary.source === 'theia-chat') {
        ctx.host.transcriptComposerAgentModel = undefined;
        return;
    }
    if (ctx.host.transcriptLastConv?.id === summary.id
        && ctx.host.transcriptComposerPrefsConvId !== summary.id) {
        ctx.applyTranscriptComposerPrefsFromConversation(ctx.host.transcriptLastConv, project, summary);
        return;
    }
    const cachedDocument = ctx.host.conversations?.threadStore.getDocument(summary.id);
    if (cachedDocument && ctx.host.transcriptComposerPrefsConvId !== summary.id) {
        ctx.applyTranscriptComposerPrefsFromConversation(cachedDocument, project, summary);
        return;
    }
    if (ctx.host.transcriptComposerPrefsConvId === summary.id) {
        return;
    }
    await ctx.hydrateTranscriptComposerPrefs(project, summary);
}

export function mountTranscriptStickyComposerExtracted(ctx: MobileProjectsTranscriptStickyComposerUiContext, host: HTMLElement,
    project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    chatHost: HTMLElement,): void {
    void ctx.mountTranscriptStickyComposerAsync(host, project, summary, chatHost);
}
