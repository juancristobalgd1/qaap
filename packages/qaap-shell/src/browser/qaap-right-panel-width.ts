// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Default width of the IDE right panel (agent chat) the first time it opens. A saved width always wins,
 * so this only applies when no size was stored for the panel yet.
 */
export namespace QaapRightPanelWidth {
    /** Share of the shell width the panel takes by default. */
    export const RATIO = 0.34;
    export const MIN_PX = 440;
    export const MAX_PX = 640;

    /** Width in pixels for a shell of `shellWidth` pixels, kept between {@link MIN_PX} and {@link MAX_PX}. */
    export function defaultWidth(shellWidth: number): number {
        const proportional = Math.round(shellWidth * RATIO);
        return Math.min(MAX_PX, Math.max(MIN_PX, proportional));
    }
}
