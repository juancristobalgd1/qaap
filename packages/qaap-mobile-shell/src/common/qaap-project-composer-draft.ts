// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Session-scoped composer draft persistence, keyed per project.
 *
 * Used by composer surfaces that are addressed by project id rather than by conversation id —
 * the home "repos" sticky composer and the Agents Hub idle (pre-conversation) composer both
 * share a single durable draft per project, backed by `sessionStorage` so it survives an F5
 * reload but not a closed tab. Falls back to an in-memory value supplied by the caller when
 * `sessionStorage` is unavailable (e.g. private browsing).
 */

export function projectComposerDraftStorageKey(projectId: string): string {
    return `qaap.composerDraft.${projectId}`;
}

export function readProjectComposerDraft(projectId: string, inMemoryFallback: string): string {
    try {
        const stored = window.sessionStorage.getItem(projectComposerDraftStorageKey(projectId));
        if (stored !== null) {
            return stored;
        }
    } catch {
        // sessionStorage unavailable (e.g. private browsing) — fall back to the in-memory draft below.
    }
    return inMemoryFallback;
}

export function writeProjectComposerDraft(projectId: string, value: string): void {
    try {
        const key = projectComposerDraftStorageKey(projectId);
        if (value) {
            window.sessionStorage.setItem(key, value);
        } else {
            window.sessionStorage.removeItem(key);
        }
    } catch {
        // sessionStorage unavailable — the caller's in-memory field still holds the draft for this session.
    }
}
