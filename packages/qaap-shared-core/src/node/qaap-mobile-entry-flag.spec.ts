// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { isQaapMobileEntryEnabled, qaapMobileEntryProbeFields } from './qaap-mobile-entry-flag';

describe('QAAP_MOBILE_ENTRY flag', () => {
    it('is on by default, also when set empty (docker-compose passes an empty value)', () => {
        expect(isQaapMobileEntryEnabled({})).to.equal(true);
        expect(qaapMobileEntryProbeFields({})).to.deep.equal({ mobileEntry: true });
        expect(qaapMobileEntryProbeFields({ QAAP_MOBILE_ENTRY: '' })).to.deep.equal({ mobileEntry: true });
        for (const value of ['1', 'true', 'ON', ' yes ']) {
            expect(qaapMobileEntryProbeFields({ QAAP_MOBILE_ENTRY: value })).to.deep.equal({ mobileEntry: true });
        }
    });

    it('turns off for 0/false/off/no and then adds nothing to the probe responses', () => {
        for (const value of ['0', 'false', 'OFF', ' no ']) {
            expect(isQaapMobileEntryEnabled({ QAAP_MOBILE_ENTRY: value })).to.equal(false);
            expect(qaapMobileEntryProbeFields({ QAAP_MOBILE_ENTRY: value })).to.deep.equal({});
        }
    });
});
