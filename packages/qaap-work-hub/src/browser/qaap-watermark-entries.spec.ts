// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_WATERMARK_ENTRY_DEFS, shouldRenderQaapWatermark } from './qaap-watermark-entries';

describe('qaap-watermark-entries', () => {

    it('uses English product labels', () => {
        expect(QAAP_WATERMARK_ENTRY_DEFS.map(entry => entry.defaultLabel)).to.deep.equal([
            'Open chat',
            'Hide terminal',
            'Show files',
            'Go to file',
            'Open browser',
            'Maximize chat',
        ]);
    });

    describe('shouldRenderQaapWatermark', () => {
        it('renders on desktop when the main area is empty', () => {
            expect(shouldRenderQaapWatermark({ mobileLayout: false, mainAreaEmpty: true, projectsPanelVisible: false })).to.equal(true);
        });

        it('never renders in mobile mode, even with an empty main area', () => {
            expect(shouldRenderQaapWatermark({ mobileLayout: true, mainAreaEmpty: true, projectsPanelVisible: false })).to.equal(false);
        });

        it('does not render with editors open or the projects panel visible', () => {
            expect(shouldRenderQaapWatermark({ mobileLayout: false, mainAreaEmpty: false, projectsPanelVisible: false })).to.equal(false);
            expect(shouldRenderQaapWatermark({ mobileLayout: false, mainAreaEmpty: true, projectsPanelVisible: true })).to.equal(false);
        });
    });
});
