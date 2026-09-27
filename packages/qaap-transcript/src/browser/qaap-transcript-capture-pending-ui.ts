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
export function isTranscriptCaptureClosed(
    conv: Pick<QaapAgentConversationDTO, 'messages'> | undefined,
    message: Pick<QaapAgentMessageDTO, 'id' | 'error'> | undefined,
    streaming: boolean,
): boolean {
    if (streaming || !message) {
        return false;
    }
    if (message.error?.trim()) {
        return true;
    }
    const lastAgent = conv ? [...conv.messages].reverse().find(candidate => candidate.role === 'agent') : undefined;
    return !!lastAgent && lastAgent.id !== message.id;
}

export function syncTranscriptCaptureClosedRow(row: HTMLElement, closed: boolean): void {
    row.toggleAttribute(TRANSCRIPT_CAPTURE_CLOSED_ATTR, closed);
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
export function enhanceTranscriptCaptureDirectives(host: HTMLElement): number {
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

    const state: CaptureChipState = row?.hasAttribute(TRANSCRIPT_CAPTURE_CLOSED_ATTR) ? 'unavailable' : 'pending';
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
