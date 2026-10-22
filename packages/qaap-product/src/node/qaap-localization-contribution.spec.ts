// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { LazyLocalization } from '@theia/core/lib/node/i18n/localization-provider';
import { LocalizationRegistry } from '@theia/core/lib/node/i18n/localization-contribution';
import { QaapLocalizationContribution } from './qaap-localization-contribution';
import { QAAP_SPANISH_TRANSLATIONS } from '../common/qaap-spanish-translations';

class SpanishEnabledLocalizationContribution extends QaapLocalizationContribution {
    protected override readonly supportedLocales: readonly string[] = ['en', 'es'];
}

async function registered(contribution: QaapLocalizationContribution): Promise<LazyLocalization[]> {
    const localizations: LazyLocalization[] = [];
    const registry = {
        registerLocalization: (localization: LazyLocalization) => localizations.push(localization),
    } as unknown as LocalizationRegistry;
    await contribution.registerLocalizations(registry);
    return localizations;
}

describe('QaapLocalizationContribution', () => {

    it('registers no Qaap translations while Qaap ships English only', async () => {
        expect(await registered(new QaapLocalizationContribution())).to.deep.equal([]);
    });

    it('registers the Spanish translations once Spanish is re-enabled', async () => {
        const localizations = await registered(new SpanishEnabledLocalizationContribution());
        expect(localizations.map(localization => localization.languageId)).to.deep.equal(['es']);
        const translations = await localizations[0].getTranslations();
        const [key, value] = Object.entries(QAAP_SPANISH_TRANSLATIONS)[0];
        expect(translations[key]).to.equal(value);
    });
});
