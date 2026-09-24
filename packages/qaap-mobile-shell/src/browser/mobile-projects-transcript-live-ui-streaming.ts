import type { MobileProjectsTranscriptLiveUiContext } from './mobile-projects-transcript-live-ui-context';
// Extracted from mobile-projects-transcript-live-ui.ts

import {
    type QaapAgentConversationDTO,
    type QaapAgentConversationSummaryDTO,
    type QaapAgentMessageDTO,
} from '../common/qaap-agent-conversation-client';
import { conversationUsesInteractiveApprovals } from '../common/qaap-agent-interactive-approvals';
import { resolveMessagePreviewText } from '../common/qaap-agent-message-content';
import { excerptTranscriptThought } from '../common/qaap-agent-transcript-segments';
import {
    conversationAwaitingDevPreview,
    conversationMayAutoOpenTranscriptPreview,
    conversationRequestsDevPreview,
    conversationShouldKickoffDevPreviewBootstrap,
    conversationShouldWatchDevPreview,
    messageRequestsDevPreview,
} from '../common/qaap-transcript-preview-offer';
import {
    buildTranscriptPreviewBootstrapFailureReason,
    shouldReportTranscriptPreviewBootstrapFailure,
    toTranscriptPreviewBootstrapSnapshot,
} from '../common/qaap-transcript-preview-bootstrap-failure';
import { reportPreviewBootstrapFailure } from '../common/qaap-agent-conversation-client';
import { agentMessageHasVisualVerificationMarker } from '../common/qaap-visual-verification';
import { normalizePreviewUrlForSameOrigin } from '@theia/qaap-adapters/lib/browser/qaap-preview-url-utils';
import { ensureTranscriptDevPreview } from './qaap-transcript-preview-bootstrap';
import type { QaapProjectBootstrapService } from './qaap-project-bootstrap-service';
import {
    mergeConversationTranscriptFingerprint,
} from '@theia/qaap-transcript-overlay/lib/common/qaap-transcript-incremental-update';
import { isTranscriptDocumentVisible } from '../common/qaap-transcript-document-visibility';
import { scheduleTranscriptIdleWork } from '../common/qaap-transcript-idle-scheduler';
import { isTranscriptAgentExecutionBusy, resolveTranscriptEffectiveStatus, isConversationTurnVisuallySettled } from '../common/qaap-transcript-turn-status';
import { MobileSnackbar } from './mobile-snackbar';
import type { MobileProjectEntry } from './mobile-projects-types';
import { TRANSCRIPT_COMPOSER_ACTIVITY_DEBOUNCE_MS } from './mobile-projects-transcript-live-ui';

export function applyTranscriptSseRenderExtracted(ctx: MobileProjectsTranscriptLiveUiContext, next: QaapAgentConversationDTO,
    eventMessage: QaapAgentMessageDTO,): void {
    const chatHost = ctx.resolveActiveTranscriptChatHost();
    const prevConv = ctx.host.transcriptLastConv;
    // Prefer the open summary's settled status so post-settle visual evidence rebuilds
    // the agent row (pending chip → img/video) instead of a streaming text patch.
    const openStatus = ctx.host.transcriptOpenSummary?.status;
    const renderConv = openStatus
        && openStatus !== 'streaming'
        && next.status === 'streaming'
        ? { ...next, status: openStatus }
        : next;
    if (!chatHost) {
        // Keep memory/cache in sync even while the chat host is briefly detached
        // during Agents Hub remount — so the next paint / final visual poll sees evidence.
        ctx.host.transcriptLastConv = renderConv;
        ctx.host.transcriptLastFingerprint = mergeConversationTranscriptFingerprint(prevConv, renderConv);
        ctx.cacheTranscriptConversation(renderConv);
        if (agentMessageHasVisualVerificationMarker(eventMessage)) {
            void ctx.refreshOpenTranscriptConversation({ forcePoll: true });
        }
        return;
    }
    // Paint BEFORE publishing the snapshot: the streaming patcher diffs the incoming
    // conv against `transcriptLastConv`, so publishing first makes prev === next and
    // turns every coalesced flush into a skipped no-op — streaming then only reaches
    // the DOM through the uncoalesced summary/poll paths (the flicker-heavy ones).
    ctx.host.transcriptMessagesUi.renderTranscriptMessages(chatHost, renderConv);
    ctx.host.transcriptLastConv = renderConv;
    // Publish the fingerprint BEFORE caching: `cacheTranscriptConversation` re-enters
    // the thread-store document subscriber synchronously, and with the fingerprint
    // already current its self-echo guard exits without duplicate render/timer work.
    ctx.host.transcriptLastFingerprint = mergeConversationTranscriptFingerprint(prevConv, renderConv);
    ctx.cacheTranscriptConversation(renderConv);
    ctx.host.conversations?.recordSubmitLatencyMark(renderConv.id, 'first_transcript_delta_rendered');
    if (renderConv.status === 'streaming') {
        ctx.touchTranscriptSemanticProgressFromConversation(renderConv);
    } else {
        ctx.clearTranscriptSemanticProgressClock();
    }
    if (conversationUsesInteractiveApprovals(renderConv) && ctx.host.transcriptApprovalRefreshTimer === undefined) {
        ctx.syncTranscriptPendingApproval(renderConv);
    }
    ctx.ensureTranscriptDevPreviewWatch(renderConv);
    ctx.maybeSyncTranscriptVisuallySettledChrome(renderConv);
    if (ctx.host.transcriptOpenSummary) {
        ctx.host.transcriptOpenSummary = {
            ...ctx.host.transcriptOpenSummary,
            status: renderConv.status,
            updatedAt: renderConv.updatedAt,
            lastMessageRole: eventMessage.role,
            lastMessagePreview: excerptTranscriptThought(
                resolveMessagePreviewText(eventMessage),
                160,
            ),
            ...(agentMessageHasVisualVerificationMarker(eventMessage)
                ? { visualVerificationPending: undefined }
                : {}),
        };
    }
    if (renderConv.status === 'streaming') {
        ctx.scheduleTranscriptComposerActivityRefresh(renderConv);
    }
}

export function scheduleTranscriptComposerActivityRefreshExtracted(ctx: MobileProjectsTranscriptLiveUiContext, conv: QaapAgentConversationDTO): void {
    if (!isTranscriptDocumentVisible()) {
        return;
    }
    if (ctx.transcriptComposerActivityTimer !== undefined) {
        return;
    }
    ctx.transcriptComposerActivityTimer = window.setTimeout(() => {
        ctx.transcriptComposerActivityTimer = undefined;
        if (!isTranscriptDocumentVisible()) {
            return;
        }
        ctx.transcriptComposerActivityIdleHandle?.cancel();
        ctx.transcriptComposerActivityIdleHandle = scheduleTranscriptIdleWork(() => {
            ctx.transcriptComposerActivityIdleHandle = undefined;
            const latest = ctx.host.transcriptLastConv;
            if (latest?.id === conv.id) {
                ctx.host.transcriptStickyComposerUi.refreshTranscriptComposerActivityIfNeeded(latest);
            }
        }, { when: isTranscriptDocumentVisible });
    }, TRANSCRIPT_COMPOSER_ACTIVITY_DEBOUNCE_MS);
}

export function stopTranscriptComposerActivityRefreshExtracted(ctx: MobileProjectsTranscriptLiveUiContext): void {
    if (ctx.transcriptComposerActivityTimer !== undefined) {
        window.clearTimeout(ctx.transcriptComposerActivityTimer);
        ctx.transcriptComposerActivityTimer = undefined;
    }
    ctx.transcriptComposerActivityIdleHandle?.cancel();
    ctx.transcriptComposerActivityIdleHandle = undefined;
}

export function syncTranscriptConversationSettledChromeExtracted(ctx: MobileProjectsTranscriptLiveUiContext): void {
    const project = ctx.host.transcriptOpenProject;
    const summary = ctx.host.transcriptOpenSummary;
    if (!project || !summary || !ctx.isActiveTranscriptConversation(summary.id)) {
        return;
    }
    if (ctx.host.transcriptLastConv?.id === summary.id) {
        ctx.host.transcriptOpenSummary = ctx.reconcileConversationListSummary(ctx.host.transcriptLastConv);
    }
    const backendStreaming = ctx.host.transcriptLastConv?.status === 'streaming';
    const effectivelyStreaming = ctx.host.transcriptLastConv
        ? resolveTranscriptEffectiveStatus(ctx.host.transcriptLastConv) === 'streaming'
        : backendStreaming;
    const previousStatus = ctx.host.transcriptLastStatus;
    if (backendStreaming) {
        if (effectivelyStreaming) {
            ctx.host.transcriptComposerSendRefresh?.();
        } else {
            ctx.host.transcriptStickyComposerUi.refreshComposerActivityStack();
            ctx.host.transcriptComposerSendRefresh?.();
        }
        ctx.host.transcriptHeaderUi.refreshTranscriptExecutionChrome();
    } else if (previousStatus === 'streaming') {
        ctx.host.transcriptStickyComposerUi.remountTranscriptStickyComposer();
        ctx.host.transcriptHeaderUi.refreshTranscriptExecutionChrome();
    } else {
        ctx.host.transcriptComposerSendRefresh?.();
        ctx.host.transcriptHeaderUi.refreshTranscriptExecutionChrome();
    }
    if (ctx.host.transcriptLastConv?.id === summary.id) {
        ctx.host.transcriptLastStatus = resolveTranscriptEffectiveStatus(ctx.host.transcriptLastConv);
    }
    const settled = ctx.host.transcriptOpenSummary;
    const activeConv = ctx.host.transcriptLastConv?.id === settled?.id ? ctx.host.transcriptLastConv : undefined;
    if (settled && !isTranscriptAgentExecutionBusy(settled, activeConv)) {
        void ctx.host.transcriptStickyComposerUi.flushTranscriptFollowUpQueue(project, settled);
    }
    // The just-settled turn may have requested a screenshot/video: its `visualVerificationPending`
    // was recomputed above from the final conversation. Arm the verification poll now — the
    // capture runs server-side after the SSE stream is already torn down, so without a
    // surface-independent poll the "Processing…" skeleton only resolves on a manual reload.
    if (settled?.visualVerificationPending) {
        ctx.ensureTranscriptConversationRefresh();
    }
    void ctx.finalizeTranscriptDevPreviewAfterSettle();
}

export function ensureBootstrapPreviewListenerExtracted(ctx: MobileProjectsTranscriptLiveUiContext): void {
    if (ctx.bootstrapPreviewListenerInitialized || !ctx.host.projectBootstrap) {
        return;
    }
    ctx.bootstrapPreviewListenerInitialized = true;
    // While the watched conversation is still streaming, bootstrap-level auto-opens (port
    // detected / warmup / attach) must stage the "Open preview" pill instead of yanking the
    // user out of the live transcript into the mini-browser mid-turn.
    ctx.host.projectBootstrap.setPreviewAutoOpenGate(() => {
        const conv = ctx.host.transcriptLastConv;
        if (!conv || ctx.host.transcriptOpenSummaryId !== conv.id) {
            return true;
        }
        if (!conversationShouldWatchDevPreview(conv, window.location.origin)) {
            return true;
        }
        return conversationMayAutoOpenTranscriptPreview(conv);
    });
    ctx.host.projectBootstrap.onStateChange(state => {
        // Composer preview visibility follows the live bootstrap phase/dependency snapshot,
        // even when the active conversation is not currently watching for preview offers.
        ctx.host.transcriptStickyComposerUi.refreshComposerActivityStack();
        const conv = ctx.host.transcriptLastConv;
        if (!conv || !ctx.host.transcriptOpenSummaryId || ctx.host.transcriptOpenSummaryId !== conv.id) {
            return;
        }
        if (!conversationShouldWatchDevPreview(conv, window.location.origin)) {
            return;
        }
        if (state.previewUrl && state.phase === 'running') {
            void ctx.openReadyTranscriptPreviewUrl(state.previewUrl, conv);
        }
    });
}

export function kickoffTranscriptDevPreviewBootstrapExtracted(ctx: MobileProjectsTranscriptLiveUiContext, conv: QaapAgentConversationDTO | undefined): void {
    const bootstrap = ctx.host.projectBootstrap;
    if (!bootstrap || !conv || !conversationRequestsDevPreview(conv)
        || !conversationShouldKickoffDevPreviewBootstrap(conv)) {
        return;
    }
    const snapshot = typeof bootstrap.getStateSnapshot === 'function'
        ? bootstrap.getStateSnapshot()
        : undefined;
    const previewAlreadyRunning = snapshot?.phase === 'running' && !!snapshot?.previewUrl;
    // A previous kickoff that ran before files existed must be allowed to retry (QA-004).
    if (ctx.transcriptDevPreviewBootstrapConversationId === conv.id && previewAlreadyRunning) {
        return;
    }
    ctx.transcriptDevPreviewBootstrapConversationId = conv.id;
    const project = ctx.host.transcriptOpenProject;
    void ensureTranscriptDevPreview(bootstrap, {
        conversation: conv,
        projectId: project?.id,
        workspaceRoot: project ? ctx.host.projectsService.getProjectCwd(project) ?? conv.cwd : conv.cwd,
    }).then(readyUrl => {
        if (readyUrl && ctx.host.transcriptOpenSummaryId === conv.id) {
            void ctx.openReadyTranscriptPreviewUrl(readyUrl, conv);
            return;
        }
        void ctx.maybeReportTranscriptPreviewBootstrapFailure(conv, bootstrap);
    }).catch(() => undefined);
}

export async function maybeReportTranscriptPreviewBootstrapFailureExtracted(ctx: MobileProjectsTranscriptLiveUiContext, conv: QaapAgentConversationDTO,
    bootstrap: QaapProjectBootstrapService,): Promise<void> {
    if (!conversationRequestsDevPreview(conv) && !ctx.host.transcriptPreviewRequestPending) {
        return;
    }
    if (ctx.transcriptPreviewFailureReportedFor.has(conv.id)) {
        return;
    }
    const snapshot = toTranscriptPreviewBootstrapSnapshot(bootstrap.getStateSnapshot());
    if (!shouldReportTranscriptPreviewBootstrapFailure(snapshot, ctx.transcriptPreviewPollMisses)) {
        return;
    }
    const reason = buildTranscriptPreviewBootstrapFailureReason(snapshot);
    if (!reason) {
        return;
    }
    ctx.transcriptPreviewFailureReportedFor.add(conv.id);
    ctx.host.transcriptPreviewRequestPending = false;
    ctx.host.transcriptPreviewRequestRunning = false;
    ctx.stopTranscriptPreviewOfferRefresh();
    try {
        const updated = await reportPreviewBootstrapFailure(conv.id, reason);
        if (updated && ctx.host.transcriptOpenSummaryId === conv.id) {
            ctx.host.transcriptLastConv = updated;
            ctx.host.transcriptLastStatus = resolveTranscriptEffectiveStatus(updated);
            if (ctx.host.transcriptOpenSummary?.id === conv.id) {
                ctx.host.transcriptOpenSummary = ctx.reconcileConversationListSummary(updated);
            }
            const chatHost = ctx.resolveActiveTranscriptChatHost();
            if (chatHost) {
                ctx.host.transcriptMessagesUi.renderTranscriptMessages(chatHost, updated);
            }
        }
    } catch {
        /* best-effort */
    }
    ctx.host.transcriptStickyComposerUi.refreshComposerActivityStack();
    ctx.host.transcriptComposerSendRefresh?.();
    ctx.host.transcriptHeaderUi.refreshTranscriptExecutionChrome();
    MobileSnackbar.show(reason, { duration: 8000, kind: 'warning' });
}

export async function openReadyTranscriptPreviewUrlExtracted(ctx: MobileProjectsTranscriptLiveUiContext, readyUrl: string,
    conv: QaapAgentConversationDTO | undefined,): Promise<void> {
    const normalized = normalizePreviewUrlForSameOrigin(readyUrl);
    if (ctx.transcriptPreviewOfferAnnouncedUrl === normalized) {
        return;
    }
    ctx.host.stageTranscriptPreviewReadyUrl(normalized);
    ctx.transcriptPreviewOfferAnnouncedUrl = normalized;
    if (
        ctx.host.transcriptPreviewSuppressedByUser
        || !conversationMayAutoOpenTranscriptPreview(conv)
    ) {
        return;
    }
    const project = ctx.host.transcriptOpenProject;
    const summary = ctx.host.transcriptOpenSummary;
    if (!project || !summary) {
        return;
    }
    const previewProject = { ...project, previewUrl: normalized };
    ctx.host.transcriptOpenProject = previewProject;
    ctx.host.executionSurfaceTabsUi.selectTranscriptTab('preview', previewProject, summary);
}

export async function finalizeTranscriptDevPreviewAfterSettleExtracted(ctx: MobileProjectsTranscriptLiveUiContext): Promise<void> {
    const conv = ctx.host.transcriptLastConv;
    if (!conv || !conversationShouldWatchDevPreview(conv, window.location.origin)) {
        return;
    }
    ctx.transcriptPreviewSettlePollUntil = Date.now() + 45_000;
    ctx.kickoffTranscriptDevPreviewBootstrap(conv);
    await ctx.refreshTranscriptPreviewOffer(conv);
}

export function maybeActivateTranscriptDevPreviewExtracted(ctx: MobileProjectsTranscriptLiveUiContext, conv: QaapAgentConversationDTO | undefined): void {
    if (!conv) {
        return;
    }
    ctx.ensureTranscriptDevPreviewWatch(conv);
}

export function ensureTranscriptDevPreviewWatchExtracted(ctx: MobileProjectsTranscriptLiveUiContext, conv: QaapAgentConversationDTO,
    options?: { readonly restartPreviewPoll?: boolean },): void {
    if (conversationRequestsDevPreview(conv) || conversationAwaitingDevPreview(conv)) {
        ctx.kickoffTranscriptDevPreviewBootstrap(conv);
    }
    if (conversationShouldWatchDevPreview(conv, window.location.origin) || ctx.host.transcriptPreviewRequestPending) {
        ctx.scheduleTranscriptPreviewOfferRefresh(conv, { restart: options?.restartPreviewPoll });
    }
}

export function onTranscriptUserMessageSubmittedExtracted(ctx: MobileProjectsTranscriptLiveUiContext, content: string, conv: QaapAgentConversationDTO): void {
    ctx.transcriptPreviewSettlePollUntil = Date.now() + 120_000;
    ctx.transcriptDevPreviewBootstrapConversationId = undefined;
    ctx.transcriptPreviewOfferAnnouncedUrl = undefined;
    ctx.transcriptPreviewFailureReportedFor.delete(conv.id);
    ctx.transcriptPreviewPollMisses = 0;
    const project = ctx.host.transcriptOpenProject;
    const summary = ctx.host.transcriptOpenSummary;
    if (messageRequestsDevPreview(content) && project && summary && !ctx.host.transcriptPreviewSuppressedByUser) {
        ctx.host.transcriptPreviewRequestPending = true;
        ctx.host.beginTranscriptDevPreviewRequest(project, summary);
    }
    if (!ctx.host.transcriptPreviewSuppressedByUser) {
        ctx.ensureTranscriptDevPreviewWatch(conv, { restartPreviewPoll: true });
    } else {
        ctx.stopTranscriptPreviewOfferRefresh();
    }
}

export function maybeSyncTranscriptVisuallySettledChromeExtracted(ctx: MobileProjectsTranscriptLiveUiContext, conv: QaapAgentConversationDTO): void {
    if (!ctx.isActiveTranscriptConversation(conv.id)) {
        ctx.transcriptTurnVisuallySettledActive = false;
        return;
    }
    if (conv.status === 'streaming') {
        if (conv.messages.at(-1)?.role !== 'agent' || !isConversationTurnVisuallySettled(conv)) {
            ctx.transcriptTurnVisuallySettledActive = false;
            return;
        }
        const becameVisuallySettled = !ctx.transcriptTurnVisuallySettledActive;
        if (becameVisuallySettled) {
            ctx.transcriptTurnVisuallySettledActive = true;
            const chatHost = ctx.resolveActiveTranscriptChatHost();
            if (chatHost) {
                const messageHost = ctx.host.transcriptMessagesUi.resolveTranscriptMessageHost(chatHost);
                ctx.host.transcriptMessagesUi.settleVisuallySettledAgentTranscript(messageHost, conv);
            }
            if (ctx.host.transcriptOpenSummary?.id === conv.id) {
                ctx.host.transcriptOpenSummary = ctx.reconcileConversationListSummary(conv);
            }
        }
        ctx.host.transcriptStickyComposerUi.refreshComposerActivityStack();
        ctx.host.transcriptComposerSendRefresh?.();
        ctx.host.transcriptHeaderUi.refreshTranscriptExecutionChrome();
        return;
    }
    if (conv.messages.at(-1)?.role !== 'agent' || !isConversationTurnVisuallySettled(conv)) {
        ctx.transcriptTurnVisuallySettledActive = false;
        return;
    }
    if (ctx.transcriptTurnVisuallySettledActive) {
        return;
    }
    ctx.transcriptTurnVisuallySettledActive = true;
    ctx.syncTranscriptConversationSettledChrome();
}

export function resolveTranscriptRefreshContextExtracted(ctx: MobileProjectsTranscriptLiveUiContext): {
    project: MobileProjectEntry;
    summary: QaapAgentConversationSummaryDTO;
    chatHost: HTMLElement;
} | undefined {
    const project = ctx.host.transcriptOpenProject;
    const summaryId = ctx.host.transcriptOpenSummaryId;
    const chatHost = ctx.resolveActiveTranscriptChatHost();
    if (!project || !summaryId || !chatHost) {
        return undefined;
    }
    const summary = ctx.host.conversationIndexUi.conversationsForProject(project).find(c => c.id === summaryId)
        ?? ctx.host.transcriptOpenSummary;
    if (!summary) {
        return undefined;
    }
    return { project, summary, chatHost };
}

