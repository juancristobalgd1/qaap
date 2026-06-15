// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { applyQaapBrandingToText } from './qaap-i18n-branding-rules';

describe('qaap-i18n-branding-rules', () => {

    it('replaces Eclipse Theia with the product name in default locale rules', () => {
        expect(applyQaapBrandingToText('Welcome to Eclipse Theia', 'en')).to.contain('Qaap');
        expect(applyQaapBrandingToText('Welcome to Eclipse Theia', 'en')).not.to.contain('Eclipse Theia');
    });

});
