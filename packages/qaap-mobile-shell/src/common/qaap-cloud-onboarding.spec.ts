// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { isQaapCloudOnboarding } from './qaap-cloud-onboarding';

describe('isQaapCloudOnboarding', () => {

    it('returns a boolean for the current runtime', () => {
        expect(isQaapCloudOnboarding()).to.be.a('boolean');
    });
});
