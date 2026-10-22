// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// Allow dynamic `import('./style/foo.css')` for lazy-loaded CSS chunks.
// Static CSS imports are handled by webpack at bundle time; this declaration
// lets TypeScript resolve CSS modules in dynamic import() expressions.
declare module '*.css';

// `import('./style/foo.css?qaap-lazy')` resolves to the URL of foo.css emitted as its own
// content-hashed file (see the `qaap-lazy-css` esbuild plugin and `QaapLazyStylesheets`).
declare module '*?qaap-lazy' {
    const url: string;
    export default url;
}

// Same, for lazy sheets the Work Hub landing needs at first paint: the login gate attaches them
// with the bundle stylesheet (see the `qaap-lazy-css` esbuild plugin).
declare module '*?qaap-lazy-boot' {
    const url: string;
    export default url;
}
