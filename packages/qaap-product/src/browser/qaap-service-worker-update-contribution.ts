// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { MessageService } from '@theia/core/lib/common/message-service';
import { nls } from '@theia/core/lib/common/nls';

/** Event the PWA registration script in index.html dispatches on `window` when a newer build is ready. */
export const QAAP_SERVICE_WORKER_UPDATE_EVENT = 'qaap-service-worker-update';

/** Update handle the registration script publishes as `window.__qaapServiceWorkerUpdate`. */
export interface QaapServiceWorkerUpdate {
    apply(): void;
}

export interface QaapServiceWorkerUpdateHost extends EventTarget {
    __qaapServiceWorkerUpdate?: QaapServiceWorkerUpdate;
}

/**
 * Offers "new version, reload" when a deploy reaches an open tab, in the IDE and in the Work Hub.
 * The service worker no longer takes over open tabs on its own, so the page keeps running its build
 * (and its lazily loaded chunks) until the user chooses to reload.
 */
@injectable()
export class QaapServiceWorkerUpdateContribution implements FrontendApplicationContribution {

    @inject(MessageService)
    protected readonly messageService: MessageService;

    protected prompting = false;

    onStart(): void {
        const host = this.updateHost();
        if (!host) {
            return;
        }
        host.addEventListener(QAAP_SERVICE_WORKER_UPDATE_EVENT, () => this.offerUpdate(host));
        // The update may have been announced while the application was still starting.
        this.offerUpdate(host);
    }

    protected updateHost(): QaapServiceWorkerUpdateHost | undefined {
        return typeof window === 'undefined' ? undefined : window as QaapServiceWorkerUpdateHost;
    }

    protected async offerUpdate(host: QaapServiceWorkerUpdateHost): Promise<void> {
        if (this.prompting || !host.__qaapServiceWorkerUpdate) {
            return;
        }
        this.prompting = true;
        try {
            const reload = nls.localize('theia/qaap-product/reload', 'Reload');
            const choice = await this.messageService.info(
                nls.localize('theia/qaap-product/newVersionAvailable', 'A new version is available. Reload to update.'),
                reload
            );
            // Read the handle again: a later announcement replaces it with the newest one.
            const update = host.__qaapServiceWorkerUpdate;
            if (choice === reload && update) {
                update.apply();
            }
        } finally {
            this.prompting = false;
        }
    }
}
