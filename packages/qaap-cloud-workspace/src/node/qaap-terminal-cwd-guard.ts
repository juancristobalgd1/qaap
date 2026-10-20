// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as path from 'path';
import { injectable } from '@theia/core/shared/inversify';
import {
    normalizeIsolationPath,
    QAAP_USER_REPOS_SEGMENT,
    resolveQaapReposRoot,
    resolveQaapWorktreesRoot,
    resolveTenantIsolationRoot,
    resolveUserReposRoot,
    tenantSegmentKey,
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
        const cwd = normalizeIsolationPath(requestedCwd ?? this.defaultTerminalCwd(owner));
        if (!this.isOwnedTerminalCwd(cwd, owner)) {
            throw new Error('Terminals are restricted to the authenticated tenant workspace.');
        }
        return cwd;
    }

    /**
     * The caller's workspace container. The control plane keeps the login's case on disk
     * (`resolveUserReposRoot`); a tenant backend sees its trees mounted under the case-folded
     * {@link tenantSegmentKey}, which is what the orchestrator uses for the mount.
     */
    protected defaultTerminalCwd(owner: string): string {
        const reposRoot = resolveQaapReposRoot();
        return this.isTenantBackendMode()
            ? path.join(reposRoot, QAAP_USER_REPOS_SEGMENT, tenantSegmentKey(owner))
            : resolveUserReposRoot(reposRoot, owner);
    }

    /**
     * The tenant segment of the LEXICAL path must be the caller's (compared as a
     * {@link tenantSegmentKey}: logins are case-insensitive and a tenant backend mounts under the
     * case-folded key), and the realpath must stay inside that same tenant root. The spawn wrapper
     * picks the tenant (uid, worker container) from the lexical path
     * (`QaapTenantSpawnService.resolveTenantSegment`), so checking only the realpath would let
     * `/worktrees/bob/link -> /worktrees/alice/x` give alice a shell running as bob.
     */
    protected isOwnedTerminalCwd(cwd: string, owner: string): boolean {
        const tenant = resolveTenantIsolationRoot(resolveQaapReposRoot(), resolveQaapWorktreesRoot(), cwd);
        if (!tenant || tenantSegmentKey(tenant.segment) !== tenantSegmentKey(owner)) {
            return false;
        }
        return isRealPathUnder(cwd, tenant.root);
    }

    protected isTenantBackendMode(): boolean {
        return isQaapTenantBackendMode(process.env);
    }
}
