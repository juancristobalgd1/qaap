// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { HostedPluginServer } from '@theia/plugin-ext/lib/common/plugin-protocol';
import { QaapPluginStartGate } from '@theia/qaap-shared-core/lib/browser/qaap-plugin-start-gate';
import { QaapHostedPluginServer } from '../common/qaap-hosted-plugin-server';

/**
 * The per-load decision of {@link QaapHostedPluginSupport}: while the page's {@link QaapPluginStartGate}
 * is held, a plugin load skips the sync and never calls the plugin server (so the backend neither
 * deploys plugins nor forks a host for this page); once released, the page asks for plugins and
 * loads again, as upstream.
 */
export class QaapPluginLoadGate {

    protected held = false;
    protected loadScheduled = false;

    constructor(
        protected readonly startGate: QaapPluginStartGate,
        protected readonly server: HostedPluginServer,
        protected readonly load: () => void,
    ) { }

    /** `true` while the current load skipped the plugin sync: nothing to load, start or clean up. */
    get syncHeld(): boolean {
        return this.held;
    }

    /** Resolves `true` when the current load may sync plugins (they have been requested). */
    async beginSync(): Promise<boolean> {
        this.held = !this.startGate.released;
        if (this.held) {
            this.loadWhenReleased();
            return false;
        }
        await QaapHostedPluginServer.requestPlugins(this.server);
        return true;
    }

    protected loadWhenReleased(): void {
        if (this.loadScheduled) {
            return;
        }
        this.loadScheduled = true;
        this.startGate.whenReleased.then(() => {
            this.loadScheduled = false;
            this.load();
        });
    }
}
