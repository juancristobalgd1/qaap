// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Startup-time replacement for `perfect-scrollbar`, wired in by the bundle-shim alias in
 * `examples/browser/esbuild.mjs`. Every Theia `ReactWidget`, `TreeWidget`, view-container part and
 * tab bar builds a PerfectScrollbar when it is attached, and each constructor forces several style
 * recalculations and layouts (`getComputedStyle` on both rails, `display` toggles, `updateGeometry`).
 * During startup Lumino attaches dozens of widgets, most of them hidden, so these forced layouts
 * cost about a second on the critical path of both the IDE and the Work Hub.
 *
 * While the Theia splash (`.theia-preload`) is still covering the app, this class records the
 * request and builds the real scrollbar after the shell is revealed, a few instances per time slice.
 * Nothing can be seen or scrolled under the splash, so the end state is the same. Once the
 * splash is gone, construction is immediate and identical to upstream.
 */
import RealPerfectScrollbar = require('perfect-scrollbar/dist/perfect-scrollbar.common.js');

/** Longest a startup scrollbar waits, even if the splash is never hidden. */
const QAAP_DEFERRED_SCROLLBAR_MAX_WAIT_MS = 15_000;
/** Main-thread budget per slice spent building deferred scrollbars. */
const QAAP_DEFERRED_SCROLLBAR_SLICE_MS = 8;
const QAAP_DEFERRED_SCROLLBAR_POLL_MS = 100;

export default class QaapDeferredPerfectScrollbar {

    protected static pending: QaapDeferredPerfectScrollbar[] = [];
    protected static flushScheduled = false;
    protected static firstDeferredAt = 0;

    protected real: RealPerfectScrollbar | undefined;
    protected destroyed = false;

    constructor(protected readonly target: string | Element, protected readonly options?: RealPerfectScrollbar.Options) {
        if (QaapDeferredPerfectScrollbar.isStartupSplashVisible()) {
            QaapDeferredPerfectScrollbar.defer(this);
        } else {
            this.real = new RealPerfectScrollbar(target, options);
        }
    }

    get element(): HTMLElement | undefined {
        return this.real?.element;
    }

    get isAlive(): boolean {
        return this.real ? this.real.isAlive : !this.destroyed;
    }

    /** Whether the real scrollbar exists yet (false only during startup). */
    get isCreated(): boolean {
        return !!this.real;
    }

    update(): void {
        // A deferred scrollbar measures its geometry when it is built, so an earlier update is not needed.
        this.real?.update();
    }

    destroy(): void {
        this.destroyed = true;
        if (this.real) {
            this.real.destroy();
            this.real = undefined;
        } else {
            QaapDeferredPerfectScrollbar.pending = QaapDeferredPerfectScrollbar.pending.filter(item => item !== this);
        }
    }

    protected create(): void {
        if (!this.destroyed && !this.real) {
            this.real = new RealPerfectScrollbar(this.target, this.options);
        }
    }

    static isStartupSplashVisible(): boolean {
        if (typeof document === 'undefined') {
            return false;
        }
        const splash = document.querySelector('.theia-preload');
        return !!splash && !splash.classList.contains('theia-hidden');
    }

    protected static defer(scrollbar: QaapDeferredPerfectScrollbar): void {
        if (this.pending.length === 0) {
            this.firstDeferredAt = Date.now();
        }
        this.pending.push(scrollbar);
        this.scheduleFlush();
    }

    protected static scheduleFlush(): void {
        if (this.flushScheduled) {
            return;
        }
        this.flushScheduled = true;
        setTimeout(() => {
            this.flushScheduled = false;
            this.flush();
        }, QAAP_DEFERRED_SCROLLBAR_POLL_MS);
    }

    /** Builds pending scrollbars once the splash is gone, within a small time budget per slice. */
    static flush(): void {
        const waitedTooLong = Date.now() - this.firstDeferredAt >= QAAP_DEFERRED_SCROLLBAR_MAX_WAIT_MS;
        if (this.isStartupSplashVisible() && !waitedTooLong) {
            this.scheduleFlush();
            return;
        }
        const sliceStart = Date.now();
        while (this.pending.length > 0 && Date.now() - sliceStart < QAAP_DEFERRED_SCROLLBAR_SLICE_MS) {
            this.pending.shift()!.create();
        }
        if (this.pending.length > 0) {
            this.scheduleFlush();
        }
    }
}
