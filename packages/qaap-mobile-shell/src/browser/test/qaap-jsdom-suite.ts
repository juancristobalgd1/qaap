// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// Shared by every qaap-* package whose specs need a DOM. It lives in qaap-mobile-shell because that
// is the lowest qaap package (no qaap dependencies) that all of them already depend on.

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

/**
 * Gives the enclosing `describe` its own jsdom: enabled in `before`, removed in `after`.
 *
 * Specs must not rely on a DOM some other spec file left behind — mocha loads every file before
 * running any suite, so that only works in one file order. Pair it with the load-time pattern
 * (enforced by `scripts/qaap-spec-jsdom-check.js`):
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

/**
 * Replaces `requestAnimationFrame` / `cancelAnimationFrame` (on `window` and `globalThis`) with a
 * `setTimeout(0)` stub for each test of the enclosing `describe`. Frames still pending after a test
 * are cancelled, so none fires once the suite's DOM is gone, and the previous globals are restored
 * after the suite so the stub never leaks into later spec files. Call it after {@link useSuiteJSDOM}.
 */
export function useSuiteAnimationFrameStub(): void {
    const pendingFrames = new Set<ReturnType<typeof setTimeout>>();
    let previous: Pick<typeof globalThis, 'requestAnimationFrame' | 'cancelAnimationFrame'> | undefined;
    before(() => {
        previous = {
            requestAnimationFrame: globalThis.requestAnimationFrame,
            cancelAnimationFrame: globalThis.cancelAnimationFrame,
        };
    });
    beforeEach(() => {
        const raf = (callback: FrameRequestCallback): number => {
            const handle = setTimeout(() => {
                pendingFrames.delete(handle);
                callback(performance.now());
            }, 0);
            pendingFrames.add(handle);
            return handle as unknown as number;
        };
        const caf = (handle: number): void => {
            const timer = handle as unknown as ReturnType<typeof setTimeout>;
            pendingFrames.delete(timer);
            clearTimeout(timer);
        };
        window.requestAnimationFrame = raf;
        window.cancelAnimationFrame = caf;
        globalThis.requestAnimationFrame = raf;
        globalThis.cancelAnimationFrame = caf;
    });
    afterEach(() => {
        pendingFrames.forEach(handle => clearTimeout(handle));
        pendingFrames.clear();
    });
    after(() => {
        globalThis.requestAnimationFrame = previous!.requestAnimationFrame;
        globalThis.cancelAnimationFrame = previous!.cancelAnimationFrame;
    });
}
