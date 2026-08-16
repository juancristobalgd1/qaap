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
import {
    recordTranscriptRenderMetric,
} from '../common/qaap-transcript-render-metrics';
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
import { TRANSCRIPT_VISUAL_VERIFICATION_POLL_BUDGET_MS } from './mobile-projects-transcript-live-ui';
import { TRANSCRIPT_VISUAL_VERIFICATION_POLL_MS } from './mobile-projects-transcript-live-ui';
import { TRANSCRIPT_PREVIEW_POLL_BASE_MS } from './mobile-projects-transcript-live-ui';
import { TRANSCRIPT_APPROVAL_REFRESH_MS, TRANSCRIPT_PREVIEW_POLL_MAX_MS, TRANSCRIPT_SSE_COALESCE_RAF } from './mobile-projects-transcript-live-ui';

export function stopTranscriptLiveWatchExtracted(ctx: any): void {
        ctx.transcriptTurnVisuallySettledActive = false;
        if (ctx.sseDeltaResyncTimer !== undefined) {
            window.clearTimeout(ctx.sseDeltaResyncTimer);
            ctx.sseDeltaResyncTimer = undefined;
        }
        if (ctx.sseRenderRafId) {
            cancelAnimationFrame(ctx.sseRenderRafId);
            ctx.sseRenderRafId = 0;
        }
        if (ctx.sseRenderTimer !== undefined) {
            window.clearTimeout(ctx.sseRenderTimer);
            ctx.sseRenderTimer = undefined;
        }
        ctx.pendingSseRenderConv = undefined;
        ctx.lastMountedApprovalId = undefined;
        ctx.lastInlineApprovalSyncKey = undefined;
        ctx.transcriptPreviewPollIntervalMs = TRANSCRIPT_PREVIEW_POLL_BASE_MS;
        ctx.transcriptPreviewPollMisses = 0;
        ctx.stopTranscriptVisualVerificationPoll();
        ctx.stopTranscriptComposerActivityRefresh();
        ctx.transcriptLiveController?.stopWatch();
        ctx.host.transcriptScheduleRefresh = undefined;
        ctx.stopTranscriptApprovalRefresh();
        ctx.stopTranscriptPreviewOfferRefresh();
}

export function stopTranscriptApprovalRefreshExtracted(ctx: any): void {
        if (ctx.host.transcriptApprovalRefreshTimer !== undefined) {
            window.clearTimeout(ctx.host.transcriptApprovalRefreshTimer);
            ctx.host.transcriptApprovalRefreshTimer = undefined;
        }
}

export function scheduleTranscriptApprovalRefreshExtracted(ctx: any): void {
        ctx.stopTranscriptApprovalRefresh();
        if (!ctx.host.transcriptOpenSummaryId || !ctx.host.transcriptLastConv
            || !conversationUsesInteractiveApprovals(ctx.host.transcriptLastConv)) {
            return;
        }
        ctx.host.transcriptApprovalRefreshTimer = window.setTimeout(() => {
            ctx.host.transcriptApprovalRefreshTimer = undefined;
            void ctx.refreshTranscriptApprovals();
        }, TRANSCRIPT_APPROVAL_REFRESH_MS);
}

export async function refreshTranscriptApprovalsExtracted(ctx: any): Promise<void> {
        if (!ctx.host.transcriptOpenSummaryId) {
            return;
        }
        try {
            ctx.host.cachedAgentApprovals = await fetchAgentApprovals(ctx.host.transcriptOpenProject
                ? ctx.host.projectsService.getProjectCwd(ctx.host.transcriptOpenProject)
                : ctx.host.transcriptOpenSummary?.cwd);
            if (ctx.host.transcriptLastConv) {
                ctx.syncTranscriptPendingApproval(ctx.host.transcriptLastConv);
            }
        } catch {
            /* best-effort */
        } finally {
            if (ctx.host.transcriptLastConv?.status === 'streaming'
                && conversationUsesInteractiveApprovals(ctx.host.transcriptLastConv)) {
                ctx.scheduleTranscriptApprovalRefresh();
            }
        }
}

export function ensureTranscriptLiveControllerExtracted(ctx: any): QaapTranscriptLiveController {
        if (!ctx.transcriptLiveController) {
            ctx.transcriptLiveController = new QaapTranscriptLiveController({
                isDocumentVisible: () => isTranscriptDocumentVisible(),
                isWatching: id => ctx.isWatchingOpenTranscript(id),
                getOpenSummary: () => ctx.host.transcriptOpenSummary,
                setOpenSummary: summary => { ctx.host.transcriptOpenSummary = summary; },
                getLastConv: () => ctx.host.transcriptLastConv,
                setLastConv: conv => { ctx.host.transcriptLastConv = conv; },
                getLastSseDeltaAt: () => ctx.host.transcriptLastSseDeltaAt,
                setLastSseDeltaAt: at => {
                    ctx.host.transcriptLastSseDeltaAt = at;
                },
                findSummaryById: id => ctx.host.conversations?.findSummaryById(id),
                refreshConversation: options => ctx.refreshOpenTranscriptConversation(options),
                renderConversation: conv => {
                    if (conv.status === 'streaming' && TRANSCRIPT_SSE_COALESCE_RAF) {
                        // Boundary summary renders arrive synchronously on the raw SSE
                        // stack — merge them into the same coalescer as token deltas so
                        // a message boundary paints once per frame instead of racing the
                        // coalesced flush. A pending delta-built snapshot is newer than
                        // this summary-merged one (its status still flows in through
                        // transcriptOpenSummary at flush time), so never overwrite it.
                        if (!ctx.pendingSseRenderConv) {
                            ctx.pendingSseRenderConv = conv;
                        }
                        ctx.schedulePendingSseRender();
                        return;
                    }
                    const chatHost = ctx.resolveActiveTranscriptChatHost();
                    if (chatHost) {
                        ctx.host.transcriptMessagesUi.renderTranscriptMessages(chatHost, conv);
                    }
                },
                onApprovalRefresh: () => ctx.scheduleTranscriptApprovalRefresh(),
                onStatusSettled: () => ctx.syncTranscriptConversationSettledChrome(),
                conversationsOnDidChange: ctx.host.conversations?.onDidChange ?? TheiaEvent.None,
            });
        }
        return ctx.transcriptLiveController;
}

export function getPendingTranscriptToolApprovalExtracted(ctx: any, conversationId: string,
        toolUseId: string,): QaapAgentApprovalRequestDTO | undefined {
        return findTranscriptToolApproval(ctx.host.cachedAgentApprovals, conversationId, toolUseId);
}

export function syncTranscriptPendingApprovalExtracted(ctx: any, conv: QaapAgentConversationDTO): void {
        const chatHost = ctx.resolveActiveTranscriptChatHost();
        const pending = resolveTranscriptInlineApproval(ctx.host.cachedAgentApprovals, conv.id);
        // Always surface a real pending store item (Allow/Deny card), even if policy reconciliation
        // thought the run was non-interactive — high-risk queue under approve-for-me depends on this.
        if (!conversationUsesInteractiveApprovals(conv) && !pending) {
            if (chatHost && ctx.lastInlineApprovalSyncKey !== undefined) {
                removeTranscriptPendingApprovalHosts(chatHost);
                ctx.lastInlineApprovalSyncKey = undefined;
            }
            if (ctx.lastMountedApprovalId !== undefined) {
                clearTranscriptPendingApprovalBar(ctx.host.transcriptComposerHost);
                ctx.lastMountedApprovalId = undefined;
            }
            return;
        }
        const pendingId = pending?.id;
        const syncKey = ctx.buildTranscriptApprovalSyncKey(chatHost, conv, pendingId);
        if (syncKey === ctx.lastInlineApprovalSyncKey && pendingId === ctx.lastMountedApprovalId) {
            recordTranscriptRenderMetric('approval_sync_skipped');
            return;
        }
        recordTranscriptRenderMetric('approval_sync');
        ctx.lastInlineApprovalSyncKey = syncKey;
        if (chatHost) {
            ctx.reconcileTranscriptInlineToolApprovalCards(chatHost, conv);
        }
        if (pendingId === ctx.lastMountedApprovalId) {
            return;
        }
        ctx.lastMountedApprovalId = pendingId;
        const onSettled = (): void => {
            ctx.stopTranscriptApprovalRefresh();
            void ctx.refreshTranscriptApprovals();
            ctx.ensureTranscriptConversationRefresh();
        };
        mountTranscriptPendingApprovalBar(
            ctx.host.transcriptComposerHost,
            pending,
            {
                onApprove: () => {
                    if (!pending) {
                        return;
                    }
                    void respondToTranscriptApproval(pending.id, 'approve', { callbacks: { onSettled } });
                },
                onReject: () => {
                    if (!pending) {
                        return;
                    }
                    void respondToTranscriptApproval(pending.id, 'reject', { callbacks: { onSettled } });
                },
            },
        );
        if (pending) {
            scrollTranscriptPendingApprovalIntoView(ctx.host.transcriptComposerHost);
        }
}

export function buildTranscriptApprovalSyncKeyExtracted(ctx: any, chatHost: HTMLElement | undefined,
        conv: QaapAgentConversationDTO,
        pendingId: string | undefined,): string {
        const approvals = ctx.host.cachedAgentApprovals
            .filter(approval => approval.conversationId === conv.id)
            .map(approval => `${approval.id}:${approval.toolUseId ?? ''}:${approval.kind}`)
            .sort()
            .join(',');
        const visibleToolIds = chatHost
            ? [...chatHost.querySelectorAll<HTMLDetailsElement>(`details[${TRANSCRIPT_TOOL_USE_ID_ATTR}]`)]
                .map(pill => pill.getAttribute(TRANSCRIPT_TOOL_USE_ID_ATTR) ?? '')
                .filter(Boolean)
                .sort()
                .join(',')
            : '';
        const mountedInlineCards = chatHost
            ? [...chatHost.querySelectorAll<HTMLElement>(`.${TRANSCRIPT_APPROVAL_CARD_CLASS}`)]
                .map(card => card.closest<HTMLDetailsElement>(`details[${TRANSCRIPT_TOOL_USE_ID_ATTR}]`)?.getAttribute(TRANSCRIPT_TOOL_USE_ID_ATTR) ?? '')
                .filter(Boolean)
                .sort()
                .join(',')
            : '';
        return [
            conv.id,
            conv.status,
            pendingId ?? '',
            approvals,
            visibleToolIds,
            mountedInlineCards,
        ].join('|');
}

export function reconcileTranscriptInlineToolApprovalCardsExtracted(ctx: any, chatHost: HTMLElement, conv: QaapAgentConversationDTO): void {
        const pills = chatHost.querySelectorAll<HTMLDetailsElement>(`details[${TRANSCRIPT_TOOL_USE_ID_ATTR}]`);
        pills.forEach(pill => {
            const toolUseId = pill.getAttribute(TRANSCRIPT_TOOL_USE_ID_ATTR);
            if (!toolUseId) {
                return;
            }
            const segment = ctx.findTranscriptToolSegment(conv, toolUseId);
            const shouldShow = !!segment
                && isPendingTranscriptToolSegment(segment)
                && ctx.hasPendingTranscriptToolApproval(conv.id, toolUseId);
            const card = pill.querySelector(`.${TRANSCRIPT_APPROVAL_CARD_CLASS}`);
            if (shouldShow && !card && segment) {
                let body = pill.querySelector<HTMLElement>('.theia-mobile-agent-tool-pill-body');
                if (!body) {
                    body = document.createElement('div');
                    body.className = 'theia-mobile-agent-tool-pill-body';
                    pill.append(body);
                }
                body.prepend(ctx.host.transcriptMessagesUi.createTranscriptToolApprovalActions(conv.id, segment));
                pill.open = true;
            } else if (!shouldShow && card) {
                card.remove();
            }
        });
}

export function hasInlineToolApprovalCardExtracted(ctx: any, chatHost: HTMLElement | undefined, toolUseId: string): boolean {
        return !!chatHost?.querySelector(
            `details[${TRANSCRIPT_TOOL_USE_ID_ATTR}="${CSS.escape(toolUseId)}"] .${TRANSCRIPT_APPROVAL_CARD_CLASS}`,
        );
}

export function findTranscriptToolSegmentExtracted(ctx: any, conv: QaapAgentConversationDTO,
        toolUseId: string,): Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }> | undefined {
        for (let i = conv.messages.length - 1; i >= 0; i--) {
            for (const segment of conv.messages[i].segments ?? []) {
                if (segment.type === 'tool' && segment.toolUseId === toolUseId) {
                    return segment;
                }
            }
        }
        return undefined;
}

export function stopTranscriptPreviewOfferRefreshExtracted(ctx: any): void {
        if (ctx.transcriptPreviewOfferTimer !== undefined) {
            window.clearTimeout(ctx.transcriptPreviewOfferTimer);
            ctx.transcriptPreviewOfferTimer = undefined;
        }
}

export function resolveTranscriptPreviewPollIntervalMsExtracted(ctx: any): number {
        return Math.min(
            TRANSCRIPT_PREVIEW_POLL_MAX_MS,
            TRANSCRIPT_PREVIEW_POLL_BASE_MS + ctx.transcriptPreviewPollMisses * 400,
        );
}

export function scheduleTranscriptPreviewOfferRefreshExtracted(ctx: any, conv: QaapAgentConversationDTO | undefined ,
        options?: { readonly restart?: boolean },): void {
        if (!options?.restart && ctx.transcriptPreviewOfferTimer !== undefined) {
            return;
        }
        ctx.stopTranscriptPreviewOfferRefresh();
        if (!ctx.host.transcriptOpenSummaryId || !conv || !isTranscriptDocumentVisible()) {
            return;
        }
        const shouldWatch = conversationShouldWatchDevPreview(conv, window.location.origin)
            || ctx.host.transcriptPreviewRequestPending;
        const settlePollActive = conv.status !== 'streaming'
            && shouldWatch
            && (ctx.transcriptPreviewSettlePollUntil ?? 0) > Date.now();
        if (conv.status !== 'streaming' && !settlePollActive) {
            return;
        }
        if (!shouldWatch) {
            return;
        }
        ctx.transcriptPreviewOfferTimer = window.setTimeout(() => {
            ctx.transcriptPreviewOfferTimer = undefined;
            void ctx.refreshTranscriptPreviewOffer(conv);
        }, ctx.transcriptPreviewPollIntervalMs);
}

export async function refreshTranscriptPreviewOfferExtracted(ctx: any, conv: QaapAgentConversationDTO | undefined ): Promise<void> {
        if (!conv || !ctx.host.transcriptOpenSummaryId || !isTranscriptDocumentVisible()) {
            return;
        }
        try {
            ctx.kickoffTranscriptDevPreviewBootstrap(conv);
            const readyUrl = await ctx.resolveReadyTranscriptPreviewUrl(conv);
            if (readyUrl) {
                ctx.transcriptPreviewPollMisses = 0;
                ctx.transcriptPreviewPollIntervalMs = TRANSCRIPT_PREVIEW_POLL_BASE_MS;
                await ctx.openReadyTranscriptPreviewUrl(readyUrl, conv);
                const project = ctx.host.transcriptOpenProject;
                if (project && project.previewUrl !== readyUrl) {
                    const updated = { ...project, previewUrl: readyUrl };
                    ctx.host.transcriptOpenProject = updated;
                    void ctx.host.projectsService.recordProjectPreviewUrl(updated, readyUrl).catch(() => undefined);
                }
            } else {
                ctx.transcriptPreviewPollMisses += 1;
                ctx.transcriptPreviewPollIntervalMs = ctx.resolveTranscriptPreviewPollIntervalMs();
                const bootstrap = ctx.host.projectBootstrap;
                if (bootstrap) {
                    void ctx.maybeReportTranscriptPreviewBootstrapFailure(conv, bootstrap);
                }
            }
        } catch {
            /* best-effort */
        } finally {
            const shouldWatch = conversationShouldWatchDevPreview(conv, window.location.origin)
                || ctx.host.transcriptPreviewRequestPending;
            const keepPolling = conv.status === 'streaming'
                ? shouldWatch
                : shouldWatch && (ctx.transcriptPreviewSettlePollUntil ?? 0) > Date.now();
            if (keepPolling) {
                ctx.scheduleTranscriptPreviewOfferRefresh(conv);
            }
        }
}

export async function resolveReadyTranscriptPreviewUrlExtracted(ctx: any, conv: QaapAgentConversationDTO): Promise<string | undefined> {
        const readyUrl = await resolveReadyTranscriptPreviewUrlFromProbe(
            conv,
            port => probeQaapDevPreviewPort(port),
            window.location.origin,
        );
        return readyUrl ? normalizePreviewUrlForSameOrigin(readyUrl) : undefined;
}

export function ensureTranscriptConversationRefreshExtracted(ctx: any): void {
        const context = ctx.resolveTranscriptRefreshContext();
        if (!context || !ctx.isWatchingOpenTranscript(context.summary.id)) {
            ctx.stopTranscriptVisualVerificationPoll();
            return;
        }
        const wasPolling = ctx.transcriptVisualVerificationPollTimer !== undefined
            || ctx.transcriptVisualVerificationPollUntil !== undefined;
        if (context.summary.visualVerificationPending) {
            ctx.scheduleTranscriptVisualVerificationPoll(context.summary.id);
        } else {
            ctx.stopTranscriptVisualVerificationPoll();
            // Pending cleared while we were watching — paint evidence in place immediately.
            if (wasPolling) {
                void ctx.refreshOpenTranscriptConversation({ forcePoll: true });
            }
        }
        if (!ctx.host.transcriptScheduleRefresh) {
            ctx.scheduleTranscriptConversationRefresh(context.project, context.summary, context.chatHost);
            void ctx.refreshOpenTranscriptConversation({ forcePoll: true });
            return;
        }
        const liveStatus = ctx.host.transcriptLastConv?.status ?? context.summary.status;
        if (liveStatus !== 'streaming') {
            void ctx.refreshOpenTranscriptConversation({ forcePoll: true });
            return;
        }
        ctx.host.transcriptScheduleRefresh();
}

export function scheduleTranscriptVisualVerificationPollExtracted(ctx: any, conversationId: string): void {
        if (ctx.transcriptVisualVerificationPollTimer !== undefined) {
            return;
        }
        ctx.transcriptVisualVerificationPollUntil = Date.now() + TRANSCRIPT_VISUAL_VERIFICATION_POLL_BUDGET_MS;
        const tick = (): void => {
            ctx.transcriptVisualVerificationPollTimer = undefined;
            if (!ctx.isWatchingOpenTranscript(conversationId)) {
                ctx.stopTranscriptVisualVerificationPoll();
                return;
            }
            const summary = ctx.host.transcriptOpenSummary;
            if (!summary || summary.id !== conversationId || !summary.visualVerificationPending) {
                // Capture completed (or summary dropped) — one final forcePoll so the open
                // transcript swaps "Processing…" for the real screenshot/video without a remount.
                ctx.stopTranscriptVisualVerificationPoll();
                void ctx.refreshOpenTranscriptConversation({ forcePoll: true });
                return;
            }
            if ((ctx.transcriptVisualVerificationPollUntil ?? 0) <= Date.now()) {
                ctx.stopTranscriptVisualVerificationPoll();
                void ctx.refreshOpenTranscriptConversation({ forcePoll: true });
                return;
            }
            void ctx.refreshOpenTranscriptConversation({ forcePoll: true });
            ctx.transcriptVisualVerificationPollTimer = window.setTimeout(tick, TRANSCRIPT_VISUAL_VERIFICATION_POLL_MS);
        };
        ctx.transcriptVisualVerificationPollTimer = window.setTimeout(tick, TRANSCRIPT_VISUAL_VERIFICATION_POLL_MS);
}

export function stopTranscriptVisualVerificationPollExtracted(ctx: any): void {
        if (ctx.transcriptVisualVerificationPollTimer !== undefined) {
            window.clearTimeout(ctx.transcriptVisualVerificationPollTimer);
            ctx.transcriptVisualVerificationPollTimer = undefined;
        }
        ctx.transcriptVisualVerificationPollUntil = undefined;
}

