// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { FrontendApplicationStateService } from '@theia/core/lib/browser/frontend-application-state';
import { ensurePullRequestsSurfaceCss } from './ensure-pull-requests-surface-css';
import { ensureTranscriptSurfaceCss } from './ensure-transcript-surface-css';

/** Upper bound for `requestIdleCallback`: a busy main thread must not postpone the warm-up forever. */
const IDLE_TIMEOUT_MS = 5_000;
/** Fallback delay where `requestIdleCallback` is unavailable (Safari). */
const IDLE_FALLBACK_DELAY_MS = 1_500;

/**
 * Surface stylesheets that some synchronous renderers need (Agents Hub inline transcript, PR
 * list) are kept out of `bundle.css` for first paint, then attached once the app is `ready` and
 * the main thread idle, so a later synchronous render finds them applied instead of flashing.
 * Surfaces with an async entry point still await their `ensure…Css()` themselves.
 */
@injectable()
export class QaapLazySurfaceStylesheetsPreload implements FrontendApplicationContribution {

    @inject(FrontendApplicationStateService)
    protected readonly stateService: FrontendApplicationStateService;

    onStart(): void {
        void this.stateService.reachedState('ready').then(() => this.whenIdle(() => {
            void ensureTranscriptSurfaceCss();
            void ensurePullRequestsSurfaceCss();
        }));
    }

    protected whenIdle(callback: () => void): void {
        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(callback, { timeout: IDLE_TIMEOUT_MS });
        } else {
            window.setTimeout(callback, IDLE_FALLBACK_DELAY_MS);
        }
    }
}
