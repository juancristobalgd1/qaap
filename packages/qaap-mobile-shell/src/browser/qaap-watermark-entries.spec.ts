// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_WATERMARK_ENTRY_DEFS } from './qaap-watermark-entries';

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
});
