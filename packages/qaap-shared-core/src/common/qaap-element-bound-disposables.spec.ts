// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { Disposable } from '@theia/core/lib/common/disposable';
import { QaapElementBoundDisposables } from './qaap-element-bound-disposables';

describe('QaapElementBoundDisposables', () => {
    let clock: number;
    let registry: QaapElementBoundDisposables;

    beforeEach(() => {
        clock = 0;
        registry = new QaapElementBoundDisposables(1000, () => clock);
    });

    function track(element: { isConnected: boolean }): { disposed: () => boolean } {
        let disposed = false;
        registry.add(element, Disposable.create(() => { disposed = true; }));
        return { disposed: () => disposed };
    }

    it('releases subscriptions of detached elements when the next one is registered', () => {
        const old = { isConnected: true };
        const oldSub = track(old);
        old.isConnected = false;
        clock = 5000;
        track({ isConnected: true });
        expect(oldSub.disposed()).to.equal(true);
        expect(registry.size).to.equal(1);
    });

    it('keeps connected elements and elements still inside the attach grace period', () => {
        const connected = track({ isConnected: true });
        const offline = track({ isConnected: false });
        clock = 500;
        track({ isConnected: true });
        expect(connected.disposed()).to.equal(false);
        expect(offline.disposed()).to.equal(false);
        clock = 1500;
        registry.prune();
        expect(offline.disposed()).to.equal(true);
        expect(connected.disposed()).to.equal(false);
    });

    it('stays bounded over many re-renders of the same slot', () => {
        for (let i = 0; i < 200; i++) {
            const element = { isConnected: true };
            track(element);
            element.isConnected = false;
            clock += 2000;
        }
        expect(registry.size).to.be.lessThan(3);
    });

    it('disposes once through the returned handle', () => {
        let count = 0;
        const handle = registry.add({ isConnected: true }, Disposable.create(() => { count++; }));
        handle.dispose();
        handle.dispose();
        expect(count).to.equal(1);
        expect(registry.size).to.equal(0);
    });
});
