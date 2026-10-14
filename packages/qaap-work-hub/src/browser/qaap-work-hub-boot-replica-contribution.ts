// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { FrontendApplicationStateService } from '@theia/core/lib/browser/frontend-application-state';
import { matchesMobileOneColumnLayout } from '@theia/core/lib/browser/shell/mobile-layout-state';
import { readQaapAuthUser } from '@theia/qaap-adapters/lib/browser/qaap-auth-session';
import { buildQaapWorkHubBootReplica, writeQaapWorkHubBootReplica } from '@theia/qaap-adapters/lib/browser/qaap-work-hub-boot-replica';
import { QAAP_MOBILE_KEYBOARD_OPEN_BODY_CLASS } from '@theia/qaap-mobile-shell/lib/browser/mobile-keyboard-helper';
import { QAAP_MOBILE_SESSIONS_SIDEBAR_BODY_CLASS } from './mobile-work-hub-sessions-sidebar';

/** Html class the login gate keeps while the Work Hub boots (the replica must not record that state). */
const MOBILE_WORK_HUB_BOOT_CLASS = 'theia-mobile-workhub-boot';

/**
 * Records the exact boot replica of the phone Work Hub (see `qaap-work-hub-boot-replica.ts`) that
 * the login gate paints on the next load: shortly after the application is ready (backend
 * answered, workspace resolved), and whenever the page goes to the background. Only a Work Hub at rest is recorded (nothing loading, no sidebar,
 * keyboard or dialog open), since that is what the Work Hub shows again once it has mounted.
 */
@injectable()
export class QaapWorkHubBootReplicaContribution implements FrontendApplicationContribution {

    protected static readonly SETTLE_DELAY_MS = 4000;
    protected static readonly SETTLE_RETRY_MS = 3000;
    protected static readonly SETTLE_ATTEMPTS = 20;
    /** Anything still loading (the Work Hub's own skeletons and loading states). */
    protected static readonly LOADING_SELECTOR = '[class*="skeleton"], [class*="-loading"], .theia-mod-loading, [aria-busy="true"]';

    @inject(FrontendApplicationStateService)
    protected readonly appState: FrontendApplicationStateService;

    protected settleTimer: ReturnType<typeof setTimeout> | undefined;

    onStart(): void {
        if (typeof window === 'undefined') {
            return;
        }
        // 'ready' comes after the workspace and layout restore (the backend answered): before
        // that the Work Hub still shows predictions from client caches.
        this.appState.reachedState('ready').then(this.scheduleSettledCapture, () => undefined);
        document.addEventListener('visibilitychange', this.captureWhenHidden);
        window.addEventListener('pagehide', this.captureNow);
    }

    onStop(): void {
        if (this.settleTimer !== undefined) {
            clearTimeout(this.settleTimer);
            this.settleTimer = undefined;
        }
        if (typeof window !== 'undefined') {
            document.removeEventListener('visibilitychange', this.captureWhenHidden);
            window.removeEventListener('pagehide', this.captureNow);
        }
    }

    /** Records once the Work Hub has finished loading after startup (retried while it is not). */
    protected scheduleSettledCapture = (): void => {
        if (this.settleTimer !== undefined) {
            clearTimeout(this.settleTimer);
        }
        let attempts = QaapWorkHubBootReplicaContribution.SETTLE_ATTEMPTS;
        const attempt = (): void => {
            this.settleTimer = undefined;
            if (!this.capture() && --attempts > 0) {
                this.settleTimer = setTimeout(attempt, QaapWorkHubBootReplicaContribution.SETTLE_RETRY_MS);
            }
        };
        this.settleTimer = setTimeout(attempt, QaapWorkHubBootReplicaContribution.SETTLE_DELAY_MS);
    };

    protected captureWhenHidden = (): void => {
        if (document.visibilityState === 'hidden' && this.appState.state === 'ready') {
            this.capture();
        }
    };

    protected captureNow = (): void => {
        if (this.appState.state === 'ready') {
            this.capture();
        }
    };

    /** Records the replica when the Work Hub is at rest on a phone; returns whether it was written. */
    capture(): boolean {
        try {
            const panel = this.findRestingWorkHub();
            const login = readQaapAuthUser()?.login?.trim();
            if (!panel || !login) {
                return false;
            }
            const replica = buildQaapWorkHubBootReplica({
                panel,
                shell: document.getElementById('theia-app-shell'),
                login,
                build: this.currentBuild(),
                origin: window.location.origin,
                document,
            });
            return !!replica && writeQaapWorkHubBootReplica(replica);
        } catch {
            return false;
        }
    }

    protected findRestingWorkHub(): Element | undefined {
        if (!matchesMobileOneColumnLayout() || document.documentElement.classList.contains(MOBILE_WORK_HUB_BOOT_CLASS)) {
            return undefined;
        }
        const body = document.body;
        if (body.classList.contains(QAAP_MOBILE_SESSIONS_SIDEBAR_BODY_CLASS) || body.classList.contains(QAAP_MOBILE_KEYBOARD_OPEN_BODY_CLASS)
            || document.querySelector('.dialogOverlay')) {
            return undefined;
        }
        const panel = document.querySelector('.theia-mobile-projects.theia-mod-visible');
        if (!panel || this.isLoading(panel)) {
            // A loading Work Hub is not what the next load mounts into; keep the previous record.
            return undefined;
        }
        return panel;
    }

    protected isLoading(panel: Element): boolean {
        return Array.from(panel.querySelectorAll(QaapWorkHubBootReplicaContribution.LOADING_SELECTOR))
            .some(element => element.getClientRects().length > 0);
    }

    /** The page's bundle stylesheet reference; the gate paints the replica only for the same build. */
    protected currentBuild(): string {
        const meta = document.querySelector('meta[name="qaap-bundle-css"]');
        const link = document.querySelector('link[href*="bundle.css"]');
        return meta?.getAttribute('content') || link?.getAttribute('href') || '';
    }
}
