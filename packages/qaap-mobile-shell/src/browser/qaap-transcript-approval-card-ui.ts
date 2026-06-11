// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';

/** Tool UI approval-card root (ported from tool-ui.com). */
export const TRANSCRIPT_APPROVAL_CARD_CLASS = 'theia-mobile-agent-approval-card';
export const TRANSCRIPT_APPROVAL_CARD_ALLOW_CLASS = 'theia-mobile-agent-approval-card-allow';
export const TRANSCRIPT_APPROVAL_CARD_DENY_CLASS = 'theia-mobile-agent-approval-card-deny';

export type TranscriptApprovalDecision = 'allow' | 'deny';

export interface TranscriptApprovalCardHandlers {
    readonly onApprove: (event: Event) => void;
    readonly onReject: (event: Event) => void;
}

/** Instant feedback after Allow/Deny — hides actions and shows the chosen outcome. */
export function applyTranscriptApprovalCardOptimisticUi(
    card: HTMLElement,
    decision: TranscriptApprovalDecision,
): void {
    if (card.classList.contains('theia-mod-resolved')) {
        return;
    }
    card.classList.add('theia-mod-resolved');
    card.classList.add(decision === 'allow' ? 'theia-mod-allowed' : 'theia-mod-denied');
    card.querySelector('.theia-mobile-agent-approval-card-actions')?.remove();
    const title = card.querySelector('.theia-mobile-agent-approval-card-title');
    if (title) {
        title.textContent = decision === 'allow'
            ? nls.localize('qaap/mobileProjects/transcriptApprovalAllowed', 'Allowed')
            : nls.localize('qaap/mobileProjects/transcriptApprovalDenied', 'Denied');
    }
}

export function findTranscriptApprovalCardFromEvent(event: Event): HTMLElement | undefined {
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) {
        return undefined;
    }
    const found = target.closest(`.${TRANSCRIPT_APPROVAL_CARD_CLASS}`);
    return found instanceof HTMLElement ? found : undefined;
}

/**
 * Binary approval surface — icon + title + optional description, separator, Deny / Allow actions.
 * Matches the Tool UI `approval-card` layout without Tailwind.
 */
export function buildTranscriptApprovalCard(
    options: {
        readonly title: string;
        readonly description?: string;
        readonly surface?: 'inline' | 'pill';
    },
    handlers: TranscriptApprovalCardHandlers,
): HTMLElement {
    const card = document.createElement('div');
    card.className = TRANSCRIPT_APPROVAL_CARD_CLASS;
    if (options.surface) {
        card.classList.add(`theia-mod-${options.surface}`);
    }

    const head = document.createElement('div');
    head.className = 'theia-mobile-agent-approval-card-head';
    const icon = document.createElement('span');
    icon.className = 'theia-mobile-agent-approval-card-icon codicon codicon-shield';
    icon.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('div');
    copy.className = 'theia-mobile-agent-approval-card-copy';
    const title = document.createElement('div');
    title.className = 'theia-mobile-agent-approval-card-title';
    title.textContent = options.title;
    copy.append(title);
    if (options.description?.trim()) {
        const description = document.createElement('p');
        description.className = 'theia-mobile-agent-approval-card-description';
        description.textContent = options.description;
        copy.append(description);
    }
    head.append(icon, copy);

    const separator = document.createElement('div');
    separator.className = 'theia-mobile-agent-approval-card-sep';
    separator.setAttribute('role', 'separator');

    const actions = document.createElement('div');
    actions.className = 'theia-mobile-agent-approval-card-actions';
    const deny = document.createElement('button');
    deny.type = 'button';
    deny.className = TRANSCRIPT_APPROVAL_CARD_DENY_CLASS;
    deny.textContent = nls.localize('qaap/mobileProjects/transcriptApprovalDeny', 'Deny');
    deny.addEventListener('click', handlers.onReject);
    const allow = document.createElement('button');
    allow.type = 'button';
    allow.className = TRANSCRIPT_APPROVAL_CARD_ALLOW_CLASS;
    allow.textContent = nls.localize('qaap/mobileProjects/transcriptApprovalAllow', 'Allow');
    allow.addEventListener('click', handlers.onApprove);
    actions.append(deny, allow);

    card.append(head, separator, actions);
    return card;
}
