// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    buildQaapWorkHubShellSnapshot,
    clearQaapWorkHubShellSnapshot,
    QAAP_WORK_HUB_SHELL_SNAPSHOT_KEY,
    QaapWorkHubShellSnapshotWriter,
    writeQaapWorkHubShellSnapshot,
} from './qaap-work-hub-shell-snapshot';

interface WindowHost {
    window?: { localStorage?: Storage };
}

describe('qaap work hub shell snapshot', () => {
    const host = globalThis as WindowHost;
    const originalWindow = host.window;
    let items: Map<string, string>;
    let writes: number;

    beforeEach(() => {
        items = new Map();
        writes = 0;
        const localStorage = {
            getItem: (key: string) => items.get(key) ?? null,
            setItem: (key: string, value: string) => { writes++; items.set(key, value); },
            removeItem: (key: string) => { items.delete(key); },
        } as unknown as Storage;
        host.window = originalWindow ?? ({} as WindowHost['window']);
        Object.defineProperty(host.window, 'localStorage', { value: localStorage, configurable: true });
        clearQaapWorkHubShellSnapshot();
    });

    afterEach(() => {
        if (originalWindow) {
            delete (originalWindow as { localStorage?: Storage }).localStorage;
        } else {
            delete host.window;
        }
    });

    it('caps the list at 12 named entries and truncates text to 80 characters', () => {
        const long = 'x'.repeat(120);
        const projects = [{ name: '  ' }, ...Array.from({ length: 20 }, (_, i) => ({ name: `${long}${i}`, subtitle: i === 0 ? long : undefined }))];
        const snapshot = buildQaapWorkHubShellSnapshot(projects, 'alice', 42);
        expect(snapshot.login).to.equal('alice');
        expect(snapshot.v).to.equal(1);
        expect(snapshot.savedAt).to.equal(42);
        expect(snapshot.projects).to.have.length(12);
        expect(snapshot.projects[0].name).to.have.length(80);
        expect(snapshot.projects[0].subtitle).to.have.length(80);
        expect(snapshot.projects[1]).to.not.have.property('subtitle');
    });

    it('writes the contract JSON and skips unchanged rewrites', () => {
        writeQaapWorkHubShellSnapshot([{ name: 'demo', subtitle: 'acme/demo' }], 'alice');
        writeQaapWorkHubShellSnapshot([{ name: 'demo', subtitle: 'acme/demo' }], 'alice');
        expect(writes).to.equal(1);
        const stored = JSON.parse(items.get(QAAP_WORK_HUB_SHELL_SNAPSHOT_KEY)!);
        expect(stored.v).to.equal(1);
        expect(stored.savedAt).to.be.a('number');
        expect(stored.login).to.equal('alice');
        expect(stored.projects).to.deep.equal([{ name: 'demo', subtitle: 'acme/demo' }]);
        clearQaapWorkHubShellSnapshot();
        expect(items.has(QAAP_WORK_HUB_SHELL_SNAPSHOT_KEY)).to.equal(false);
    });

    it('writes nothing without a signed-in login (the gate would reject it)', () => {
        writeQaapWorkHubShellSnapshot([{ name: 'demo' }], undefined);
        writeQaapWorkHubShellSnapshot([{ name: 'demo' }], '  ');
        expect(items.has(QAAP_WORK_HUB_SHELL_SNAPSHOT_KEY)).to.equal(false);
    });

    it('never throws when storage fails', () => {
        Object.defineProperty(host.window, 'localStorage', {
            get: () => { throw new Error('denied'); },
            configurable: true,
        });
        expect(() => writeQaapWorkHubShellSnapshot([{ name: 'demo' }], 'alice')).to.not.throw();
        expect(() => clearQaapWorkHubShellSnapshot()).to.not.throw();
    });

    it('coalesces burst renders into one write with the latest list', async () => {
        const writer = new QaapWorkHubShellSnapshotWriter(5);
        writer.schedule([{ name: 'a' }], 'alice');
        writer.schedule([{ name: 'b' }], 'alice');
        await new Promise<void>(resolve => setTimeout(resolve, 20));
        expect(writes).to.equal(1);
        expect(JSON.parse(items.get(QAAP_WORK_HUB_SHELL_SNAPSHOT_KEY)!).projects).to.deep.equal([{ name: 'b' }]);
        writer.schedule([{ name: 'c' }], 'alice');
        writer.dispose();
        await new Promise<void>(resolve => setTimeout(resolve, 20));
        expect(writes).to.equal(1);
    });
});
