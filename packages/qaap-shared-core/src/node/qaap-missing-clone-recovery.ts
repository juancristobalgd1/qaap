// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { nls } from '@theia/core/lib/common/nls';
import { QaapGithubAuthGuard, type QaapGithubAuthContext, type QaapResolvedRepositoryCwd } from './qaap-github-auth-guard';
import { QaapGithubOauthEndpoint } from './qaap-github-oauth-endpoint';

/** Error code of a 422 answer when a project's missing clone could not be cloned again. */
export const QAAP_REPOSITORY_CLONE_UNAVAILABLE_CODE = 'repository_clone_unavailable';

export type QaapRecoveredRepositoryCwd =
    | QaapResolvedRepositoryCwd
    | { readonly kind: 'clone-failed'; readonly error: string };

/**
 * Resolves an agent cwd like {@link QaapGithubAuthGuard.resolveOwnedRepositoryCwd}, but first clones
 * again a project of the caller whose clone is gone from disk (deleted, or data restored without
 * clones), so sending a task to the agent does not fail with a cryptic `cwd` error.
 *
 * Ownership stays as strict as the guard's: only the caller's own canonical clone path is ever
 * cloned ({@link QaapGithubAuthGuard.missingOwnedRepositoryClone}), and the result goes through the
 * guard's resolver again.
 */
@injectable()
export class QaapMissingCloneRecovery {

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    @inject(QaapGithubOauthEndpoint)
    protected readonly repositories: QaapGithubOauthEndpoint;

    /** Concurrent sends to the same missing project share one clone. */
    protected readonly restoring = new Map<string, Promise<void>>();

    async resolveOwnedRepositoryCwd(ctx: QaapGithubAuthContext, rawCwd: string | undefined): Promise<QaapRecoveredRepositoryCwd> {
        const resolved = this.auth.resolveOwnedRepositoryCwd(ctx, rawCwd);
        if (resolved.kind !== 'denied' || ctx.kind !== 'authenticated') {
            return resolved;
        }
        const missing = this.auth.missingOwnedRepositoryClone(ctx.userLogin, rawCwd);
        if (!missing) {
            return resolved;
        }
        let restore = this.restoring.get(missing.path);
        if (!restore) {
            restore = this.repositories.restoreMissingRepositoryClone(ctx, missing.owner, missing.repo)
                .then(() => undefined)
                .finally(() => this.restoring.delete(missing.path));
            this.restoring.set(missing.path, restore);
        }
        try {
            await restore;
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            console.warn('[qaap-missing-clone] could not clone a missing project again', JSON.stringify({
                userLogin: ctx.userLogin,
                repository: `${missing.owner}/${missing.repo}`,
                reason,
            }));
            return {
                kind: 'clone-failed',
                error: nls.localize(
                    'qaap/agentTasks/missingCloneRestoreFailed',
                    'I cannot find the repository {0} on the server and could not clone it again: {1}',
                    `${missing.owner}/${missing.repo}`,
                    reason,
                ),
            };
        }
        return this.auth.resolveOwnedRepositoryCwd(ctx, rawCwd);
    }
}
