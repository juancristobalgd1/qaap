import type { MobileClosingNarrativeAction } from './mobile-projects-transcript-messages-artifacts-ui';
import type { MobileProjectsTranscriptMessagesArtifactsUiContext } from './mobile-projects-transcript-messages-artifacts-ui-context';
import { resolveAgentMessageTiming } from '@theia/qaap-shared-core/lib/common/qaap-transcript-turn-status';
import { MOBILE_CLOSING_TEXT_ERROR_PREFIX } from './mobile-projects-transcript-messages-artifacts-ui-constants';
// Extracted from mobile-projects-transcript-messages-artifacts-ui.ts

import { type QaapAgentConversationDTO, type QaapAgentMessageDTO, type QaapAgentMessageSegmentDTO, cancelConversationRun, resolveRunUserMessageId } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { QaapCreateAgentTaskQaiqModel } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import {
    extractLastFailedToolFromMessage,
    resolveAgentTurnFailureTechnicalContent,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-failure-message';
import { enhanceTranscriptCaptureDirectives } from './qaap-transcript-capture-pending-ui';
import { TRANSCRIPT_MESSAGE_ID_ATTR, TRANSCRIPT_SEGMENT_INDEX_ATTR } from '@theia/qaap-transcript-overlay/lib/common/qaap-transcript-incremental-update';
import {
    destroyThinkingOrbIndicator,
    QAAP_THINKING_ORB_INDICATOR_CLASS,
} from './qaap-thinking-orb-indicator';
import {
    buildMobileExecutionEvents,
    createMobileClosingErrorCardElement,
    createMobileExecutionEventTimeline,
    MOBILE_TOOL_FILE_OPEN_EVENT,
    resolveMobileActivityVerb,
    syncTranscriptStandaloneTurnProvenance,
    wrapMobileProcessAccordion,
} from './qaap-execution-event-timeline';
import { ensureSlowTurnHint } from './qaap-slow-turn-hint';
import {
    removeTranscriptLiveStatusElement,
    resolveTranscriptChatHostFromNode,
} from '../common/qaap-transcript-live-status';
import {
    normalizeMobileClosingNarrativeText,
} from './mobile-projects-transcript-timeline-utils';
import {
    didExecutionToolSegmentsChange as didExecutionToolSegmentsChangeHelper,
    collectMobileClosingNarrativeTextsBefore as collectMobileClosingNarrativeTextsBeforeHelper,
} from './mobile-projects-transcript-messages-artifacts-helpers';

export function removeTranscriptLiveStatusWithOrbExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, root: ParentNode): void {
        removeTranscriptLiveStatusElement(root, {
            beforeRemove: element => {
                for (const host of element.querySelectorAll<HTMLElement>(`.${QAAP_THINKING_ORB_INDICATOR_CLASS}`)) {
                    destroyThinkingOrbIndicator(host);
                }
            },
        });
}

export function didExecutionToolSegmentsChangeExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, previousSegments: readonly QaapAgentMessageSegmentDTO[],
        nextSegments: readonly QaapAgentMessageSegmentDTO[],): boolean {
        return didExecutionToolSegmentsChangeHelper(previousSegments, nextSegments);
}

export function createTranscriptAgentSegmentsRowExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, segments: QaapAgentMessageSegmentDTO[],
        error?: string,
        conv?: QaapAgentConversationDTO,
        options?: {
            readonly deferHeavyContent?: boolean;
            readonly streaming?: boolean;
            /** The specific agent message being rendered, if known -- lets
             *  cancellation be derived from THIS message rather than
             *  whichever agent message happens to be last in the
             *  conversation (which mislabels historical accordions once a
             *  later turn has run). */
            readonly message?: QaapAgentMessageDTO;
        },): HTMLElement {
        const row = document.createElement('div');
        row.className = 'theia-mobile-agent-transcript-msg theia-mod-agent';
        const defer = !!options?.deferHeavyContent;
        if (defer) {
            row.setAttribute('data-transcript-row-deferred', '1');
        }
        const body = document.createElement('div');
        body.className = 'theia-mobile-agent-transcript-segments';
        const streaming = !!options?.streaming;

        // ─── Codex-style Execution Event Timeline ───────────────────────────
        // Replaces the old activity timeline + tool pills + diff/verification cards.
        // Events are the primary element; tools are children, not siblings.
        // Everything collapsed by default. Only Terminal/Error/Diff get cards.
        const hasToolSegments = segments.some(s => s.type === 'tool');
        if (hasToolSegments) {
            ctx.renderMobileExecutionEventTimeline(body, segments, {
                streaming,
                defer,
                conv,
                error,
                message: options?.message,
            });
        } else {
            // No tools (yet, or ever, for a turn that never calls one) — still
            // render the turn-provenance badge as the FIRST child of `body`
            // (same slot used when tools exist: above the process accordion).
            // This is deliberately NOT an empty accordion -- there is no process to
            // expand for a tool-less turn, and a collapsible control with nothing
            // inside would be worse than no accordion at all.
            const effectiveMessage = options?.message ?? ctx.resolveLastAgentMessage(conv);
            const provenance = ctx.resolveTurnProvenance(conv, effectiveMessage);
            syncTranscriptStandaloneTurnProvenance(body, provenance.turnAgentId, provenance.turnAgentModel);
            // No tools yet — render thinking content (if any) as a thought brief,
            // then visible text segments. This preserves the thinking-phase UX
            // (collapsible reasoning block with live indicator) before the first
            // tool arrives. When tools arrive later via streaming, the row is
            // upgraded to the Codex-style timeline in patchStreamingActivityTimeline.
            const thoughtBrief = ctx.createTranscriptThoughtBriefBlock(segments, {
                streaming,
                conv,
            });
            if (thoughtBrief) {
                body.append(thoughtBrief);
            }
            for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
                const segment = segments[segmentIndex];
                if (segment.type === 'text' && (segment.content?.trim() ?? '').length > 0) {
                    const textBlock = ctx.toolUi.createTranscriptSegmentDetails(segment, {
                        defer,
                        streaming: options?.streaming,
                    });
                    textBlock.setAttribute(TRANSCRIPT_SEGMENT_INDEX_ATTR, String(segmentIndex));
                    body.append(textBlock);
                }
            }
        }

        if (error) {
            const failedTool = extractLastFailedToolFromMessage({
                role: 'agent',
                content: '',
                segments,
            });
            // The effective backend status normally becomes `failed`, but older/reconnected
            // payloads can arrive with an idle status while the last agent message already has
            // the durable error. Keep the recovery CTA available in both shapes.
            const canRetry = ctx.isConversationError(conv) && !!ctx.host.retryOpenFailedConversationTask;
            const provenance = ctx.resolveTurnProvenance(conv, undefined);
            const agentId = provenance.turnAgentId ?? conv?.agentId;
            const failureMessage = {
                role: 'agent' as const,
                content: '',
                error,
                segments,
            };
            body.append(ctx.toolUi.createTranscriptAgentFailureDialog(
                error,
                resolveAgentTurnFailureTechnicalContent(failureMessage),
                {
                    failedToolName: failedTool?.name,
                    onRetry: canRetry ? () => ctx.host.retryOpenFailedConversationTask?.() : undefined,
                    onOpenAuthUrl: (url: string) => {
                        window.open(url, '_blank', 'noopener,noreferrer');
                    },
                    onOpenAgentSignIn: ctx.host.openAgentSignInTerminal
                        ? () => ctx.host.openAgentSignInTerminal?.(agentId)
                        : undefined,
                    onOpenAiFeaturesSettings: ctx.host.openPreferencesSheet
                        ? () => ctx.host.openPreferencesSheet?.('ai-features')
                        : undefined,
                    agentId,
                    agentMessage: failureMessage,
                },
            ));
        }
        row.append(body);
        // Child Markdown blocks may have rendered synchronously before the row was
        // assembled. Reconcile once the complete row is attached so settled visual
        // evidence can remove a chip created during that detached render.
        for (const content of row.querySelectorAll<HTMLElement>('.theia-mobile-agent-transcript-content')) {
            enhanceTranscriptCaptureDirectives(content);
        }
        if (streaming && conv && !hasToolSegments) {
            ctx.ensureAndSyncTranscriptLiveStatusFooter(body, segments, conv, { streaming: true });
        }
        if (streaming) {
            ctx.ensureTranscriptStreamStallWatch(row);
        }
        return row;
}

export function renderMobileExecutionEventTimelineExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, body: HTMLElement,
        segments: readonly QaapAgentMessageSegmentDTO[],
        options: {
            readonly streaming: boolean;
            readonly defer?: boolean;
            readonly conv?: QaapAgentConversationDTO;
            /** The failure reason recorded on the message being rendered (`msg.error`), if any. */
            readonly error?: string;
            /** The specific agent message being rendered, if known -- see
             *  {@link createTranscriptAgentSegmentsRow}'s `options.message`. Falls
             *  back to the conversation's last agent message when omitted (e.g.
             *  benchmark/test callers that only have a `conv`). */
            readonly message?: QaapAgentMessageDTO;
        },): void {
        const { streaming, defer, conv, error, message } = options;
        const eventTimeline = createMobileExecutionEventTimeline(segments);
        // Wrap the timeline in a process accordion (Codex-style "Processed in").
        const { isWorking, elapsedMs, turnStartMs } = resolveAgentMessageTiming(conv, message ?? ctx.resolveLastAgentMessage(conv));
        const isError = ctx.isConversationError(conv);
        // Cancellation must be derived from THIS message, not merely the
        // conversation's last agent message -- each agent message renders its
        // own accordion, and in a multi-turn conversation a historical
        // (already-settled) turn's accordion would otherwise be mislabeled
        // whenever a later turn happened to end up cancelled.
        const effectiveMessage = message ?? ctx.resolveLastAgentMessage(conv);
        const isCancelled = ctx.isAgentMessageCancelled(effectiveMessage);
        const activityVerb = isWorking ? resolveMobileActivityVerb(buildMobileExecutionEvents(segments).events) : undefined;
        const provenance = ctx.resolveTurnProvenance(conv, effectiveMessage);
        // Agent/model identity always sits ABOVE the accordion (never inside its summary).
        syncTranscriptStandaloneTurnProvenance(body, provenance.turnAgentId, provenance.turnAgentModel);
        const accordion = wrapMobileProcessAccordion(eventTimeline, {
            isWorking,
            isError,
            isCancelled,
            elapsedMs,
            turnStartMs,
            activityVerb,
            onStopRun: ctx.resolveRunStopHandler(conv, message, isWorking),
            settled: !isWorking,
        });
        ctx.bindMobileExecutionEventTimelineFileOpen(accordion);
        body.append(accordion);
        ensureSlowTurnHint(accordion, {
            isWorking,
            turnStartMs,
            onStopTurn: ctx.resolveRunStopHandler(conv, message, isWorking) ?? (() => ctx.host.cancelOpenTranscriptStream?.()),
        });
        // Render closing narrative text segments (text after the last tool)
        // as rich content blocks — these are the agent's final answer, not
        // process prose. The timeline model captures them as closingNarrative
        // (plain text), but the final answer needs full markdown rendering.
        //
        // Repeated tool failures / retries can surface the same "error"
        // trace-event text more than once (e.g. one summary per retry
        // attempt that ends up identical) — identical closing-narrative
        // content must render ONCE, not once per occurrence. A segment whose
        // (normalized) content matches `msg.error` is skipped entirely: the
        // styled "Task failed" dialog below already shows that message, so an
        // extra unstyled copy here would just be a duplicate.
        const lastToolIndex = segments.reduce(
            (last, segment, index) => segment.type === 'tool' ? index : last,
            -1,
        );
        const seenClosingNarrativeTexts = new Set<string>();
        const normalizedFailureReason = error?.trim() ? normalizeMobileClosingNarrativeText(error) : undefined;
        for (let segmentIndex = lastToolIndex + 1; segmentIndex < segments.length; segmentIndex++) {
            const segment = segments[segmentIndex];
            if (segment.type !== 'text') {
                continue;
            }
            const text = segment.content?.trim() ?? '';
            if (!text) {
                continue;
            }
            if (ctx.isLobeWorkflowProcessText(segment.content)) {
                continue;
            }
            const action = ctx.resolveMobileClosingNarrativeAction(text, seenClosingNarrativeTexts, normalizedFailureReason, isError);
            seenClosingNarrativeTexts.add(normalizeMobileClosingNarrativeText(text));
            if (action.kind === 'skip') {
                continue;
            }
            if (action.kind === 'error-card') {
                const errorCard = createMobileClosingErrorCardElement(action.message, ctx.resolveMobileClosingErrorCardRetry());
                errorCard.setAttribute(TRANSCRIPT_SEGMENT_INDEX_ATTR, String(segmentIndex));
                body.append(errorCard);
                continue;
            }
            const textBlock = ctx.toolUi.createTranscriptSegmentDetails(segment, {
                defer,
                streaming,
            });
            textBlock.setAttribute(TRANSCRIPT_SEGMENT_INDEX_ATTR, String(segmentIndex));
            body.append(textBlock);
        }
        // Files Changed card only after the backend commits the final response
        // (idle/failed/cancelled) — never while streaming, working, or finalizing
        // (status still `streaming`/`settled` even when the turn looks complete).
        if (ctx.shouldShowMobileDiffSummary(conv, streaming)) {
            ctx.appendMobileDiffSummary(body, segments);
        } else {
            // Drop any premature card from an earlier paint; keep the live footer
            // only for true streaming renders.
            body.querySelector('.theia-mobile-diff-summary')?.remove();
            if (streaming && conv) {
                ctx.ensureAndSyncTranscriptLiveStatusFooter(body, segments, conv, { streaming: true });
            } else if (conv && ctx.shouldShowPinnedTranscriptLiveStatus(conv)) {
                // Visual settle while the backend is still busy — keep the pinned footer.
                ctx.removeTranscriptLiveStatusWithOrb(body);
                ctx.ensurePinnedTranscriptLiveStatus(conv);
            } else {
                ctx.removeTranscriptLiveStatusWithOrb(body);
                ctx.clearPinnedTranscriptStreamFooter(resolveTranscriptChatHostFromNode(body));
            }
        }
}

export function shouldShowMobileDiffSummaryExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, conv: QaapAgentConversationDTO | undefined,
        renderStreaming: boolean,): boolean {
        return ctx.isConversationFinalResponseCommitted(conv, renderStreaming);
}

export function resolveRunStopHandlerExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, conv: QaapAgentConversationDTO | undefined,
        message: QaapAgentMessageDTO | undefined,
        isWorking: boolean,): (() => void) | undefined {
        // `isWorking` is conversation-wide: with several agents in one session it is true for
        // every turn, including ones that already answered. `runActive` is the per-message flag
        // the backend sets while THAT run streams — the stop belongs only to those.
        if (!isWorking || !message?.runActive) {
            return undefined;
        }
        const userMessageId = conv && message
            ? resolveRunUserMessageId(conv.messages, message.id)
            : undefined;
        if (!conv || !userMessageId) {
            return () => ctx.host.cancelOpenTranscriptStream?.();
        }
        return () => {
            void cancelConversationRun(conv.id, userMessageId).catch(() => {
                // Backend refused the targeted cancel — fall back to stopping the session.
                ctx.host.cancelOpenTranscriptStream?.();
            });
        };
}

export function bindMobileExecutionEventTimelineFileOpenExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, root: HTMLElement): void {
        if (root.dataset.mobileToolFileOpenBound === '1') {
            return;
        }
        root.dataset.mobileToolFileOpenBound = '1';
        root.addEventListener(MOBILE_TOOL_FILE_OPEN_EVENT, event => {
            const detail = (event as CustomEvent<{ readonly filePath?: unknown }>).detail;
            const filePath = typeof detail?.filePath === 'string'
                ? detail.filePath
                : undefined;
            if (!filePath) {
                return;
            }
            event.stopPropagation();
            ctx.toolUi.handleTranscriptFileOpen(filePath);
        });
}

export function resolveLastAgentMessageExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, conv: QaapAgentConversationDTO | undefined): QaapAgentMessageDTO | undefined {
        const messages = conv?.messages;
        if (!messages) {
            return undefined;
        }
        for (let index = messages.length - 1; index >= 0; index--) {
            if (messages[index].role === 'agent') {
                return messages[index];
            }
        }
        return undefined;
}

export function resolveTranscriptRowAgentMessageExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, row: HTMLElement | undefined,
        conv: QaapAgentConversationDTO | undefined,): QaapAgentMessageDTO | undefined {
        const messageId = row?.getAttribute(TRANSCRIPT_MESSAGE_ID_ATTR);
        const found = messageId ? conv?.messages.find(entry => entry.id === messageId) : undefined;
        return found ?? ctx.resolveLastAgentMessage(conv);
}

export function resolveTurnProvenanceExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, conv: QaapAgentConversationDTO | undefined,
        message: QaapAgentMessageDTO | undefined,): { readonly turnAgentId?: string; readonly turnAgentModel?: QaapCreateAgentTaskQaiqModel } {
        if (!conv || !message) {
            return {};
        }
        const userMessageId = resolveRunUserMessageId(conv.messages, message.id);
        const userMessage = userMessageId ? conv.messages.find(entry => entry.id === userMessageId) : undefined;
        return { turnAgentId: userMessage?.turnAgentId, turnAgentModel: userMessage?.turnAgentModel };
}

export function resolveMobileClosingNarrativeActionExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, text: string,
        seenClosingNarrativeTexts: ReadonlySet<string>,
        normalizedFailureReason: string | undefined,
        isError: boolean,): MobileClosingNarrativeAction {
        const normalizedText = normalizeMobileClosingNarrativeText(text);
        if (seenClosingNarrativeTexts.has(normalizedText)) {
            // Exact duplicate of an already-rendered closing block — collapse
            // to a single occurrence instead of repeating the raw text.
            return { kind: 'skip' };
        }
        if (normalizedFailureReason !== undefined && normalizedText === normalizedFailureReason) {
            // Same message the failure dialog renders — skip the duplicate
            // instead of showing it twice.
            return { kind: 'skip' };
        }
        if (isError && MOBILE_CLOSING_TEXT_ERROR_PREFIX.test(text)) {
            // A distinct error-derived closing line with no corresponding
            // `msg.error` dialog — show it as a single, styled error card
            // (icon + message) instead of an unstyled markdown block.
            return { kind: 'error-card', message: normalizedText };
        }
        return { kind: 'text' };
}

export function resolveMobileClosingErrorCardRetryExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext): (() => void) | undefined {
        if (!ctx.host.retryOpenTranscriptConversation) {
            return undefined;
        }
        return () => {
            void ctx.host.retryOpenTranscriptConversation?.();
        };
}

export function collectMobileClosingNarrativeTextsBeforeExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, segments: readonly QaapAgentMessageSegmentDTO[],
        lastToolIndex: number,
        beforeIndex: number,): Set<string> {
        return collectMobileClosingNarrativeTextsBeforeHelper(segments, lastToolIndex, beforeIndex, content => ctx.isLobeWorkflowProcessText(content));
}

export function isClosingNarrativeSegmentSkippedExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, segment: QaapAgentMessageSegmentDTO,
        segments: readonly QaapAgentMessageSegmentDTO[],
        lastToolIndex: number,
        segmentIndex: number,
        conv: QaapAgentConversationDTO | undefined,): boolean {
        const text = segment.type === 'text' ? (segment.content?.trim() ?? '') : '';
        if (!text) {
            return false;
        }
        const seenClosingNarrativeTexts = ctx.collectMobileClosingNarrativeTextsBefore(segments, lastToolIndex, segmentIndex);
        const error = ctx.resolveLastAgentMessageError(conv);
        const normalizedFailureReason = error?.trim() ? normalizeMobileClosingNarrativeText(error) : undefined;
        const isErrorLikely = ctx.isConversationError(conv) || MOBILE_CLOSING_TEXT_ERROR_PREFIX.test(text);
        return ctx.resolveMobileClosingNarrativeAction(
            text, seenClosingNarrativeTexts, normalizedFailureReason, isErrorLikely,
        ).kind === 'skip';
}
