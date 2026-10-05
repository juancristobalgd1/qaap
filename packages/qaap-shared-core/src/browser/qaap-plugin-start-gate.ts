// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable, postConstruct } from '@theia/core/shared/inversify';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { isQaapMobileDevice } from '@theia/qaap-mobile-shell/lib/common/qaap-mobile-device';
import { resolveWorkSurfaceBootIntent } from '../common/qaap-mobile-work-surface-preference';

/**
 * Holds every plugin of a page until it shows the IDE.
 *
 * Upstream syncs and starts every plugin on every page load, and the tenant backend forks a plugin
 * host for each page that syncs. The Work Hub does not use plugins (its review reads the qaap git
 * endpoints), and opening a project in the IDE reloads the page into that workspace, so a hub page
 * used to boot all plugins only to throw them away and boot them again after the reload (≈25 s each
 * in production). The gate is released at boot when the page boots into the IDE, and on a Work Hub
 * page only when the IDE is shown on this page without a pending workspace reload, or when a plugin
 * is actually needed. Until then the page does not even ask the backend for plugins, which keeps the
 * backend from deploying them (see `QaapPluginDeploymentGate`).
 *
 * A mobile device never releases it: phones only run the Work Hub and never load, start or
 * download IDE plugins.
 */
@injectable()
export class QaapPluginStartGate {

    protected readonly deferred = new Deferred<void>();
    protected isReleased = false;
    protected heldForMobileDevice = false;

    @postConstruct()
    protected init(): void {
        this.heldForMobileDevice = isQaapMobileDevice();
        if (resolveWorkSurfaceBootIntent() === 'ide') {
            this.release();
        }
    }

    get released(): boolean {
        return this.isReleased;
    }

    /** `true` on a mobile device, where plugins never start. */
    get mobileDevice(): boolean {
        return this.heldForMobileDevice;
    }

    /** Settles once plugins may start on this page; never on a mobile device. */
    get whenReleased(): Promise<void> {
        return this.deferred.promise;
    }

    release(): void {
        if (this.heldForMobileDevice || this.isReleased) {
            return;
        }
        this.isReleased = true;
        this.deferred.resolve();
    }
}
