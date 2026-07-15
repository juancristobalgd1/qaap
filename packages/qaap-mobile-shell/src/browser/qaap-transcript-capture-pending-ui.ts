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
} from '../common/qaap-visual-verification';

export const TRANSCRIPT_CAPTURE_PENDING_CHIP_CLASS = 'theia-mobile-agent-transcript-capture-pending';
export const TRANSCRIPT_CAPTURE_DIRECTIVE_CLASS = 'theia-mobile-agent-transcript-capture-directive';

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
    for (const block of row.querySelectorAll('.theia-mobile-agent-transcript-content')) {
        const text = block.textContent ?? '';
        if (agentMessageHasVisualVerificationMarker({ content: text })) {
            return true;
        }
        if (block.querySelector(VISUAL_EVIDENCE_SELECTOR)) {
            return true;
        }
    }
    return false;
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
        anchor.insertAdjacentElement('afterend', chip);
        return;
    }
    host.append(chip);
}

export function buildTranscriptCapturePendingChip(
    mode: 'image' | 'video',
    routes: readonly string[],
): HTMLElement {
    const chip = document.createElement('div');
    chip.className = `${TRANSCRIPT_CAPTURE_PENDING_CHIP_CLASS} theia-mod-${mode}`;
    chip.setAttribute('role', 'status');
    chip.setAttribute('aria-live', 'polite');
    chip.dataset.qaapCaptureMode = mode;

    const preview = document.createElement('div');
    preview.className = 'theia-mobile-agent-transcript-capture-pending-preview';
    preview.setAttribute('aria-hidden', 'true');

    const meta = document.createElement('div');
    meta.className = 'theia-mobile-agent-transcript-capture-pending-meta';

    const icon = document.createElement('span');
    icon.className = `theia-mobile-agent-transcript-capture-pending-icon codicon ${
        mode === 'video' ? 'codicon-device-camera-video' : 'codicon-device-camera'
    }`;
    icon.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'theia-mobile-agent-transcript-capture-pending-label';
    label.textContent = mode === 'video'
        ? nls.localize('qaap/mobileProjects/transcriptCaptureProcessingVideo', 'Processing video…')
        : nls.localize('qaap/mobileProjects/transcriptCaptureProcessingImage', 'Processing screenshot…');

    meta.append(icon, label);

    if (routes.length > 0) {
        const routesEl = document.createElement('span');
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
): void {
    chip.classList.toggle('theia-mod-image', mode === 'image');
    chip.classList.toggle('theia-mod-video', mode === 'video');
    chip.dataset.qaapCaptureMode = mode;
    const label = chip.querySelector<HTMLElement>('.theia-mobile-agent-transcript-capture-pending-label');
    if (label) {
        label.textContent = mode === 'video'
            ? nls.localize('qaap/mobileProjects/transcriptCaptureProcessingVideo', 'Processing video…')
            : nls.localize('qaap/mobileProjects/transcriptCaptureProcessingImage', 'Processing screenshot…');
    }
    const routesEl = chip.querySelector<HTMLElement>('.theia-mobile-agent-transcript-capture-pending-routes');
    if (routes.length === 0) {
        routesEl?.remove();
        return;
    }
    const target = routesEl ?? (() => {
        const created = document.createElement('span');
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

    const existingChip = host.querySelector<HTMLElement>(`:scope > .${TRANSCRIPT_CAPTURE_PENDING_CHIP_CLASS}`)
        ?? host.querySelector<HTMLElement>(`.${TRANSCRIPT_CAPTURE_PENDING_CHIP_CLASS}`);
    if (existingChip) {
        syncExistingCapturePendingChip(existingChip, pending.mode, pending.routes);
        return 1;
    }

    insertCapturePendingChip(host, buildTranscriptCapturePendingChip(pending.mode, pending.routes));
    return 1;
}
