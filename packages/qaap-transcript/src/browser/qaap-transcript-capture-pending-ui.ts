// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import {
    agentMessageHasVisualVerificationMarker,
    findQaapCaptureDirectivesInText,
    QAAP_CAPTURE_DIRECTIVE_PATTERN,
    textContainsQaapCaptureDirective,
} from '@theia/qaap-shared-core/lib/common/qaap-visual-verification';
import type { QaapAgentConversationDTO, QaapAgentMessageDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';

export const TRANSCRIPT_CAPTURE_PENDING_CHIP_CLASS = 'theia-mobile-agent-transcript-capture-pending';
export const TRANSCRIPT_CAPTURE_DIRECTIVE_CLASS = 'theia-mobile-agent-transcript-capture-directive';
const TRANSCRIPT_CAPTURE_DIRECTIVE_TEXT_CLASS = 'theia-mobile-agent-transcript-capture-directive-text';
/**
 * Set on an agent message row when no capture can land for it any more, so a `[QAAP capture]`
 * directive renders as "not available" instead of an endless "Processing screenshot…" skeleton.
 */
export const TRANSCRIPT_CAPTURE_CLOSED_ATTR = 'data-qaap-capture-closed';

type CaptureChipState = 'pending' | 'unavailable';

/**
 * Whether a capture requested in `message` can no longer arrive: the backend only captures a
 * settled turn without an error (see `conversationNeedsVisualVerificationEvidence`), and a later
 * agent turn supersedes it. A still-streaming or unknown message stays open.
 */
/**
 * How long a settled turn may wait for its visual evidence. The backend captures right after the turn
 * settles, so a capture that has not landed this long after the reply is not coming; the chip must not
 * keep a skeleton on screen forever.
 */
export const TRANSCRIPT_CAPTURE_EXPIRY_MS = 90_000;
/** Dataset key on the message row that carries the capture deadline (epoch ms). */
const TRANSCRIPT_CAPTURE_EXPIRES_AT_DATA = 'qaapCaptureExpiresAt';
const TRANSCRIPT_CAPTURE_EXPIRY_TIMER_DATA = 'qaapCaptureExpiryTimer';

/** Epoch ms after which a settled message's capture is given up, or `undefined` while it is still running. */
export function transcriptCaptureExpiresAt(
    message: Partial<Pick<QaapAgentMessageDTO, 'runFinishedAt' | 'createdAt'>> | undefined,
): number | undefined {
    const settledAt = message?.runFinishedAt ?? message?.createdAt;
    return settledAt === undefined ? undefined : settledAt + TRANSCRIPT_CAPTURE_EXPIRY_MS;
}

export function isTranscriptCaptureClosed(
    conv: Pick<QaapAgentConversationDTO, 'messages'> | undefined,
    message: Pick<QaapAgentMessageDTO, 'id' | 'error'> & Partial<Pick<QaapAgentMessageDTO, 'runFinishedAt' | 'createdAt'>> | undefined,
    streaming: boolean,
    now: number = Date.now(),
): boolean {
    if (streaming || !message) {
        return false;
    }
    if (message.error?.trim()) {
        return true;
    }
    const expiresAt = transcriptCaptureExpiresAt(message);
    if (expiresAt !== undefined && now >= expiresAt) {
        return true;
    }
    const lastAgent = conv ? [...conv.messages].reverse().find(candidate => candidate.role === 'agent') : undefined;
    return !!lastAgent && lastAgent.id !== message.id;
}

/**
 * Marks a message row closed (no capture can land any more). With `expiresAt`, the row also remembers
 * its deadline so an open pending chip flips to "not available" when the deadline passes.
 */
export function syncTranscriptCaptureClosedRow(row: HTMLElement, closed: boolean, expiresAt?: number): void {
    row.toggleAttribute(TRANSCRIPT_CAPTURE_CLOSED_ATTR, closed);
    if (expiresAt === undefined) {
        delete row.dataset[TRANSCRIPT_CAPTURE_EXPIRES_AT_DATA];
    } else {
        row.dataset[TRANSCRIPT_CAPTURE_EXPIRES_AT_DATA] = String(expiresAt);
    }
}

/**
 * Whether the row's capture is closed by its deadline. Also arms a single timer that re-runs the
 * directive enhancement at the deadline, so a chip that is on screen flips without a new render.
 */
function resolveRowCaptureExpiry(host: HTMLElement, row: HTMLElement | null): boolean {
    if (!row) {
        return false;
    }
    const expiresAt = Number(row.dataset[TRANSCRIPT_CAPTURE_EXPIRES_AT_DATA]);
    if (!Number.isFinite(expiresAt)) {
        return false;
    }
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
        return true;
    }
    const view = host.ownerDocument?.defaultView;
    if (view && !row.dataset[TRANSCRIPT_CAPTURE_EXPIRY_TIMER_DATA]) {
        row.dataset[TRANSCRIPT_CAPTURE_EXPIRY_TIMER_DATA] = '1';
        view.setTimeout(() => {
            delete row.dataset[TRANSCRIPT_CAPTURE_EXPIRY_TIMER_DATA];
            syncTranscriptCaptureClosedRow(row, true, expiresAt);
            enhanceTranscriptCaptureDirectives(host);
        }, remaining + 25);
    }
    return false;
}

function localizeCaptureChipLabel(mode: 'image' | 'video', state: CaptureChipState): string {
    if (state === 'unavailable') {
        return mode === 'video'
            ? nls.localize('qaap/mobileProjects/transcriptCaptureUnavailableVideo', 'Video not available')
            : nls.localize('qaap/mobileProjects/transcriptCaptureUnavailableImage', 'Screenshot not available');
    }
    return mode === 'video'
        ? nls.localize('qaap/mobileProjects/transcriptCaptureProcessingVideo', 'Processing video…')
        : nls.localize('qaap/mobileProjects/transcriptCaptureProcessingImage', 'Processing screenshot…');
}

function captureChipIconClass(mode: 'image' | 'video', state: CaptureChipState): string {
    if (state === 'unavailable') {
        return 'codicon-circle-slash';
    }
    return mode === 'video' ? 'codicon-device-camera-video' : 'codicon-device-camera';
}

const CAPTURE_DIRECTIVE_REGEX = new RegExp(QAAP_CAPTURE_DIRECTIVE_PATTERN, 'i');
const VISUAL_EVIDENCE_SELECTOR = [
    'img[src*="/visual-verifications/"]',
    'video.qaap-transcript-video-evidence',
    'a[href*="/visual-verifications/"]',
].join(', ');

function isDomElement(node: Node): node is Element {
    return node.nodeType === 1;
}

function resolveTranscriptMessageRow(host: HTMLElement): HTMLElement | null {
    return host.closest('.theia-mobile-agent-transcript-msg');
}

function transcriptRowHasResolvedVisualEvidence(row: HTMLElement | null): boolean {
    if (!row) {
        return false;
    }
    // A settled visual block is rendered beside the directive block. Do not scope this
    // check to `.theia-mobile-agent-transcript-content`: execution-timeline/deferred
    // renderers can temporarily place the marker or the media node in another child of
    // the same message row. The row is the ownership boundary for the pending chip.
    return agentMessageHasVisualVerificationMarker({ content: row.textContent ?? '' })
        || row.querySelector(VISUAL_EVIDENCE_SELECTOR) !== null;
}

function removeCapturePendingChips(root: ParentNode): void {
    root.querySelectorAll(`.${TRANSCRIPT_CAPTURE_PENDING_CHIP_CLASS}`).forEach(node => node.remove());
}

function resolveCaptureDirectiveAnchor(host: HTMLElement): HTMLElement | null {
    let anchor: HTMLElement | null = null;
    host.querySelectorAll('p, .theia-mobile-agent-transcript-stream-plain-body').forEach(node => {
        if (!isDomElement(node)) {
            return;
        }
        if (!CAPTURE_DIRECTIVE_REGEX.test(node.textContent ?? '')) {
            return;
        }
        node.classList.add(TRANSCRIPT_CAPTURE_DIRECTIVE_CLASS);
        anchor = node as HTMLElement;
    });
    return anchor;
}

function insertCapturePendingChip(host: HTMLElement, chip: HTMLElement): void {
    const anchor = resolveCaptureDirectiveAnchor(host);
    if (anchor && anchor !== host) {
        try {
            anchor.insertAdjacentElement('afterend', chip);
        } catch {
            // Some embedded DOM implementations expose insertAdjacentElement but cannot
            // move nodes between their document realms. Appending is the safe fallback: the
            // directive is normally the final streamed paragraph, and the browser path keeps
            // the precise after-directive placement above.
            host.append(chip);
        }
        return;
    }
    host.append(chip);
}

export function buildTranscriptCapturePendingChip(
    mode: 'image' | 'video',
    routes: readonly string[],
    ownerDocument: Document = document,
    state: CaptureChipState = 'pending',
): HTMLElement {
    const chip = ownerDocument.createElement('div');
    chip.className = `${TRANSCRIPT_CAPTURE_PENDING_CHIP_CLASS} theia-mod-${mode}${state === 'unavailable' ? ' theia-mod-unavailable' : ''}`;
    chip.setAttribute('role', 'status');
    chip.setAttribute('aria-live', 'polite');
    chip.dataset.qaapCaptureMode = mode;

    const preview = ownerDocument.createElement('div');
    preview.className = 'theia-mobile-agent-transcript-capture-pending-preview';
    preview.setAttribute('aria-hidden', 'true');

    const meta = ownerDocument.createElement('div');
    meta.className = 'theia-mobile-agent-transcript-capture-pending-meta';

    const icon = ownerDocument.createElement('span');
    icon.className = `theia-mobile-agent-transcript-capture-pending-icon codicon ${captureChipIconClass(mode, state)}`;
    icon.setAttribute('aria-hidden', 'true');

    const label = ownerDocument.createElement('span');
    label.className = 'theia-mobile-agent-transcript-capture-pending-label';
    label.textContent = localizeCaptureChipLabel(mode, state);

    meta.append(icon, label);

    if (routes.length > 0) {
        const routesEl = ownerDocument.createElement('span');
        routesEl.className = 'theia-mobile-agent-transcript-capture-pending-routes';
        routesEl.textContent = routes.join(' ');
        meta.append(routesEl);
    }

    chip.append(preview, meta);
    return chip;
}

function syncExistingCapturePendingChip(
    chip: HTMLElement,
    mode: 'image' | 'video',
    routes: readonly string[],
    state: CaptureChipState,
): void {
    chip.classList.toggle('theia-mod-image', mode === 'image');
    chip.classList.toggle('theia-mod-video', mode === 'video');
    chip.classList.toggle('theia-mod-unavailable', state === 'unavailable');
    chip.dataset.qaapCaptureMode = mode;
    const label = chip.querySelector<HTMLElement>('.theia-mobile-agent-transcript-capture-pending-label');
    if (label) {
        label.textContent = localizeCaptureChipLabel(mode, state);
    }
    const icon = chip.querySelector<HTMLElement>('.theia-mobile-agent-transcript-capture-pending-icon');
    if (icon) {
        icon.className = `theia-mobile-agent-transcript-capture-pending-icon codicon ${captureChipIconClass(mode, state)}`;
    }
    const routesEl = chip.querySelector<HTMLElement>('.theia-mobile-agent-transcript-capture-pending-routes');
    if (routes.length === 0) {
        routesEl?.remove();
        return;
    }
    const target = routesEl ?? (() => {
        const created = chip.ownerDocument.createElement('span');
        created.className = 'theia-mobile-agent-transcript-capture-pending-routes';
        chip.querySelector('.theia-mobile-agent-transcript-capture-pending-meta')?.append(created);
        return created;
    })();
    target.textContent = routes.join(' ');
}

/**
 * When the agent streams `[QAAP capture]` / `[QAAP record]`, show a skeleton chip below the
 * directive until visual evidence (or a failure note) lands in the same message row.
 */
/**
 * `[QAAP capture]` / `[QAAP record]` is a protocol token the capture pipeline and the pending chip read,
 * not prose for the reader. Wrap each occurrence in a hidden span: `textContent` keeps the token, so the
 * directive detection below still works, while the reader no longer sees the raw bracket text.
 */
export function concealTranscriptCaptureDirectiveText(host: HTMLElement): void {
    const doc = host.ownerDocument ?? document;
    const textNodes: Text[] = [];
    // Numeric SHOW_TEXT and nodeType checks: DOM globals (NodeFilter, Text) may come from another realm.
    const SHOW_TEXT = 0x4;
    const TEXT_NODE = 3;
    const walker = doc.createTreeWalker(host, SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.nodeType === TEXT_NODE && !node.parentElement?.classList.contains(TRANSCRIPT_CAPTURE_DIRECTIVE_TEXT_CLASS)) {
            textNodes.push(node as Text);
        }
    }
    for (const textNode of textNodes) {
        const data = textNode.data;
        const regex = new RegExp(QAAP_CAPTURE_DIRECTIVE_PATTERN, 'gi');
        const parts: Node[] = [];
        let cursor = 0;
        for (let match = regex.exec(data); match; match = regex.exec(data)) {
            if (match.index > cursor) {
                parts.push(doc.createTextNode(data.slice(cursor, match.index)));
            }
            const concealed = doc.createElement('span');
            concealed.className = TRANSCRIPT_CAPTURE_DIRECTIVE_TEXT_CLASS;
            concealed.setAttribute('hidden', '');
            concealed.textContent = match[0];
            parts.push(concealed);
            cursor = match.index + match[0].length;
        }
        if (parts.length === 0) {
            continue;
        }
        if (cursor < data.length) {
            parts.push(doc.createTextNode(data.slice(cursor)));
        }
        textNode.replaceWith(...parts);
    }
}

export function enhanceTranscriptCaptureDirectives(host: HTMLElement): number {
    concealTranscriptCaptureDirectiveText(host);
    const row = resolveTranscriptMessageRow(host);
    if (transcriptRowHasResolvedVisualEvidence(row)) {
        removeCapturePendingChips(row ?? host);
        return 0;
    }

    const sourceText = host.textContent ?? '';
    if (!textContainsQaapCaptureDirective(sourceText)) {
        host.querySelectorAll(`.${TRANSCRIPT_CAPTURE_PENDING_CHIP_CLASS}`).forEach(node => node.remove());
        return 0;
    }

    const directives = findQaapCaptureDirectivesInText(sourceText);
    const pending = directives.at(-1);
    if (!pending) {
        return 0;
    }

    resolveCaptureDirectiveAnchor(host);

    const closed = !!row?.hasAttribute(TRANSCRIPT_CAPTURE_CLOSED_ATTR) || resolveRowCaptureExpiry(host, row);
    const state: CaptureChipState = closed ? 'unavailable' : 'pending';
    const existingChip = host.querySelector<HTMLElement>(`:scope > .${TRANSCRIPT_CAPTURE_PENDING_CHIP_CLASS}`)
        ?? host.querySelector<HTMLElement>(`.${TRANSCRIPT_CAPTURE_PENDING_CHIP_CLASS}`);
    if (existingChip) {
        syncExistingCapturePendingChip(existingChip, pending.mode, pending.routes, state);
        return 1;
    }

    insertCapturePendingChip(
        host,
        buildTranscriptCapturePendingChip(pending.mode, pending.routes, host.ownerDocument ?? document, state),
    );
    return 1;
}
