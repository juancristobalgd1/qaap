// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { LocalizationContribution, LocalizationRegistry } from '@theia/core/lib/node/i18n/localization-contribution';
import { QAAP_BRANDING_LOCALES, buildQaapBrandingOverlay } from './qaap-i18n-branding';
import { QAAP_SPANISH_TRANSLATIONS } from '../common/qaap-spanish-translations';
import { QaapSupportedLocales } from '../common/qaap-supported-locales';

/**
 * Merges Qaap-specific wording over core nls packs (registered after Theia), for the display
 * languages enabled in {@link QaapSupportedLocales}. Qaap ships English only (audit L1), so by
 * default nothing is registered; the Spanish keys stay in `qaap-spanish-translations.ts`.
 */
@injectable()
export class QaapLocalizationContribution implements LocalizationContribution {

    /** Display languages to register overlays for; tests override it. */
    protected readonly supportedLocales: readonly string[] = QaapSupportedLocales.LOCALES;

    async registerLocalizations(registry: LocalizationRegistry): Promise<void> {
        for (const languageId of QAAP_BRANDING_LOCALES) {
            if (!QaapSupportedLocales.isSupported(languageId, this.supportedLocales)) {
                continue;
            }
            registry.registerLocalization({
                languageId,
                getTranslations: async () => ({
                    ...await buildQaapBrandingOverlay(languageId),
                    ...(languageId === 'es' ? QAAP_SPANISH_TRANSLATIONS : {})
                })
            });
        }
    }
}
