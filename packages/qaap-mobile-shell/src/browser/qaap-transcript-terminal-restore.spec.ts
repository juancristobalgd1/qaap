// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    restoreOrCreateTranscriptTerminal,
    sanitizeTranscriptTerminalPersistedWorkspace,
    type RestorableTranscriptTerminal,
} from './qaap-transcript-terminal-restore';

describe('qaap-transcript-terminal-restore', () => {

    it('sanitizeTranscriptTerminalPersistedWorkspace drops invalid ids', () => {
        const sanitized = sanitizeTranscriptTerminalPersistedWorkspace({
            activeIndex: 2,
            terminals: [
                { terminalId: 1, titleLabel: 'ok' },
                { terminalId: -1 },
                { terminalId: Number.NaN },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                { terminalId: '1206332507' as any },
            ],
        });
        expect(sanitized).to.deep.equal({
            activeIndex: 0,
            terminals: [{ terminalId: 1, titleLabel: 'ok' }],
        });
    });

    it('sanitizeTranscriptTerminalPersistedWorkspace returns undefined when empty', () => {
        expect(sanitizeTranscriptTerminalPersistedWorkspace({
            activeIndex: 0,
            terminals: [{ terminalId: -1 }],
        })).to.equal(undefined);
    });

    it('restoreOrCreateTranscriptTerminal reuses a live PTY id', async () => {
        const starts: Array<number | undefined> = [];
        const terminal: RestorableTranscriptTerminal = {
            isDisposed: false,
            title: { label: '', caption: '' },
            start: async (id?: number) => {
                starts.push(id);
                return id ?? 99;
            },
            dispose: () => { /* noop */ },
        };

        const restored = await restoreOrCreateTranscriptTerminal(
            async () => terminal,
            { terminalId: 42, titleLabel: 'Shell' },
        );

        expect(restored).to.equal(terminal);
        expect(starts).to.deep.equal([42]);
        expect(terminal.title.label).to.equal('Shell');
    });

    it('restoreOrCreateTranscriptTerminal starts a fresh PTY when the persisted id is gone', async () => {
        const starts: Array<number | undefined> = [];
        let createCount = 0;
        const disposed: boolean[] = [];

        const createTerminal = async (): Promise<RestorableTranscriptTerminal> => {
            createCount += 1;
            const index = createCount;
            return {
                isDisposed: false,
                title: { label: '', caption: '' },
                start: async (id?: number) => {
                    starts.push(id);
                    if (index === 1 && id === 1206332507) {
                        throw new Error('terminal "1206332507" does not exist');
                    }
                    return id ?? 7;
                },
                dispose: () => {
                    disposed.push(true);
                },
            };
        };

        const restored = await restoreOrCreateTranscriptTerminal(
            createTerminal,
            { terminalId: 1206332507, titleLabel: 'Old' },
        );

        expect(createCount).to.equal(2);
        expect(starts).to.deep.equal([1206332507, undefined]);
        expect(disposed).to.deep.equal([true]);
        expect(restored.title.label).to.equal('Old');
    });
});
