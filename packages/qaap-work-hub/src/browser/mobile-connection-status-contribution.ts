// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { ConnectionStatus, ConnectionStatusService } from '@theia/core/lib/browser/connection-status-service';
import { matchesMobileOneColumnLayout } from '@theia/core/lib/browser/shell/mobile-layout-state';
import { MobileOneColumnShellContribution } from './mobile-one-column-shell-contribution';

/**
 * Recovers the narrow-viewport workbench after a backend outage. The socket reconnects on its
 * own in the background (pairs with the bumped `frontendConnectionTimeout`, 10 min, so a
 * backgrounded tab can come back without losing its plugin host), so no "Reconnecting…" /
 * "Back online" toast is shown: the user keeps typing a prompt, browsing the sidebar or
 * reviewing a PR while it happens. Once the backend answers again, the Work Hub mount is
 * retried in case it failed while the backend was unreachable.
 */
@injectable()
export class MobileConnectionStatusContribution implements FrontendApplicationContribution {

    @inject(ConnectionStatusService)
    protected readonly connectionStatusService: ConnectionStatusService;

    @inject(MobileOneColumnShellContribution)
    protected readonly mobileShell: MobileOneColumnShellContribution;

    protected wasOffline = false;

    onStart(): void {
        this.connectionStatusService.onStatusChange(status => this.handleStatusChange(status));
    }

    protected handleStatusChange(status: ConnectionStatus): void {
        if (!matchesMobileOneColumnLayout()) {
            return;
        }
        if (status === ConnectionStatus.OFFLINE) {
            this.wasOffline = true;
        } else if (this.wasOffline) {
            this.wasOffline = false;
            // The Work Hub may have failed to mount while the backend was unreachable: retry now.
            this.mobileShell.tryBootstrapMobileAgentsChat();
        }
    }
}
