// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Lets the shell's window-resize handler react only when the window really changed size.
 *
 * The desktop sessions sidebar dispatches synthetic `resize` events so Lumino split panels
 * re-measure; the shell handler answered each one by syncing the sidebar layout, which dispatched
 * another synthetic `resize` on the next frame. With the right panel open that loop ran every frame
 * forever (≈25–30 % renderer CPU at rest, ~290 widget relayouts per frame). A synthetic event leaves
 * the window size unchanged, so it no longer re-enters the layout pass.
 */
export class QaapWindowResizeGate {
    protected lastSize: string | undefined;

    accept(width: number, height: number): boolean {
        const size = `${width}x${height}`;
        if (size === this.lastSize) {
            return false;
        }
        this.lastSize = size;
        return true;
    }
}
