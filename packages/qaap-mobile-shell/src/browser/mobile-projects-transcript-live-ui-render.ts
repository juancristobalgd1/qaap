import type { MobileProjectsTranscriptLiveUiContext } from './mobile-projects-transcript-live-ui-context';
// Extracted from mobile-projects-transcript-live-ui.ts

import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import {
    type QaapAgentConversationDTO,
    type QaapAgentConversationSummaryDTO,
    type QaapAgentMessageDTO,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { applyAgentMessageWireDelta } from '@theia/qaap-shared-core/lib/common/qaap-agent-message-wire-delta';
import {
    advanceTranscriptSemanticProgressClock,
    resolveTranscriptStreamingAgentSegments,
    seedTranscriptSemanticProgressClock,
} from '../common/qaap-transcript-semantic-progress';
import type { ConversationLiveMessageEvent } from '@theia/qaap-shared-core/lib/browser/mobile-projects-conversations';
import {
    applyConversationMessageDelta,
    canApplySseMessageDelta,
} from '@theia/qaap-transcript-overlay/lib/common/qaap-transcript-sse-delta';
import {
    mergeConversationTranscriptFingerprint,
} from '@theia/qaap-transcript-overlay/lib/common/qaap-transcript-incremental-update';
import { isTranscriptDocumentVisible } from '../common/qaap-transcript-document-visibility';
import { resolveTranscriptStreamingCoalesceDelayMs } from '../common/qaap-transcript-streaming-coalesce';
import {
    recordTranscriptRenderMetric,
} from '@theia/qaap-transcript-overlay/lib/common/qaap-transcript-render-metrics';
import { isTranscriptScrollNearBottom } from '@theia/qaap-transcript-overlay/lib/common/qaap-transcript-user-scroll-pin';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import { TRANSCRIPT_SSE_COALESCE_RAF } from './mobile-projects-transcript-live-ui';

export function touchTranscriptSemanticProgressFromConversationExtracted(ctx: MobileProjectsTranscriptLiveUiContext, conv: QaapAgentConversationDTO): void {
        const segments = resolveTranscriptStreamingAgentSegments(conv);
        const next = advanceTranscriptSemanticProgressClock(segments, {
            at: ctx.host.transcriptLastStreamProgressAt,
            key: ctx.host.transcriptLastSemanticProgressKey,
        });
        ctx.host.transcriptLastStreamProgressAt = next.at;
        ctx.host.transcriptLastSemanticProgressKey = next.key;
}

export function clearTranscriptSemanticProgressClockExtracted(ctx: MobileProjectsTranscriptLiveUiContext): void {
        ctx.host.transcriptLastStreamProgressAt = undefined;
        ctx.host.transcriptLastSemanticProgressKey = undefined;
        ctx.host.transcriptLastTransportEventAt = undefined;
}

export function seedTranscriptSemanticProgressClockExtracted(ctx: MobileProjectsTranscriptLiveUiContext): void {
        const seeded = seedTranscriptSemanticProgressClock();
        ctx.host.transcriptLastStreamProgressAt = seeded.at;
        ctx.host.transcriptLastSemanticProgressKey = seeded.key;
        ctx.host.transcriptLastTransportEventAt = seeded.at;
}

export function readOpenTranscriptRollbackSnapshotExtracted(ctx: MobileProjectsTranscriptLiveUiContext, conversationId: string): QaapAgentConversationDTO | undefined {
        const conv = ctx.host.transcriptLastConv;
        const source = conv?.id === conversationId
            ? conv
            : ctx.peekCachedOpenTranscript(conversationId);
        if (!source) {
            return undefined;
        }
        return { ...source, messages: [...source.messages] };
}

export function restoreOpenTranscriptSnapshotExtracted(ctx: MobileProjectsTranscriptLiveUiContext, conv: QaapAgentConversationDTO): void {
        ctx.host.transcriptLastConv = conv;
        ctx.host.transcriptLastFingerprint = undefined;
        const chatHost = ctx.resolveActiveTranscriptChatHost();
        if (chatHost) {
            ctx.host.transcriptMessagesUi.renderTranscriptMessages(chatHost, conv);
        }
        ctx.host.transcriptHeaderUi.refreshTranscriptExecutionChrome();
}

export function applyOptimisticConversationCancelExtracted(ctx: MobileProjectsTranscriptLiveUiContext, summary: QaapAgentConversationSummaryDTO): void {
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

export function applyOptimisticStreamTimeoutRetryExtracted(ctx: MobileProjectsTranscriptLiveUiContext, summary: QaapAgentConversationSummaryDTO): void {
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

export function applyOptimisticFailedTaskRetryExtracted(ctx: MobileProjectsTranscriptLiveUiContext, summary: QaapAgentConversationSummaryDTO): void {
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

export async function resyncOpenTranscriptStreamAfterTimeoutExtracted(ctx: MobileProjectsTranscriptLiveUiContext, project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,): Promise<void> {
        const chatHost = ctx.resolveActiveTranscriptChatHost();
        if (chatHost) {
            ctx.scheduleTranscriptConversationRefresh(project, summary, chatHost);
        }
        await ctx.refreshOpenTranscriptConversation({ forcePoll: true });
}

export function ensureVisibilityResumeListenerExtracted(ctx: MobileProjectsTranscriptLiveUiContext): void {
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

export function handleTranscriptSseMessageExtracted(ctx: MobileProjectsTranscriptLiveUiContext, event: ConversationLiveMessageEvent): void {
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

export function scheduleSseDeltaResyncExtracted(ctx: MobileProjectsTranscriptLiveUiContext): void {
        if (ctx.sseDeltaResyncTimer !== undefined) {
            return;
        }
        ctx.sseDeltaResyncTimer = window.setTimeout(() => {
            ctx.sseDeltaResyncTimer = undefined;
            void ctx.refreshOpenTranscriptConversation({ forcePoll: true });
        }, 250);
}

export function resolveLiveSseMessageExtracted(ctx: MobileProjectsTranscriptLiveUiContext, event: ConversationLiveMessageEvent): QaapAgentMessageDTO | undefined {
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

export function pauseTranscriptBackgroundRendersExtracted(ctx: MobileProjectsTranscriptLiveUiContext): void {
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

export function schedulePendingSseRenderExtracted(ctx: MobileProjectsTranscriptLiveUiContext): void {
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

export function isActiveTranscriptNearBottomExtracted(ctx: MobileProjectsTranscriptLiveUiContext): boolean {
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

export function flushPendingSseRenderExtracted(ctx: MobileProjectsTranscriptLiveUiContext): void {
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

export function bindOpenTranscriptThreadStoreExtracted(ctx: MobileProjectsTranscriptLiveUiContext, conversationId: string): void {
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

