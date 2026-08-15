// @ts-nocheck
// Extracted from mobile-projects-transcript-sticky-composer-ui.ts

import { nls } from '@theia/core/lib/common/nls';
import URI from '@theia/core/lib/common/uri';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { ConfirmDialog } from '@theia/core/lib/browser';
import { MessageService } from '@theia/core/lib/common/message-service';
import type { CommandRegistry } from '@theia/core/lib/common/command';
import type { QuickInputService } from '@theia/core/lib/common/quick-pick-service';
import { ChatAgentService } from '@theia/ai-chat/lib/common/chat-agent-service';
import { ChatMode, ChatModel } from '@theia/ai-chat';
import { Disposable } from '@theia/core/lib/common/disposable';
import {
    conversationToSummary,
    getConversation,
    isMaxConcurrentRunsError,
    recordConversationGitAction,
    updateConversation,
    type QaapAgentConversationDTO,
    type QaapAgentConversationSummaryDTO,
    type QaapAgentMessageDTO,
    type QaapMessageDeliveryMode,
} from '../common/qaap-agent-conversation-client';
import { createComposerGitActionDisplayMarker, type ComposerGitActionDisplayMetadata } from '../common/qaap-composer-git-action-display';
import {
    QAAP_COMPOSER_DEFAULT_AGENT_ID,
    QAAP_PRIMARY_AGENT_ID,
    readStoredAgentModel,
    resolveExplicitAgentForSubmit,
    type QaapAgentTaskAgentOption,
} from '../common/qaap-agent-task-client';
import { warmAgentTurnPath } from '../common/qaap-agent-turn-warm';
import { formatCommitFeedback } from '../common/qaap-commit-feedback';
import { createComposerContextEntry } from '../common/qaap-composer-context-entry';
import { isTranscriptAgentExecutionBusy, resolveTranscriptEffectiveStatus, isTranscriptSummaryAgentWorking, shouldShowTranscriptEmptyQuickActions } from '../common/qaap-transcript-turn-status';
import type { MobileComposerAttachHandlers } from './qaap-mobile-composer-device-attach';
import {
    resolveChatModelContextUsageBreakdown,
    resolveVpsContextUsageBreakdown,
} from './qaap-chat-context-usage-panel';
import {
    applyConversationComposerPrefs,
    applyProjectComposerDefaults,
    buildRuntimeComposerPersistPatch,
    clearConversationComposerDraft,
    extractConversationComposerPrefs,
    extractConversationComposerPrefsFromSummary,
    readConversationComposerDraft,
    writeConversationComposerDraft,
} from '../common/qaap-conversation-composer-state';
import {
    describeComposerInteractionMode,
    reconcileComposerModeId,
    resolveComposerModeLabel,
    resolveStickyComposerModes,
} from '../common/qaap-sticky-composer-mode';
import {
    reconcileModelCapabilityLevel,
} from '../common/qaap-sticky-composer-model-capability';
import {
    agentSupportsApprovalPolicy,
    reconcileAgentApprovalPolicyId,
    resolveComposerAutoApprove,
    type QaapAgentApprovalPolicyId,
} from '../common/qaap-sticky-composer-approval-policy';
import {
    reconcileAgentToolApprovalRules,
    type QaapAgentToolApprovalRules,
} from '../common/qaap-agent-tool-approval-rules';
import {
    MAX_TRANSCRIPT_FOLLOW_UP_QUEUE,
    TranscriptFollowUpQueue,
    type TranscriptFollowUpEntry,
} from '../common/qaap-transcript-follow-up-queue';
import { isAgentsHubIdleConversationSummary } from '../common/qaap-agents-hub-landing';
import { readProjectComposerDraft, writeProjectComposerDraft } from '../common/qaap-project-composer-draft';
import type { StickyComposerContextChipView } from './qaap-sticky-composer-context-ui';
import { collectComposerImagePreviews } from './qaap-sticky-composer-context-ui';
import {
    composerContextRequests,
    disposeComposerContextEntries,
    hasPendingComposerContextEntries,
    revokeComposerContextPreview,
    type StickyComposerContextEntry,
} from '../common/qaap-composer-context-entry';
import type { StickyComposerTokenOption } from '../common/qaap-sticky-composer-mention';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { MobileProjectsConversations } from './mobile-projects-conversations';
import type { MobileProjectsService } from './mobile-projects-service';
import type { MobileProjectsTranscriptComposerUi } from './mobile-projects-transcript-composer-ui';
import { createStickyComposerImprovePromptHandler } from './qaap-composer-prompt-improve-handler';
import type { WorkHubTranscriptBridge } from './work-hub-transcript-bridge';
import { MobileSnackbar } from './mobile-snackbar';
import {
    QAAP_GIT_REVIEW_API_PATH,
    type QaapGitChangedFile,
    type QaapGitCommitWorkflowAction,
} from '../common/qaap-git-review';
import {
    renderStickyComposerActivityStack,
    buildStickyComposerActivityStackFingerprint,
    buildStickyComposerChangesPillFingerprint,
    patchStickyComposerActivityStack,
    patchStickyComposerChangesPillHost,
    renderStickyComposerChangesPill,
    selectComposerPillChanges,
    type StickyComposerActivityStackOptions,
    type StickyComposerChangedFileView,
} from './qaap-sticky-composer-activity-stack';
import {
    ensureQueueControlInPillRow,
    ensureQueueControlPositionObserver,
} from './qaap-sticky-composer-queue-position';
import { syncTranscriptQueuedBubbles } from './qaap-transcript-queued-bubbles';
import {
    mergeFailedComposerDraft,
    isIdleComposerFocusStealable,
    hasComposerAgentActivity as hasComposerAgentActivityHelper,
    resolveChangedFilesStats as resolveChangedFilesStatsHelper,
    mapGitChangedFileToComposerView as mapGitChangedFileToComposerViewHelper,
    resolveGitCommitWorkflowLabel as resolveGitCommitWorkflowLabelHelper,
    isComposerBackgroundWorkAllowed as isComposerBackgroundWorkAllowedHelper,
} from './mobile-projects-transcript-sticky-composer-helpers';
import {
    parkWorkingControlFromAncestor,
    transferWorkingControlToHost,
} from './qaap-sticky-composer-working-agents-popover';
import { transferStepPillToHost } from './qaap-sticky-composer-step-pill';
import { probeQaapDevPreviewPort, probeQaapIdentityPreview } from './qaap-dev-preview-client';
import { extractTranscriptPreviewId } from './mobile-projects-transcript-messages-content-ui';
import type { QaapProjectBootstrapService } from './qaap-project-bootstrap-service';
import { extractDevPreviewPortFromUrl } from './qaap-transcript-preview-bootstrap';
import {
    openCurrentComposerPreview,
    resolveComposerPreviewCandidate,
    resolveVerifiedComposerPreviewUrl,
    type ComposerPreviewRuntime,
} from './qaap-composer-preview-action';

export function appendRunningGitActionToTranscriptExtracted(ctx: any, summary: QaapAgentConversationSummaryDTO,
    action: QaapGitCommitWorkflowAction,): string | undefined {
    const messageId = `pending-git-action-${Date.now()}`;
    const metadata = ctx.buildGitActionMetadata(action, 'running');
    const message: QaapAgentMessageDTO = {
        id: messageId,
        role: 'user',
        content: createComposerGitActionDisplayMarker(metadata),
        createdAt: Date.now(),
    };
    ctx.pendingGitActionMessageId = messageId;
    const base = ctx.host.transcriptLastConv?.id === summary.id
        ? ctx.host.transcriptLastConv
        : undefined;
    if (!base) {
        return messageId;
    }
    const next: QaapAgentConversationDTO = {
        ...base,
        updatedAt: Date.now(),
        messages: [...base.messages, message],
    };
    ctx.applyGitActionTranscriptConversation(summary, next);
    return messageId;
}

export function markPendingGitActionFailedExtracted(ctx: any, summary: QaapAgentConversationSummaryDTO,
    action: QaapGitCommitWorkflowAction,): void {
    const pendingId = ctx.pendingGitActionMessageId;
    const base = ctx.host.transcriptLastConv?.id === summary.id
        ? ctx.host.transcriptLastConv
        : undefined;
    if (!pendingId || !base) {
        return;
    }
    const metadata = ctx.buildGitActionMetadata(action, 'failed');
    const next: QaapAgentConversationDTO = {
        ...base,
        updatedAt: Date.now(),
        messages: base.messages.map(message => message.id === pendingId
            ? { ...message, content: createComposerGitActionDisplayMarker(metadata) }
            : message),
    };
    ctx.applyGitActionTranscriptConversation(summary, next);
}

export function applyGitActionTranscriptConversationExtracted(ctx: any, summary: QaapAgentConversationSummaryDTO,
    conv: QaapAgentConversationDTO,): void {
    if (ctx.host.transcriptOpenSummary?.id !== summary.id) {
        return;
    }
    ctx.host.transcriptLastConv = conv;
    ctx.host.conversations?.cacheDocument(conv);
    const updatedSummary = conversationToSummary(conv);
    ctx.host.transcriptOpenSummary = updatedSummary;
    if (ctx.host.transcriptComposerSummary?.id === summary.id) {
        ctx.host.transcriptComposerSummary = updatedSummary;
    }
    ctx.host.conversations?.recordSnapshot(updatedSummary);
    const chatHost = ctx.host.resolveActiveTranscriptChatHost() ?? ctx.host.transcriptChatHost;
    if (chatHost) {
        ctx.host.transcriptMessagesUi.renderTranscriptMessages(chatHost, conv);
    }
}

export async function recordComposerGitActionInTranscriptExtracted(ctx: any, summary: QaapAgentConversationSummaryDTO,
    action: QaapGitCommitWorkflowAction,
    options: {
        readonly branch?: string;
        readonly stat?: { files: number; insertions: number; deletions: number };
        readonly status: 'completed' | 'failed';
        readonly replaceMessageId?: string;
    },): Promise<void> {
    try {
        const updated = await recordConversationGitAction(summary.id, ctx.buildGitActionMetadata(action, options.status, {
            branch: options.branch,
            stat: options.stat,
        }), {
            replaceMessageId: options.replaceMessageId,
        });
        if (!updated || ctx.host.transcriptOpenSummary?.id !== summary.id) {
            if (options.status === 'completed' && ctx.host.transcriptLastConv?.id === summary.id && options.replaceMessageId) {
                const metadata = ctx.buildGitActionMetadata(action, 'completed', {
                    branch: options.branch,
                    stat: options.stat,
                });
                const next: QaapAgentConversationDTO = {
                    ...ctx.host.transcriptLastConv,
                    updatedAt: Date.now(),
                    messages: ctx.host.transcriptLastConv.messages.map(message => message.id === options.replaceMessageId
                        ? { ...message, content: createComposerGitActionDisplayMarker(metadata) }
                        : message),
                };
                ctx.applyGitActionTranscriptConversation(summary, next);
            }
            return;
        }
        ctx.applyGitActionTranscriptConversation(summary, updated);
    } catch {
        if (options.status === 'completed' && ctx.host.transcriptLastConv?.id === summary.id && options.replaceMessageId) {
            const metadata = ctx.buildGitActionMetadata(action, 'completed', {
                branch: options.branch,
                stat: options.stat,
            });
            const next: QaapAgentConversationDTO = {
                ...ctx.host.transcriptLastConv,
                updatedAt: Date.now(),
                messages: ctx.host.transcriptLastConv.messages.map(message => message.id === options.replaceMessageId
                    ? { ...message, content: createComposerGitActionDisplayMarker(metadata) }
                    : message),
            };
            ctx.applyGitActionTranscriptConversation(summary, next);
        }
    }
}

export function buildTranscriptComposerActivityStackExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): HTMLElement | undefined {
    return renderStickyComposerActivityStack(ctx.buildTranscriptComposerActivityOptions(project, summary));
}

export function buildTranscriptComposerChangesPillExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): HTMLElement | undefined {
    return renderStickyComposerChangesPill(ctx.buildTranscriptComposerActivityOptions(project, summary));
}

export function buildComposerActivityFingerprintExtracted(ctx: any, summary: QaapAgentConversationSummaryDTO,
    activityOptions: StickyComposerActivityStackOptions,
    activityFiles: {
        readonly files: readonly StickyComposerChangedFileView[];
        readonly stats?: { readonly added: number; readonly removed: number };
    },): string {
    const pathsKey = activityFiles.files.map(file => file.path).sort().join('\n');
    return [
        ctx.host.transcriptFollowUpQueue.size(summary.id),
        pathsKey,
        activityFiles.stats?.added ?? 0,
        activityFiles.stats?.removed ?? 0,
        activityOptions.agentWorking ? 1 : 0,
    ].join('|');
}

export function syncComposerActivityFingerprintExtracted(ctx: any, summary: QaapAgentConversationSummaryDTO,
    project?: MobileProjectEntry,
    activityOptions?: StickyComposerActivityStackOptions,): void {
    const conv = ctx.host.transcriptLastConv?.id === summary.id ? ctx.host.transcriptLastConv : undefined;
    const resolvedProject = project ?? ctx.host.transcriptComposerProject;
    const activityFiles = resolvedProject
        ? ctx.resolveComposerActivityFilesForStack(resolvedProject, summary, conv)
        : ctx.host.transcriptMessagesUi.resolveComposerActivityFiles(conv, summary);
    const options = activityOptions
        ?? ctx.buildTranscriptComposerActivityOptions(resolvedProject ?? ctx.host.transcriptComposerProject!, summary);
    ctx.lastComposerActivityFingerprint = ctx.buildComposerActivityFingerprint(summary, options, activityFiles);
    ctx.lastComposerChangesPillFingerprint = buildStickyComposerChangesPillFingerprint(options);
    ctx.lastComposerActivityStackFingerprint = buildStickyComposerActivityStackFingerprint(options);
}

export function refreshComposerActivityStackExtracted(ctx: any): void {
    const host = ctx.host.transcriptComposerHost;
    const project = ctx.host.transcriptComposerProject;
    const summary = ctx.host.transcriptComposerSummary;
    if (!host?.isConnected || !project || !summary) {
        return;
    }
    const wrap = host.querySelector('.theia-mobile-projects-sticky-composer-inner');
    const card = wrap?.querySelector('.theia-mobile-projects-sticky-composer-card.theia-mod-codex');
    if (!wrap || !card) {
        ctx.remountTranscriptStickyComposer();
        return;
    }
    const activityOptions = ctx.buildTranscriptComposerActivityOptions(project, summary);
    // Once the last queued entry has been dispatched or removed, the expanded
    // state must not leak into the next queue mount. Otherwise a later queue
    // can reopen as a stale popover even though the previous one was closed.
    if ((activityOptions.queueEntries?.length ?? 0) === 0) {
        ctx.host.transcriptComposerQueueExpanded = false;
    }
    const pillFingerprint = buildStickyComposerChangesPillFingerprint(activityOptions);
    const changesPill = renderStickyComposerChangesPill(activityOptions);
    // Activity row vs Working/Step-only strip share the same host class — never tear down
    // `theia-mod-working-only` during streaming ticks or Step/Working flicker every SSE.
    const pillHosts = Array.from(
        wrap.querySelectorAll(':scope > .theia-mobile-sticky-composer-changes-pill-host'),
    );
    const existingActivityPill = pillHosts.find(
        host => !host.classList.contains('theia-mod-working-only'),
    );
    const pillsOnlyHost = pillHosts.find(
        host => host.classList.contains('theia-mod-working-only'),
    );
    if (!changesPill) {
        if (existingActivityPill instanceof HTMLElement) {
            parkWorkingControlFromAncestor(existingActivityPill);
            existingActivityPill.remove();
        }
        ctx.lastComposerChangesPillFingerprint = '';
    } else if (existingActivityPill instanceof HTMLElement) {
        if (pillFingerprint === ctx.lastComposerChangesPillFingerprint
            || patchStickyComposerChangesPillHost(existingActivityPill, activityOptions)) {
            ctx.lastComposerChangesPillFingerprint = pillFingerprint;
        } else {
            if (changesPill instanceof HTMLElement) {
                transferWorkingControlToHost(existingActivityPill, changesPill);
                transferStepPillToHost(existingActivityPill, changesPill);
            } else {
                parkWorkingControlFromAncestor(existingActivityPill);
            }
            existingActivityPill.replaceWith(changesPill);
            ctx.lastComposerChangesPillFingerprint = pillFingerprint;
        }
    } else if (pillsOnlyHost instanceof HTMLElement && changesPill instanceof HTMLElement) {
        transferWorkingControlToHost(pillsOnlyHost, changesPill);
        transferStepPillToHost(pillsOnlyHost, changesPill);
        // Insert the pill AFTER the queue stack (if it exists) — queue goes on top, pill below it.
        const existingStack = wrap.querySelector(':scope > .theia-mobile-sticky-composer-activity-stack');
        if (existingStack) {
            wrap.insertBefore(changesPill, existingStack.nextSibling ?? card);
        } else {
            wrap.insertBefore(changesPill, card);
        }
        pillsOnlyHost.remove();
        ctx.lastComposerChangesPillFingerprint = pillFingerprint;
    } else {
        const existingStack = wrap.querySelector(':scope > .theia-mobile-sticky-composer-activity-stack');
        if (existingStack) {
            wrap.insertBefore(changesPill, existingStack.nextSibling ?? card);
        } else {
            wrap.insertBefore(changesPill, card);
        }
        ctx.lastComposerChangesPillFingerprint = pillFingerprint;
    }
    const stackFingerprint = buildStickyComposerActivityStackFingerprint(activityOptions);
    const stack = renderStickyComposerActivityStack(activityOptions);
    // The queue control always lives inside the changes-pill-row (left of Working pill).
    // Search the whole wrap since it may be nested inside a pill host.
    const existing = wrap.querySelector('.theia-mobile-sticky-composer-activity-stack');
    card.classList.remove('theia-mod-has-activity');
    card.querySelector(':scope > .theia-mobile-sticky-composer-activity-stack')?.remove();
    card.querySelector(':scope > .theia-mobile-sticky-composer-activity-section.theia-mod-streaming')?.remove();
    if (!stack) {
        existing?.remove();
        ctx.lastComposerActivityStackFingerprint = '';
    } else if (existing instanceof HTMLElement) {
        if (stackFingerprint === ctx.lastComposerActivityStackFingerprint
            || patchStickyComposerActivityStack(existing, activityOptions)) {
            ctx.lastComposerActivityStackFingerprint = stackFingerprint;
        } else {
            existing.replaceWith(stack);
            ctx.lastComposerActivityStackFingerprint = stackFingerprint;
        }
    } else {
        // No existing stack — place inside the first changes-pill-row, or before card as fallback.
        const pillHost = wrap.querySelector(':scope > .theia-mobile-sticky-composer-changes-pill-host');
        const row = pillHost?.querySelector<HTMLElement>(':scope .theia-mobile-sticky-composer-changes-pill-row');
        if (row) {
            row.insertBefore(stack, row.firstChild);
        } else {
            wrap.insertBefore(stack, pillHost ?? card);
        }
        ctx.lastComposerActivityStackFingerprint = stackFingerprint;
    }
    // Single normalization point: ensure the queue control is inside the best
    // available changes-pill-row as first child. The MutationObserver installed
    // below catches pill hosts created asynchronously by other contributions,
    // so we don't need a rAF pass or duplicate calls here.
    ensureQueueControlInPillRow(wrap);
    const orderedPillHosts = Array.from(
        wrap.querySelectorAll<HTMLElement>('.theia-mobile-sticky-composer-changes-pill-host'),
    );
    // Ensure every pill host is above the card.
    for (const pillEl of orderedPillHosts) {
        if (card && pillEl.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_PRECEDING) {
            wrap.insertBefore(pillEl, card);
        }
    }
    ctx.syncComposerActivityFingerprint(summary, project, activityOptions);
    ctx.syncTranscriptQueuedFollowUpBubbles(summary);
    ctx.host.updateWorkingPillChrome();
    // updateWorkingPillChrome may have created a working-only pill host with a
    // row — re-normalize once more so the queue pill lands inside it.
    ensureQueueControlInPillRow(wrap);
    // Install the MutationObserver once per wrap to catch async pill-host
    // creation by other contributions (Working pill, Step pill, …).
    ensureQueueControlPositionObserver(wrap);
    ctx.host.composerHeaderUi.updateStickyComposerFabLift();
}

export function refreshTranscriptComposerActivityIfNeededExtracted(ctx: any, conv: QaapAgentConversationDTO): void {
    if (!ctx.isComposerBackgroundWorkAllowed()) {
        return;
    }
    const summary = ctx.host.transcriptComposerSummary;
    const project = ctx.host.transcriptComposerProject;
    if (!summary || summary.id !== conv.id || !project || !ctx.host.transcriptComposerHost?.isConnected) {
        return;
    }
    const turnSettled = conv.status !== 'streaming';
    if (turnSettled && ctx.hasComposerFileActivity(conv)) {
        if (ctx.shouldRefetchComposerGitSnapshot(conv.id, conv)) {
            void ctx.syncComposerGitSnapshot(project, summary)
                .then(() => ctx.refreshComposerActivityStack())
                .catch(() => undefined);
        }
    }
    const activityOptions = ctx.buildTranscriptComposerActivityOptions(project, summary);
    const activityFiles = project
        ? ctx.resolveComposerActivityFilesForStack(project, summary, conv)
        : ctx.host.transcriptMessagesUi.resolveComposerActivityFiles(conv, summary);
    const fingerprint = ctx.buildComposerActivityFingerprint(summary, activityOptions, activityFiles);
    const pillFingerprint = buildStickyComposerChangesPillFingerprint(activityOptions);
    if (fingerprint === ctx.lastComposerActivityFingerprint
        && pillFingerprint === ctx.lastComposerChangesPillFingerprint) {
        ctx.host.transcriptComposerSendRefresh?.();
        return;
    }
    const previousFingerprint = ctx.lastComposerActivityFingerprint;
    ctx.lastComposerActivityFingerprint = fingerprint;
    ctx.lastComposerChangesPillFingerprint = pillFingerprint;
    const previousPaths = previousFingerprint.split('|')[1] ?? '';
    const nextPaths = fingerprint.split('|')[1] ?? '';
    if (nextPaths !== previousPaths) {
        // New file paths only — invalidate git snapshot so counts stay accurate.
        ctx.composerActivityGitFilesByConversationId.delete(conv.id);
        ctx.clearStaleComposerGitLatches(conv.id);
    }
    ctx.refreshComposerActivityStack();
    ctx.host.transcriptComposerSendRefresh?.();
}

export function isTranscriptFollowUpReadyExtracted(ctx: any, summary: QaapAgentConversationSummaryDTO): boolean {
    if (ctx.host.transcriptFollowUpFlushInFlight) {
        return false;
    }
    if (ctx.host.transcriptLastConv?.id === summary.id) {
        return !isTranscriptAgentExecutionBusy(summary, ctx.host.transcriptLastConv);
    }
    return !isTranscriptAgentExecutionBusy(summary, undefined);
}

export async function flushTranscriptFollowUpQueueExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): Promise<void> {
    if (!ctx.isTranscriptFollowUpReady(summary)) {
        return;
    }
    // Drop leading entries already mirrored to the server — the backend drain owns them.
    while (ctx.host.transcriptFollowUpQueue.peek(summary.id)[0]?.serverSynced) {
        ctx.host.transcriptFollowUpQueue.shift(summary.id);
    }
    ctx.refreshComposerActivityStack();
    const next = ctx.host.transcriptFollowUpQueue.shift(summary.id);
    if (!next) {
        return;
    }
    if (next.serverSynced) {
        return;
    }
    await ctx.submitQueuedFollowUpEntry(project, summary, next);
}

export async function sendQueuedFollowUpNowExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    index: number,): Promise<void> {
    const entry = ctx.host.transcriptFollowUpQueue.takeAt(summary.id, index);
    if (!entry) {
        return;
    }
    ctx.host.transcriptComposerQueueExpanded = false;
    ctx.refreshComposerActivityStack();
    if (entry.serverPendingId && ctx.host.transcriptMessagesUi?.dispatchQueuedMessage) {
        await ctx.host.transcriptMessagesUi.dispatchQueuedMessage(
            summary.id,
            { id: entry.serverPendingId, content: entry.draft, createdAt: Date.now() },
            'parallel',
        );
        return;
    }
    if (ctx.isTranscriptStickyComposerAgentWorking()) {
        await ctx.dispatchQueuedFollowUpInParallel(project, summary, entry);
        return;
    }
    await ctx.submitQueuedFollowUpEntry(project, summary, entry);
}

/**
 * Interrupt the running agent and process a queued message immediately.
 * Cancels the current agent turn, then submits the queued entry with deliveryMode 'interrupt'.
 */
export async function interruptQueuedFollowUpExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    index: number,): Promise<void> {
    const entry = ctx.host.transcriptFollowUpQueue.takeAt(summary.id, index);
    if (!entry) {
        return;
    }
    ctx.refreshComposerActivityStack();
    try {
        await ctx.stopOpenComposerAgentLikeComposerStop();
        await ctx.submitQueuedFollowUpEntry(project, summary, entry, { deliveryMode: 'interrupt' });
    } catch (error) {
        // Put it back in the queue if the interrupt failed.
        ctx.host.transcriptFollowUpQueue.unshift(summary.id, entry);
        ctx.refreshComposerActivityStack();
        throw error;
    }
}

export async function dispatchQueuedFollowUpInParallelExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    entry: TranscriptFollowUpEntry,): Promise<void> {
    ctx.refreshComposerActivityStack();
    (entry as TranscriptFollowUpEntry & { deliveryMode?: QaapMessageDeliveryMode }).deliveryMode = 'parallel';
    const ok = await ctx.startPeerRunOrQueue(project, summary, entry);
    if (!ok) {
        ctx.host.transcriptFollowUpQueue.unshift(summary.id, entry);
        ctx.refreshComposerActivityStack();
    }
}

export async function startIsolatedRunIfRequestedExtracted(ctx: any, project: MobileProjectEntry,
    entry: TranscriptFollowUpEntry,): Promise<boolean> {
    if (ctx.host.stickyComposerWorkspaceUi.resolveComposerWorkspaceDestination(project) !== 'worktree') {
        return false;
    }
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
    return true;
}
