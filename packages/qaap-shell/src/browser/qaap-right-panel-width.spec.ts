// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapRightPanelWidth } from './qaap-right-panel-width';

describe('QaapRightPanelWidth.defaultWidth', () => {

    it('takes about a third of the shell width', () => {
        expect(QaapRightPanelWidth.defaultWidth(1600)).to.equal(544);
        expect(QaapRightPanelWidth.defaultWidth(1400)).to.equal(476);
    });

    it('never goes below the minimum on narrow windows', () => {
        expect(QaapRightPanelWidth.defaultWidth(1000)).to.equal(440);
        expect(QaapRightPanelWidth.defaultWidth(0)).to.equal(440);
    });

    it('never goes above the maximum on wide windows', () => {
        expect(QaapRightPanelWidth.defaultWidth(2560)).to.equal(640);
    });
});
