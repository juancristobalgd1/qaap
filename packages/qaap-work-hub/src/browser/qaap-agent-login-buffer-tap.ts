// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Structural subset of the Theia terminal buffer (xterm's active buffer). */
export interface QaapAgentLoginTerminalBuffer {
    readonly length: number;
    getLines(start: number, length: number, trimRight?: boolean): string[];
}

export interface QaapAgentLoginBufferTapOptions {
    /** The terminal's buffer, or `undefined` once the terminal is gone. */
    readonly buffer: () => QaapAgentLoginTerminalBuffer | undefined;
    /** Receives only the text that appeared since the previous read. */
    readonly feed: (text: string) => void;
    /** Terminal column count when known: a row filled to this width continues on the next row. */
    readonly columns?: () => number | undefined;
}

/** Rows read per poll from the bottom of the buffer; a sign-in produces far fewer lines. */
export const QAAP_AGENT_LOGIN_BUFFER_TAP_MAX_ROWS = 500;

/**
 * Recovers sign-in terminal output that never reached `onOutput`. Theia only emits `onOutput` once
 * the xterm instance is open, and output written before that is flushed into the buffer silently.
 * The tap reads the rendered buffer and feeds only the text that is new since its last read.
 *
 * `onOutput` deliveries re-baseline the tap to the buffer as it stands (that text was already fed
 * live), so a healthy terminal never produces duplicates.
 */
export class QaapAgentLoginBufferTap {

    protected fedText = '';
    protected fedUtf8Bytes = 0;
    protected disposed = false;

    constructor(protected readonly options: QaapAgentLoginBufferTapOptions) { }

    /** UTF-8 bytes this tap has fed to the flow. */
    get fedBytes(): number {
        return this.fedUtf8Bytes;
    }

    /** Live `onOutput` text arrived: the buffer now holds it, so it counts as already fed. */
    noteOutput(): void {
        if (!this.disposed) {
            this.fedText = this.readText();
        }
    }

    /** Feeds the buffer text that appeared since the last read. Returns the fed text length. */
    poll(): number {
        if (this.disposed) {
            return 0;
        }
        const current = this.readText();
        if (current === this.fedText) {
            return 0;
        }
        // A changed row (a redrawn prompt, a shrunk buffer) is fed from where the text diverges.
        const delta = current.slice(commonPrefixLength(current, this.fedText));
        this.fedText = current;
        if (!delta) {
            return 0;
        }
        this.fedUtf8Bytes += agentLoginUtf8ByteLength(delta);
        this.options.feed(delta);
        return delta.length;
    }

    dispose(): void {
        this.disposed = true;
    }

    protected readText(): string {
        const buffer = this.options.buffer();
        if (!buffer) {
            return '';
        }
        const start = Math.max(0, buffer.length - QAAP_AGENT_LOGIN_BUFFER_TAP_MAX_ROWS);
        const rows = buffer.getLines(start, buffer.length - start, false);
        const columns = this.options.columns?.();
        let text = '';
        rows.forEach((row, index) => {
            const isLast = index === rows.length - 1;
            const wrapped = columns !== undefined && columns > 0 && row.length >= columns;
            if (wrapped) {
                // Untrimmed: the padding is part of a row that continues on the next one.
                text += row;
            } else {
                text += isLast ? row.trimEnd() : `${row.trimEnd()}\n`;
            }
        });
        return text;
    }
}

function commonPrefixLength(left: string, right: string): number {
    const limit = Math.min(left.length, right.length);
    let index = 0;
    while (index < limit && left.charCodeAt(index) === right.charCodeAt(index)) {
        index++;
    }
    return index;
}

export function agentLoginUtf8ByteLength(text: string): number {
    return new TextEncoder().encode(text).length;
}
