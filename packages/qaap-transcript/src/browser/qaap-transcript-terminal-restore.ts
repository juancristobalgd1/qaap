// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Pure restore helpers for Work Hub terminals (no Lumino / DOM imports — safe for unit tests).
 */

export interface TranscriptTerminalPersistedTerminal {
    readonly terminalId: number;
    readonly titleLabel?: string;
}

export interface TranscriptTerminalPersistedWorkspace {
    readonly activeIndex: number;
    readonly terminals: TranscriptTerminalPersistedTerminal[];
}

/** Minimal terminal surface used by {@link restoreOrCreateTranscriptTerminal}. */
export interface RestorableTranscriptTerminal {
    readonly isDisposed: boolean;
    readonly title: { label: string; caption: string };
    start(id?: number): Promise<number>;
    dispose(): void;
}

/** Keeps only usable persisted PTY ids (drops strings / NaN left by older storage). */
export function sanitizeTranscriptTerminalPersistedWorkspace(
    state: TranscriptTerminalPersistedWorkspace | undefined,
): TranscriptTerminalPersistedWorkspace | undefined {
    if (!state || !Array.isArray(state.terminals)) {
        return undefined;
    }
    const terminals = state.terminals.filter(
        (terminal): terminal is TranscriptTerminalPersistedTerminal =>
            !!terminal
            && Number.isInteger(terminal.terminalId)
            && terminal.terminalId >= 0,
    );
    if (terminals.length === 0) {
        return undefined;
    }
    return {
        activeIndex: Math.min(Math.max(0, state.activeIndex | 0), terminals.length - 1),
        terminals,
    };
}

/**
 * Reattaches to a persisted PTY when it still exists; after backend/VPS restart the id is gone
 * and Theia may surface `terminal "<id>" does not exist` — fall back to a fresh shell instead.
 */
export async function restoreOrCreateTranscriptTerminal<T extends RestorableTranscriptTerminal>(
    createTerminal: () => Promise<T>,
    state: TranscriptTerminalPersistedTerminal,
): Promise<T> {
    const applyTitle = (terminal: T): void => {
        if (!state.titleLabel) {
            return;
        }
        terminal.title.label = state.titleLabel;
        terminal.title.caption = state.titleLabel;
    };
    const terminal = await createTerminal();
    applyTitle(terminal);
    try {
        await terminal.start(state.terminalId);
        return terminal;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
            '[qaap-mobile-shell] Work Hub terminal restore failed; starting a fresh PTY',
            { terminalId: state.terminalId, message },
        );
        if (!terminal.isDisposed) {
            terminal.dispose();
        }
        const fresh = await createTerminal();
        applyTitle(fresh);
        await fresh.start();
        return fresh;
    }
}
