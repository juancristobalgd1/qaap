// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { injectable } from '@theia/core/shared/inversify';
import { nls } from '@theia/core/lib/common/nls';

/**
 * Chat-style image handling for transcript messages: images render as bounded thumbnails
 * (CSS in mobile-workbench.css) and tapping one opens a full-page lightbox with a close
 * button. Installed once via document-level event delegation, so it covers every render
 * path (markdown, streaming patches, deferred rows) without touching the renderers.
 */

const LIGHTBOX_CLASS = 'qaap-transcript-image-lightbox';

/** Opens the full-page viewer for one image. Returns the overlay (used by tests). */
export function openQaapImageLightbox(doc: Document, source: string, alt: string): HTMLElement {
    const existing = doc.querySelector(`.${LIGHTBOX_CLASS}`);
    existing?.remove();

    const overlay = doc.createElement('div');
    overlay.className = LIGHTBOX_CLASS;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', alt || nls.localize('theia/qaap/imagePreview', 'Image preview'));

    const image = doc.createElement('img');
    image.src = source;
    image.alt = alt;
    overlay.append(image);

    const close = doc.createElement('button');
    close.type = 'button';
    close.className = `${LIGHTBOX_CLASS}-close`;
    close.setAttribute('aria-label', nls.localizeByDefault('Close'));
    const icon = doc.createElement('span');
    icon.className = 'codicon codicon-close';
    icon.setAttribute('aria-hidden', 'true');
    close.append(icon);
    overlay.append(close);

    const dispose = (): void => {
        doc.removeEventListener('keydown', onKeyDown, true);
        overlay.remove();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            dispose();
        }
    };
    close.addEventListener('click', event => {
        event.stopPropagation();
        dispose();
    });
    // Tapping the backdrop (anywhere that is not the image itself) closes too.
    overlay.addEventListener('click', event => {
        if (event.target !== image) {
            dispose();
        }
    });
    doc.addEventListener('keydown', onKeyDown, true);

    doc.body.append(overlay);
    close.focus();
    return overlay;
}

/** Delegated click handler — exported for tests. */
export function handleTranscriptImageClick(doc: Document, event: MouseEvent): boolean {
    const target = event.target;
    if (!(target instanceof HTMLImageElement)) {
        return false;
    }
    if (!target.closest('.theia-mobile-agent-transcript-content')) {
        return false;
    }
    if (!target.src || target.closest(`.${LIGHTBOX_CLASS}`)) {
        return false;
    }
    event.preventDefault();
    event.stopPropagation();
    openQaapImageLightbox(doc, target.src, target.alt ?? '');
    return true;
}

@injectable()
export class QaapTranscriptImageLightboxContribution implements FrontendApplicationContribution {
    onStart(): void {
        document.addEventListener('click', event => {
            handleTranscriptImageClick(document, event);
        }, true);
    }
}
