// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export type ComposerImproveFeedbackKind = 'error' | 'info';

const FEEDBACK_SELECTOR = '.qaap-composer-improve-feedback';

export function showComposerImproveFeedback(
    anchor: HTMLElement,
    message: string,
    kind: ComposerImproveFeedbackKind = 'error',
): void {
    const panel = anchor.closest('.theia-mobile-projects-sticky-composer-input-panel');
    if (!panel) {
        return;
    }
    let feedback = panel.querySelector<HTMLElement>(FEEDBACK_SELECTOR);
    if (!feedback) {
        feedback = document.createElement('div');
        feedback.className = FEEDBACK_SELECTOR;
        feedback.setAttribute('role', 'status');
        feedback.setAttribute('aria-live', 'polite');
        panel.insertBefore(feedback, panel.firstChild);
    }
    feedback.textContent = message;
    feedback.hidden = false;
    feedback.classList.toggle('theia-mod-error', kind === 'error');
    feedback.classList.toggle('theia-mod-info', kind === 'info');
}

export function clearComposerImproveFeedback(anchor: HTMLElement): void {
    const panel = anchor.closest('.theia-mobile-projects-sticky-composer-input-panel');
    const feedback = panel?.querySelector<HTMLElement>(FEEDBACK_SELECTOR);
    if (!feedback) {
        return;
    }
    feedback.hidden = true;
    feedback.textContent = '';
    feedback.classList.remove('theia-mod-error', 'theia-mod-info');
}
