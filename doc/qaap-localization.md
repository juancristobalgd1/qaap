# Qaap localization

## Current policy: English only (launch audit L1, Oct 2026)

Qaap ships a single display language, English, regardless of the browser/OS locale or a
display language a user picked earlier. The Spanish overlay covered ~300 of the ~1,650 `qaap/*`
keys, so a Spanish-locale user saw a mixed interface; until the remaining keys are translated,
every user gets a consistent English UI.

The i18n infrastructure stays in place: every user-facing string still goes through
`nls.localize`, and `packages/qaap-product/src/common/qaap-spanish-translations.ts` keeps its keys
and its spec.

## How the locale is chosen

Theia reads the display language from `localStorage['localeId']` into `nls.locale` while
`bundle.js` evaluates; the frontend then loads that language's translations from the backend
`LocalizationRegistry`. The switch is enforced at three points, all in `@theia/qaap-product`:

| Where | What it does while only `'en'` is supported |
|---|---|
| `resources/qaap-login-gate.js` (`QAAP_SUPPORTED_LOCALES`) | Runs before `bundle.js` / `bundle-mobile.js` on desktop and mobile; rewrites an unsupported stored `localeId` (for example `'es'`) to `'en'` and sets `<html lang>`. |
| `src/node/qaap-localization-contribution.ts` | Registers no Qaap translation overlays (Spanish keys and the localized branding overlays are not served). |
| `src/browser/qaap-display-language-command-contribution.ts` | Removes core's "Configure Display Language" command, which could only reload back into English. |

Date and number formatting in Qaap UI code passes `nls.locale ?? nls.defaultLocale` to `Intl`
/ `toLocale*String`, so it follows the display language (English today) instead of the browser
locale. Speech dictation (`navigator.language`) intentionally keeps the user's spoken language.
Server-produced messages are English.

## Re-enabling a language

1. Add the Theia language-pack id (for example `'es'`) to `QaapSupportedLocales.LOCALES` in
   `packages/qaap-product/src/common/qaap-supported-locales.ts`.
2. Add the same id to `QAAP_SUPPORTED_LOCALES` at the top of
   `packages/qaap-product/resources/qaap-login-gate.js` (`qaap-supported-locales.spec.ts` fails
   if the two lists differ).
3. Update the specs that pin English only (`qaap-supported-locales.spec.ts`,
   `qaap-localization-contribution.spec.ts`, `qaap-display-language-command-contribution.spec.ts`)
   and complete the language's `qaap/*` coverage before shipping it.

The language picker reappears automatically once any non-English locale is listed.
