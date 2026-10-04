// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Root of the instant Work Hub shell painted by `qaap-login-gate.js` before bundle.js loads. */
export const INSTANT_WORK_HUB_SHELL_ID = 'qaap-instant-work-hub';
/** `sessionStorage` key where the instant shell keeps the text typed before the app started. */
export const INSTANT_COMPOSER_DRAFT_KEY = 'qaap.instantComposer.draft';

/**
 * Moves the text typed into the pre-bundle instant composer into the real composer textarea, then
 * removes the instant shell. The text is appended to an existing restored draft on its own line,
 * focus moves along when the instant composer had it, and an `input` event lets the composer persist
 * the draft and resize as if the user had typed it. A disabled textarea is left alone so the text is
 * not lost while the project is still loading. Returns `true` when there was a shell or draft to adopt.
 */
export function adoptInstantComposerDraft(textarea: HTMLTextAreaElement): boolean {
    if (textarea.disabled) {
        return false;
    }
    const shell = document.getElementById(INSTANT_WORK_HUB_SHELL_ID);
    const instantInput = shell?.querySelector('textarea') ?? undefined;
    const text = instantInput ? instantInput.value : readInstantComposerDraft();
    const hadFocus = !!instantInput && document.activeElement === instantInput;
    try {
        window.sessionStorage.removeItem(INSTANT_COMPOSER_DRAFT_KEY);
    } catch {
        // sessionStorage unavailable — the instant shell could not have stored a draft either.
    }
    shell?.remove();
    if (text && !textarea.value.endsWith(text)) {
        textarea.value = textarea.value.trim() ? `${textarea.value}\n${text}` : text;
        textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
    }
    if (hadFocus) {
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }
    return !!shell || !!text;
}

function readInstantComposerDraft(): string {
    try {
        return window.sessionStorage.getItem(INSTANT_COMPOSER_DRAFT_KEY) ?? '';
    } catch {
        return '';
    }
}
