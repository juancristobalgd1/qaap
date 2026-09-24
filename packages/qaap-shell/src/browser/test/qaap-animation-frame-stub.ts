// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * jsdom has no `requestAnimationFrame`; give the enclosing `describe` a macrotask-backed one
 * (Theia's `animationFrame()` awaits it). A real implementation already present is kept.
 */
export function useAnimationFrameStub(): void {
    const scope = globalThis as { requestAnimationFrame?: (callback: FrameRequestCallback) => number };
    let installed = false;
    before(() => {
        if (typeof scope.requestAnimationFrame !== 'function') {
            scope.requestAnimationFrame = callback => setTimeout(() => callback(Date.now()), 0) as unknown as number;
            installed = true;
        }
    });
    after(() => {
        if (installed) {
            delete scope.requestAnimationFrame;
            installed = false;
        }
    });
}
