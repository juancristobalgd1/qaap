// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Startup-size replacement for `date-fns/locale`, wired in by the bundle-shim alias in
 * `examples/browser/esbuild.mjs`. Upstream `@theia/ai-chat-ui` (`chat-date-utils.ts`) does
 * `import * as locales from 'date-fns/locale'` and looks up `locales[nls.locale] ?? locales.enUS`,
 * which pulls every date-fns locale (about 0.9 MB) into startup. Theia language packs use ids such as
 * `de`, `es` or `zh-cn`; only ids that are also date-fns export names can ever match, so this module
 * exports exactly those plus the `enUS` fallback. The lookup result is unchanged for every locale.
 */
export { enUS } from 'date-fns/locale/en-US';
export { cs } from 'date-fns/locale/cs';
export { de } from 'date-fns/locale/de';
export { es } from 'date-fns/locale/es';
export { fr } from 'date-fns/locale/fr';
export { hu } from 'date-fns/locale/hu';
export { it } from 'date-fns/locale/it';
export { ja } from 'date-fns/locale/ja';
export { ko } from 'date-fns/locale/ko';
export { pl } from 'date-fns/locale/pl';
export { ru } from 'date-fns/locale/ru';
export { tr } from 'date-fns/locale/tr';
export type { Locale } from 'date-fns';
