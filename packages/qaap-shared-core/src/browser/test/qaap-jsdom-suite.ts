// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

/**
 * Gives the enclosing `describe` its own jsdom: enabled in `before`, removed in `after`.
 *
 * Specs must not rely on a DOM some other spec file left behind — mocha loads every file before
 * running any suite, so that only works in one file order. Pair it with the load-time pattern:
 *
 * ```ts
 * import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
 * const disableImportJSDOM = enableJSDOM();
 * // ...imports that touch the DOM while loading...
 * disableImportJSDOM();
 *
 * describe('...', () => {
 *     useSuiteJSDOM();
 * });
 * ```
 *
 * A DOM that is already present (an enclosing suite's) is left to its owner.
 */
export function useSuiteJSDOM(): void {
    let disableJSDOM: (() => void) | undefined;
    before(() => {
        disableJSDOM = typeof document === 'undefined' ? enableJSDOM() : undefined;
    });
    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });
}
