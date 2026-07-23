// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable } from '@theia/core/lib/common/disposable';
import {
    reduceTranscriptScrollPhase,
    transcriptScrollPhaseAllowsAutoFollow,
    transcriptScrollPhaseAllowsViewportMutation,
    type TranscriptScrollIntentEvent,
    type TranscriptScrollPhase,
} from '../common/qaap-transcript-scroll-intent-machine';
import { TRANSCRIPT_SCROLL_TO_BOTTOM_NEAR_BOTTOM_PX } from '../common/qaap-transcript-scroll-to-bottom';
import { isTranscriptScrollNearBottom } from '../common/qaap-transcript-user-scroll-pin';

/** Keep in sync with `qaap-transcript-scroll-intent` (string literal avoids circular import). */
const TRANSCRIPT_USER_SCROLL_INTENT_AT_ATTR = 'data-transcript-user-scroll-intent-at';
const TRANSCRIPT_USER_SCROLL_INTENT_REASON_ATTR = 'data-transcript-user-scroll-intent-reason';

const TRANSCRIPT_ANCHOR_SELECTOR = [
    '[data-transcript-message-id]',
    '.theia-mobile-agent-transcript-msg',
    '[data-transcript-activity-row]',
].join(', ');
const DEFAULT_PROGRAMMATIC_SCROLL_MS = 120;
const SMOOTH_PROGRAMMATIC_SCROLL_MS = 520;
const USER_GESTURE_SCROLL_WINDOW_MS = 500;

export interface TranscriptScrollAnchor {
    readonly top: number;
    readonly messageId?: string;
    readonly element?: HTMLElement;
    readonly offsetTop?: number;
}

function eventHasTranscriptScrollIntent(event: KeyboardEvent): boolean {
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && ['f', 'g'].includes(key)) {
        return true;
    }
    if (key === 'escape') {
        return true;
    }
    return ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar'].includes(event.key);
}

function findTranscriptAnchorElement(scroller: HTMLElement, messageId: string): HTMLElement | undefined {
    return [...scroller.querySelectorAll<HTMLElement>('[data-transcript-message-id]')]
        .find(candidate => candidate.getAttribute('data-transcript-message-id') === messageId);
}

export function captureTranscriptScrollAnchor(scroller: HTMLElement): TranscriptScrollAnchor {
    const scrollerRect = scroller.getBoundingClientRect();
    const isVisibleAnchor = (candidate: HTMLElement): boolean => candidate.getBoundingClientRect().bottom >= scrollerRect.top + 8;
    const messageCandidates = [...scroller.querySelectorAll<HTMLElement>('[data-transcript-message-id]')];
    const element = messageCandidates.find(isVisibleAnchor)
        ?? [...scroller.querySelectorAll<HTMLElement>(TRANSCRIPT_ANCHOR_SELECTOR)].find(isVisibleAnchor);
    return {
        top: scroller.scrollTop,
        messageId: element?.getAttribute('data-transcript-message-id') ?? undefined,
        element,
        offsetTop: element ? element.getBoundingClientRect().top - scrollerRect.top : undefined,
    };
}

export function restoreTranscriptScrollAnchor(scroller: HTMLElement, anchor: TranscriptScrollAnchor): void {
    const element = anchor.messageId
        ? findTranscriptAnchorElement(scroller, anchor.messageId) ?? anchor.element
        : anchor.element;
    if (!element?.isConnected || anchor.offsetTop === undefined) {
        scroller.scrollTop = anchor.top;
        return;
    }
    const scrollerRect = scroller.getBoundingClientRect();
    const currentOffset = element.getBoundingClientRect().top - scrollerRect.top;
    scroller.scrollTop += currentOffset - anchor.offsetTop;
}

type TranscriptScrollReconcileIntent =
    | { readonly kind: 'follow-tail' }
    | { readonly kind: 'preserve-anchor'; readonly anchor: TranscriptScrollAnchor; readonly settlePass?: boolean };

export class TranscriptScrollController {
    protected currentPhase: TranscriptScrollPhase = 'idle';
    protected currentConversationId: string | undefined;
    protected programmaticScrollUntil = 0;
    protected reconcileRaf = 0;
    protected reconcileScroller: HTMLElement | undefined;
    protected reconcileIntent: TranscriptScrollReconcileIntent | undefined;
    protected reconcileNeedsSettlePass = false;

    constructor(protected readonly primaryScroller: HTMLElement) { }

    get phase(): TranscriptScrollPhase {
        return this.currentPhase;
    }

    get conversationId(): string | undefined {
        return this.currentConversationId;
    }

    shouldFollowTail(): boolean {
        return transcriptScrollPhaseAllowsAutoFollow(this.currentPhase);
    }

    markProgrammaticScroll(durationMs = DEFAULT_PROGRAMMATIC_SCROLL_MS): void {
        this.programmaticScrollUntil = Math.max(this.programmaticScrollUntil, Date.now() + Math.max(0, durationMs));
    }

    notifyUserDetach(reason?: string): void {
        this.transition({ type: 'user-detach', reason });
    }

    jumpToLatest(): void {
        this.primaryScroller.removeAttribute(TRANSCRIPT_USER_SCROLL_INTENT_AT_ATTR);
        this.primaryScroller.removeAttribute(TRANSCRIPT_USER_SCROLL_INTENT_REASON_ATTR);
        document.getSelection()?.removeAllRanges();
        this.cancelPendingPreserveAnchor();
        this.transition({ type: 'jump-to-latest' });
    }

    beginConversation(conversationId: string): void {
        this.currentConversationId = conversationId;
        this.transition({ type: 'conversation-open' });
    }

    /** Bind conversation identity without resetting follow/detach phase. */
    bindConversationId(conversationId: string): void {
        this.currentConversationId = conversationId;
    }

    beginRestore(): void {
        this.transition({ type: 'restore-start' });
    }

    completeRestore(): void {
        this.transition({ type: 'restore-done' });
    }

    beginPositionTurn(): void {
        this.transition({ type: 'position-turn-start' });
    }

    completePositionTurn(): void {
        this.transition({ type: 'position-turn-done' });
    }

    captureAnchor(scroller: HTMLElement): TranscriptScrollAnchor {
        return captureTranscriptScrollAnchor(scroller);
    }

    restoreAnchor(scroller: HTMLElement, anchor: TranscriptScrollAnchor): void {
        const kind = this.currentPhase === 'restoring' ? 'restore' : 'preserve-anchor';
        if (!transcriptScrollPhaseAllowsViewportMutation(this.currentPhase, kind)) {
            return;
        }
        this.markProgrammaticScroll();
        restoreTranscriptScrollAnchor(scroller, anchor);
    }

    /** Preserve viewport anchor after layout settles (optionally twice for full rebuilds). */
    schedulePreserveAnchor(scroller: HTMLElement, anchor: TranscriptScrollAnchor): void {
        this.scheduleScrollReconciliation(scroller, { kind: 'preserve-anchor', anchor });
    }

    /** True while a deferred preserve-anchor reconciliation is queued. */
    isPreserveAnchorPending(): boolean {
        return this.reconcileIntent?.kind === 'preserve-anchor';
    }

    cancelPendingPreserveAnchor(): void {
        if (this.reconcileIntent?.kind === 'preserve-anchor') {
            this.reconcileIntent = undefined;
            this.reconcileNeedsSettlePass = false;
        }
        if (this.reconcileRaf && !this.reconcileIntent) {
            cancelAnimationFrame(this.reconcileRaf);
            this.reconcileRaf = 0;
            this.reconcileScroller = undefined;
        }
    }

    /** One scroll decision per animation frame — follow OR preserve, never both. */
    scheduleScrollReconciliation(scroller: HTMLElement, intent: TranscriptScrollReconcileIntent): void {
        this.reconcileScroller = scroller;
        this.reconcileIntent = this.mergeReconcileIntent(intent);
        if (this.reconcileIntent.kind === 'follow-tail') {
            this.reconcileNeedsSettlePass = false;
        } else if (intent.kind === 'preserve-anchor' && !intent.settlePass) {
            this.reconcileNeedsSettlePass = true;
        }
        if (this.reconcileRaf) {
            return;
        }
        this.reconcileRaf = requestAnimationFrame(() => {
            this.reconcileRaf = 0;
            this.flushScrollReconciliation();
        });
    }

    protected mergeReconcileIntent(next: TranscriptScrollReconcileIntent): TranscriptScrollReconcileIntent {
        const current = this.reconcileIntent;
        if (!current) {
            return next;
        }
        if (next.kind === 'follow-tail' || current.kind === 'follow-tail') {
            return { kind: 'follow-tail' };
        }
        return next;
    }

    protected flushScrollReconciliation(): void {
        const scroller = this.reconcileScroller;
        const intent = this.reconcileIntent;
        const needsSettle = this.reconcileNeedsSettlePass;
        this.reconcileScroller = undefined;
        this.reconcileIntent = undefined;
        this.reconcileNeedsSettlePass = false;
        if (!scroller || !intent) {
            return;
        }
        if (this.shouldFollowTail()) {
            this.scrollToTail(scroller, 'auto');
            return;
        }
        if (intent.kind === 'preserve-anchor') {
            this.restoreAnchor(scroller, intent.anchor);
            if (needsSettle) {
                this.scheduleScrollReconciliation(scroller, {
                    kind: 'preserve-anchor',
                    anchor: intent.anchor,
                    settlePass: true,
                });
            }
        }
    }

    scrollToTail(scroller: HTMLElement, behavior: ScrollBehavior = 'auto'): void {
        if (!transcriptScrollPhaseAllowsViewportMutation(this.currentPhase, 'follow-tail')) {
            return;
        }
        this.markProgrammaticScroll(behavior === 'smooth' ? SMOOTH_PROGRAMMATIC_SCROLL_MS : DEFAULT_PROGRAMMATIC_SCROLL_MS);
        scroller.scrollTo({ top: scroller.scrollHeight, behavior });
    }

    /** Place a turn near the top with prior context (open/restore or gated position-turn). */
    placeReadingPosition(scroller: HTMLElement, row: HTMLElement): void {
        const kind = this.currentPhase === 'restoring' ? 'restore' : 'position-turn';
        if (!transcriptScrollPhaseAllowsViewportMutation(this.currentPhase, kind)) {
            return;
        }
        const scrollerRect = scroller.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        const contextPx = Math.min(96, Math.max(40, Math.round(scroller.clientHeight * 0.14)));
        const nextTop = scroller.scrollTop + rowRect.top - scrollerRect.top - contextPx;
        this.markProgrammaticScroll();
        scroller.scrollTo({
            top: Math.max(0, Math.min(nextTop, Math.max(0, scroller.scrollHeight - scroller.clientHeight))),
            behavior: 'auto',
        });
    }

    positionTurnStart(scroller: HTMLElement, row: HTMLElement): void {
        if (!transcriptScrollPhaseAllowsViewportMutation(this.currentPhase, 'position-turn')) {
            return;
        }
        this.placeReadingPosition(scroller, row);
    }

    onContentChanged(scroller: HTMLElement): void {
        this.cancelPendingPreserveAnchor();
        this.scheduleScrollReconciliation(scroller, { kind: 'follow-tail' });
    }

    bind(scroller: HTMLElement): Disposable {
        let userGestureActive = false;
        let touchActive = false;
        let gestureTimer: ReturnType<typeof setTimeout> | undefined;

        const clearGestureTimer = (): void => {
            if (gestureTimer !== undefined) {
                clearTimeout(gestureTimer);
                gestureTimer = undefined;
            }
        };
        const expireGesture = (): void => {
            clearGestureTimer();
            gestureTimer = setTimeout(() => {
                gestureTimer = undefined;
                if (!touchActive) {
                    userGestureActive = false;
                }
            }, USER_GESTURE_SCROLL_WINDOW_MS);
        };
        const onWheel = (event: WheelEvent): void => {
            userGestureActive = true;
            this.programmaticScrollUntil = 0;
            // Upward wheel detaches immediately; downward may re-follow on scroll settle.
            if (event.deltaY < 0) {
                this.notifyUserDetach('wheel');
            }
            expireGesture();
        };
        const onTouchStart = (): void => {
            touchActive = true;
            userGestureActive = true;
            this.programmaticScrollUntil = 0;
            expireGesture();
        };
        const onTouchMove = (): void => {
            userGestureActive = true;
            this.programmaticScrollUntil = 0;
            expireGesture();
        };
        const onTouchEnd = (): void => {
            touchActive = false;
            expireGesture();
        };
        const onPointerDown = (event: PointerEvent): void => {
            if (event.pointerType !== 'mouse' || event.buttons > 0) {
                userGestureActive = true;
                this.programmaticScrollUntil = 0;
                expireGesture();
            }
        };
        const onKeydown = (event: KeyboardEvent): void => {
            if (eventHasTranscriptScrollIntent(event)) {
                userGestureActive = true;
                this.programmaticScrollUntil = 0;
                const key = event.key;
                if (key === 'ArrowUp' || key === 'PageUp' || key === 'Home'
                    || ((event.ctrlKey || event.metaKey) && ['f', 'F', 'g', 'G'].includes(key))) {
                    this.notifyUserDetach('keyboard');
                }
                expireGesture();
            }
        };
        const onScroll = (): void => {
            const nearBottom = isTranscriptScrollNearBottom(
                scroller.scrollTop,
                scroller.clientHeight,
                scroller.scrollHeight,
                TRANSCRIPT_SCROLL_TO_BOTTOM_NEAR_BOTTOM_PX,
            );
            if (Date.now() <= this.programmaticScrollUntil) {
                if (nearBottom) {
                    this.transition({ type: 'programmatic-near-bottom' });
                }
                return;
            }
            if (!userGestureActive) {
                return;
            }
            if (nearBottom) {
                this.transition({ type: 'user-return-to-live-edge' });
            } else {
                this.notifyUserDetach('scroll');
            }
            expireGesture();
        };
        scroller.addEventListener('wheel', onWheel, { passive: true });
        scroller.addEventListener('touchstart', onTouchStart, { passive: true });
        scroller.addEventListener('touchmove', onTouchMove, { passive: true });
        scroller.addEventListener('touchend', onTouchEnd, { passive: true });
        scroller.addEventListener('pointerdown', onPointerDown, { passive: true });
        scroller.addEventListener('keydown', onKeydown);
        scroller.addEventListener('scroll', onScroll, { passive: true });

        return Disposable.create(() => {
            clearGestureTimer();
            scroller.removeEventListener('wheel', onWheel);
            scroller.removeEventListener('touchstart', onTouchStart);
            scroller.removeEventListener('touchmove', onTouchMove);
            scroller.removeEventListener('touchend', onTouchEnd);
            scroller.removeEventListener('pointerdown', onPointerDown);
            scroller.removeEventListener('keydown', onKeydown);
            scroller.removeEventListener('scroll', onScroll);
        });
    }

    protected transition(event: TranscriptScrollIntentEvent): void {
        this.currentPhase = reduceTranscriptScrollPhase(this.currentPhase, event);
    }
}

const transcriptScrollControllers = new WeakMap<HTMLElement, TranscriptScrollController>();

export function getTranscriptScrollController(scroller: HTMLElement): TranscriptScrollController | undefined {
    return transcriptScrollControllers.get(scroller);
}

export function ensureTranscriptScrollController(scroller: HTMLElement): TranscriptScrollController {
    let controller = transcriptScrollControllers.get(scroller);
    if (!controller) {
        controller = new TranscriptScrollController(scroller);
        transcriptScrollControllers.set(scroller, controller);
    }
    return controller;
}
