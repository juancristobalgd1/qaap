// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { ConnectionStatus, ConnectionStatusService } from '@theia/core/lib/browser/connection-status-service';
import { matchesMobileOneColumnLayout } from '@theia/core/lib/browser/shell/mobile-layout-state';
import { nls } from '@theia/core/lib/common';
import { MobileOneColumnShellContribution } from './mobile-one-column-shell-contribution';
import { MobileSnackbar } from '@theia/qaap-mobile-shell/lib/browser/mobile-snackbar';

/**
 * Surfaces backend reconnection state on the narrow-viewport workbench. The socket
 * reconnects on its own (pairs with the bumped `frontendConnectionTimeout`, 10 min, so a
 * backgrounded tab can come back without losing its plugin host), and most drops — tab
 * backgrounding, a brief network blip — recover within a second or two. We only surface a
 * "Reconnecting…" toast once an outage outlasts `RECONNECT_GRACE_PERIOD_MS`; a quick blip
 * stays silent so the user can keep typing a prompt, browsing the sidebar or reviewing a PR
 * without interruption. A "Back online" toast only follows a reconnect the user actually saw.
 */
@injectable()
export class MobileConnectionStatusContribution implements FrontendApplicationContribution {

    /** How long an outage is allowed to run silently before the "Reconnecting…" toast appears. */
    protected static readonly RECONNECT_GRACE_PERIOD_MS = 3000;

    @inject(ConnectionStatusService)
    protected readonly connectionStatusService: ConnectionStatusService;

    @inject(MobileOneColumnShellContribution)
    protected readonly mobileShell: MobileOneColumnShellContribution;

    protected wasOffline = false;
    protected toastShown = false;
    protected offlineToastTimer: number | undefined;

    onStart(): void {
        this.connectionStatusService.onStatusChange(status => this.handleStatusChange(status));
    }

    protected handleStatusChange(status: ConnectionStatus): void {
        if (!matchesMobileOneColumnLayout()) {
            return;
        }
        if (status === ConnectionStatus.OFFLINE) {
            this.wasOffline = true;
            this.scheduleOfflineToast();
        } else if (this.wasOffline) {
            this.wasOffline = false;
            this.cancelOfflineToast();
            // The Work Hub may have failed to mount while the backend was unreachable: retry now.
            this.mobileShell.tryBootstrapMobileAgentsChat();
            if (this.toastShown) {
                this.toastShown = false;
                MobileSnackbar.show(
                    nls.localize('theia/qaap-mobile-shell/backOnline', 'Back online'),
                    { kind: 'success', duration: 1800 }
                );
            }
        }
    }

    protected scheduleOfflineToast(): void {
        this.cancelOfflineToast();
        this.offlineToastTimer = window.setTimeout(() => {
            this.offlineToastTimer = undefined;
            this.toastShown = true;
            MobileSnackbar.show(
                nls.localize('theia/qaap-mobile-shell/reconnecting', 'Reconnecting…'),
                { kind: 'loading', duration: 0 }
            );
        }, MobileConnectionStatusContribution.RECONNECT_GRACE_PERIOD_MS);
    }

    protected cancelOfflineToast(): void {
        if (this.offlineToastTimer !== undefined) {
            window.clearTimeout(this.offlineToastTimer);
            this.offlineToastTimer = undefined;
        }
    }
}
