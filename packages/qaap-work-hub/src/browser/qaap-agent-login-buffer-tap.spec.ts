// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapAgentLoginBufferTap, type QaapAgentLoginTerminalBuffer } from './qaap-agent-login-buffer-tap';

/** A fake xterm screen: text lands on the cursor row, and a newline opens a new (empty) cursor row. */
class FakeTerminal {
    readonly rows: string[] = [''];
    cols: number | undefined = undefined;
    private listeners: Array<(chunk: string) => void> = [];

    get buffer(): QaapAgentLoginTerminalBuffer {
        const rows = this.rows;
        return {
            get length(): number {
                return rows.length;
            },
            getLines(start: number, length: number, trimRight?: boolean): string[] {
                return rows.slice(start, start + length).map(row => trimRight ? row.trimEnd() : row);
            },
        };
    }

    /** Writes a chunk to the screen and emits it on `onOutput`, as Theia does for parsed output. */
    writeLive(text: string): void {
        this.writeSilently(text);
        this.listeners.forEach(listener => listener(text));
    }

    /** Writes to the screen only, as Theia's pre-open flush does (no `onOutput`). */
    writeSilently(text: string): void {
        text.split('\n').forEach((segment, index) => {
            if (index > 0) {
                this.rows.push('');
            }
            this.rows[this.rows.length - 1] += segment;
        });
    }

    onOutput(listener: (chunk: string) => void): void {
        this.listeners.push(listener);
    }
}

describe('QaapAgentLoginBufferTap', () => {

    function createTap(terminal: FakeTerminal, options: { columns?: () => number | undefined } = {}): { tap: QaapAgentLoginBufferTap; fed: string[] } {
        const fed: string[] = [];
        const tap = new QaapAgentLoginBufferTap({
            buffer: () => terminal.buffer,
            feed: text => fed.push(text),
            columns: options.columns,
        });
        return { tap, fed };
    }

    it('feeds output that never reached onOutput, exactly once', () => {
        const terminal = new FakeTerminal();
        const { tap, fed } = createTap(terminal);
        tap.noteOutput();
        terminal.writeSilently('Open this link: https://accounts.example.test/authorize?code=abc\n');
        tap.poll();
        tap.poll();
        expect(fed.join('')).to.contain('https://accounts.example.test/authorize?code=abc');
        expect(fed.length).to.equal(1);
        expect(tap.fedBytes).to.equal(fed.join('').length);
    });

    it('does not duplicate output that onOutput already delivered', () => {
        const terminal = new FakeTerminal();
        const { tap, fed } = createTap(terminal);
        tap.noteOutput();
        terminal.writeLive('Waiting for browser sign-in\n');
        tap.noteOutput();
        tap.poll();
        tap.poll();
        expect(fed).to.deep.equal([]);
        expect(tap.fedBytes).to.equal(0);
    });

    it('feeds only the new screen text after live output, without repeating the live part', () => {
        const terminal = new FakeTerminal();
        const { tap, fed } = createTap(terminal);
        tap.noteOutput();
        terminal.writeLive('first line\n');
        tap.noteOutput();
        terminal.writeSilently('second line\n');
        tap.poll();
        expect(fed.join('')).to.equal('second line\n');
        expect(fed.join('')).to.not.contain('first line');
    });

    it('feeds the rest of a row that was redrawn in place', () => {
        const terminal = new FakeTerminal();
        const { tap, fed } = createTap(terminal);
        tap.noteOutput();
        terminal.writeSilently('Enter code: ab');
        tap.poll();
        terminal.rows[terminal.rows.length - 1] = 'Enter code: abcd';
        tap.poll();
        expect(fed.join('')).to.equal('Enter code: ab' + 'cd');
    });

    it('joins a row that fills the terminal width with the next row, without a newline', () => {
        const terminal = new FakeTerminal();
        terminal.cols = 10;
        const { tap, fed } = createTap(terminal, { columns: () => terminal.cols });
        tap.noteOutput();
        terminal.writeSilently('https://ab\ncdef.test\n');
        tap.poll();
        expect(fed.join('')).to.equal('https://ab' + 'cdef.test\n');
    });

    it('feeds nothing and stops reading after dispose', () => {
        const terminal = new FakeTerminal();
        const { tap, fed } = createTap(terminal);
        tap.noteOutput();
        tap.dispose();
        terminal.writeSilently('late output\n');
        expect(tap.poll()).to.equal(0);
        expect(fed).to.deep.equal([]);
        expect(tap.fedBytes).to.equal(0);
    });

    it('feeds nothing once the terminal is gone', () => {
        let gone = false;
        const terminal = new FakeTerminal();
        const fed: string[] = [];
        const tap = new QaapAgentLoginBufferTap({ buffer: () => gone ? undefined : terminal.buffer, feed: text => fed.push(text) });
        tap.noteOutput();
        terminal.writeSilently('after close\n');
        gone = true;
        tap.poll();
        expect(fed).to.deep.equal([]);
    });

    it('counts UTF-8 bytes, not characters', () => {
        const terminal = new FakeTerminal();
        const { tap } = createTap(terminal);
        tap.noteOutput();
        terminal.writeSilently('é\n');
        tap.poll();
        expect(tap.fedBytes).to.equal(Buffer.byteLength('é\n', 'utf8'));
    });
});
