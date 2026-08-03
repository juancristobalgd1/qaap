// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// Allow dynamic `import('./style/foo.css')` for lazy-loaded CSS chunks.
// Static CSS imports are handled by webpack at bundle time; this declaration
// lets TypeScript resolve CSS modules in dynamic import() expressions.
declare module '*.css';
