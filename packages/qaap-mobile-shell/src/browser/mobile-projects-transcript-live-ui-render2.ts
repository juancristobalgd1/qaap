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
    // QAAP-METRICS-DEBUG (temporary, gated by ?qaapRenderMetrics=1) — revert with this block.
    enableTranscriptRenderMetrics,
    resetTranscriptRenderMetrics,
    getTranscriptRenderMetricsSnapshot,
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

export function touchTranscriptSemanticProgressFromConversationExtracted(ctx: any, conv: QaapAgentConversationDTO): void {
        const segments = resolveTranscriptStreamingAgentSegments(conv);
        const next = advanceTranscriptSemanticProgressClock(segments, {
            at: ctx.host.transcriptLastStreamProgressAt,
            key: ctx.host.transcriptLastSemanticProgressKey,
        });
        ctx.host.transcriptLastStreamProgressAt = next.at;
        ctx.host.transcriptLastSemanticProgressKey = next.key;
}

export function clearTranscriptSemanticProgressClockExtracted(ctx: any): void {
        ctx.host.transcriptLastStreamProgressAt = undefined;
        ctx.host.transcriptLastSemanticProgressKey = undefined;
        ctx.host.transcriptLastTransportEventAt = undefined;
}

export function seedTranscriptSemanticProgressClockExtracted(ctx: any): void {
        const seeded = seedTranscriptSemanticProgressClock();
        ctx.host.transcriptLastStreamProgressAt = seeded.at;
        ctx.host.transcriptLastSemanticProgressKey = seeded.key;
        ctx.host.transcriptLastTransportEventAt = seeded.at;
}

export function readOpenTranscriptRollbackSnapshotExtracted(ctx: any, conversationId: string): QaapAgentConversationDTO | undefined {
        const conv = ctx.host.transcriptLastConv;
        const source = conv?.id === conversationId
            ? conv
            : ctx.peekCachedOpenTranscript(conversationId);
        if (!source) {
            return undefined;
        }
        return { ...source, messages: [...source.messages] };
}

export function restoreOpenTranscriptSnapshotExtracted(ctx: any, conv: QaapAgentConversationDTO): void {
        ctx.host.transcriptLastConv = conv;
        ctx.host.transcriptLastFingerprint = undefined;
        const chatHost = ctx.resolveActiveTranscriptChatHost();
        if (chatHost) {
            ctx.host.transcriptMessagesUi.renderTranscriptMessages(chatHost, conv);
        }
        ctx.host.transcriptHeaderUi.refreshTranscriptExecutionChrome();
}

export function applyOptimisticConversationCancelExtracted(ctx: any, summary: QaapAgentConversationSummaryDTO): void {
        const conv = ctx.host.transcriptLastConv;
        if (!conv || conv.id !== summary.id) {
            return;
        }
        const optimistic: QaapAgentConversationDTO = {
            ...conv,
            status: 'idle',
            updatedAt: Date.now(),
            messages: conv.messages.map(message => message.role === 'agent' && message.runActive
                ? { ...message, runActive: undefined }
                : message),
        };
        ctx.host.transcriptLastConv = optimistic;
        ctx.host.transcriptLastFingerprint = undefined;
        const chatHost = ctx.resolveActiveTranscriptChatHost();
        if (chatHost) {
            ctx.host.transcriptMessagesUi.renderTranscriptMessages(chatHost, optimistic);
        }
        ctx.scheduleTranscriptComposerActivityRefresh(optimistic);
        ctx.host.transcriptHeaderUi.refreshTranscriptExecutionChrome();
        ctx.host.transcriptComposerSendRefresh?.();
}

export function applyOptimisticStreamTimeoutRetryExtracted(ctx: any, summary: QaapAgentConversationSummaryDTO): void {
        ctx.seedTranscriptSemanticProgressClock();
        ctx.transcriptTurnVisuallySettledActive = false;
        const conv = ctx.host.transcriptLastConv;
        const chatHost = ctx.resolveActiveTranscriptChatHost();
        if (!chatHost || !conv || conv.id !== summary.id) {
            return;
        }
        const optimistic: QaapAgentConversationDTO = { ...conv, status: 'streaming' };
        ctx.host.transcriptLastConv = optimistic;
        ctx.host.transcriptLastFingerprint = undefined;
        ctx.host.transcriptMessagesUi.renderTranscriptMessages(chatHost, optimistic);
        ctx.scheduleTranscriptComposerActivityRefresh(optimistic);
        ctx.host.transcriptHeaderUi.refreshTranscriptExecutionChrome();
}

export function applyOptimisticFailedTaskRetryExtracted(ctx: any, summary: QaapAgentConversationSummaryDTO): void {
        ctx.seedTranscriptSemanticProgressClock();
        ctx.transcriptTurnVisuallySettledActive = false;
        const conv = ctx.readOpenTranscriptRollbackSnapshot(summary.id);
        const chatHost = ctx.resolveActiveTranscriptChatHost();
        if (!chatHost || !conv) {
            return;
        }
        const optimistic: QaapAgentConversationDTO = {
            ...conv,
            status: 'streaming',
            updatedAt: Date.now(),
        };
        ctx.host.transcriptLastConv = optimistic;
        ctx.host.transcriptLastFingerprint = undefined;
        ctx.host.transcriptMessagesUi.renderTranscriptMessages(chatHost, optimistic);
        ctx.scheduleTranscriptComposerActivityRefresh(optimistic);
        ctx.host.transcriptHeaderUi.refreshTranscriptExecutionChrome();
}

export async function resyncOpenTranscriptStreamAfterTimeoutExtracted(ctx: any, project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,): Promise<void> {
        const chatHost = ctx.resolveActiveTranscriptChatHost();
        if (chatHost) {
            ctx.scheduleTranscriptConversationRefresh(project, summary, chatHost);
        }
        await ctx.refreshOpenTranscriptConversation({ forcePoll: true });
}

export function ensureVisibilityResumeListenerExtracted(ctx: any): void {
        if (ctx.visibilityResumeListenerInstalled || typeof document === 'undefined') {
            return;
        }
        ctx.visibilityResumeListenerInstalled = true;
        document.addEventListener('visibilitychange', () => {
            if (!isTranscriptDocumentVisible()) {
                ctx.pauseTranscriptBackgroundRenders();
                return;
            }
            const conv = ctx.host.transcriptLastConv;
            if (!conv || !ctx.isActiveTranscriptConversation(conv.id)) {
                return;
            }
            if (conv.status === 'streaming') {
                ctx.scheduleTranscriptComposerActivityRefresh(conv);
                ctx.scheduleTranscriptPreviewOfferRefresh(conv, { restart: true });
                if (ctx.pendingSseRenderConv) {
                    ctx.schedulePendingSseRender();
                }
            }
        });
}

export function handleTranscriptSseMessageExtracted(ctx: any, event: ConversationLiveMessageEvent): void {
        if (!ctx.isActiveTranscriptConversation(event.conversationId)) {
            return;
        }
        ctx.touchTranscriptTransportEvent();
        ctx.agUiLiveBridge.onLiveMessage(event);
        const message = ctx.resolveLiveSseMessage(event);
        if (!message) {
            // Wire delta against a message the local snapshot never received (e.g. its
            // message_start was dropped) — silently skipping would wedge the transcript
            // for the rest of the turn, so re-sync once via GET instead.
            ctx.scheduleSseDeltaResync();
            return;
        }
        const base = ctx.host.transcriptLastConv;
        if (!canApplySseMessageDelta(base, event.conversationId, message)) {
            ctx.scheduleSseDeltaResync();
            return;
        }
        const next = applyConversationMessageDelta(base, message);
        if (next === base) {
            return;
        }
        ctx.ensureTranscriptLiveController().markSseDeltaApplied();
        ctx.agUiLiveBridge.afterMessageUpdated(event.conversationId, message);
        if (TRANSCRIPT_SSE_COALESCE_RAF) {
            ctx.pendingSseRenderConv = next;
            ctx.schedulePendingSseRender();
            return;
        }
        ctx.applyTranscriptSseRender(next, message);
}

export function scheduleSseDeltaResyncExtracted(ctx: any): void {
        if (ctx.sseDeltaResyncTimer !== undefined) {
            return;
        }
        ctx.sseDeltaResyncTimer = window.setTimeout(() => {
            ctx.sseDeltaResyncTimer = undefined;
            void ctx.refreshOpenTranscriptConversation({ forcePoll: true });
        }, 250);
}

export function resolveLiveSseMessageExtracted(ctx: any, event: ConversationLiveMessageEvent): QaapAgentMessageDTO | undefined {
        if (event.type === 'message') {
            return event.message;
        }
        const base = ctx.host.transcriptLastConv;
        if (!base) {
            return undefined;
        }
        if (event.delta.kind === 'message_start' || event.delta.kind === 'replace') {
            return event.delta.message;
        }
        const patched = applyAgentMessageWireDelta(base, event.delta);
        return patched;
}

export function pauseTranscriptBackgroundRendersExtracted(ctx: any): void {
        if (ctx.sseRenderRafId) {
            cancelAnimationFrame(ctx.sseRenderRafId);
            ctx.sseRenderRafId = 0;
        }
        if (ctx.sseRenderTimer !== undefined) {
            window.clearTimeout(ctx.sseRenderTimer);
            ctx.sseRenderTimer = undefined;
        }
        ctx.transcriptComposerActivityIdleHandle?.cancel();
        ctx.transcriptComposerActivityIdleHandle = undefined;
}

export function schedulePendingSseRenderExtracted(ctx: any): void {
        if (!isTranscriptDocumentVisible()) {
            return;
        }
        recordTranscriptRenderMetric('sse_scheduled');
        const nearBottom = ctx.isActiveTranscriptNearBottom();
        const delayMs = resolveTranscriptStreamingCoalesceDelayMs(nearBottom);
        if (delayMs === 0) {
            if (ctx.sseRenderTimer !== undefined) {
                window.clearTimeout(ctx.sseRenderTimer);
                ctx.sseRenderTimer = undefined;
            }
            if (!ctx.sseRenderRafId) {
                ctx.sseRenderRafId = requestAnimationFrame(() => ctx.flushPendingSseRender());
            }
            return;
        }
        if (ctx.sseRenderRafId) {
            cancelAnimationFrame(ctx.sseRenderRafId);
            ctx.sseRenderRafId = 0;
        }
        if (ctx.sseRenderTimer === undefined) {
            ctx.sseRenderTimer = window.setTimeout(() => {
                ctx.sseRenderTimer = undefined;
                ctx.flushPendingSseRender();
            }, delayMs);
        }
}

export function isActiveTranscriptNearBottomExtracted(ctx: any): boolean {
        const chatHost = ctx.resolveActiveTranscriptChatHost();
        if (!chatHost) {
            return true;
        }
        const list = ctx.host.transcriptUi.activeList;
        if (list?.active) {
            return list.isNearBottom();
        }
        const messageHost = ctx.host.transcriptMessagesUi.resolveTranscriptMessageHost(chatHost);
        return isTranscriptScrollNearBottom(
            messageHost.scrollTop,
            messageHost.clientHeight,
            messageHost.scrollHeight,
        );
}

export function flushPendingSseRenderExtracted(ctx: any): void {
        ctx.sseRenderRafId = 0;
        if (ctx.sseRenderTimer !== undefined) {
            window.clearTimeout(ctx.sseRenderTimer);
            ctx.sseRenderTimer = undefined;
        }
        if (!isTranscriptDocumentVisible()) {
            return;
        }
        const next = ctx.pendingSseRenderConv;
        if (!next) {
            return;
        }
        recordTranscriptRenderMetric('sse_flushed');
        ctx.pendingSseRenderConv = undefined;
        const lastMessage = next.messages.at(-1);
        if (!lastMessage) {
            return;
        }
        ctx.applyTranscriptSseRender(next, lastMessage);
}

export function bindOpenTranscriptThreadStoreExtracted(ctx: any, conversationId: string): void {
        ctx.threadStoreSummaryDispose.dispose();
        const conversations = ctx.host.conversations;
        if (!conversations) {
            ctx.threadStoreSummaryDispose = Disposable.NULL;
            return;
        }
        const summaryDispose = conversations.threadStore.subscribe<QaapAgentConversationSummaryDTO | undefined>(
            summary => {
                if (ctx.host.transcriptOpenSummary?.id !== conversationId) {
                    return;
                }
                if (summary) {
                    const previousVisualPending = ctx.host.transcriptOpenSummary.visualVerificationPending ?? false;
                    const nextVisualPending = summary.visualVerificationPending ?? false;
                    ctx.host.transcriptOpenSummary = {
                        ...ctx.host.transcriptOpenSummary,
                        ...summary,
                        // `visualVerificationPending` is omitted (not set to false) once the
                        // capture lands, so a plain spread would leave a stale `true` pinned
                        // forever — take the flag verbatim from the authoritative summary.
                        visualVerificationPending: summary.visualVerificationPending,
                    };
                    if (ctx.host.transcriptComposerSummary?.id === conversationId) {
                        ctx.host.transcriptComposerSummary = {
                            ...ctx.host.transcriptComposerSummary,
                            ...summary,
                            visualVerificationPending: summary.visualVerificationPending,
                        };
                    }
                    // A settled turn that emitted `[QAAP capture]`/`[QAAP record]` flips this
                    // flag on/off through summary events — the capture runs server-side after
                    // the SSE stream ends. Kick the verification poll on any change so the
                    // skeleton chip swaps to the real screenshot/video in place; without this
                    // the evidence only surfaced after a manual page reload.
                    if (nextVisualPending !== previousVisualPending) {
                        ctx.ensureTranscriptConversationRefresh();
                    }
                }
            },
            snapshot => snapshot.summariesById.get(conversationId),
            conversationId,
        );
        const documentDispose = conversations.threadStore.subscribe<QaapAgentConversationDTO | undefined>(
            document => {
                if (!document || document.id !== conversationId || !ctx.isActiveTranscriptConversation(conversationId)) {
                    return;
                }
                // Self-echo of the SSE flush that just cached this exact snapshot — it
                // already rendered and published the fingerprint. Skip without paying
                // any fingerprint work at all.
                if (document === ctx.host.transcriptLastConv && ctx.host.transcriptLastFingerprint !== undefined) {
                    return;
                }
                // Tail-only merge (prefix cache) instead of the O(messages × segments)
                // full build — this subscriber fires on the streaming hot path.
                const fingerprint = mergeConversationTranscriptFingerprint(ctx.host.transcriptLastConv, document);
                if (ctx.host.transcriptLastFingerprint === fingerprint) {
                    ctx.host.transcriptLastConv = document;
                    return;
                }
                const chatHost = ctx.resolveActiveTranscriptChatHost();
                if (!chatHost) {
                    return;
                }
                ctx.host.transcriptLastFingerprint = fingerprint;
                ctx.host.transcriptMessagesUi.renderTranscriptMessages(chatHost, document);
                if (document.status === 'streaming') {
                    ctx.touchTranscriptSemanticProgressFromConversation(document);
                    ctx.scheduleTranscriptComposerActivityRefresh(document);
                    ctx.scheduleTranscriptApprovalRefresh();
                    ctx.maybeActivateTranscriptDevPreview(document);
                } else {
                    ctx.clearTranscriptSemanticProgressClock();
                }
            },
            snapshot => snapshot.document,
            conversationId,
        );
        ctx.threadStoreSummaryDispose = new DisposableCollection(summaryDispose, documentDispose);
}

