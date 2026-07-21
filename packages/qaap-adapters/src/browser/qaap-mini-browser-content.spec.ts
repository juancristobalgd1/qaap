// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

let disableJSDOM = enableJSDOM();

import { expect } from 'chai';
import { getQaapPreviewFrameSlot } from './qaap-mini-browser-frame-lifecycle';

disableJSDOM();

describe('Qaap mini-browser frame lifecycle', () => {

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM();
    });

    it('defers annotation mounting while the base constructor has not assigned the frame', () => {
        expect(getQaapPreviewFrameSlot(undefined)).to.equal(undefined);
    });

    it('returns the frame slot after content-area construction', () => {
        const frameSlot = document.createElement('div');
        const frame = document.createElement('iframe');
        frameSlot.append(frame);
        expect(getQaapPreviewFrameSlot(frame)).to.equal(frameSlot);
    });
});
