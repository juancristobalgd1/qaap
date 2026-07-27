// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    formatTranscriptStreamElapsed,
    formatTranscriptTokenCount,
} from './qaap-transcript-stream-status';
import {
    totalTokensFromContextUsage,
    type QaapAgentContextUsage,
} from './qaap-agent-context-usage';
import { QAAP_BRAND_LOGO_INDICATOR_CLASS, syncShimmerTextElement } from './qaap-agent-setup-phrases';

/** Live turn row: always the last child of the transcript scroller while the turn is in flight. */
export const TRANSCRIPT_LIVE_STATUS_ATTR = 'data-transcript-live-status';
export const TRANSCRIPT_LIVE_STATUS_CLASS = 'theia-mobile-agent-live-status';
export const TRANSCRIPT_LIVE_STATUS_LOGO_CLASS = 'qaap-transcript-live-status-logo';
/**
 * Legacy pinned host (sibling of the scroller). Kept for host reshape / clear paths;
 * live-status mounts inside the scroller as its last child.
 */
export const TRANSCRIPT_STREAM_FOOTER_HOST_CLASS = 'theia-mobile-agent-transcript-stream-footer';

export interface TranscriptLiveStatusSnapshot {
    readonly elapsedMs: number;
    readonly streamChars: number;
    /** Preferred token count (provider usage); falls back to streamChars estimate. */
    readonly tokenCount?: number;
    readonly activityTitle: string;
    readonly activityKind?: string;
    readonly stalled?: boolean;
    readonly timedOut?: boolean;
}

/**
 * Tokens shown next to elapsed time: provider usage when present, else a
 * chars/4 estimate from the in-flight agent turn (incl. tool I/O).
 */
export function resolveTranscriptLiveStatusTokenCount(options: {
    readonly streamChars: number;
    readonly contextUsage?: QaapAgentContextUsage;
}): number {
    const usage = options.contextUsage;
    if (usage) {
        const produced = usage.outputTokens + (usage.reasoningTokens ?? 0);
        if (produced > 0) {
            return produced;
        }
        const total = totalTokensFromContextUsage(usage);
        if (total > 0) {
            return total;
        }
    }
    return Math.max(0, Math.round(options.streamChars / 4));
}

export interface CreateTranscriptLiveStatusElementOptions {
    /** Override the default brand-logo host (e.g. ThinkingOrb). */
    readonly createIndicator?: () => HTMLElement;
}

export function createTranscriptLiveStatusElement(
    options?: CreateTranscriptLiveStatusElementOptions,
): HTMLElement {
    const root = document.createElement('div');
    root.className = TRANSCRIPT_LIVE_STATUS_CLASS;
    root.setAttribute(TRANSCRIPT_LIVE_STATUS_ATTR, 'true');
    root.setAttribute('aria-live', 'polite');
    root.setAttribute('aria-busy', 'true');

    const logo = options?.createIndicator?.() ?? document.createElement('span');
    if (!options?.createIndicator) {
        logo.className = QAAP_BRAND_LOGO_INDICATOR_CLASS;
        logo.setAttribute('aria-hidden', 'true');
    }
    logo.classList.add(TRANSCRIPT_LIVE_STATUS_LOGO_CLASS);

    const activity = document.createElement('span');
    activity.className = 'qaap-agent-setup-text qaap-transcript-live-status-activity';

    const meta = document.createElement('span');
    meta.className = 'qaap-transcript-live-status-meta';

    root.classList.add('theia-mod-real-status');
    root.append(logo, activity, meta);
    return root;
}

/**
 * Ensure the legacy stream-footer host exists as a sibling of the message scroller
 * (kept empty/hidden; live-status lives in the scroller tail).
 */
export function ensureTranscriptStreamFooterHost(chatHost: HTMLElement): HTMLElement {
    let host = chatHost.querySelector<HTMLElement>(`:scope > .${TRANSCRIPT_STREAM_FOOTER_HOST_CLASS}`);
    if (host) {
        const scroller = chatHost.querySelector(':scope > .theia-mobile-agent-transcript');
        if (scroller && host.previousElementSibling !== scroller) {
            chatHost.append(host);
        }
        return host;
    }
    host = document.createElement('div');
    host.className = TRANSCRIPT_STREAM_FOOTER_HOST_CLASS;
    host.hidden = true;
    chatHost.append(host);
    return host;
}

export function resolveTranscriptChatHostFromNode(node: ParentNode | null | undefined): HTMLElement | undefined {
    if (!(node instanceof Element)) {
        return undefined;
    }
    const chatHost = node.closest('.theia-mobile-agent-transcript-real-chat');
    return chatHost instanceof HTMLElement ? chatHost : undefined;
}

export function resolveTranscriptScroller(chatHost: HTMLElement): HTMLElement | undefined {
    const scroller = chatHost.querySelector(':scope > .theia-mobile-agent-transcript');
    return scroller instanceof HTMLElement ? scroller : undefined;
}

/**
 * Strip live-status copies nested inside message rows/segments. Keeps the canonical
 * direct child of the scroller (always-last transcript tail).
 */
export function removeNestedTranscriptLiveStatusCopies(chatHost: HTMLElement): void {
    const scroller = resolveTranscriptScroller(chatHost);
    if (!scroller) {
        return;
    }
    for (const element of scroller.querySelectorAll<HTMLElement>(`.${TRANSCRIPT_LIVE_STATUS_CLASS}`)) {
        if (element.parentElement !== scroller) {
            element.remove();
        }
    }
}

/** @deprecated Use {@link removeNestedTranscriptLiveStatusCopies}. */
export function removeInlineTranscriptLiveStatusFromScroller(chatHost: HTMLElement): void {
    removeNestedTranscriptLiveStatusCopies(chatHost);
}

/**
 * Detach the canonical scroller-tail live-status (same node) so a full
 * `replaceChildren` / virtual mount can rebuild messages without destroying the
 * ThinkingOrb + shimmer timers. Caller must re-append via
 * {@link ensureTranscriptLiveStatusAtScrollerTail}.
 */
export function detachTranscriptLiveStatusFromScroller(scroller: HTMLElement): HTMLElement | undefined {
    const live = scroller.querySelector<HTMLElement>(`:scope > .${TRANSCRIPT_LIVE_STATUS_CLASS}`);
    live?.remove();
    return live ?? undefined;
}

/**
 * Insert message / activity / compaction nodes *before* the live-status tail so
 * a mid-turn append never buries the chrome for a frame (visible jump + orb flash).
 */
export function appendBeforeTranscriptLiveStatus(scroller: HTMLElement, node: Node): void {
    const live = scroller.querySelector(`:scope > .${TRANSCRIPT_LIVE_STATUS_CLASS}`);
    if (live) {
        scroller.insertBefore(node, live);
        return;
    }
    scroller.append(node);
}

/**
 * Keep `element` as the last child of the transcript scroller so new message rows
 * never bury the live-status chrome mid-turn.
 */
export function ensureTranscriptLiveStatusAtScrollerTail(
    chatHost: HTMLElement,
    element: HTMLElement,
): HTMLElement | undefined {
    const scroller = resolveTranscriptScroller(chatHost);
    if (!scroller) {
        return undefined;
    }
    if (element.parentElement !== scroller || scroller.lastElementChild !== element) {
        scroller.append(element);
    }
    return scroller;
}

/** @deprecated Alias — live-status mounts at the scroller tail. */
export function ensureTranscriptLiveStatusPinned(
    chatHost: HTMLElement,
    element: HTMLElement,
): HTMLElement | undefined {
    return ensureTranscriptLiveStatusAtScrollerTail(chatHost, element);
}

/** Hide and empty the legacy pinned footer host (live-status no longer mounts there). */
export function clearLegacyTranscriptStreamFooterHost(chatHost: HTMLElement): void {
    const footerHost = chatHost.querySelector<HTMLElement>(`:scope > .${TRANSCRIPT_STREAM_FOOTER_HOST_CLASS}`);
    if (!footerHost) {
        return;
    }
    footerHost.hidden = true;
    footerHost.replaceChildren();
}

export function formatTranscriptLiveStatusMeta(snapshot: TranscriptLiveStatusSnapshot): string {
    const parts: string[] = [formatTranscriptStreamElapsed(snapshot.elapsedMs)];
    const rawTokens = snapshot.tokenCount !== undefined
        ? snapshot.tokenCount
        : Math.round(snapshot.streamChars / 4);
    parts.push(formatTranscriptTokenCount(Math.max(0, rawTokens)) ?? '~0 tokens');
    return parts.join(' · ');
}

export function formatTranscriptLiveStatusActivity(snapshot: TranscriptLiveStatusSnapshot): string {
    const label = snapshot.activityTitle.replace(/…+$/u, '').trim();
    if (!label) {
        return '…';
    }
    // Duration-based labels ("Processing for 12s", "Processed in 8s") read as
    // complete sentences — appending "…" makes them look unfinished.
    if (/\d+s$/.test(label) || /\d+m\b/.test(label)) {
        return label;
    }
    return `${label}…`;
}

export function formatTranscriptLiveStatusText(snapshot: TranscriptLiveStatusSnapshot): string {
    const activity = formatTranscriptLiveStatusActivity(snapshot);
    const meta = formatTranscriptLiveStatusMeta(snapshot);
    return meta ? `${activity} · ${meta}` : activity;
}

export function syncTranscriptLiveStatusElement(
    element: HTMLElement,
    snapshot: TranscriptLiveStatusSnapshot,
): void {
    const meta = element.querySelector('.qaap-transcript-live-status-meta');
    const activity = element.querySelector<HTMLElement>('.qaap-transcript-live-status-activity');
    const nextMeta = formatTranscriptLiveStatusMeta(snapshot);
    const nextActivity = formatTranscriptLiveStatusActivity(snapshot);
    if (meta && meta.textContent !== nextMeta) {
        meta.textContent = nextMeta;
    }
    if (activity) {
        syncShimmerTextElement(activity, nextActivity);
    }
    element.classList.toggle('theia-mod-stalled', !!snapshot.stalled || !!snapshot.timedOut);
}

export function removeTranscriptLiveStatusElement(
    root: ParentNode,
    options?: { readonly beforeRemove?: (element: HTMLElement) => void },
): void {
    const element = root.querySelector<HTMLElement>(`.${TRANSCRIPT_LIVE_STATUS_CLASS}`);
    if (!element) {
        return;
    }
    options?.beforeRemove?.(element);
    element.remove();
}

/** Insertion anchor for closing narrative blocks: before diff summary or live footer. */
export function resolveTranscriptSegmentsFooterAnchor(segmentsBody: ParentNode): ChildNode | null {
    return segmentsBody.querySelector(`.theia-mobile-diff-summary, .${TRANSCRIPT_LIVE_STATUS_CLASS}`);
}
