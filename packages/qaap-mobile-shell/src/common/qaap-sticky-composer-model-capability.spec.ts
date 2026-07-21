// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import { expect } from 'chai';
import {
    DEFAULT_MODEL_CAPABILITY_LEVEL,
    parseStoredModelCapabilityLevel,
    readStoredModelCapabilityLevel,
    reconcileModelCapabilityLevel,
    scopedModelCapabilityStorageKey,
    snapModelCapabilityFraction,
    writeStoredModelCapabilityLevel,
} from './qaap-sticky-composer-model-capability';

describe('qaap-sticky-composer-model-capability', () => {
    const cwd = '/tmp/model-capability-test';

    beforeEach(() => {
        window.localStorage.clear();
    });

    it('reconciles current, stored, then default level', () => {
        expect(reconcileModelCapabilityLevel(2, cwd)).to.equal(2);
        writeStoredModelCapabilityLevel(cwd, 0);
        expect(reconcileModelCapabilityLevel(undefined, cwd)).to.equal(0);
        expect(reconcileModelCapabilityLevel(undefined, undefined)).to.equal(DEFAULT_MODEL_CAPABILITY_LEVEL);
    });

    it('persists numeric values and reads legacy id aliases', () => {
        writeStoredModelCapabilityLevel(cwd, 3);
        expect(window.localStorage.getItem(scopedModelCapabilityStorageKey(cwd))).to.equal('3');
        expect(readStoredModelCapabilityLevel(cwd)).to.equal(3);
    });

    it('maps legacy reasoning names and ids for backwards compatibility', () => {
        expect(parseStoredModelCapabilityLevel('light')).to.equal(0);
        expect(parseStoredModelCapabilityLevel('standard')).to.equal(1);
        expect(parseStoredModelCapabilityLevel('deep')).to.equal(2);
        expect(parseStoredModelCapabilityLevel('max')).to.equal(3);
        expect(parseStoredModelCapabilityLevel('medium')).to.equal(1);
        expect(parseStoredModelCapabilityLevel('high')).to.equal(2);
    });

    it('snaps slider fractions to the nearest discrete level', () => {
        expect(snapModelCapabilityFraction(0)).to.equal(0);
        expect(snapModelCapabilityFraction(0.16)).to.equal(0);
        expect(snapModelCapabilityFraction(0.34)).to.equal(1);
        expect(snapModelCapabilityFraction(0.66)).to.equal(2);
        expect(snapModelCapabilityFraction(1)).to.equal(3);
    });
});
