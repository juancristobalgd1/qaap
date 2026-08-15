// @ts-nocheck
// Extracted from mobile-projects-transcript-live-ui.ts

import { Event as TheiaEvent } from '@theia/core/lib/common/event';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import {
    conversationToSummary,
    getConversation,
    type QaapAgentConversationDTO,
    type QaapAgentConversationSummaryDTO,
    type QaapAgentMessageDTO,
    type QaapAgentMessageSegmentDTO,
} from '../common/qaap-agent-conversation-client';
import { conversationUsesInteractiveApprovals } from '../common/qaap-agent-interactive-approvals';
import {
    fetchAgentApprovals,
    type QaapAgentApprovalRequestDTO,
} from '../common/qaap-agent-approval-client';
import { resolveMessagePreviewText } from '../common/qaap-agent-message-content';
import { excerptTranscriptThought } from '../common/qaap-agent-transcript-segments';
import { applyAgentMessageWireDelta } from '../common/qaap-agent-message-wire-delta';
import {
    advanceTranscriptSemanticProgressClock,
    resolveTranscriptStreamingAgentSegments,
    seedTranscriptSemanticProgressClock,
} from '../common/qaap-transcript-semantic-progress';
import type { ConversationLiveMessageEvent } from './mobile-projects-conversations';
import {
    applyConversationMessageDelta,
    canApplySseMessageDelta,
    shouldSkipStreamingTranscriptRefetch,
} from '../common/qaap-transcript-sse-delta';
import { findTranscriptToolApproval, isPendingTranscriptToolSegment, resolveTranscriptInlineApproval } from '../common/qaap-transcript-approval-inline';
import { TRANSCRIPT_APPROVAL_CARD_CLASS } from './qaap-transcript-approval-card-ui';
import {
    clearTranscriptPendingApprovalBar,
    mountTranscriptPendingApprovalBar,
    removeTranscriptPendingApprovalHosts,
    scrollTranscriptPendingApprovalIntoView,
} from './qaap-transcript-inline-approval-ui';
import { respondToTranscriptApproval } from './qaap-transcript-approval-respond';
import {
    conversationAwaitingDevPreview,
    conversationMayAutoOpenTranscriptPreview,
    conversationRequestsDevPreview,
    conversationShouldKickoffDevPreviewBootstrap,
    conversationShouldWatchDevPreview,
    messageRequestsDevPreview,
    resolveReadyTranscriptPreviewUrlFromProbe,
} from '../common/qaap-transcript-preview-offer';
import {
    buildTranscriptPreviewBootstrapFailureReason,
    shouldReportTranscriptPreviewBootstrapFailure,
    toTranscriptPreviewBootstrapSnapshot,
} from '../common/qaap-transcript-preview-bootstrap-failure';
import { reportPreviewBootstrapFailure } from '../common/qaap-agent-conversation-client';
import { agentMessageHasVisualVerificationMarker } from '../common/qaap-visual-verification';
import { normalizePreviewUrlForSameOrigin } from '@theia/qaap-adapters/lib/browser/qaap-preview-url-utils';
import { probeQaapDevPreviewPort } from './qaap-dev-preview-client';
import { ensureTranscriptDevPreview } from './qaap-transcript-preview-bootstrap';
import type { QaapProjectBootstrapService } from './qaap-project-bootstrap-service';
import {
    buildConversationTranscriptFingerprint,
    mergeConversationTranscriptFingerprint,
    shouldForceTranscriptRenderOnStatusSettle,
    TRANSCRIPT_TOOL_USE_ID_ATTR,
} from '../common/qaap-transcript-incremental-update';
import { warmAgentTurnPath } from '../common/qaap-agent-turn-warm';
import { isTranscriptDocumentVisible } from '../common/qaap-transcript-document-visibility';
import { scheduleTranscriptIdleWork, type TranscriptIdleWorkHandle } from '../common/qaap-transcript-idle-scheduler';
import { resolveTranscriptStreamingCoalesceDelayMs } from '../common/qaap-transcript-streaming-coalesce';
import { isTranscriptScrollNearBottom } from '../common/qaap-transcript-user-scroll-pin';
import { isTranscriptAgentExecutionBusy, resolveTranscriptEffectiveStatus, isConversationTurnVisuallySettled } from '../common/qaap-transcript-turn-status';
import {
    QaapTranscriptLiveController,
    type QaapTranscriptLiveRefreshOptions,
} from './qaap-transcript-live-controller';
import { MobileSnackbar } from './mobile-snackbar';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { MobileProjectsService } from './mobile-projects-service';
import type { MobileProjectsConversations } from './mobile-projects-conversations';
import type { MobileProjectsTranscriptMessagesUi } from './mobile-projects-transcript-messages-ui';
import type { MobileProjectsTranscriptUi } from './mobile-projects-transcript-ui';
import type { MobileProjectsTranscriptStickyComposerUi } from './mobile-projects-transcript-sticky-composer-ui';
import type { MobileProjectsExecutionSurfaceTabsUi } from './mobile-projects-execution-surface-tabs-ui';
import type { MobileProjectsTranscriptHeaderUi } from './mobile-projects-transcript-header-ui';
import { QaapAgUiTranscriptLiveBridge } from './qaap-ag-ui-transcript-live-bridge';

export function scheduleTranscriptConversationRefreshExtracted(ctx: any, project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        _chatHost: HTMLElement,): void {
        ctx.transcriptTurnVisuallySettledActive = false;
        warmAgentTurnPath(
            ctx.host.projectsService.getProjectCwd(project) ?? summary.cwd,
            { warmLiveTransport: () => ctx.host.conversations?.warmLiveTransport() },
        );
        const controller = ctx.ensureTranscriptLiveController();
        controller.watch(summary.id);
        ctx.bindOpenTranscriptThreadStore(summary.id);
        ctx.host.transcriptScheduleRefresh = controller.onScheduleRefresh;
        ctx.scheduleTranscriptApprovalRefresh();
        // Always force a GET on open/switch so incomplete SSE caches / preview shells
        // cannot stick until the next SSE event (transcript looked truncated on reopen).
        void ctx.refreshOpenTranscriptConversation({ forcePoll: true });
}

export function renderOpenTranscriptPlaceholderExtracted(ctx: any, chatHost: HTMLElement,
        summary: QaapAgentConversationSummaryDTO,): void {
        // Never paint lastMessagePreview as a fake transcript row — it is list chrome (often
        // mid-sentence / truncated) and sticks until a GET finishes. Show an empty shell instead.
        ctx.host.transcriptMessagesUi.renderTranscriptMessages(chatHost, {
            id: summary.id,
            cwd: summary.cwd,
            agentId: summary.agentId,
            title: summary.title,
            status: summary.status,
            createdAt: summary.createdAt,
            updatedAt: summary.updatedAt,
            messages: [],
        });
}

/**
 * Only reuse a cached document when it looks complete vs the list summary.
 * Incomplete SSE caches and stale messageCount mismatches caused truncated
 * transcripts on reopen ("uld you like to work on?").
 */
export function isTrustedOpenTranscriptCache(
    cached: QaapAgentConversationDTO,
    summary: QaapAgentConversationSummaryDTO,
): boolean {
    if (cached.id !== summary.id) {
        return false;
    }
    if (cached.messages.some(message => message.id.endsWith(':summary-preview'))) {
        return false;
    }
    const expected = summary.messageCount;
    if (typeof expected === 'number' && expected > 0 && cached.messages.length < expected) {
        return false;
    }
    if (cached.messages.length === 0 && resolveTranscriptEffectiveStatus(cached) !== 'streaming') {
        return false;
    }
    return true;
}

export function applyCachedTranscriptOnOpenExtracted(ctx: any, summary: QaapAgentConversationSummaryDTO,
        chatHost: HTMLElement,): boolean {
        const cached = ctx.readCachedTranscriptConversation(summary.id);
        if (!cached || !isTrustedOpenTranscriptCache(cached, summary)) {
            return false;
        }
        // Safety net: merge the fresh summary status into the cached document so
        // the transcript never shows a stale streaming/idle indicator on reopen.
        const synced = cached.status !== summary.status || cached.updatedAt < summary.updatedAt
            ? { ...cached, status: summary.status, updatedAt: Math.max(cached.updatedAt, summary.updatedAt) }
            : cached;
        ctx.host.transcriptLastConv = synced;
        ctx.host.transcriptLastFingerprint = ctx.conversationTranscriptFingerprint(synced);
        ctx.host.transcriptMessagesUi.renderTranscriptMessages(chatHost, synced);
        ctx.host.conversations?.cacheDocument(synced);
        return true;
}

export function reconcileConversationListSummaryExtracted(ctx: any, full: QaapAgentConversationDTO): QaapAgentConversationSummaryDTO {
        const snapshot = conversationToSummary(full);
        const stored = ctx.host.conversations?.findSummaryById(full.id);
        const shouldPersist = !stored
            || stored.status !== snapshot.status
            || snapshot.updatedAt > stored.updatedAt
            || stored.activityLabel !== snapshot.activityLabel;
        if (shouldPersist) {
            ctx.host.conversations?.recordSnapshot(snapshot);
        }
        return snapshot;
}

export async function resolveOpenTranscriptConversationExtracted(ctx: any, summary: QaapAgentConversationSummaryDTO,): Promise<QaapAgentConversationDTO | undefined> {
        if (summary.source === 'theia-chat' || summary.id.startsWith('theia-chat-service:')) {
            return ctx.host.getChatServiceConversation(summary);
        }
        try {
            return await getConversation(summary.id);
        } catch {
            if (summary.sessionId) {
                return ctx.host.getChatServiceConversation(summary);
            }
            return undefined;
        }
}

export async function refreshOpenTranscriptConversationExtracted(ctx: any, options?: QaapTranscriptLiveRefreshOptions,): Promise<void> {
        const activeId = ctx.host.transcriptOpenSummaryId;
        if (ctx.refreshInFlight && ctx.refreshInFlightConversationId === activeId) {
            if (options?.forceStatusSettle) {
                return ctx.refreshInFlight.then(() => ctx.refreshOpenTranscriptConversation(options));
            }
            return ctx.refreshInFlight;
        }
        ctx.refreshInFlightConversationId = activeId;
        ctx.refreshInFlight = ctx.doRefreshOpenTranscriptConversation(options).finally(() => {
            ctx.refreshInFlight = undefined;
            ctx.refreshInFlightConversationId = undefined;
        });
        return ctx.refreshInFlight;
}

export async function doRefreshOpenTranscriptConversationExtracted(ctx: any, options?: QaapTranscriptLiveRefreshOptions,): Promise<void> {
        const context = ctx.resolveTranscriptRefreshContext();
        if (!context) {
            return;
        }
        const { project: activeProject, summary: activeSummary, chatHost: activeChatHost } = context;
        if (ctx.host.transcriptHeaderUi.isPendingNewChatSummary(activeSummary)) {
            return;
        }
        if (!ctx.isActiveTranscriptConversation(activeSummary.id)) {
            return;
        }
        if (shouldSkipStreamingTranscriptRefetch(ctx.host.transcriptLastConv, ctx.host.transcriptLastSseDeltaAt)
            && !options?.forceStatusSettle
            && !options?.forcePoll) {
            return;
        }
        const localSnapshot = options?.forcePoll
            ? ctx.readCachedTranscriptConversation(activeSummary.id)
            : undefined;
        if (localSnapshot && localSnapshot.messages.length > 0) {
            ctx.host.transcriptLastConv = localSnapshot;
            const cacheFingerprint = ctx.conversationTranscriptFingerprint(localSnapshot);
            if (ctx.host.transcriptLastFingerprint !== cacheFingerprint) {
                ctx.host.transcriptLastFingerprint = cacheFingerprint;
                ctx.host.transcriptMessagesUi.renderTranscriptMessages(activeChatHost, localSnapshot);
            }
        }
        try {
            const full = await ctx.resolveOpenTranscriptConversation(activeSummary);
            if (!full) {
                throw new Error('Conversation not found');
            }
            if (!ctx.isActiveTranscriptConversation(activeSummary.id) || !activeChatHost.isConnected) {
                return;
            }
            const fingerprint = ctx.conversationTranscriptFingerprint(full);
            const fingerprintUnchanged = fingerprint === ctx.host.transcriptLastFingerprint;
            const forceStatusSettle = options?.forceStatusSettle
                || shouldForceTranscriptRenderOnStatusSettle(
                    ctx.host.transcriptLastConv,
                    full,
                    fingerprintUnchanged,
                );
            if (!fingerprintUnchanged || forceStatusSettle) {
                await ctx.host.syncTranscriptPreviewFromConversation(activeProject, activeSummary, full);
            }
            ctx.host.transcriptLastConv = full;
            ctx.cacheTranscriptConversation(full);
            const reconciledSummary = ctx.reconcileConversationListSummary(full);
            ctx.host.transcriptOpenSummary = reconciledSummary;
            if (ctx.host.transcriptComposerSummary?.id === full.id
                && ctx.host.transcriptComposerPrefsConvId !== full.id) {
                ctx.host.transcriptStickyComposerUi.applyTranscriptComposerPrefsFromConversation(full, activeProject, activeSummary);
                ctx.host.transcriptStickyComposerUi.remountTranscriptStickyComposer();
            }
            if (fingerprintUnchanged && !forceStatusSettle) {
                if (conversationUsesInteractiveApprovals(full)) {
                    ctx.syncTranscriptPendingApproval(full);
                }
                if (reconciledSummary.status !== 'streaming' && ctx.host.transcriptLastStatus === 'streaming') {
                    ctx.syncTranscriptConversationSettledChrome();
                }
                if (full.status !== 'streaming' && !ctx.host.transcriptPreviewRequestPending) {
                    ctx.host.transcriptLastSseDeltaAt = undefined;
                    ctx.clearTranscriptSemanticProgressClock();
                }
                return;
            }
            ctx.host.transcriptLastFingerprint = fingerprint;
            if (full.status === 'streaming') {
                ctx.touchTranscriptSemanticProgressFromConversation(full);
            }
            ctx.host.transcriptMessagesUi.renderTranscriptMessages(activeChatHost, full);
            if (conversationUsesInteractiveApprovals(full)) {
                ctx.syncTranscriptPendingApproval(full);
            }
            if (ctx.host.transcriptComposerSummary?.id === full.id) {
                ctx.host.transcriptStickyComposerUi.refreshTranscriptComposerActivityIfNeeded(full);
            }
            if (ctx.host.transcriptSheet) {
                const surfaceTab = ctx.host.executionSurfaceTabsUi.executionSurfaceTabForProject(activeProject);
                ctx.host.executionSurfaceTabsUi.showOnlyExecutionSurfaceTab(surfaceTab);
                ctx.host.executionSurfaceTabsUi.mountTranscriptSurfaceTab(activeProject, activeSummary, surfaceTab);
                ctx.host.executionSurfaceTabsUi.syncExecutionSurfaceChrome(activeProject);
            }
            ctx.host.handleTranscriptStatusForAutoVerify(activeProject, activeSummary, full.status);
            if (full.status !== 'streaming') {
                ctx.host.transcriptLastSseDeltaAt = undefined;
                ctx.clearTranscriptSemanticProgressClock();
                ctx.syncTranscriptConversationSettledChrome();
            } else {
                ctx.host.transcriptLastStatus = full.status;
            }
            if (full.status === 'streaming') {
                ctx.scheduleTranscriptApprovalRefresh();
                ctx.maybeActivateTranscriptDevPreview(full);
            } else if (conversationShouldWatchDevPreview(full, window.location.origin)) {
                void ctx.finalizeTranscriptDevPreviewAfterSettle();
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn('[qaap] transcript refresh failed:', message);
            MobileSnackbar.show(message, { kind: 'warning', duration: 3200 });
        }
}

