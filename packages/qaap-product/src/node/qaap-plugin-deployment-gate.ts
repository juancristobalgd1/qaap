// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { Deferred } from '@theia/core/lib/common/promise-util';

/**
 * Holds the backend plugin deployment until a client actually needs plugins.
 *
 * Upstream deploys every plugin (≈98 under /app/plugins) when the backend initializes. Phones and
 * Work Hub pages never run them, and on a 2-CPU tenant the deployment competed with the cold start
 * the user is waiting for. Deployment now starts on the first {@link request}: an IDE page
 * syncing plugins, a plugin install, or the `list-plugins` CLI command.
 */
@injectable()
export class QaapPluginDeploymentGate {

    protected readonly deferred = new Deferred<void>();
    protected isRequested = false;

    get requested(): boolean {
        return this.isRequested;
    }

    /** Settles once plugin deployment has been requested. */
    get whenRequested(): Promise<void> {
        return this.deferred.promise;
    }

    request(): void {
        if (!this.isRequested) {
            this.isRequested = true;
            this.deferred.resolve();
        }
    }
}
