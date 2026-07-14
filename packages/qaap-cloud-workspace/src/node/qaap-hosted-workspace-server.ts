// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as path from 'path';
import { inject, injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { safeUserIdSegment } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { DefaultWorkspaceServer } from '@theia/workspace/lib/node/default-workspace-server';
import { QaapGithubAuthGuard } from '@theia/qaap-mobile-shell/lib/node/qaap-github-auth-guard';
import { filterHostedWorkspaceUris, isForbiddenHostedWorkspaceUri } from '../common/qaap-workspace-isolation';
import { QaapWebsocketAuthRegistry } from './qaap-websocket-auth-registry';

/**
 * Never persist or suggest hosted workspace containers (`/workspace`, `.../repos/users`, …)
 * as the IDE workspace root. Recent workspaces are stored per authenticated user.
 */
@injectable()
export class QaapHostedWorkspaceServer extends DefaultWorkspaceServer {

    @inject(QaapWebsocketAuthRegistry)
    protected readonly connections: QaapWebsocketAuthRegistry;

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    protected override async getRoot(): Promise<string | undefined> {
        const root = await super.getRoot();
        if (!root) {
            return undefined;
        }
        return isForbiddenHostedWorkspaceUri(new URI(root)) ? undefined : root;
    }

    override async getRecentWorkspaces(): Promise<string[]> {
        const recents = filterHostedWorkspaceUris(await super.getRecentWorkspaces());
        return this.filterOwnedRecents(recents);
    }

    override async setMostRecentlyUsedWorkspace(rawUri: string): Promise<void> {
        if (rawUri && (isForbiddenHostedWorkspaceUri(new URI(rawUri)) || !this.currentLoginOwnsWorkspaceUri(rawUri))) {
            return;
        }
        return super.setMostRecentlyUsedWorkspace(rawUri);
    }

    protected override async getUserStoragePath(): Promise<string> {
        const base = await super.getUserStoragePath();
        if (this.auth.isSkipAuthEnabled()) {
            return base;
        }
        const login = this.connections.getCurrentLogin();
        if (!login) {
            return base;
        }
        const directory = path.dirname(base);
        const segment = safeUserIdSegment(login);
        return path.join(directory, `recentworkspace-${segment}.json`);
    }

    protected filterOwnedRecents(recents: string[]): string[] {
        return recents.filter(uri => this.currentLoginOwnsWorkspaceUri(uri));
    }

    protected currentLoginOwnsWorkspaceUri(rawUri: string): boolean {
        if (this.auth.isSkipAuthEnabled()) {
            return true;
        }
        const login = this.connections.getCurrentLogin();
        if (!login) {
            return false;
        }
        try {
            const fsPath = new URI(rawUri).path.toString();
            return this.auth.loginOwnsWorkspacePath(login, fsPath);
        } catch {
            return false;
        }
    }
}
