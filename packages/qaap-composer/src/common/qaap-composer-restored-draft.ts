// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Composer drafts that were put back into the box because a send did not go through (for
 * example a Stop while the turn was still starting). The text stays editable and is never sent
 * on its own; the composer labels it so an accidental Enter does not read as a new message.
 * In memory only: the marker lasts for this page session and is cleared by the next send/clear.
 */
const restoredDraftKeys = new Set<string>();

/** Key for a composer draft: the idle Work Hub summary is shared, so it is scoped by project. */
export function resolveComposerRestoredDraftKey(projectId: string, summaryId: string, isIdleSummary: boolean): string {
    return isIdleSummary ? `project:${projectId}` : `conversation:${summaryId}`;
}

export function markComposerDraftRestored(key: string): void {
    restoredDraftKeys.add(key);
}

export function clearComposerDraftRestored(key: string): void {
    restoredDraftKeys.delete(key);
}

export function isComposerDraftRestored(key: string): boolean {
    return restoredDraftKeys.has(key);
}
