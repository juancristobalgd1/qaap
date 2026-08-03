// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { nls } from '@theia/core/lib/common/nls';
import { fetchQaapAuthConfig } from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';
import { MobileSnackbar } from './mobile-snackbar';

/** Re-check cadence while the tab is visible; visibility changes also trigger a check. */
const CHECK_INTERVAL_MS = 5 * 60_000;
/** Never hit the config endpoint more often than this, however many triggers fire. */
const MIN_CHECK_SPACING_MS = 60_000;
/** Long-lived toast: the user should notice it, but the next check re-offers if dismissed. */
const TOAST_DURATION_MS = 15_000;

/**
 * Offers a one-tap reload when the SERVING build moves on from the build this tab loaded.
 *
 * Deploys replace the whole image (backend + bundle together), but open tabs keep running the
 * old JavaScript — during the July 11 debugging night every "the fix doesn't work" report
 * turned out to be a stale tab. The deployed build SHA is already public on
 * `/qaap/api/auth/config` (see the sessions-sidebar badge); this contribution stamps the SHA
 * the tab was loaded with and re-compares when the user returns to the tab (visibilitychange)
 * or every few minutes, showing a "Reload" snackbar when they differ.
 *
 * Local dev (no `QAAP_BUILD_SHA`) never shows anything.
 */
@injectable()
export class QaapBuildFreshnessContribution implements FrontendApplicationContribution {

    protected loadedBuild: string | undefined;
    protected lastCheckAt = 0;
    protected disposed = false;
    protected checkInterval: number | undefined;
    protected onVisibilityChange = (): void => {
        if (this.disposed || document.visibilityState !== 'visible') {
            return;
        }
        void this.checkForNewBuild();
    };

    onStart(): void {
        void fetchQaapAuthConfig().then(config => {
            // The bundle and backend ship in one image, so the build serving THIS page load is
            // the build this tab runs. No embedded constant needed.
            this.loadedBuild = config.build?.trim() || undefined;
        }).catch(() => undefined);
        document.addEventListener('visibilitychange', this.onVisibilityChange);
        this.checkInterval = window.setInterval(() => {
            if (!this.disposed && document.visibilityState === 'visible') {
                void this.checkForNewBuild();
            }
        }, CHECK_INTERVAL_MS);
    }

    onStop(): void {
        this.disposed = true;
        document.removeEventListener('visibilitychange', this.onVisibilityChange);
        if (this.checkInterval !== undefined) {
            window.clearInterval(this.checkInterval);
            this.checkInterval = undefined;
        }
    }

    protected async checkForNewBuild(): Promise<void> {
        const now = Date.now();
        if (this.disposed || !this.loadedBuild || now - this.lastCheckAt < MIN_CHECK_SPACING_MS) {
            return;
        }
        this.lastCheckAt = now;
        const current = (await fetchQaapAuthConfig().catch(() => undefined))?.build?.trim();
        if (!current || current === this.loadedBuild) {
            return;
        }
        MobileSnackbar.show(
            nls.localize(
                'qaap/mobileProjects/newBuildAvailable',
                'Qaap was updated ({0}). Reload to get the latest version.',
                current,
            ),
            {
                duration: TOAST_DURATION_MS,
                actionLabel: nls.localize('qaap/mobileProjects/newBuildReload', 'Reload'),
                onAction: () => window.location.reload(),
            },
        );
    }
}
