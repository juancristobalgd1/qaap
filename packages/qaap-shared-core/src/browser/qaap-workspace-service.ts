// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable, interfaces } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { FileStat } from '@theia/filesystem/lib/common/files';
import { CollaborationWorkspaceService } from '@theia/collaboration/lib/browser/collaboration-workspace-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { matchesMobileOneColumnLayout } from '@theia/core/lib/browser/shell/mobile-layout-state';
import { peekPreferDesktopIde } from '../common/qaap-mobile-work-surface-preference';

/**
 * Lets the Work Hub open the IDE on a project without reloading the page.
 *
 * Upstream `WorkspaceService.open` always reloads (`reloadWindow`), even when the page has no
 * workspace yet. On a desktop the Work Hub runs at `/` without a workspace, so the first click on
 * the IDE tab paid a full reload: modules, backend connection and plugin host again (prod
 * 2026-10-06: tree ~22 s after the click).
 * Extends the collaboration subclass, which upstream already binds as the `WorkspaceService` and
 * which switches workspaces in place the same way (`setHostWorkspace`).
 */
@injectable()
export class QaapWorkspaceService extends CollaborationWorkspaceService {

    protected skippedMostRecentWorkspace = false;

    /**
     * A desktop Work Hub at `/` (no hash, no IDE choice in this tab) starts without a workspace.
     *
     * Upstream falls back to the backend's most recently used workspace, a value shared by every
     * page of the backend process. The hub never shows that workspace, yet it made the page "opened",
     * so the IDE tab on the project the hub shows took the reload path unless both happened to be
     * the same repository. Without it the IDE opens the hub's project in place
     * ({@link openWithoutReload}). The IDE surface (F5 keeps the hash) and mobile keep upstream.
     */
    protected override async getDefaultWorkspaceUri(): Promise<string | undefined> {
        if (this.startsHubWithoutWorkspace()) {
            this.skippedMostRecentWorkspace = true;
            return undefined;
        }
        return super.getDefaultWorkspaceUri();
    }

    /**
     * Upstream records "no workspace" as the backend's most recent one; after a skipped default that
     * would clear it for every other page of the backend (a phone loading `/` next).
     */
    protected override async setWorkspace(workspaceStat: FileStat | undefined): Promise<void> {
        if (!workspaceStat && !this._workspace && this.skippedMostRecentWorkspace) {
            this.setURLFragment('');
            this.updateTitle();
            await this.updateWorkspace();
            return;
        }
        return super.setWorkspace(workspaceStat);
    }

    protected startsHubWithoutWorkspace(): boolean {
        return window.location.hash.length <= 1 && !peekPreferDesktopIde() && !matchesMobileOneColumnLayout();
    }

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
        // Upstream fires this only for workspace files; listeners such as the workspace-scoped
        // layout storage otherwise keep the "no workspace" state they read at startup.
        this.onWorkspaceLocationChangedEmitter.fire(stat);
        return true;
    }
}

/** Binds {@link QaapWorkspaceService} as the single workspace service, also behind the collaboration binding. */
export function bindQaapWorkspaceService(bind: interfaces.Bind, rebind: interfaces.Rebind, isBound: interfaces.IsBound): void {
    bind(QaapWorkspaceService).toSelf().inSingletonScope();
    if (isBound(CollaborationWorkspaceService)) {
        rebind(CollaborationWorkspaceService).toService(QaapWorkspaceService);
    }
    rebind(WorkspaceService).toService(QaapWorkspaceService);
}
