// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_COMPOSER_SUBMIT_MODE_ID } from './qaap-composer-until-done';

describe('qaap-composer-until-done', () => {
    it('submits every task in the agent mode', () => {
        expect(QAAP_COMPOSER_SUBMIT_MODE_ID).to.equal('agent');
    });
});
