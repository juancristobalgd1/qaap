// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * THE display-language switch of the Qaap product (launch audit L1, Oct 2026: English only).
 *
 * Qaap ships English only until the remaining `qaap/*` keys are translated. The i18n
 * infrastructure stays in place (every user-facing string still goes through `nls.localize`,
 * `qaap-spanish-translations.ts` keeps its keys), so re-enabling a language is one edit:
 * add its id here (for example `['en', 'es']`) AND to the `QAAP_SUPPORTED_LOCALES` list at the
 * top of `resources/qaap-login-gate.js` (a spec keeps both lists in sync).
 *
 * With only `'en'` listed:
 * - the login gate rewrites any stored `localeId` (for example a previous `'es'` choice) to
 *   `'en'` before `bundle.js` evaluates `nls.locale` (desktop and mobile both boot through it);
 * - `QaapLocalizationContribution` registers no Qaap overlays (no Spanish keys reach the frontend);
 * - `QaapDisplayLanguageCommandContribution` removes "Configure Display Language".
 *
 * See `doc/qaap-localization.md`.
 */
export namespace QaapSupportedLocales {

    /** The locale Qaap falls back to; its strings are the `nls.localize` default values. */
    export const DEFAULT_LOCALE = 'en';

    /** Display languages users may run Qaap in. */
    export const LOCALES: readonly string[] = [DEFAULT_LOCALE];

    /** Whether any display language besides English is enabled. */
    export function isLocalizationEnabled(locales: readonly string[] = LOCALES): boolean {
        return locales.some(locale => !isEnglish(locale));
    }

    /**
     * Whether `locale` (a Theia language-pack id such as `'es'` or `'pt-br'`, as stored in
     * `localeId`) is enabled. Matches the login gate: exact, case-insensitive.
     */
    export function isSupported(locale: string | undefined, locales: readonly string[] = LOCALES): boolean {
        if (!locale) {
            return false;
        }
        const normalized = locale.toLowerCase();
        return locales.some(candidate => candidate.toLowerCase() === normalized);
    }

    function isEnglish(locale: string): boolean {
        const normalized = locale.toLowerCase();
        return normalized === DEFAULT_LOCALE || normalized.startsWith(`${DEFAULT_LOCALE}-`);
    }
}
