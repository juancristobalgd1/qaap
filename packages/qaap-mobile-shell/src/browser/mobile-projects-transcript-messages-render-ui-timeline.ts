// @ts-nocheck
// Extracted from mobile-projects-transcript-messages-render-ui.ts

import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { nls } from '@theia/core/lib/common/nls';
import { normalizeAgentMessageContentForDisplay } from '../common/qaap-agent-message-content';
import { parseAgentLogForTranscript } from '../common/qaap-cli-transcript-stream';
import { dedupeAgentMessageTextSegments } from '../common/qaap-qaiq-stream';
import { resolveQaapTranscriptTrace, segmentsToTraceEvents, traceEventsToSegments, type QaapTranscriptTrace } from '../common/qaap-transcript-trace-model';
import { agentMessageHasStructuredTrace } from '../common/qaap-transcript-trace-lifecycle';
import { buildConversationTranscriptFingerprint, fingerprintTranscriptMessage, isStreamingTranscriptTailUnchanged, resolveStreamingTranscriptPatchDecision, resolveStreamingTranscriptPatchKind, TRANSCRIPT_ACTIVITY_ROW_ATTR, TRANSCRIPT_MESSAGE_ID_ATTR, canStreamPatchAgentAppendTextSegment, canStreamPatchAgentAppendThinkingSegment, canStreamPatchAgentAppendToolSegment, canStreamPatchAgentSegmentsInPlace, canStreamPatchAgentSegmentsInPlaceWithAppend, canStreamPatchStdoutAgentContentOnly, type QaapTranscriptStreamingPatchNoneReason } from '../common/qaap-transcript-incremental-update';
import { TRANSCRIPT_PENDING_APPROVAL_HOST_CLASS } from './qaap-transcript-inline-approval-ui';
import { TRANSCRIPT_APPROVAL_CARD_CLASS } from './qaap-transcript-approval-card-ui';
import { hasMobileExecutionEventTimeline, syncTranscriptStandaloneTurnProvenance } from './qaap-execution-event-timeline';
import { resolveAgentDisplayLabel } from './qaap-agent-ui';
import {
    isTranscriptAgentTailStreaming,
    resolveTranscriptEffectiveStatus,
    shouldShowTranscriptEmptyQuickActions,
} from '../common/qaap-transcript-turn-status';
import {
    appendBeforeTranscriptLiveStatus,
    detachTranscriptLiveStatusFromScroller,
} from '../common/qaap-transcript-live-status';
import { recordTranscriptRenderMetric, type QaapTranscriptRenderMetricKind } from '../common/qaap-transcript-render-metrics';
import { attachTranscriptScrollToBottomButton } from './qaap-transcript-scroll-to-bottom';
import {
    attachTranscriptScrollIntentObserver,
    transcriptHasActiveSelection,
    transcriptHasInteractiveFocus,
} from './qaap-transcript-scroll-intent';
import {
    ensureTranscriptScrollController,
    type TranscriptScrollController,
} from './qaap-transcript-scroll-controller';
import { attachTranscriptUserScrollPin } from './qaap-transcript-user-scroll-pin';
import { attachTranscriptInlineSearch } from './qaap-transcript-inline-search';
import {
    attachTranscriptReadPositionPersistence,
    resolveStoredTranscriptReadMessageIndex,
    restoreTranscriptReadPosition,
} from './qaap-transcript-read-position';
import { attachTranscriptActivityTimelineStickySummary } from './qaap-transcript-activity-timeline-sticky-summary';
import {
    attachTranscriptRowDeferObserver,
    shouldDeferTranscriptRowHeavyContent,
} from './qaap-transcript-row-defer';
import { normalizeAgentConversationFailures, type QaapAgentConversationDTO, type QaapAgentMessageDTO, type QaapAgentMessageSegmentDTO } from '../common/qaap-agent-conversation-client';
import {
    extractLastFailedToolFromMessage,
    resolveAgentTurnFailureTechnicalContent,
} from '../common/qaap-agent-failure-message';
import type { MobileProjectsTranscriptMessagesArtifactsUi } from './mobile-projects-transcript-messages-artifacts-ui';
import type { MobileProjectsTranscriptMessagesContentUi } from './mobile-projects-transcript-messages-content-ui';
import type { MobileProjectsTranscriptMessagesHost } from './mobile-projects-transcript-messages-ui';
import type { MobileProjectsTranscriptMessagesToolUi } from './mobile-projects-transcript-messages-tool-ui';
import type { MobileProjectsTranscriptMessagesUserUi } from './mobile-projects-transcript-messages-user-ui';
import type { WorkHubTranscriptBridge } from './work-hub-transcript-bridge';
import { PATCH_NONE_REASON_METRIC } from './mobile-projects-transcript-messages-render-ui';
import { AGENT_REPLACE_REASON_METRIC } from './mobile-projects-transcript-messages-render-ui';

export function attachTranscriptScrollChromeExtracted(ctx: any, host: HTMLElement,
        messageHost: HTMLElement,
        conv: QaapAgentConversationDTO,): void {
        const scroll = ctx.resolveTranscriptScrollController(messageHost);
        if (scroll.conversationId !== undefined && scroll.conversationId !== conv.id) {
            // Switching threads always drops follow; restore path owns viewport placement.
            scroll.beginConversation(conv.id);
            scroll.completeRestore();
        } else if (scroll.conversationId === undefined) {
            scroll.bindConversationId(conv.id);
        }
        // Skip rebuilding scroll chrome on same-conversation re-renders (streaming ticks,
        // incremental patches, settle refetches). Re-creating the scroll-to-bottom button
        // on every render tick causes it to flash hidden→visible: the new button starts
        // hidden and needs a rAF + 100ms debounce to show again. The existing button's
        // internal MutationObserver/ResizeObserver already detect content changes and
        // update visibility without a full teardown.
        if (ctx.transcriptScrollChromeBoundConversationId === conv.id
            && ctx.host.transcriptUserScrollPinDispose !== Disposable.NULL) {
            return;
        }
        ctx.transcriptScrollChromeBoundConversationId = conv.id;
        ctx.host.transcriptUserScrollPinDispose.dispose();
        ctx.host.transcriptUserScrollPinDispose = new DisposableCollection(
            attachTranscriptUserScrollPin(messageHost),
            attachTranscriptScrollIntentObserver(messageHost),
            scroll.bind(messageHost),
            attachTranscriptInlineSearch(host, messageHost),
            attachTranscriptReadPositionPersistence(messageHost, conv.id),
            attachTranscriptActivityTimelineStickySummary(messageHost),
            attachTranscriptScrollToBottomButton(host),
            attachTranscriptRowDeferObserver(messageHost, {
                renderMarkdown: (target, content, streaming) => {
                    if (streaming) {
                        ctx.contentUi.renderTranscriptStreamingMarkdown(target, content);
                    } else {
                        ctx.contentUi.renderTranscriptMarkdown(target, content);
                    }
                },
                renderToolBody: (target, segment, kind, streaming) => {
                    target.append(ctx.toolUi.createTranscriptToolResultBody(segment, kind, { streaming }));
                },
            }),
        );
        ctx.workHub.renderTeamSectionInTranscript(host, conv);
        ctx.workHub.renderInlineApproval(host, conv);
        ctx.host.transcriptHeaderUi.refreshTranscriptExecutionChrome();
        if (resolveTranscriptEffectiveStatus(conv) === 'streaming') {
            for (const row of messageHost.querySelectorAll<HTMLElement>('.theia-mobile-agent-transcript-msg.theia-mod-streaming')) {
                ctx.artifactsUi.ensureTranscriptStreamStallWatch(row);
            }
            const activityRow = messageHost.querySelector<HTMLElement>(`[${TRANSCRIPT_ACTIVITY_ROW_ATTR}]`);
            if (activityRow) {
                ctx.artifactsUi.ensureTranscriptStreamStallWatch(activityRow);
            }
        }
}

export function tryPatchStreamingTranscriptMessagesExtracted(ctx: any, host: HTMLElement, conv: QaapAgentConversationDTO): boolean {
        const messageHost = ctx.resolveTranscriptMessageHost(host);
        ctx.clearTranscriptEmptyQuickActions(messageHost, conv);
        const previousConversation = ctx.host.transcriptLastConv;
        const decision = resolveStreamingTranscriptPatchDecision(previousConversation, conv);
        const patchKind = decision.kind;
        const appendedUserMessageIndex = patchKind === 'append-agent' || patchKind === 'append-user'
            ? ctx.findAppendedUserMessageIndex(previousConversation, conv)
            : -1;
        if (patchKind === 'none') {
            if (isStreamingTranscriptTailUnchanged(ctx.host.transcriptLastConv, conv)) {
                recordTranscriptRenderMetric('render_skip_unchanged_tail');
                ctx.host.transcriptLastConv = conv;
                return true;
            }
            recordTranscriptRenderMetric('render_patch_none');
            recordTranscriptRenderMetric(PATCH_NONE_REASON_METRIC[decision.noneReason ?? 'tail-role-unknown']);
            return false;
        }
        if (ctx.host.transcriptUi.shouldVirtualize(conv)) {
            const list = ctx.host.transcriptUi.activeList;
            if (!list || ctx.host.transcriptUi.activeConversationId !== conv.id) {
                return false;
            }
            return ctx.tryPatchStreamingTranscriptVirtual(host, conv, patchKind);
        }
        const shouldFollowTail = ctx.shouldFollowTranscriptTail(messageHost);
        const anchor = shouldFollowTail ? undefined : ctx.captureTranscriptScrollAnchor(messageHost);

        if (patchKind === 'activity-only') {
            recordTranscriptRenderMetric('render_patch_activity');
            ctx.syncTranscriptActivityRow(messageHost, conv);
            ctx.host.transcriptLastConv = conv;
            ctx.host.transcriptLastRenderedConversationId = conv.id;
            ctx.host.transcriptLastRenderedMessageId = conv.messages.at(-1)?.id;
            ctx.artifactsUi.ensurePinnedTranscriptLiveStatus(conv);
            ctx.applyTranscriptScrollAfterMutation(messageHost, anchor);
            return true;
        }

        if (patchKind === 'append-user') {
            // A queued user message landed mid-stream: append the new row(s)
            // instead of rebuilding the whole list. Mirrors the full-render
            // output for a user tail — prior streaming rows settle, the
            // activity row moves below the new user turn.
            recordTranscriptRenderMetric('render_patch_append');
            const prevCount = ctx.host.transcriptLastConv?.messages.length ?? Math.max(0, conv.messages.length - 1);
            ctx.removeTranscriptActivityRow(messageHost);
            messageHost.querySelectorAll('.theia-mod-streaming').forEach(element => {
                if (element instanceof HTMLElement) {
                    ctx.contentUi.settleTranscriptStreamingContent(element);
                }
                element.classList.remove('theia-mod-streaming');
            });
            const fragment = document.createDocumentFragment();
            for (let index = prevCount; index < conv.messages.length; index++) {
                fragment.append(ctx.createTranscriptMessageRowAtIndex(conv, index));
            }
            appendBeforeTranscriptLiveStatus(messageHost, fragment);
            ctx.host.transcriptLastConv = conv;
            ctx.host.transcriptLastRenderedConversationId = conv.id;
            ctx.host.transcriptLastRenderedMessageId = conv.messages.at(-1)?.id;
            ctx.syncTranscriptActivityRow(messageHost, conv);
            ctx.scrollTranscriptToLastUserTurn(messageHost, { asPositionTurn: true });
            ctx.artifactsUi.ensurePinnedTranscriptLiveStatus(conv);
            return true;
        }

        const lastAgent = conv.messages[conv.messages.length - 1];
        if (!lastAgent || !lastAgent.id || lastAgent.role !== 'agent') {
            return false;
        }
        const prevLast = ctx.host.transcriptLastConv?.messages[ctx.host.transcriptLastConv.messages.length - 1];
        const segments = ctx.resolveTranscriptAgentSegments(conv, lastAgent);

        if (patchKind === 'last-agent') {
            const existing = messageHost.querySelector<HTMLElement>(
                `[${TRANSCRIPT_MESSAGE_ID_ATTR}="${CSS.escape(lastAgent.id)}"]`,
            );
            if (existing && ctx.tryPatchStreamingAgentTextContent(existing, prevLast, lastAgent, segments, conv)) {
                recordTranscriptRenderMetric('render_patch_last_agent');
                recordTranscriptRenderMetric('render_patch_last_agent_in_place');
                ctx.markTranscriptMessageRow(existing, lastAgent.id, isTranscriptAgentTailStreaming(conv));
                ctx.artifactsUi.ensureTranscriptLiveStatusForStreamingRow(existing, conv);
                ctx.removeTranscriptActivityRow(messageHost);
                ctx.host.transcriptLastConv = conv;
                ctx.host.transcriptLastRenderedConversationId = conv.id;
                ctx.host.transcriptLastRenderedMessageId = lastAgent.id;
                ctx.applyTranscriptScrollAfterMutation(messageHost, anchor);
                return true;
            }
        }

        ctx.removeTranscriptActivityRow(messageHost);
        messageHost.querySelectorAll('.theia-mod-streaming').forEach(element => {
            if (element instanceof HTMLElement) {
                ctx.contentUi.settleTranscriptStreamingContent(element);
            }
            element.classList.remove('theia-mod-streaming');
        });

        const row = segments?.length
            ? ctx.artifactsUi.createTranscriptAgentSegmentsRow(segments, lastAgent.error, conv, { streaming: true, message: lastAgent })
            : ctx.createTranscriptMessageRowAtIndex(conv, conv.messages.length - 1);
        ctx.markTranscriptMessageRow(row, lastAgent.id, isTranscriptAgentTailStreaming(conv));

        if (patchKind === 'last-agent') {
            recordTranscriptRenderMetric('render_patch_last_agent');
            const existing = messageHost.querySelector<HTMLElement>(
                `[${TRANSCRIPT_MESSAGE_ID_ATTR}="${CSS.escape(lastAgent.id)}"]`,
            );
            if (existing) {
                recordTranscriptRenderMetric('render_patch_last_agent_replace');
                recordTranscriptRenderMetric(AGENT_REPLACE_REASON_METRIC[ctx.lastAgentPatchRejectReason ?? 'predicates']);
                existing.replaceWith(row);
            } else {
                // The row for this message id was never mounted (e.g. the
                // placeholder tick was skipped) — this is an append, not a
                // replace; keep the two apart in telemetry.
                recordTranscriptRenderMetric('render_patch_last_agent_append_missing_row');
                appendBeforeTranscriptLiveStatus(messageHost, row);
            }
        } else {
            recordTranscriptRenderMetric('render_patch_append');
            if (!shouldFollowTail) {
                row.classList.add('theia-mod-new-message');
            }
            // A coalesced tick can deliver several rows at once — append every
            // intermediate row (user or agent) before the streaming tail.
            const prevCount = ctx.host.transcriptLastConv?.messages.length ?? Math.max(0, conv.messages.length - 1);
            if (conv.messages.length - prevCount > 1) {
                const fragment = document.createDocumentFragment();
                for (let index = prevCount; index < conv.messages.length - 1; index++) {
                    fragment.append(ctx.createTranscriptMessageRowAtIndex(conv, index));
                }
                appendBeforeTranscriptLiveStatus(messageHost, fragment);
            }
            appendBeforeTranscriptLiveStatus(messageHost, row);
        }

        ctx.host.transcriptLastConv = conv;
        ctx.host.transcriptLastRenderedConversationId = conv.id;
        ctx.host.transcriptLastRenderedMessageId = lastAgent.id;
        // Live-status is the scroller tail — re-pin after message append/replace.
        ctx.artifactsUi.ensurePinnedTranscriptLiveStatus(conv);
        if (appendedUserMessageIndex >= 0) {
            // SSE can coalesce the submitted user row and the agent placeholder
            // into one append-agent snapshot. Position by the appended slice,
            // not only by the role of the final message.
            ctx.scrollTranscriptToLastUserTurn(messageHost, { asPositionTurn: true });
        } else {
            ctx.applyTranscriptScrollAfterMutation(messageHost, anchor);
        }
        return true;
}

export function settleVisuallySettledAgentTranscriptExtracted(ctx: any, messageHost: HTMLElement, conv: QaapAgentConversationDTO): void {
        const lastAgent = [...conv.messages].reverse().find(message => message.role === 'agent');
        if (!lastAgent?.id) {
            return;
        }
        const row = messageHost.querySelector<HTMLElement>(
            `[${TRANSCRIPT_MESSAGE_ID_ATTR}="${CSS.escape(lastAgent.id)}"]`,
        );
        if (!row) {
            return;
        }
        // Settling swaps streaming chrome for the final trace (diff summary, completed tool
        // cards), which measurably grows the row — on a real turn this was ~+1.2k px. Anchor
        // the viewport across it exactly like the streaming patch paths do, so the reader's
        // position survives the expansion instead of the transcript jumping at every turn end.
        const shouldFollowTail = ctx.shouldFollowTranscriptTail(messageHost);
        const anchor = shouldFollowTail ? undefined : ctx.captureTranscriptScrollAnchor(messageHost);
        row.classList.remove('theia-mod-streaming');
        ctx.contentUi.settleTranscriptStreamingContent(row);
        delete row.dataset.qaapRowRenderKey;
        const segments = ctx.resolveTranscriptAgentSegments(conv, lastAgent);
        if (segments?.length) {
            ctx.artifactsUi.finalizeStreamingAgentTrace(row, segments, conv);
        }
        ctx.applyTranscriptScrollAfterMutation(messageHost, anchor);
}

export function tryPatchStreamingTranscriptVirtualExtracted(ctx: any, _host: HTMLElement,
        conv: QaapAgentConversationDTO,
        patchKind: ReturnType<typeof resolveStreamingTranscriptPatchKind>,): boolean {
        const list = ctx.host.transcriptUi.activeList;
        if (!list) {
            return false;
        }
        const messageHost = ctx.resolveTranscriptMessageHost(_host);
        const wasFollowingTail = ctx.shouldFollowTranscriptTail(messageHost);
        const appendedUserMessageIndex = patchKind === 'append-agent' || patchKind === 'append-user'
            ? ctx.findAppendedUserMessageIndex(ctx.host.transcriptLastConv, conv)
            : -1;

        if (patchKind === 'activity-only') {
            recordTranscriptRenderMetric('render_patch_activity');
            recordTranscriptRenderMetric('render_patch_activity_in_place');
            ctx.host.transcriptLastConv = conv;
            list.setItemCount(conv.messages.length);
            list.setFooter(ctx.buildTranscriptVirtualFooter(conv, {
                existingActivityRow: ctx.findTranscriptStreamingActivityRow(messageHost),
            }));
            ctx.host.transcriptLastRenderedConversationId = conv.id;
            ctx.host.transcriptLastRenderedMessageId = conv.messages.at(-1)?.id;
            ctx.artifactsUi.ensurePinnedTranscriptLiveStatus(conv);
            if (wasFollowingTail) {
                ctx.scrollTranscriptFollowTail(messageHost);
            }
            return true;
        }

        if (patchKind === 'append-user') {
            recordTranscriptRenderMetric('render_patch_append');
            messageHost.querySelectorAll('.theia-mod-streaming').forEach(element => {
                element.classList.remove('theia-mod-streaming');
                if (element instanceof HTMLElement) {
                    ctx.contentUi.settleTranscriptStreamingContent(element);
                }
            });
            ctx.host.transcriptLastConv = conv;
            list.setItemCount(conv.messages.length);
            // New user turn owns a fresh activity row below the appended message.
            list.setFooter(ctx.buildTranscriptVirtualFooter(conv));
            ctx.host.transcriptLastRenderedConversationId = conv.id;
            ctx.host.transcriptLastRenderedMessageId = conv.messages.at(-1)?.id;
            ctx.positionTranscriptVirtualListAtUserTurn(messageHost, list, appendedUserMessageIndex);
            ctx.artifactsUi.ensurePinnedTranscriptLiveStatus(conv);
            return true;
        }

        const lastAgent = conv.messages[conv.messages.length - 1];
        if (!lastAgent || !lastAgent.id || lastAgent.role !== 'agent') {
            return false;
        }
        const prevLast = ctx.host.transcriptLastConv?.messages[ctx.host.transcriptLastConv.messages.length - 1];
        const segments = ctx.resolveTranscriptAgentSegments(conv, lastAgent);
        const existingVirtualRow = patchKind === 'last-agent'
            ? list.findRowByAttribute(TRANSCRIPT_MESSAGE_ID_ATTR, lastAgent.id)
            : undefined;

        if (patchKind === 'last-agent') {
            if (existingVirtualRow && ctx.tryPatchStreamingAgentTextContent(existingVirtualRow, prevLast, lastAgent, segments, conv)) {
                recordTranscriptRenderMetric('render_patch_last_agent');
                recordTranscriptRenderMetric('render_patch_last_agent_in_place');
                ctx.markTranscriptMessageRow(existingVirtualRow, lastAgent.id, isTranscriptAgentTailStreaming(conv));
                ctx.artifactsUi.ensureTranscriptLiveStatusForStreamingRow(existingVirtualRow, conv);
                ctx.host.transcriptLastConv = conv;
                list.setItemCount(conv.messages.length);
                list.setFooter(ctx.buildTranscriptVirtualFooter(conv));
                ctx.host.transcriptLastRenderedConversationId = conv.id;
                ctx.host.transcriptLastRenderedMessageId = lastAgent.id;
                // Grow spacer before absolute streaming content paints over live-status.
                list.requestMeasureImmediate();
                if (wasFollowingTail) {
                    ctx.scrollTranscriptFollowTail(messageHost);
                }
                return true;
            }
        }

        ctx.host.transcriptLastConv = conv;
        const row = segments?.length
            ? ctx.artifactsUi.createTranscriptAgentSegmentsRow(segments, lastAgent.error, conv, { streaming: true, message: lastAgent })
            : ctx.createTranscriptMessageRowAtIndex(conv, conv.messages.length - 1);
        ctx.markTranscriptMessageRow(row, lastAgent.id, isTranscriptAgentTailStreaming(conv));

        if (patchKind === 'last-agent') {
            recordTranscriptRenderMetric('render_patch_last_agent');
            if (existingVirtualRow) {
                recordTranscriptRenderMetric('render_patch_last_agent_replace');
                recordTranscriptRenderMetric(AGENT_REPLACE_REASON_METRIC[ctx.lastAgentPatchRejectReason ?? 'predicates']);
            } else {
                recordTranscriptRenderMetric('render_patch_last_agent_append_missing_row');
            }
            list.replaceRowByAttribute(TRANSCRIPT_MESSAGE_ID_ATTR, lastAgent.id, row);
        } else {
            recordTranscriptRenderMetric('render_patch_append');
        }
        list.setItemCount(conv.messages.length);
        list.setFooter(ctx.buildTranscriptVirtualFooter(conv));
        ctx.host.transcriptLastRenderedConversationId = conv.id;
        ctx.host.transcriptLastRenderedMessageId = lastAgent.id;
        ctx.artifactsUi.ensurePinnedTranscriptLiveStatus(conv);
        list.requestMeasureImmediate();
        if (appendedUserMessageIndex >= 0) {
            ctx.positionTranscriptVirtualListAtUserTurn(messageHost, list, appendedUserMessageIndex);
        } else if (wasFollowingTail) {
            ctx.scrollTranscriptFollowTail(messageHost);
        }
        return true;
}

export function markTranscriptMessageRowExtracted(ctx: any, row: HTMLElement, messageId: string, streaming: boolean): void {
        const wasStreaming = row.classList.contains('theia-mod-streaming');
        row.setAttribute(TRANSCRIPT_MESSAGE_ID_ATTR, messageId);
        row.classList.toggle('theia-mod-streaming', streaming);
        if (wasStreaming && !streaming) {
            ctx.contentUi.settleTranscriptStreamingContent(row);
        }
        // The row was just patched/replaced by a streaming path — its full-build
        // render key no longer describes its DOM; drop it so the next full
        // render rebuilds this row instead of reusing it.
        delete row.dataset.qaapRowRenderKey;
}

