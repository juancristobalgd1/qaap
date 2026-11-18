// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapWindowResizeGate } from './qaap-window-resize-gate';

describe('QaapWindowResizeGate', () => {
    it('lets a real resize through once and ignores synthetic resizes that keep the window size', () => {
        const gate = new QaapWindowResizeGate();
        expect(gate.accept(1920, 1080)).to.equal(true);
        // The sidebar's synthetic resize on every frame: same size, no layout pass, no new resize.
        for (let frame = 0; frame < 120; frame++) {
            expect(gate.accept(1920, 1080)).to.equal(false);
        }
        expect(gate.accept(1280, 1080)).to.equal(true);
        expect(gate.accept(1280, 720)).to.equal(true);
        expect(gate.accept(1280, 720)).to.equal(false);
    });
});
