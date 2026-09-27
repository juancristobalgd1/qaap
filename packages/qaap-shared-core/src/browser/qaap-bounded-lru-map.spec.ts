// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapBoundedLruMap } from './qaap-bounded-lru-map';

describe('QaapBoundedLruMap', () => {
    it('never exceeds the limit and evicts the least-recently-used key', () => {
        const map = new QaapBoundedLruMap<string, number>(2);
        map.set('a', 1);
        map.set('b', 2);
        map.set('c', 3); // evicts 'a' (oldest)
        expect(map.size).to.equal(2);
        expect(map.has('a')).to.equal(false);
        expect(map.get('b')).to.equal(2);
        expect(map.get('c')).to.equal(3);
    });

    it('get() marks a key as most-recently-used so it survives the next eviction', () => {
        const map = new QaapBoundedLruMap<string, number>(2);
        map.set('a', 1);
        map.set('b', 2);
        expect(map.get('a')).to.equal(1); // touch 'a' → 'b' is now oldest
        map.set('c', 3); // evicts 'b', not 'a'
        expect(map.has('a')).to.equal(true);
        expect(map.has('b')).to.equal(false);
        expect(map.has('c')).to.equal(true);
    });

    it('re-setting an existing key updates the value without growing size', () => {
        const map = new QaapBoundedLruMap<string, number>(2);
        map.set('a', 1);
        map.set('b', 2);
        map.set('a', 9);
        expect(map.size).to.equal(2);
        expect(map.get('a')).to.equal(9);
    });

    it('behaves as a plain Map for delete/has/get on a missing key', () => {
        const map = new QaapBoundedLruMap<string, number>(3);
        map.set('a', 1);
        expect(map.delete('a')).to.equal(true);
        expect(map.get('a')).to.equal(undefined);
        expect(map.has('a')).to.equal(false);
    });
});
