// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Disposable } from '@theia/core/lib/common/disposable';
import { FrontendApplicationStateService } from '@theia/core/lib/browser/frontend-application-state';

/** Upper bound for `requestIdleCallback`: a busy main thread must not postpone the work forever. */
const IDLE_TIMEOUT_MS = 5_000;
/** Fallback delay where `requestIdleCallback` is unavailable (Safari). */
const IDLE_FALLBACK_DELAY_MS = 1_500;

type IdleWindow = Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
};

/**
 * Runs non-critical boot work (status fetches, warm-ups, push registration) only after the app
 * reached `ready` and the main thread is idle, so it never competes with first paint / Work Hub
 * restore. Same approach as `QaapAgentCliUpdateContribution` (ready + deferred timer).
 */
@injectable()
export class QaapDeferredStartup {

    @inject(FrontendApplicationStateService)
    protected readonly stateService: FrontendApplicationStateService;

    /** Schedule `task` after `ready` + idle. Disposing before it ran cancels it. */
    whenReadyAndIdle(task: () => void): Disposable {
        let cancelled = false;
        let cancelScheduled: (() => void) | undefined;
        void this.stateService.reachedState('ready').then(() => {
            if (cancelled) {
                return;
            }
            cancelScheduled = this.scheduleIdle(() => {
                if (!cancelled) {
                    task();
                }
            });
        });
        return Disposable.create(() => {
            cancelled = true;
            cancelScheduled?.();
        });
    }

    protected scheduleIdle(callback: () => void): () => void {
        const idleWindow = window as IdleWindow;
        if (typeof idleWindow.requestIdleCallback === 'function') {
            const handle = idleWindow.requestIdleCallback(callback, { timeout: IDLE_TIMEOUT_MS });
            return () => idleWindow.cancelIdleCallback?.(handle);
        }
        const handle = window.setTimeout(callback, IDLE_FALLBACK_DELAY_MS);
        return () => window.clearTimeout(handle);
    }
}

/**
 * `setInterval` that skips ticks while the tab is hidden and runs one tick as soon as the tab
 * becomes visible again (so state is fresh when the user returns without background polling).
 */
export class QaapVisibleInterval implements Disposable {

    protected timer: number | undefined;
    protected readonly onVisibilityChange = (): void => {
        if (document.visibilityState === 'visible') {
            this.tick();
        }
    };

    constructor(protected readonly callback: () => void, protected readonly intervalMs: number) {
        this.timer = window.setInterval(() => {
            if (document.visibilityState !== 'hidden') {
                this.tick();
            }
        }, intervalMs);
        document.addEventListener('visibilitychange', this.onVisibilityChange);
    }

    dispose(): void {
        if (this.timer !== undefined) {
            window.clearInterval(this.timer);
            this.timer = undefined;
        }
        document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }

    protected tick(): void {
        try {
            this.callback();
        } catch (error) {
            console.warn('[qaap-visible-interval] tick failed:', error);
        }
    }
}
