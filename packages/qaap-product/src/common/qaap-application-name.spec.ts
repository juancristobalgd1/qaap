// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_APPLICATION_DISPLAY_NAME } from './qaap-application-name';

describe('QAAP_APPLICATION_DISPLAY_NAME', () => {
    it('is the Qaap product display name', () => {
        expect(QAAP_APPLICATION_DISPLAY_NAME).to.equal('Qaap');
    });
});
