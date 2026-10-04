// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type {} from 'highlight.js';

/**
 * Startup-size replacement for `highlight.js`, wired in by the bundle-shim alias in
 * `examples/browser/esbuild.mjs`. Upstream `@theia/preview` imports the full `highlight.js` entry,
 * which registers all 190 languages (about 1 MB of startup JavaScript, evaluated on every start in the
 * IDE and the Work Hub alike) only to colour fenced code blocks in the Markdown preview. This module
 * exports the same `hljs` instance shape with the common languages registered; fences in any other
 * language render as plain code, which is the preview's existing fallback for unknown languages.
 */
import hljs = require('highlight.js/lib/core');
import { QAAP_HIGHLIGHT_LANGUAGES } from './qaap-highlight-languages';

for (const [name, language] of QAAP_HIGHLIGHT_LANGUAGES) {
    hljs.registerLanguage(name, language);
}

export = hljs;
