// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable, postConstruct } from '@theia/core/shared/inversify';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { isQaapWorkspaceContainerPath } from '@theia/qaap-adapters/lib/common/qaap-workspace-container-path';
import { resolveWorkSurfaceBootIntent } from '../common/qaap-mobile-work-surface-preference';

/**
 * Holds the plugin host start of a page that boots into the Work Hub.
 *
 * Upstream starts every plugin on every page load. The Work Hub does not use them, and opening a
 * project in the IDE reloads the page into that workspace, so a hub page used to boot all plugins
 * only to throw them away and boot them again after the reload (≈25 s each in production). The gate
 * is released at boot when the page boots into the IDE or into a project (the Work Hub review follows
 * the git plugin's SCM events there, and the IDE opens that project without a reload). A hub page
 * without a project releases it only when the IDE is shown on this page without a pending workspace
 * reload, or when a plugin is actually needed.
 */
@injectable()
export class QaapPluginStartGate {

    protected readonly deferred = new Deferred<void>();
    protected isReleased = false;

    @postConstruct()
    protected init(): void {
        if (resolveWorkSurfaceBootIntent() === 'ide') {
            this.release();
        }
    }

    /** Called with the page's workspace path once it is known, right before plugins would start. */
    releaseForBootWorkspace(workspacePath: string | undefined): void {
        if (workspacePath && !isQaapWorkspaceContainerPath(workspacePath)) {
            this.release();
        }
    }

    get released(): boolean {
        return this.isReleased;
    }

    /** Settles once plugins may start on this page. */
    get whenReleased(): Promise<void> {
        return this.deferred.promise;
    }

    release(): void {
        this.isReleased = true;
        this.deferred.resolve();
    }
}
