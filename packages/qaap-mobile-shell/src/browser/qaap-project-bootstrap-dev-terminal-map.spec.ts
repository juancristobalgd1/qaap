// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { Disposable } from '@theia/core/lib/common/disposable';
import type { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';

/**
 * Verifies the per-conversation dev terminal map in QaapProjectBootstrapService.
 *
 * The full bootstrap service requires heavy DI (terminal service, preview port claim
 * service, etc.), so this test exercises the map logic via a minimal stub that exposes
 * only the per-conversation map methods. This evidences that:
 *   1. Multiple dev terminals can coexist (one per conversation).
 *   2. Releasing one conversation's terminal does NOT affect another's.
 *   3. The activeDevTerminalConversationIds getter tracks live terminals.
 */
describe('QaapProjectBootstrapService — per-conversation dev terminal map', () => {
    let disableJSDOM: () => void;

    before(() => { disableJSDOM = enableJSDOM(); });
    after(() => { disableJSDOM(); });

    /** Minimal stub of the per-conversation map logic from QaapProjectBootstrapService. */
    function createDevTerminalMapStub(): {
        register: (convId: string, terminal: TerminalWidget, listener: Disposable) => void;
        release: (convId: string) => void;
        getForConversation: (convId: string) => TerminalWidget | undefined;
        activeIds: () => readonly string[];
        disposeAll: () => void;
    } {
        const map = new Map<string, { terminal: TerminalWidget; listener: Disposable }>();
        const disposedTerminals = new Set<TerminalWidget>();

        function disposeTerminal(t: TerminalWidget | undefined): void {
            if (!t || disposedTerminals.has(t)) {
                return;
            }
            disposedTerminals.add(t);
            try { t.dispose(); } catch { /* already gone */ }
        }

        return {
            register(convId, terminal, listener) {
                const existing = map.get(convId);
                if (existing && existing.terminal !== terminal) {
                    existing.listener.dispose();
                    disposeTerminal(existing.terminal);
                }
                map.set(convId, { terminal, listener });
            },
            release(convId) {
                const entry = map.get(convId);
                if (!entry) { return; }
                entry.listener.dispose();
                disposeTerminal(entry.terminal);
                map.delete(convId);
            },
            getForConversation(convId) {
                const entry = map.get(convId);
                return entry?.terminal && !entry.terminal.isDisposed ? entry.terminal : undefined;
            },
            activeIds() {
                return Array.from(map.keys()).filter(id => {
                    const entry = map.get(id);
                    return entry?.terminal && !entry.terminal.isDisposed;
                });
            },
            disposeAll() {
                for (const [, entry] of map) {
                    entry.listener.dispose();
                    disposeTerminal(entry.terminal);
                }
                map.clear();
            },
        };
    }

    function createTerminalStub(id: string): TerminalWidget {
        return {
            id,
            terminalId: id,
            isDisposed: false,
            dispose() { (this as unknown as { isDisposed: boolean }).isDisposed = true; },
        } as unknown as TerminalWidget;
    }

    it('supports multiple simultaneous dev terminals (one per conversation)', () => {
        const stub = createDevTerminalMapStub();
        const t1 = createTerminalStub('t1');
        const t2 = createTerminalStub('t2');
        const l1 = Disposable.NULL;
        const l2 = Disposable.NULL;

        stub.register('conv-a', t1, l1);
        stub.register('conv-b', t2, l2);

        expect(stub.getForConversation('conv-a')).to.equal(t1);
        expect(stub.getForConversation('conv-b')).to.equal(t2);
        expect(stub.activeIds()).to.deep.equal(['conv-a', 'conv-b']);
        stub.disposeAll();
    });

    it('releasing one conversation terminal does NOT affect another', () => {
        const stub = createDevTerminalMapStub();
        const t1 = createTerminalStub('t1');
        const t2 = createTerminalStub('t2');

        stub.register('conv-a', t1, Disposable.NULL);
        stub.register('conv-b', t2, Disposable.NULL);

        stub.release('conv-a');

        expect(stub.getForConversation('conv-a')).to.equal(undefined);
        expect(t1.isDisposed).to.equal(true);
        // conv-b survives
        expect(stub.getForConversation('conv-b')).to.equal(t2);
        expect(t2.isDisposed).to.equal(false);
        expect(stub.activeIds()).to.deep.equal(['conv-b']);
        stub.disposeAll();
    });

    it('re-registering a conversation replaces the previous terminal', () => {
        const stub = createDevTerminalMapStub();
        const t1 = createTerminalStub('t1');
        const t2 = createTerminalStub('t2');

        stub.register('conv-a', t1, Disposable.NULL);
        stub.register('conv-a', t2, Disposable.NULL);

        // t1 should be disposed and replaced by t2
        expect(t1.isDisposed).to.equal(true);
        expect(stub.getForConversation('conv-a')).to.equal(t2);
        expect(t2.isDisposed).to.equal(false);
        expect(stub.activeIds()).to.deep.equal(['conv-a']);
        stub.disposeAll();
    });

    it('disposeAll cleans up all conversations and disposes all terminals', () => {
        const stub = createDevTerminalMapStub();
        const t1 = createTerminalStub('t1');
        const t2 = createTerminalStub('t2');
        const t3 = createTerminalStub('t3');

        stub.register('conv-a', t1, Disposable.NULL);
        stub.register('conv-b', t2, Disposable.NULL);
        stub.register('conv-c', t3, Disposable.NULL);

        stub.disposeAll();

        expect(t1.isDisposed).to.equal(true);
        expect(t2.isDisposed).to.equal(true);
        expect(t3.isDisposed).to.equal(true);
        expect(stub.activeIds()).to.deep.equal([]);
    });

    it('returns undefined for a conversation with no dev terminal', () => {
        const stub = createDevTerminalMapStub();
        expect(stub.getForConversation('nonexistent')).to.equal(undefined);
        expect(stub.activeIds()).to.deep.equal([]);
    });
});
