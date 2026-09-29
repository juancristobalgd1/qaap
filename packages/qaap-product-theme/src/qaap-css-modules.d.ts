// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// `import('./style/foo.css?qaap-lazy')` resolves to the URL of foo.css emitted as its own
// content-hashed file (see the `qaap-lazy-css` esbuild plugin and `QaapLazyStylesheets`).
declare module '*?qaap-lazy' {
    const url: string;
    export default url;
}
