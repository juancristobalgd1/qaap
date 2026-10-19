// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as path from 'path';
import { injectable } from '@theia/core/shared/inversify';
import {
    isPathUnderUserWorkspace,
    normalizeIsolationPath,
    resolveQaapParallelRoot,
    resolveQaapReposRoot,
    resolveQaapWorktreesRoot,
    resolveUserReposRoot,
    safeUserIdSegment,
} from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { QAAP_TENANT_BACKEND_MODE_ENV, QAAP_TENANT_LOGIN_ENV } from '@theia/qaap-adapters/lib/common/qaap-tenant-backend-auth';
import { isRealPathUnder } from '@theia/qaap-shared-core/lib/node/qaap-realpath-guard';

/**
 * Decides where a hosted interactive terminal may start.
 *
 * `terminal.create` receives its `rootURI` from the browser, and the tenant spawn wrapper derives
 * the tenant (uid, worker container) from that path. Without this check a signed-in user could
 * pass another tenant's path and get a shell in that tenant's tree or container. Mirrors
 * `QaapShellExecutionServerImpl.isAllowedTenantCwd`, except that the user's workspace container
 * (`/workspace/repos/users/<login>`) is allowed too: it is where a terminal opens when no
 * repository is open yet.
 */
@injectable()
export class QaapTerminalCwdGuard {

    /** Returns the canonical cwd for a terminal of `ownerLogin`, or throws when it is not theirs. */
    resolveHostedTerminalCwd(requestedCwd: string | undefined, ownerLogin: string | undefined): string {
        // Paths use the login as the auth guard does (`resolveUserReposRoot`); only comparisons fold case.
        const owner = ownerLogin?.trim();
        if (!owner) {
            throw new Error('Opening a terminal requires an authenticated tenant.');
        }
        if (this.isTenantBackendMode()) {
            // A tenant backend serves exactly one tenant, fixed by its container environment.
            const pinned = process.env[QAAP_TENANT_LOGIN_ENV]?.trim().toLowerCase();
            if (!pinned || pinned !== owner.toLowerCase()) {
                throw new Error('Opening a terminal requires the tenant this backend serves.');
            }
        }
        const cwd = normalizeIsolationPath(requestedCwd ?? resolveUserReposRoot(resolveQaapReposRoot(), owner));
        if (!this.isOwnedTerminalCwd(cwd, owner)) {
            throw new Error('Terminals are restricted to the authenticated tenant workspace.');
        }
        return cwd;
    }

    protected isOwnedTerminalCwd(cwd: string, owner: string): boolean {
        const reposRoot = resolveQaapReposRoot();
        if (isPathUnderUserWorkspace(cwd, reposRoot, owner)) {
            return isRealPathUnder(cwd, resolveUserReposRoot(reposRoot, owner));
        }
        const segment = safeUserIdSegment(owner);
        return [resolveQaapWorktreesRoot(), resolveQaapParallelRoot()]
            .map(root => path.join(root, segment))
            .some(root => isRealPathUnder(cwd, root));
    }

    protected isTenantBackendMode(): boolean {
        return /^(1|true)$/i.test(process.env[QAAP_TENANT_BACKEND_MODE_ENV]?.trim() ?? '');
    }
}
