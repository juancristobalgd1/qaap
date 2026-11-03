// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Pending partial stdout line kept between chunks; a longer line is dropped rather than buffered. */
const MAX_PENDING_STDOUT_LENGTH = 4 * 1024 * 1024;
/** Pi's stop reason for an assistant message whose provider request failed. */
const PI_STOP_REASON_ERROR = 'error';
const PI_FALLBACK_ERROR_TEXT = 'The model provider returned an error.';

/**
 * Follows Pi's `--mode json` stdout and reports whether the turn ended on a provider error. Pi writes
 * a failed request as an assistant `message_end` with `stopReason: "error"` and exits 0 in JSON mode,
 * so the exit code alone cannot tell a failed turn from a finished one. The latest assistant message
 * decides: a later successful answer (Pi's own retry) clears an earlier error.
 */
export interface PiProviderErrorWatcher {
    /** Feeds a stdout chunk; a line split across chunks is joined before it is read. */
    push(chunk: string): void;
    /** The provider error text when the latest assistant message failed, otherwise undefined. */
    finalError(): string | undefined;
}

export function createPiProviderErrorWatcher(): PiProviderErrorWatcher {
    let pending = '';
    let finalError: string | undefined;
    const consumeLine = (line: string): void => {
        const trimmed = line.trim();
        // Only `message_end` records can carry the stop reason; the rest of the stream is not parsed.
        if (!trimmed.startsWith('{') || !trimmed.includes('"message_end"')) {
            return;
        }
        let event: { readonly type?: string; readonly message?: { readonly role?: string; readonly stopReason?: string; readonly errorMessage?: string } };
        try {
            event = JSON.parse(trimmed);
        } catch {
            return;
        }
        if (event.type !== 'message_end' || event.message?.role !== 'assistant') {
            return;
        }
        finalError = event.message.stopReason === PI_STOP_REASON_ERROR
            ? event.message.errorMessage?.trim() || PI_FALLBACK_ERROR_TEXT
            : undefined;
    };
    return {
        push(chunk: string): void {
            const lines = `${pending}${chunk}`.split('\n');
            pending = lines.pop() ?? '';
            if (pending.length > MAX_PENDING_STDOUT_LENGTH) {
                pending = '';
            }
            for (const line of lines) {
                consumeLine(line);
            }
        },
        finalError(): string | undefined {
            return finalError;
        },
    };
}
