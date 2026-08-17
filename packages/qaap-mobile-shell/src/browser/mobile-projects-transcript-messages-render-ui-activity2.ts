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
import { enhanceTranscriptCaptureDirectives } from './qaap-transcript-capture-pending-ui';
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

export function tryPatchStreamingAgentTextContentExtracted(ctx: any, existingRow: HTMLElement,
        prevMsg: QaapAgentMessageDTO | undefined,
        nextMsg: QaapAgentMessageDTO,
        resolvedSegments: QaapAgentMessageSegmentDTO[] | undefined,
        conv?: QaapAgentConversationDTO,): boolean {
        ctx.lastAgentPatchRejectReason = undefined;
        const prevComparable = prevMsg ? ctx.withDerivedTranscriptSegments(prevMsg) : undefined;
        const nextComparable = ctx.withDerivedTranscriptSegments(nextMsg);
        if (canStreamPatchStdoutAgentContentOnly(prevComparable, nextComparable)) {
            const contentEl = existingRow.querySelector<HTMLElement>('.theia-mobile-agent-transcript-content');
            if (!contentEl) {
                ctx.lastAgentPatchRejectReason = 'applier';
                return false;
            }
            ctx.toolUi.renderTranscriptRichContent(
                contentEl,
                normalizeAgentMessageContentForDisplay(nextMsg.content),
                { streaming: existingRow.classList.contains('theia-mod-streaming') },
            );
            // This row (createTranscriptMessageRow) has no segments-body wrapper --
            // its standalone turn-provenance badge lives directly on `existingRow`.
            // Re-sync on every content-only tick, same as the accordion/no-tool
            // paths, so a row created before the driving user message was sealed
            // (an unlikely race, but the wire delta layer doesn't rule it out)
            // still ends up attributed once the field arrives.
            const provenance = ctx.artifactsUi.resolveTurnProvenance(conv, nextMsg);
            syncTranscriptStandaloneTurnProvenance(existingRow, provenance.turnAgentId, provenance.turnAgentModel);
            return true;
        }
        if (!prevComparable) {
            if (hasMobileExecutionEventTimeline(existingRow)) {
                const nextOnly = nextComparable?.segments ?? resolvedSegments ?? [];
                ctx.artifactsUi.patchStreamingActivityTimeline(existingRow, nextOnly, conv);
                recordTranscriptRenderMetric('render_patch_last_agent_timeline_fallback');
                return true;
            }
            ctx.lastAgentPatchRejectReason = 'no_prev';
            return false;
        }
        const nextSegments = nextComparable.segments ?? [];
        const prevSegments = prevComparable.segments ?? [];
        const segmentsInPlace = canStreamPatchAgentSegmentsInPlace(prevComparable, nextComparable);
        const appendTool = canStreamPatchAgentAppendToolSegment(prevComparable, nextComparable);
        const appendText = canStreamPatchAgentAppendTextSegment(prevComparable, nextComparable);
        const appendThinking = canStreamPatchAgentAppendThinkingSegment(prevComparable, nextComparable);
        // Combined tick: the shared prefix changed patchably AND one segment was
        // appended in the same coalesced frame (tool finishing + next block
        // starting). Patch the prefix in place, then append the tail.
        const inPlaceWithAppend = !segmentsInPlace && !appendTool && !appendText && !appendThinking
            && canStreamPatchAgentSegmentsInPlaceWithAppend(prevComparable, nextComparable);
        const tryTimelineFallback = (): boolean => {
            if (!hasMobileExecutionEventTimeline(existingRow)) {
                return false;
            }
            ctx.artifactsUi.patchStreamingActivityTimeline(existingRow, nextSegments, conv);
            recordTranscriptRenderMetric('render_patch_last_agent_timeline_fallback');
            return true;
        };
        if (!segmentsInPlace && !appendTool && !appendText && !appendThinking && !inPlaceWithAppend) {
            // Prefer refreshing the Codex timeline in place over remounting the
            // whole agent row (that remount restarts shimmer/spin and flashes).
            ctx.lastAgentPatchRejectReason = 'predicates';
            return tryTimelineFallback();
        }
        // The DOM patchers iterate index-aligned prev/next pairs, so the
        // combined tick hands them the equal-length shared prefix only — the
        // appended tail is handled by the append helpers below.
        const nextShared = inPlaceWithAppend ? nextSegments.slice(0, prevSegments.length) : nextSegments;
        if (segmentsInPlace || inPlaceWithAppend) {
            if (resolvedSegments?.length) {
                if (!ctx.artifactsUi.patchStreamingAgentTextSegments(existingRow, prevSegments, nextShared, conv)) {
                    ctx.lastAgentPatchRejectReason = 'applier';
                    return tryTimelineFallback();
                }
            } else {
                const contentEl = existingRow.querySelector<HTMLElement>('.theia-mobile-agent-transcript-content');
                const lastText = [...nextShared].reverse().find(segment => segment.type === 'text');
                if (contentEl && lastText?.type === 'text') {
                    ctx.toolUi.renderTranscriptRichContent(
                        contentEl,
                        lastText.content ?? '',
                        { streaming: existingRow.classList.contains('theia-mod-streaming') },
                    );
                }
            }
            if (prevSegments.length === nextShared.length) {
                if (!ctx.artifactsUi.patchStreamingAgentToolSegments(existingRow, prevSegments, nextShared, conv)) {
                    if (existingRow.classList.contains('theia-mod-streaming')) {
                        ctx.artifactsUi.patchStreamingActivityTimeline(existingRow, nextSegments, conv);
                    } else if (!tryTimelineFallback()) {
                        ctx.lastAgentPatchRejectReason = 'applier';
                        return false;
                    }
                }
            }
        }
        const appendedTailType = inPlaceWithAppend ? nextSegments[nextSegments.length - 1]?.type : undefined;
        if (appendTool || appendedTailType === 'tool') {
            if (!ctx.artifactsUi.appendStreamingAgentToolSegment(existingRow, nextSegments, conv)) {
                ctx.lastAgentPatchRejectReason = 'applier';
                return tryTimelineFallback();
            }
        }
        if (appendThinking || appendedTailType === 'thinking') {
            // Thinking has no dedicated DOM append path; keep the Codex timeline
            // (or fall through to replace when tools have not mounted yet).
            if (!tryTimelineFallback()) {
                ctx.lastAgentPatchRejectReason = 'thinking';
                return false;
            }
        } else if (appendText || appendedTailType === 'text') {
            if (!ctx.artifactsUi.appendStreamingAgentTextSegment(existingRow, nextSegments, conv)) {
                ctx.lastAgentPatchRejectReason = 'applier';
                return tryTimelineFallback();
            }
        }
        ctx.artifactsUi.patchStreamingActivityTimeline(existingRow, nextSegments, conv);
        return true;
}

export function clearTranscriptEmptyQuickActionsExtracted(ctx: any, messageHost: HTMLElement, conv: QaapAgentConversationDTO): void {
        if (shouldShowTranscriptEmptyQuickActions(conv, ctx.host.transcriptLastConv)) {
            return;
        }
        messageHost.classList.remove('theia-mod-empty-chat');
        ctx.host.transcriptComposerHost?.classList.remove('theia-mod-show-quick-actions');
}

export function syncTranscriptActivityRowExtracted(ctx: any, messageHost: HTMLElement, conv: QaapAgentConversationDTO): void {
        ctx.clearTranscriptEmptyQuickActions(messageHost, conv);
        const existingActivityRow = ctx.findTranscriptStreamingActivityRow(messageHost);
        messageHost.querySelectorAll('.theia-mod-streaming').forEach(element => {
            if (element === existingActivityRow) {
                return;
            }
            element.classList.remove('theia-mod-streaming');
            if (element instanceof HTMLElement) {
                ctx.contentUi.settleTranscriptStreamingContent(element);
            }
        });
        if (resolveTranscriptEffectiveStatus(conv) === 'streaming' && conv.messages.at(-1)?.role === 'user') {
            if (existingActivityRow && ctx.artifactsUi.syncTranscriptStreamingActivityRow(existingActivityRow, conv)) {
                existingActivityRow.hidden = false;
                recordTranscriptRenderMetric('render_patch_activity_in_place');
                return;
            }
            ctx.removeTranscriptActivityRow(messageHost);
            recordTranscriptRenderMetric('render_patch_activity_replace');
            const activityRow = ctx.artifactsUi.createTranscriptStreamingActivityRow(conv);
            if (activityRow) {
                appendBeforeTranscriptLiveStatus(messageHost, activityRow);
                ctx.artifactsUi.ensurePinnedTranscriptLiveStatus(conv);
            }
            return;
        }
        if (resolveTranscriptEffectiveStatus(conv) === 'streaming' && existingActivityRow) {
            ctx.ensureLiveStatusBeforeRemovingActivityRow(messageHost, conv);
        }
        ctx.removeTranscriptActivityRow(messageHost);
}

export function ensureLiveStatusBeforeRemovingActivityRowExtracted(ctx: any, messageHost: HTMLElement,
        conv: QaapAgentConversationDTO,): void {
        const lastAgent = [...conv.messages].reverse().find(message => message.role === 'agent');
        if (!lastAgent?.id) {
            return;
        }
        const agentRow = messageHost.querySelector<HTMLElement>(
            `[${TRANSCRIPT_MESSAGE_ID_ATTR}="${CSS.escape(lastAgent.id)}"]`,
        );
        if (agentRow) {
            ctx.artifactsUi.ensureTranscriptLiveStatusForStreamingRow(agentRow, conv);
        }
}

export function createTranscriptAgentFailureRowExtracted(ctx: any, msg: QaapAgentMessageDTO,
        conv?: QaapAgentConversationDTO,
        options?: { readonly deferHeavyContent?: boolean },): HTMLElement {
        const row = document.createElement('div');
        row.className = 'theia-mobile-agent-transcript-msg theia-mod-agent';
        if (options?.deferHeavyContent) {
            row.setAttribute('data-transcript-row-deferred', '1');
        }
        const body = document.createElement('div');
        body.className = 'theia-mobile-agent-transcript-segments';
        // A failed turn with no trace segments has no process accordion to host the
        // turn-provenance badge in its header -- this is arguably the row where
        // knowing which agent/model ran matters MOST (a failure with no attribution
        // forces guessing whether the model or the task was at fault). Same standalone
        // badge, same host function, as the tool-less success case in
        // createTranscriptAgentSegmentsRow.
        const provenance = ctx.artifactsUi.resolveTurnProvenance(conv, msg);
        syncTranscriptStandaloneTurnProvenance(body, provenance.turnAgentId, provenance.turnAgentModel);
        const failedTool = extractLastFailedToolFromMessage(msg);
        const canRetry = conv?.status === 'failed' && !!ctx.host.retryOpenFailedConversationTask;
        const agentId = provenance.turnAgentId ?? conv?.agentId;
        body.append(ctx.toolUi.createTranscriptAgentFailureDialog(
            msg.error ?? '',
            resolveAgentTurnFailureTechnicalContent(msg),
            {
                ...ctx.buildTranscriptAgentFailureDialogOptions({
                    failedToolName: failedTool?.name,
                    canRetry,
                    agentId,
                    error: msg.error,
                    technicalContent: resolveAgentTurnFailureTechnicalContent(msg),
                }),
                agentMessage: msg,
            },
        ));
        row.append(body);
        return row;
}

export function buildTranscriptAgentFailureDialogOptionsExtracted(ctx: any, input: {
        readonly failedToolName?: string;
        readonly canRetry: boolean;
        readonly agentId?: string;
        readonly error?: string;
        readonly technicalContent?: string;
        readonly agentMessage?: unknown;
    }): {
        readonly failedToolName?: string;
        readonly onRetry?: () => void | Promise<void>;
        readonly onOpenAuthUrl?: (url: string) => void;
        readonly onOpenAgentSignIn?: () => void | Promise<void>;
        readonly agentLabel?: string;
        readonly agentId?: string;
    } {
        return {
            failedToolName: input.failedToolName,
            onRetry: input.canRetry ? () => ctx.host.retryOpenFailedConversationTask?.() : undefined,
            onOpenAuthUrl: (url: string) => {
                window.open(url, '_blank', 'noopener,noreferrer');
            },
            onOpenAgentSignIn: ctx.host.openAgentSignInTerminal
                ? () => ctx.host.openAgentSignInTerminal?.(input.agentId)
                : undefined,
            agentLabel: input.agentId ? resolveAgentDisplayLabel(input.agentId) : undefined,
            agentId: input.agentId,
            agentMessage: input.agentMessage,
        };
}

export function createTranscriptMessageRowExtracted(ctx: any, role: 'user' | 'agent',
        content: string,
        _error?: string,
        options?: {
            readonly deferHeavyContent?: boolean;
            readonly streaming?: boolean;
            /** Only meaningful for `role === 'agent'`: lets a turn rendered with no
             *  segments at all (e.g. raw shell stdout -- no tool calls, no thinking)
             *  still show the turn-provenance badge. See
             *  {@link syncTranscriptStandaloneTurnProvenance}. */
            readonly conv?: QaapAgentConversationDTO;
            readonly message?: QaapAgentMessageDTO;
        },): HTMLElement {
        const row = document.createElement('div');
        row.className = `theia-mobile-agent-transcript-msg theia-mod-${role}`;
        if (options?.deferHeavyContent) {
            row.setAttribute('data-transcript-row-deferred', '1');
        }
        if (role === 'agent') {
            // This row type has no `.theia-mobile-agent-transcript-segments` wrapper
            // (it is a flat row > content element) -- mount the standalone badge
            // directly on `row`, still the first flex child, so it lands in the same
            // visual slot as the segments-body-hosted badge (both sit at the top of
            // the same padded flex column, see .theia-mobile-agent-transcript-msg).
            const provenance = ctx.artifactsUi.resolveTurnProvenance(options?.conv, options?.message);
            syncTranscriptStandaloneTurnProvenance(row, provenance.turnAgentId, provenance.turnAgentModel);
        }
        // Ownership is conveyed by alignment and the bubble surface, so no redundant "You" label.
        const contentEl = document.createElement('div');
        contentEl.className = 'theia-mobile-agent-transcript-content';
        ctx.toolUi.renderTranscriptRichContent(
            contentEl,
            normalizeAgentMessageContentForDisplay(content),
            { defer: options?.deferHeavyContent, streaming: options?.streaming },
        );
        row.append(contentEl);
        // Synchronous Markdown fallback rendering can create the pending chip while
        // the content host is detached. Reconcile after attaching it to its row so a
        // resolved capture/video rendered in a sibling block can remove that chip.
        enhanceTranscriptCaptureDirectives(contentEl);
        return row;
}
