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
    resolveTenantIsolationRoot,
    resolveUserReposRoot,
    safeUserIdSegment,
} from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { isQaapTenantBackendMode, QAAP_TENANT_LOGIN_ENV } from '@theia/qaap-adapters/lib/common/qaap-tenant-backend-auth';
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
        // Paths use the login verbatim, as the auth guard does (`resolveUserReposRoot` /
        // `safeUserIdSegment`), and path comparisons are case-sensitive. Only the tenant-backend pin
        // below folds case.
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
        const segment = safeUserIdSegment(owner);
        // The spawn wrapper picks the tenant (uid, worker container) from the LEXICAL path
        // (`QaapTenantSpawnService.resolveTenantSegment`), so the lexical tenant segment must be the
        // caller's too — not only the realpath. Otherwise `/worktrees/bob/link -> /worktrees/alice/x`
        // passes the realpath check for alice and yields a shell running as bob.
        if (resolveTenantIsolationRoot(reposRoot, resolveQaapWorktreesRoot(), cwd)?.segment !== segment) {
            return false;
        }
        if (isPathUnderUserWorkspace(cwd, reposRoot, owner)) {
            return isRealPathUnder(cwd, resolveUserReposRoot(reposRoot, owner));
        }
        return [resolveQaapWorktreesRoot(), resolveQaapParallelRoot()]
            .map(root => path.join(root, segment))
            .some(root => isRealPathUnder(cwd, root));
    }

    protected isTenantBackendMode(): boolean {
        return isQaapTenantBackendMode(process.env);
    }
}
