import type { MobileProjectsTranscriptMessagesArtifactsUiContext } from './mobile-projects-transcript-messages-artifacts-ui-context';
// Extracted from mobile-projects-transcript-messages-artifacts-ui.ts

import { nls } from '@theia/core/lib/common/nls';
import { type QaapAgentConversationDTO, type QaapAgentMessageSegmentDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { isAwaitingFirstTranscriptAgentOutput, resolveLastUserPromptChars, resolveTranscriptTurnElapsedMs, resolveTranscriptTurnStartMs, shouldShowTranscriptInlineTimeline, shouldShowTranscriptStreamingActivity, shouldTranscriptStreamLabelShimmer } from '../common/qaap-transcript-stream-status';
import { type TranscriptStreamTimeoutCause } from '../common/qaap-transcript-stream-health';
import { resolveTranscriptStreamingAgentSegments } from '../common/qaap-transcript-semantic-progress';
import {
    resolveTranscriptEffectiveStatus,
} from '@theia/qaap-shared-core/lib/common/qaap-transcript-turn-status';
import { resolveQaapTranscriptTrace } from '@theia/qaap-shared-core/lib/common/qaap-transcript-trace-model';
import { recordTranscriptRenderMetric } from '@theia/qaap-transcript-overlay/lib/common/qaap-transcript-render-metrics';
import { TRANSCRIPT_ACTIVITY_ROW_ATTR, TRANSCRIPT_ACTIVITY_TIMELINE_ATTR, TRANSCRIPT_MESSAGE_ID_ATTR } from '@theia/qaap-transcript-overlay/lib/common/qaap-transcript-incremental-update';
import { syncAgentSetupElement } from '../common/qaap-agent-setup-phrases';
import {
    hasMobileExecutionEventTimeline,
    refreshMobileExecutionEventTimeline,
} from './qaap-execution-event-timeline';
import {
    resolveTranscriptChatHostFromNode,
} from '../common/qaap-transcript-live-status';
import {
    buildTranscriptExecutionTimelineItems,
} from './mobile-projects-transcript-timeline-utils';

export function createTranscriptStreamTimeoutBannerExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, cause?: TranscriptStreamTimeoutCause,): HTMLElement {
        const banner = document.createElement('div');
        banner.className = 'theia-mobile-agent-stream-timeout-banner';
        banner.setAttribute('role', 'alert');

        const message = document.createElement('p');
        message.className = 'theia-mobile-agent-stream-timeout-message';
        message.textContent = nls.localize(
            'qaap/mobileProjects/transcriptStreamTimedOut',
            'The agent didn’t respond in time',
        );
        const detailText = ctx.resolveTranscriptStreamTimeoutDetail(cause);
        if (detailText) {
            const detail = document.createElement('p');
            detail.className = 'theia-mobile-agent-stream-timeout-detail';
            detail.textContent = detailText;
            message.after(detail);
        }

        const actions = document.createElement('div');
        actions.className = 'theia-mobile-agent-stream-timeout-actions';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'theia-mobile-agent-stream-timeout-btn theia-mod-ghost';
        cancelBtn.textContent = nls.localize('qaap/mobileProjects/transcriptStreamTimeoutCancel', 'Cancel');
        cancelBtn.addEventListener('click', () => {
            ctx.host.cancelOpenTranscriptStream?.();
        });

        const retryBtn = document.createElement('button');
        retryBtn.type = 'button';
        retryBtn.className = 'theia-mobile-agent-stream-timeout-btn theia-mod-primary';
        retryBtn.textContent = nls.localize('qaap/mobileProjects/transcriptStreamTimeoutRetry', 'Retry');
        retryBtn.addEventListener('click', () => {
            void ctx.host.retryOpenTranscriptStream?.();
        });

        actions.append(cancelBtn, retryBtn);
        banner.append(message, actions);
        return banner;
}

export function resolveTranscriptRowSegmentsExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, conv: QaapAgentConversationDTO, row: HTMLElement): QaapAgentMessageSegmentDTO[] {
        const messageId = row.getAttribute(TRANSCRIPT_MESSAGE_ID_ATTR);
        if (messageId) {
            const message = conv.messages.find(entry => entry.id === messageId);
            if (message) {
                const segments = resolveQaapTranscriptTrace(message).segments;
                if (segments.length) {
                    return [...segments];
                }
            }
        }
        const lastAgent = [...conv.messages].reverse().find(message => message.role === 'agent');
        return lastAgent ? [...resolveQaapTranscriptTrace(lastAgent).segments] : [];
}

export function syncTranscriptStreamingActivityLineExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, line: Element,
        conv: QaapAgentConversationDTO,
        stalled: boolean,
        timedOut = false,): void {
        const ownerRow = line.closest<HTMLElement>('.theia-mobile-agent-transcript-msg');
        const segments = ownerRow
            ? ctx.resolveTranscriptRowSegments(conv, ownerRow)
            : [...resolveTranscriptStreamingAgentSegments(conv)];
        const turnStartMs = resolveTranscriptTurnStartMs(conv.messages);
        const show = shouldShowTranscriptStreamingActivity(segments, true, {
            turnElapsedMs: resolveTranscriptTurnElapsedMs(turnStartMs),
            userPromptChars: resolveLastUserPromptChars(conv.messages),
            stalled: stalled || timedOut,
            awaitingFirstAgentOutput: isAwaitingFirstTranscriptAgentOutput(conv),
        });
        const host = line.closest<HTMLElement>(`[${TRANSCRIPT_ACTIVITY_ROW_ATTR}]`) ?? line.parentElement;
        // While the backend turn is still streaming, keep the setup/stream indicator mounted
        // and visible. Toggling `hidden` here caused a hide→show flicker (logo + shimmer phrase
        // + elapsed meta) whenever `shouldShow` briefly flipped during live work.
        const keepVisibleWhileStreaming = resolveTranscriptEffectiveStatus(conv) === 'streaming';
        if (host instanceof HTMLElement) {
            host.hidden = keepVisibleWhileStreaming ? false : !show;
        }
        if (!show && !keepVisibleWhileStreaming) {
            return;
        }
        const state = ctx.resolveTranscriptStreamingActivity(conv, { stalled, timedOut });
        const durationLabel = stalled || timedOut ? state.title : ctx.resolveTranscriptStreamDurationLabel(conv);
        if (line.classList.contains('qaap-agent-setup')) {
            syncAgentSetupElement(line as HTMLElement, stalled || timedOut ? null : durationLabel);
            return;
        }
        line.className = `theia-mobile-agent-stream-line theia-mod-${state.kind}`;
        const label = line.querySelector('.theia-mobile-agent-stream-label');
        if (label) {
            label.textContent = timedOut ? state.title : durationLabel;
            label.classList.toggle(
                'theia-mod-shimmer',
                shouldTranscriptStreamLabelShimmer(state.kind, stalled, timedOut),
            );
            label.classList.toggle('theia-mod-stall', stalled || timedOut);
        }
}

export function syncTranscriptStreamingActivityRowExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, row: HTMLElement, conv: QaapAgentConversationDTO): boolean {
        if (!row.hasAttribute(TRANSCRIPT_ACTIVITY_ROW_ATTR)) {
            return false;
        }
        const line = row.querySelector<HTMLElement>('.theia-mobile-agent-stream-line, .qaap-agent-setup');
        if (!line) {
            return false;
        }
        const stalled = ctx.resolveTranscriptStreamStalled(conv);
        const timedOut = ctx.resolveTranscriptStreamTimedOut(conv);
        ctx.syncTranscriptStreamingActivityLine(line, conv, stalled, timedOut);
        row.classList.toggle('theia-mod-streaming', resolveTranscriptEffectiveStatus(conv) === 'streaming');
        row.classList.toggle('theia-mod-stream-stalled', stalled);
        row.classList.toggle('theia-mod-stream-timed-out', timedOut);
        row.setAttribute('aria-live', 'polite');
        row.setAttribute('aria-busy', resolveTranscriptEffectiveStatus(conv) === 'streaming' ? 'true' : 'false');
        row.dataset.qaapAgenticState = timedOut ? 'timeout' : stalled ? 'stall' : 'streaming';
        const existingBanner = row.querySelector('.theia-mobile-agent-stream-timeout-banner');
        if (timedOut) {
            if (!existingBanner) {
                row.append(ctx.createTranscriptStreamTimeoutBanner());
            }
        } else {
            existingBanner?.remove();
        }
        if (resolveTranscriptEffectiveStatus(conv) === 'streaming') {
            ctx.ensureTranscriptStreamStallWatch(row);
        }
        // Pin status from the first setup tick so the orb never lives only in the scrollport.
        ctx.ensurePinnedTranscriptLiveStatus(conv, { stalled, timedOut });
        return true;
}

export function patchStreamingActivityTimelineExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, row: HTMLElement,
        nextSegments: readonly QaapAgentMessageSegmentDTO[],
        conv?: QaapAgentConversationDTO,): boolean {
        // ─── Codex-style execution event timeline path ──────────────────────
        // If the row was rendered with the new execution event timeline, rebuild
        // it in place. This is cheap (a flat list of collapsed <details>) and
        // avoids the complex incremental sync logic of the legacy timeline.
        const segmentsBody = row.querySelector<HTMLElement>('.theia-mobile-agent-transcript-segments');
        if (segmentsBody && hasMobileExecutionEventTimeline(row)) {
            const queuedRefreshSegments = ctx.consumeExecutionTimelineRefresh(row);
            const skippedOnly = !queuedRefreshSegments && ctx.consumeSkippedExecutionTimelineRefresh(row);
            // Prefer live trace-derived segments from the conversation snapshot —
            // stale msg.segments[] can lag behind traceEvents while a shell tool
            // streams stdout, which would leave an open terminal card on
            // "Running…" even though patch_tool / patch_trace_event already
            // updated the trace. Signature caching keeps no-op refreshes cheap.
            const refreshSegments = conv
                ? ctx.resolveTranscriptRowSegments(conv, row)
                : (queuedRefreshSegments ?? nextSegments);
            if (conv || !skippedOnly) {
                const hasTools = refreshSegments.some(s => s.type === 'tool');
                if (hasTools) {
                    recordTranscriptRenderMetric('timeline_sync');
                    refreshMobileExecutionEventTimeline(segmentsBody, refreshSegments);
                }
            }
            // Sync the accordion label here too: this path handles the
            // tool-START frame (a new tool appended to a streaming row), and a
            // long quiet tool produces no further frames — without this sync
            // the live label would keep the verb captured before the tool
            // began (usually none, i.e. plain 'Processing…').
            // Always re-assert brand logo + live footer even when the timeline
            // refresh itself was skipped — otherwise mid-stream patches can
            // leave Processing… without the working indicator.
            ctx.syncRowProcessAccordion(row, refreshSegments, conv, true);
            // Streaming patches must never leave a Files Changed card mounted.
            segmentsBody.querySelector('.theia-mobile-diff-summary')?.remove();
            if (conv) {
                const stalled = ctx.resolveTranscriptStreamStalled(conv);
                const timedOut = ctx.resolveTranscriptStreamTimedOut(conv);
                ctx.ensureAndSyncTranscriptLiveStatusFooter(segmentsBody, refreshSegments, conv, {
                    streaming: true,
                    stalled,
                    timedOut,
                });
            }
            return true;
        }

        // ─── Upgrade path: thinking → tools ────────────────────────────────
        // The row was created during the thinking phase (no tools, so a thought
        // brief was rendered). Now tools are present — upgrade to the Codex-style
        // execution event timeline so the user sees events, not a tool log.
        if (segmentsBody && nextSegments.some(s => s.type === 'tool')) {
            recordTranscriptRenderMetric('timeline_upgrade');
            ctx.upgradeToMobileExecutionEventTimeline(row, nextSegments, { streaming: true, conv });
            return true;
        }

        // ─── Legacy activity timeline path ──────────────────────────────────
        const stalled = ctx.resolveTranscriptStreamStalled(conv);
        const timedOut = ctx.resolveTranscriptStreamTimedOut(conv);
        const streaming = row.classList.contains('theia-mod-streaming');
        if (!shouldShowTranscriptInlineTimeline(nextSegments, streaming)) {
            segmentsBody?.querySelector(`[${TRANSCRIPT_ACTIVITY_TIMELINE_ATTR}]`)?.remove();
            ctx.patchStreamingThoughtBrief(row, nextSegments, conv, true);
            if (streaming && conv && segmentsBody) {
                ctx.ensureAndSyncTranscriptLiveStatusFooter(segmentsBody, nextSegments, conv, {
                    streaming: true,
                    stalled,
                    timedOut,
                });
            }
            return true;
        }
        const items = ctx.resolveTranscriptActivityItemsForDisplay([...nextSegments], {
            stalled,
            timedOut,
            row,
            conv,
            streaming,
        });
        if (items.length === 0) {
            ctx.patchStreamingThoughtBrief(row, nextSegments, conv, true);
            if (streaming && conv && segmentsBody) {
                ctx.ensureAndSyncTranscriptLiveStatusFooter(segmentsBody, nextSegments, conv, {
                    streaming: true,
                    stalled,
                    timedOut,
                });
            }
            return true;
        }
        if (!segmentsBody) {
            return false;
        }
        let timeline = segmentsBody.querySelector<HTMLElement>(`[${TRANSCRIPT_ACTIVITY_TIMELINE_ATTR}]`);
        const timelineOptions = {
            streaming: true,
            stalled,
            timedOut,
            expanded: false,
            segments: nextSegments,
            includeThinkingSteps: true,
            conv,
            row,
        };
        if (!timeline) {
            recordTranscriptRenderMetric('timeline_create');
            const created = ctx.createTranscriptActivityTimeline([...nextSegments], timelineOptions);
            if (!created) {
                return false;
            }
            const thoughtBrief = segmentsBody.querySelector('.theia-mobile-agent-thought-brief');
            if (thoughtBrief) {
                thoughtBrief.insertAdjacentElement('afterend', created);
            } else {
                segmentsBody.prepend(created);
            }
            timeline = created;
        } else {
            ctx.syncTranscriptActivityTimelineElement(timeline, buildTranscriptExecutionTimelineItems(items), timelineOptions);
        }
        // Hide the thought brief when the timeline is visible (instead of removing it)
        // to prevent flickering from create/destroy cycles during streaming.
        const thoughtBrief = segmentsBody.querySelector<HTMLElement>('.theia-mobile-agent-thought-brief');
        if (thoughtBrief) {
            thoughtBrief.hidden = true;
        }
        if (streaming && conv) {
            ctx.ensureAndSyncTranscriptLiveStatusFooter(segmentsBody, nextSegments, conv, {
                streaming: true,
                stalled,
                timedOut,
            });
        }
        return true;
}

export function ensureTranscriptLiveStatusForStreamingRowExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, row: HTMLElement, conv: QaapAgentConversationDTO): void {
        const segmentsBody = row.querySelector<HTMLElement>('.theia-mobile-agent-transcript-segments');
        if (segmentsBody instanceof HTMLElement) {
            const segments = ctx.resolveTranscriptRowSegments(conv, row);
            const stalled = ctx.resolveTranscriptStreamStalled(conv);
            const timedOut = ctx.resolveTranscriptStreamTimedOut(conv);
            ctx.ensureAndSyncTranscriptLiveStatusFooter(segmentsBody, segments, conv, {
                streaming: true,
                stalled,
                timedOut,
            });
            return;
        }
        ctx.ensurePinnedTranscriptLiveStatus(conv);
}

export function shouldHoldPinnedTranscriptLiveStatusExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, conv: QaapAgentConversationDTO): boolean {
        if (conv.status !== 'streaming' && conv.status !== 'settled') {
            return false;
        }
        return ctx.pinnedLiveStatusConvId === conv.id
            && Date.now() < ctx.pinnedLiveStatusHoldUntil;
}

export function resolveTranscriptLiveStatusChatHostExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, hint?: HTMLElement): HTMLElement | undefined {
        if (hint?.isConnected && hint.classList.contains('theia-mobile-agent-transcript-real-chat')) {
            return hint;
        }
        const fromHint = resolveTranscriptChatHostFromNode(hint);
        if (fromHint?.isConnected) {
            return fromHint;
        }
        const fromHost = ctx.host.transcriptChatHost;
        if (fromHost instanceof HTMLElement && fromHost.isConnected) {
            return fromHost;
        }
        const queried = document.querySelector<HTMLElement>('.theia-mobile-agent-transcript-real-chat');
        return queried?.isConnected ? queried : undefined;
}

