// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { isQaapMobileEntryEnabled, qaapMobileEntryProbeFields } from './qaap-mobile-entry-flag';

describe('QAAP_MOBILE_ENTRY flag', () => {
    it('is off by default and adds nothing to the probe responses', () => {
        expect(isQaapMobileEntryEnabled({})).to.equal(false);
        expect(qaapMobileEntryProbeFields({})).to.deep.equal({});
        expect(qaapMobileEntryProbeFields({ QAAP_MOBILE_ENTRY: '0' })).to.deep.equal({});
        expect(qaapMobileEntryProbeFields({ QAAP_MOBILE_ENTRY: 'false' })).to.deep.equal({});
    });

    it('turns on for 1/true/on/yes', () => {
        for (const value of ['1', 'true', 'ON', ' yes ']) {
            expect(qaapMobileEntryProbeFields({ QAAP_MOBILE_ENTRY: value })).to.deep.equal({ mobileEntry: true });
        }
    });
});
