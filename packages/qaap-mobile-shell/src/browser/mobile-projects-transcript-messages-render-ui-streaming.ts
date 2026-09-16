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

export function createTranscriptEmptyWelcomeExtracted(ctx: any): HTMLElement {
        const welcome = document.createElement('section');
        welcome.className = 'theia-mobile-agent-transcript-empty-welcome';
        welcome.setAttribute(
            'aria-label',
            nls.localize('qaap/mobileProjects/transcriptEmptyWelcomeAria', 'Qaap welcome'),
        );

        const logo = document.createElement('div');
        logo.className = 'theia-mobile-agent-transcript-empty-logo';
        logo.setAttribute('aria-hidden', 'true');

        const title = document.createElement('h2');
        title.className = 'theia-mobile-agent-transcript-empty-title';
        title.textContent = nls.localize('qaap/mobileProjects/transcriptEmptyWelcomeTitle', 'Ready when you are.');

        welcome.append(logo, title);
        return welcome;
}

export function renderTranscriptMessagesVirtualExtracted(ctx: any, host: HTMLElement,
        conv: QaapAgentConversationDTO,
        options?: { readonly openingConversation?: boolean; readonly newTurnStarted?: boolean },): void {
        const normalized = ctx.normalizeConversationFailuresCached(conv);
        ctx.host.transcriptLastConv = normalized;
        const messageHost = ctx.resolveTranscriptMessageHost(host);
        messageHost.classList.remove('theia-mod-empty-chat');
        messageHost.classList.add('theia-mod-virtual-scroll');
        ctx.host.transcriptComposerHost?.classList.remove('theia-mod-show-quick-actions');

        const list = ctx.host.transcriptUi.mount(messageHost, normalized, index => {
            const current = ctx.host.transcriptLastConv;
            if (!current) {
                return document.createElement('div');
            }
            return ctx.createTranscriptMessageRowAtIndex(current, index);
        });

        const scroll = ctx.resolveTranscriptScrollController(messageHost);
        const wasFollowingTail = ctx.shouldFollowTranscriptTail(messageHost);
        list.setItemCount(normalized.messages.length);
        list.setFooter(ctx.buildTranscriptVirtualFooter(normalized, {
            existingActivityRow: ctx.findTranscriptStreamingActivityRow(messageHost),
        }));
        ctx.host.transcriptLastRenderedConversationId = normalized.id;
        ctx.host.transcriptLastRenderedMessageId = normalized.messages.at(-1)?.id;
        if (options?.newTurnStarted) {
            // Always pin the new user turn near the top with prior context.
            // completePositionTurn leaves the phase detached so the stream can
            // grow off-screen without chasing the live edge.
            const lastUserIndex = ctx.findLastUserMessageIndex(normalized);
            ctx.positionTranscriptVirtualListAtUserTurn(messageHost, list, lastUserIndex);
        } else if (options?.openingConversation && !ctx.hasExplicitTranscriptMessageHash()) {
            scroll.beginRestore();
            scroll.markProgrammaticScroll(200);
            const contextPx = Math.min(96, Math.max(40, Math.round(messageHost.clientHeight * 0.14)));
            if (!ctx.restoreTranscriptOpeningPositionVirtual(list, normalized, contextPx)) {
                const lastUserIndex = ctx.findLastUserMessageIndex(normalized);
                if (lastUserIndex >= 0) {
                    ctx.scrollTranscriptVirtualListToIndex(
                        list,
                        lastUserIndex,
                        contextPx,
                    );
                }
            }
            scroll.completeRestore();
        } else if (wasFollowingTail) {
            scroll.onContentChanged(messageHost);
        }
        // mount() replaceChildren drops the scroller-tail live-status — re-pin
        // after every virtual mount, not only on newTurnStarted.
        ctx.artifactsUi.ensurePinnedTranscriptLiveStatus(normalized);
        ctx.attachTranscriptScrollChrome(host, messageHost, conv);
}

export function restoreTranscriptOpeningPositionExtracted(ctx: any, messageHost: HTMLElement, conv: QaapAgentConversationDTO): boolean {
        if (ctx.hasExplicitTranscriptMessageHash()) {
            return false;
        }
        return restoreTranscriptReadPosition(messageHost, conv.id);
}

export function scrollTranscriptToLastUserTurnExtracted(ctx: any, messageHost: HTMLElement, options?: { readonly asPositionTurn?: boolean }): void {
        const userRow = ctx.findLastUserMessageRow(messageHost);
        if (!userRow) {
            return;
        }
        const scroll = ctx.resolveTranscriptScrollController(messageHost);
        // Reader already following, or — only when placing a freshly submitted turn —
        // sitting on the live edge: keep the live-status footer in view; do not pin
        // the turn/process header or install a reading runway. The open/restore path
        // (no asPositionTurn) must not adopt follow from mere proximity.
        if (scroll.shouldFollowTail()
            || (options?.asPositionTurn === true && scroll.adoptFollowingFromLiveEdge())) {
            ctx.scrollTranscriptFollowTail(messageHost);
            return;
        }
        ctx.prepareTranscriptReadingAnchorWindow(messageHost, userRow);
        if (options?.asPositionTurn) {
            scroll.beginPositionTurn();
            scroll.schedulePositionTurnStart(messageHost, userRow);
            return;
        }
        ctx.scrollTranscriptTurnStartIntoReadingPosition(messageHost, userRow);
}

export function prepareTranscriptReadingAnchorWindowExtracted(ctx: any, messageHost: HTMLElement, userRow: HTMLElement): void {
        messageHost.querySelectorAll('.theia-mod-transcript-reading-anchor').forEach(element => {
            element.classList.remove('theia-mod-transcript-reading-anchor');
        });
        const contextPx = Math.min(96, Math.max(40, Math.round(messageHost.clientHeight * 0.14)));
        const runwayPx = Math.max(0, messageHost.clientHeight - contextPx);
        messageHost.classList.add('theia-mod-transcript-reading-runway');
        messageHost.style.setProperty('--qaap-transcript-reading-context-px', `${contextPx}px`);
        messageHost.style.setProperty('--qaap-transcript-reading-runway-px', `${runwayPx}px`);
        const userWrap = userRow.closest<HTMLElement>('[data-transcript-message-id]') ?? userRow;
        userWrap.classList.add('theia-mod-transcript-reading-anchor');
        userRow.classList.add('theia-mod-transcript-reading-anchor');
        if (userWrap.previousElementSibling instanceof HTMLElement) {
            userWrap.previousElementSibling.classList.add('theia-mod-transcript-reading-anchor');
        }
}

export function renderTranscriptMessagesExtracted(ctx: any, host: HTMLElement, conv: QaapAgentConversationDTO): void {
        const conversationSwitched = ctx.host.transcriptLastRenderedConversationId !== undefined
            && ctx.host.transcriptLastRenderedConversationId !== conv.id;
        // Settled (non-streaming) snapshots can never take the stream-patch fast path and never
        // satisfy `isStreamingTranscriptTailUnchanged` (both bail on `status !== 'streaming'`), so
        // any re-render of one falls straight through to a full rebuild. A background/idle host that
        // re-runs this on every SSE tick of *another* streaming conversation therefore rebuilds an
        // unchanged transcript ~8x/s. Short-circuit host-locally when the settled snapshot is
        // byte-identical to what this host already shows. The key is stamped on the host element
        // itself (not the shared `transcriptLast*` fields, which thrash between hosts) and includes
        // the conversation id, so a switch to a different conversation always repaints. Streaming
        // renders bypass this and clear the stamp, so a later re-settle still repaints exactly once.
        if (conv.status !== 'streaming') {
            const settledHost = ctx.resolveTranscriptMessageHost(host);
            // Cheap pre-check first: `updatedAt` bumps on any change, and the message count plus the
            // last message's content length catch the common append/edit even if a caller left
            // `updatedAt` stale. An unchanged tuple means the snapshot is identical — skip WITHOUT
            // paying the O(messages × segments) full fingerprint. A background host re-running on
            // another conversation's ~8/s SSE ticks now does a string compare instead of a full hash.
            const lastSettledMessage = conv.messages[conv.messages.length - 1];
            const cheapKey = `${conv.id}|${conv.updatedAt}|${conv.messages.length}|${lastSettledMessage?.content?.length ?? 0}|${conv.contextCompaction?.status ?? ''}:${conv.contextCompaction?.completedAt ?? ''}:${conv.contextCompaction?.compactedMessageCount ?? 0}`;
            if (settledHost.childElementCount > 0 && settledHost.dataset.qaapSettledCheapKey === cheapKey) {
                recordTranscriptRenderMetric('render_skip_unchanged_settled');
                ctx.clearTranscriptEmptyQuickActions(settledHost, conv);
                return;
            }
            const settledKey = `${conv.id} ${buildConversationTranscriptFingerprint(conv)}`;
            if (settledHost.childElementCount > 0 && settledHost.dataset.qaapSettledRenderKey === settledKey) {
                recordTranscriptRenderMetric('render_skip_unchanged_settled');
                settledHost.dataset.qaapSettledCheapKey = cheapKey;
                ctx.clearTranscriptEmptyQuickActions(settledHost, conv);
                return;
            }
            settledHost.dataset.qaapSettledRenderKey = settledKey;
            settledHost.dataset.qaapSettledCheapKey = cheapKey;
        } else {
            const streamingHost = ctx.resolveTranscriptMessageHost(host);
            if (streamingHost.dataset.qaapSettledRenderKey !== undefined) {
                delete streamingHost.dataset.qaapSettledRenderKey;
            }
            if (streamingHost.dataset.qaapSettledCheapKey !== undefined) {
                delete streamingHost.dataset.qaapSettledCheapKey;
            }
        }
        if (!conversationSwitched && ctx.tryPatchStreamingTranscriptMessages(host, conv)) {
            return;
        }
        if (isStreamingTranscriptTailUnchanged(ctx.host.transcriptLastConv, conv)) {
            recordTranscriptRenderMetric('render_skip_unchanged_tail');
            ctx.host.transcriptLastConv = conv;
            ctx.clearTranscriptEmptyQuickActions(ctx.resolveTranscriptMessageHost(host), conv);
            return;
        }
        recordTranscriptRenderMetric('render_full');
        const previousConversation = ctx.host.transcriptLastConv;
        const shouldVirtualize = ctx.host.transcriptUi.shouldVirtualize(conv);
        const messageHost = ctx.resolveTranscriptMessageHost(host);
        const hadReadingAnchorWindow = messageHost.querySelector('.theia-mod-transcript-reading-anchor') !== null;
        const scroll = ctx.resolveTranscriptScrollController(messageHost);
        const openingConversation = scroll.conversationId !== conv.id;
        if (openingConversation) {
            scroll.beginConversation(conv.id);
            scroll.markProgrammaticScroll(200);
        }
        const sameConversation = previousConversation?.id === conv.id;
        const previousLastMessageId = previousConversation?.messages.at(-1)?.id;
        const nextLastMessage = conv.messages.at(-1);
        const newTurnStarted = sameConversation
            && nextLastMessage?.role === 'user'
            && !!nextLastMessage.id
            && nextLastMessage.id !== previousLastMessageId;
        ctx.host.transcriptLastConv = conv;
        const showQuickActions = shouldShowTranscriptEmptyQuickActions(conv, previousConversation);
        const isEmptyChat = conv.messages.length === 0 && resolveTranscriptEffectiveStatus(conv) !== 'streaming';
        if (isEmptyChat && showQuickActions) {
            ctx.host.transcriptUi.disposeList();
            messageHost.classList.remove('theia-mod-virtual-scroll');
            messageHost.replaceChildren();
            messageHost.classList.toggle('theia-mod-empty-chat', true);
            messageHost.append(ctx.createTranscriptEmptyWelcome());
            ctx.host.transcriptComposerHost?.classList.toggle('theia-mod-show-quick-actions', true);
            ctx.host.transcriptLastRenderedConversationId = conv.id;
            ctx.host.transcriptLastRenderedMessageId = undefined;
            const project = ctx.host.transcriptOpenProject;
            if (project && ctx.workHub.shouldEmbedAgentsHubRecentsInWorkspaceTranscript()) {
                messageHost.append(ctx.workHub.createAgentsHubRecentsBlock(project));
            }
            ctx.host.transcriptUserScrollPinDispose.dispose();
            ctx.host.transcriptUserScrollPinDispose = new DisposableCollection(
                attachTranscriptScrollToBottomButton(host),
            );
            ctx.transcriptScrollChromeBoundConversationId = undefined;
            return;
        }
        if (isEmptyChat) {
            ctx.host.transcriptUi.disposeList();
            messageHost.classList.remove('theia-mod-virtual-scroll', 'theia-mod-empty-chat');
            ctx.host.transcriptComposerHost?.classList.remove('theia-mod-show-quick-actions');
            messageHost.replaceChildren();
            ctx.host.transcriptLastRenderedConversationId = conv.id;
            ctx.host.transcriptLastRenderedMessageId = undefined;
            const project = ctx.host.transcriptOpenProject;
            if (project && ctx.workHub.shouldEmbedAgentsHubRecentsInWorkspaceTranscript()) {
                messageHost.append(ctx.workHub.createAgentsHubRecentsBlock(project));
            }
            ctx.host.transcriptUserScrollPinDispose.dispose();
            ctx.host.transcriptUserScrollPinDispose = new DisposableCollection(
                attachTranscriptScrollToBottomButton(host),
            );
            ctx.transcriptScrollChromeBoundConversationId = undefined;
            return;
        }
        if (shouldVirtualize) {
            ctx.renderTranscriptMessagesVirtual(host, conv, { openingConversation, newTurnStarted });
            return;
        }
        ctx.host.transcriptUi.disposeList();
        messageHost.classList.remove('theia-mod-virtual-scroll');
        const shouldFollowTail = ctx.shouldFollowTranscriptTail(messageHost);
        const anchor = shouldFollowTail || newTurnStarted || openingConversation
            ? undefined
            : ctx.captureTranscriptScrollAnchor(messageHost);
        messageHost.classList.toggle('theia-mod-empty-chat', false);
        ctx.host.transcriptComposerHost?.classList.remove('theia-mod-show-quick-actions');
        // Build off-DOM then swap once — avoids N reflows while appending rows
        // into a connected host (visible flicker during streaming rebuilds).
        // Keyed reuse: a row whose stamped render key still matches its message
        // snapshot is MOVED into the new fragment instead of rebuilt — markdown,
        // timelines and <details> state survive untouched, so a settle/refetch
        // full render only rebuilds the tail. Stamps are dropped whenever a
        // patch path mutates a row, so a stamp always describes exactly what
        // the row currently shows.
        const reusableRows = new Map<string, HTMLElement>();
        messageHost.querySelectorAll<HTMLElement>(`:scope > [${TRANSCRIPT_MESSAGE_ID_ATTR}]`).forEach(el => {
            const key = el.dataset.qaapRowRenderKey;
            if (key && !reusableRows.has(key)) {
                reusableRows.set(key, el);
            }
        });
        // Detach the live setup/stream activity row before replaceChildren so a same-conversation
        // full rebuild can remount the same DOM (logo + phrase timers + elapsed meta) without a
        // flicker. Never reuse across conversation switches — that would leak the previous turn.
        const preservedActivityRow = !conversationSwitched
            ? ctx.findTranscriptStreamingActivityRow(messageHost)
            : undefined;
        preservedActivityRow?.remove();
        // Same for the scroller-tail live-status: replaceChildren would destroy the ThinkingOrb
        // and drop `:has(> .live-status)`, flashing the activity chrome for a frame.
        const preservedLiveStatus = !conversationSwitched
            ? detachTranscriptLiveStatusFromScroller(messageHost)
            : undefined;
        const normalizedForKeys = ctx.normalizeConversationFailuresCached(conv);
        const seamIndex = ctx.transcriptContextCompactionBoundaryIndex(normalizedForKeys);
        const fragment = document.createDocumentFragment();
        let reusedRowCount = 0;
        for (let index = 0; index < conv.messages.length; index++) {
            const isTail = index === conv.messages.length - 1;
            const key = isTail || index === seamIndex
                ? undefined
                : ctx.transcriptRowRenderKey(normalizedForKeys, index);
            const reused = key ? reusableRows.get(key) : undefined;
            if (reused && !reused.querySelector(`.${TRANSCRIPT_PENDING_APPROVAL_HOST_CLASS}, .${TRANSCRIPT_APPROVAL_CARD_CLASS}`)) {
                reusableRows.delete(key!);
                reused.classList.remove('theia-mod-streaming', 'theia-mod-new-message');
                fragment.append(reused);
                reusedRowCount++;
                continue;
            }
            const row = ctx.createTranscriptMessageRowAtIndex(conv, index);
            if (key && row.hasAttribute(TRANSCRIPT_MESSAGE_ID_ATTR)) {
                row.dataset.qaapRowRenderKey = key;
            }
            fragment.append(row);
        }
        recordTranscriptRenderMetric('render_full_rows_reused', reusedRowCount);
        recordTranscriptRenderMetric('render_full_rows_rebuilt', conv.messages.length - reusedRowCount);
        messageHost.replaceChildren(fragment);
        ctx.host.transcriptLastRenderedConversationId = conv.id;
        ctx.host.transcriptLastRenderedMessageId = conv.messages.at(-1)?.id;
        const last = conv.messages[conv.messages.length - 1];
        // The completed seam is emitted inline by createTranscriptMessageRowAtIndex during the loop
        // above; only the live shimmer is appended here as a footer.
        const runningCompaction = conv.contextCompaction?.status === 'running'
            ? ctx.createTranscriptContextCompactionRow(conv)
            : undefined;
        if (resolveTranscriptEffectiveStatus(conv) === 'streaming') {
            if (last?.role === 'agent') {
                const streamingTail = [...messageHost.children]
                    .reverse()
                    .find((el): el is HTMLElement => el instanceof HTMLElement
                        && el.classList.contains('theia-mobile-agent-transcript-msg'));
                streamingTail?.classList.add('theia-mod-streaming');
                if (runningCompaction) {
                    appendBeforeTranscriptLiveStatus(messageHost, runningCompaction);
                }
            } else {
                if (runningCompaction) {
                    appendBeforeTranscriptLiveStatus(messageHost, runningCompaction);
                }
                if (preservedActivityRow
                    && ctx.artifactsUi.syncTranscriptStreamingActivityRow(preservedActivityRow, conv)) {
                    preservedActivityRow.hidden = false;
                    appendBeforeTranscriptLiveStatus(messageHost, preservedActivityRow);
                } else {
                    const activityRow = ctx.artifactsUi.createTranscriptStreamingActivityRow(conv);
                    if (activityRow) {
                        appendBeforeTranscriptLiveStatus(messageHost, activityRow);
                    }
                }
            }
        } else if (runningCompaction) {
            appendBeforeTranscriptLiveStatus(messageHost, runningCompaction);
        }
        // Reattach the same live-status node (orb/shimmer intact) then sync via hold rules.
        if (preservedLiveStatus) {
            messageHost.append(preservedLiveStatus);
        }
        ctx.artifactsUi.ensurePinnedTranscriptLiveStatus(conv);
        if (hadReadingAnchorWindow && !newTurnStarted && !shouldFollowTail) {
            const lastUserRow = ctx.findLastUserMessageRow(messageHost);
            if (lastUserRow) {
                // Optimistic and persisted user messages have different ids.
                // Carry the bounded materialized window across that keyed/full
                // reconciliation so the scroll range does not collapse again.
                ctx.prepareTranscriptReadingAnchorWindow(messageHost, lastUserRow);
            }
        }
        if (newTurnStarted && !shouldFollowTail) {
            ctx.scrollTranscriptToLastUserTurn(messageHost, { asPositionTurn: true });
        } else if (newTurnStarted && shouldFollowTail) {
            ctx.scrollTranscriptFollowTail(messageHost);
        } else if (openingConversation && !ctx.hasExplicitTranscriptMessageHash()) {
            scroll.beginRestore();
            scroll.markProgrammaticScroll(200);
            if (!ctx.restoreTranscriptOpeningPosition(messageHost, conv)) {
                // Opening places the last user turn for reading context — ends detached.
                ctx.scrollTranscriptToLastUserTurn(messageHost);
            }
            scroll.completeRestore();
        } else {
            // Following after replaceChildren: one follow path only (no sync scrollTop
            // plus RAF — that double-write flashes when live-status remounts).
            if (shouldFollowTail) {
                ctx.scrollTranscriptFollowTail(messageHost);
            } else {
                ctx.scheduleTranscriptScrollAfterMutation(messageHost, anchor);
            }
        }
        ctx.attachTranscriptScrollChrome(host, messageHost, conv);
}

