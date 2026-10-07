// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** A clone the user removed from the hub (see `QaapGithubOauthEndpoint.handleDeleteGithubRepository`). */
export interface QaapRepositoryRemoval {
    readonly login: string;
    /** `github:owner/repo`, lower-cased: the identity every hub key of the clone resolves to. */
    readonly identity: string;
    /** `{reposRoot}/users/{login}/{owner}/{repo}`; usually gone already. */
    readonly clonePath: string;
    /** `{reposRoot}/users/{login}`, to resolve paths to {@link identity} with `qaapProjectRemovalIdentity`. */
    readonly userReposRoot: string;
    /** Task worktrees checked out from the clone; deleted right after the contributions ran. */
    readonly worktreePaths: readonly string[];
}

export const QaapRepositoryRemovalContribution = Symbol('QaapRepositoryRemovalContribution');

/**
 * Forgets state a higher layer keeps for a removed clone (terminal sessions, conversations, recent
 * workspaces) so nothing lists the project again. Runs when the clone is removed and once more after
 * each backend start, the first time the removed project would be listed (removals recorded before this
 * hook existed). Must be idempotent and best effort: a failure never brings the project back.
 */
export interface QaapRepositoryRemovalContribution {
    onRepositoryRemoved(removal: QaapRepositoryRemoval): Promise<void>;
}
