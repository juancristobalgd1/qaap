// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { formatTranscriptStreamElapsed, formatTranscriptStreamTokens } from './qaap-transcript-stream-status';
import { QAAP_BRAND_LOGO_INDICATOR_CLASS, syncShimmerTextElement } from './qaap-agent-setup-phrases';

/** Footer row shown while a turn streams; hidden once the diff summary mounts. */
export const TRANSCRIPT_LIVE_STATUS_ATTR = 'data-transcript-live-status';
export const TRANSCRIPT_LIVE_STATUS_CLASS = 'theia-mobile-agent-live-status';

export interface TranscriptLiveStatusSnapshot {
    readonly elapsedMs: number;
    readonly streamChars: number;
    readonly activityTitle: string;
    readonly stalled?: boolean;
    readonly timedOut?: boolean;
}

export function createTranscriptLiveStatusElement(): HTMLElement {
    const root = document.createElement('div');
    root.className = TRANSCRIPT_LIVE_STATUS_CLASS;
    root.setAttribute(TRANSCRIPT_LIVE_STATUS_ATTR, 'true');
    root.setAttribute('aria-live', 'polite');
    root.setAttribute('aria-busy', 'true');

    const logo = document.createElement('span');
    logo.className = `${QAAP_BRAND_LOGO_INDICATOR_CLASS} qaap-transcript-live-status-logo`;
    logo.setAttribute('aria-hidden', 'true');

    const activity = document.createElement('span');
    activity.className = 'qaap-agent-setup-text qaap-transcript-live-status-activity';

    const meta = document.createElement('span');
    meta.className = 'qaap-transcript-live-status-meta';

    root.classList.add('theia-mod-real-status');
    root.append(logo, activity, meta);
    return root;
}

export function formatTranscriptLiveStatusMeta(snapshot: TranscriptLiveStatusSnapshot): string {
    const parts: string[] = [formatTranscriptStreamElapsed(snapshot.elapsedMs)];
    const tokens = formatTranscriptStreamTokens(snapshot.streamChars);
    if (tokens) {
        parts.push(tokens);
    }
    return parts.join(' · ');
}

export function formatTranscriptLiveStatusActivity(snapshot: TranscriptLiveStatusSnapshot): string {
    const label = snapshot.activityTitle.replace(/…+$/u, '').trim();
    return label ? `${label}…` : '…';
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

export function removeTranscriptLiveStatusElement(root: ParentNode): void {
    root.querySelector(`.${TRANSCRIPT_LIVE_STATUS_CLASS}`)?.remove();
}

/** Insertion anchor for closing narrative blocks: before diff summary or live footer. */
export function resolveTranscriptSegmentsFooterAnchor(segmentsBody: ParentNode): ChildNode | null {
    return segmentsBody.querySelector(`.theia-mobile-diff-summary, .${TRANSCRIPT_LIVE_STATUS_CLASS}`);
}
