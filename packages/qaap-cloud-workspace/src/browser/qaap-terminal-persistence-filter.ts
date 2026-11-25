// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** A terminal widget as far as the IDE's restore hint is concerned. */
export interface QaapPersistableTerminalWidget {
    readonly id: string;
    readonly title: { readonly label: string };
}

/**
 * The IDE terminals worth announcing after a restart: never the transient Work Hub ones (chat panels, the hidden
 * sign-in terminal of the Connect dialog), which keep their own state. Listing those made the IDE announce
 * "Previous terminal session restored (π)" for a Pi sign-in that had long finished (staging, 24 Nov 2026).
 */
export function persistableQaapTerminals(widgets: readonly QaapPersistableTerminalWidget[]): { id: string; title: string; cwd: undefined }[] {
    return widgets
        .filter(widget => !(widget as unknown as { options?: { isTransient?: boolean } }).options?.isTransient)
        .map(widget => ({ id: widget.id, title: widget.title.label, cwd: undefined }));
}
