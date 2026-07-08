// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { applyQaapBrandingToText } from './qaap-i18n-branding-rules';
import { QAAP_APPLICATION_DISPLAY_NAME as APP } from './qaap-application-name';

describe('applyQaapBrandingToText', () => {

    it('rebrands "Theia IDE" and "Eclipse Theia" (English)', () => {
        expect(applyQaapBrandingToText('Welcome to Theia IDE', 'en')).to.equal(`Welcome to ${APP}`);
        expect(applyQaapBrandingToText('Built on Eclipse Theia.', 'en')).to.equal(`Built on ${APP}.`);
    });

    it('rewrites "in the Theia IDE" phrasings without leaving a dangling article', () => {
        expect(applyQaapBrandingToText('Open it in the Theia IDE', 'en')).to.equal(`Open it in ${APP}`);
        expect(applyQaapBrandingToText('as described in the Theia IDE documentation', 'en'))
            .to.equal(`as described in the ${APP} documentation`);
    });

    it('maps the legacy product name Nova → the current app name', () => {
        expect(applyQaapBrandingToText('Nova is great', 'en')).to.equal(`${APP} is great`);
    });

    it('rebrands the generic app phrase per locale', () => {
        expect(applyQaapBrandingToText('Restart this application', 'en')).to.equal(`Restart ${APP}`);
        expect(applyQaapBrandingToText('Reinicia esta aplicación', 'es')).to.equal(`Reinicia ${APP}`);
    });

    it('falls back to the default rules for an unknown locale', () => {
        expect(applyQaapBrandingToText('Theia IDE rocks', 'xx-unknown')).to.equal(`${APP} rocks`);
    });

    it('leaves text without Theia branding untouched', () => {
        expect(applyQaapBrandingToText('Hello world', 'en')).to.equal('Hello world');
    });
});
