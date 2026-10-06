// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';

/**
 * Lets the Work Hub open the IDE on a project without reloading the page.
 *
 * Upstream `WorkspaceService.open` always reloads (`reloadWindow`), even when the page has no
 * workspace yet. On a hosted desktop the Work Hub runs at `/` without a workspace, so the first
 * click on the IDE tab paid a full reload: modules, backend connection and plugin host again.
 */
@injectable()
export class QaapWorkspaceService extends WorkspaceService {

    /**
     * Makes the directory `uri` the workspace of this page in place and resolves `true`.
     *
     * Only while no workspace is open: nothing workspace-scoped (editors, terminals, folder
     * preferences, plugin host) exists yet, and the explorer, preferences and SCM follow
     * `onWorkspaceChanged`. Switching from one open workspace to another still needs the upstream
     * reload, so this resolves `false` then, and when `uri` is not an existing directory.
     */
    async openWithoutReload(uri: URI): Promise<boolean> {
        await this.ready;
        if (this.opened) {
            return false;
        }
        const stat = await this.toFileStat(uri);
        if (!stat?.isDirectory || this.opened) {
            return false;
        }
        await this.setWorkspace(stat);
        return true;
    }
}
