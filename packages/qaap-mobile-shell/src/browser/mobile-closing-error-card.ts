// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// ─── Closing Error Card (mobile) ─────────────────────────────────────────────
//
// A single, styled outcome card for a failed turn's closing narrative — the
// codex-style equivalent of the old repeated raw "Error: ..." text blocks.
// Rendered OUTSIDE the process accordion (it's a final outcome, like the diff
// summary), and only once per distinct message: callers are responsible for
// deduplicating identical/duplicate error text before calling this.
// Extracted from qaap-execution-event-timeline.ts.

import { nls } from '@theia/core/lib/common/nls';

/** CSS class on the compact closing error card. */
export const MOBILE_CLOSING_ERROR_CARD_CLASS = 'theia-mobile-closing-error-card';

/**
 * Creates the compact closing error card, optionally with a quiet "Retry"
 * action when `onRetry` is provided. The button disables itself after the
 * first click so a slow/failed retry attempt can't be triggered twice from
 * the same card.
 */
export function createMobileClosingErrorCardElement(message: string, onRetry?: () => void): HTMLElement {
    const card = document.createElement('div');
    card.className = `${MOBILE_CLOSING_ERROR_CARD_CLASS} theia-mod-error`;

    const icon = document.createElement('span');
    icon.className = 'codicon codicon-error theia-mobile-closing-error-card-icon';
    icon.setAttribute('aria-hidden', 'true');

    const content = document.createElement('div');
    content.className = 'theia-mobile-closing-error-card-content';

    const text = document.createElement('span');
    text.className = 'theia-mobile-closing-error-card-message';
    text.textContent = message;
    content.append(text);

    if (onRetry) {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'theia-mobile-closing-error-card-retry';
        retry.textContent = nls.localizeByDefault('Retry');
        retry.addEventListener('click', () => {
            // Disable immediately so a double-click (or a slow retry that
            // hasn't settled yet) can't fire the callback a second time.
            retry.disabled = true;
            onRetry();
        }, { once: true });
        content.append(retry);
    }

    card.append(icon, content);
    return card;
}
