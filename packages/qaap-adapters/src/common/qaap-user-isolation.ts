// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as os from 'os';
import * as path from 'path';

/** Well-known segment under {@link resolveQaapReposRoot} for per-user clones. */
export const QAAP_USER_REPOS_SEGMENT = 'users';

/** Anonymous GitHub clones (unsigned / public-only) are isolated under this login bucket. */
export const QAAP_ANONYMOUS_USER_LOGIN = '_anonymous';

/** Dev skip-auth workspaces use this bucket so they never collide with real users. */
export const QAAP_SKIP_AUTH_USER_LOGIN = '_dev';

/**
 * Default on-disk root for cloned GitHub workspaces.
 * Production mounts `/workspace/repos`; local dev uses `~/.qaap/workspaces`.
 */
export function resolveQaapReposRoot(): string {
    if (process.env.QAAP_REPOS_ROOT?.trim()) {
        return process.env.QAAP_REPOS_ROOT.trim();
    }
    if (process.env.NODE_ENV === 'production') {
        return '/workspace/repos';
    }
    return path.join(os.homedir(), '.qaap', 'workspaces');
}

/** Sanitize GitHub login / user id for use as a single path segment. */
export function safeUserIdSegment(login: string): string {
    const trimmed = login.trim();
    if (!trimmed) {
        return '_unknown';
    }
    const safe = trimmed.replace(/[^A-Za-z0-9_.-]/g, '_');
    return safe || '_unknown';
}

/** Per-user workspace root: `{reposRoot}/users/{login}/`. */
export function resolveUserReposRoot(reposRoot: string, userLogin: string): string {
    return path.join(reposRoot, QAAP_USER_REPOS_SEGMENT, safeUserIdSegment(userLogin));
}

/** Absolute path for a user's clone of `owner/repo`. */
export function resolveRepositoryWorkspacePath(
    reposRoot: string,
    userLogin: string,
    owner: string,
    repo: string,
): string {
    const ownerDir = safeUserIdSegment(owner);
    const repoDir = safeUserIdSegment(repo);
    return path.join(resolveUserReposRoot(reposRoot, userLogin), ownerDir, repoDir);
}

/** True when `targetPath` is inside the authenticated user's workspace tree. */
export function isPathUnderUserWorkspace(
    targetPath: string,
    reposRoot: string,
    userLogin: string,
): boolean {
    const resolved = path.resolve(targetPath);
    const userRoot = path.resolve(resolveUserReposRoot(reposRoot, userLogin));
    const relative = path.relative(userRoot, resolved);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Extract the per-user path segment ({@link safeUserIdSegment} of the login) from a workspace path of
 * the form `{reposRoot}/users/{segment}/...`, or `undefined` when the path is not under the per-user
 * tree. Used to derive which tenant a spawned process belongs to from its cwd, so it can run under
 * that tenant's uid (uid-per-user isolation).
 */
export function resolveTenantSegmentFromWorkspacePath(reposRoot: string, targetPath: string): string | undefined {
    const usersRoot = path.resolve(reposRoot, QAAP_USER_REPOS_SEGMENT);
    const relative = path.relative(usersRoot, path.resolve(targetPath));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        return undefined;
    }
    const [segment] = relative.split(path.sep);
    return segment || undefined;
}

/**
 * True when `targetPath` is a CONTAINER level of the user's workspace tree
 * rather than a repository: the user root itself (depth 0) or an owner
 * directory (depth 1). Repositories live at `{userRoot}/{owner}/{repo}`
 * (depth 2). Agent conversations must never target a container — the agent
 * would ingest every repository at once, which is the wrong scope and a
 * massive LLM context.
 */
export function isUserWorkspaceContainerPath(
    targetPath: string,
    reposRoot: string,
    userLogin: string,
): boolean {
    if (!isPathUnderUserWorkspace(targetPath, reposRoot, userLogin)) {
        return false;
    }
    const resolved = path.resolve(targetPath);
    const userRoot = path.resolve(resolveUserReposRoot(reposRoot, userLogin));
    const relative = path.relative(userRoot, resolved);
    const depth = relative === '' ? 0 : relative.split(path.sep).length;
    return depth < 2;
}

/**
 * Parse `owner/repo` from a workspace URI path.
 * Supports `.../repos/users/{login}/{owner}/{repo}` and legacy `.../repos/{owner}/{repo}`.
 */
export function parseGithubFullNameFromWorkspacePath(workspacePath: string): string | undefined {
    const normalized = workspacePath.replace(/\\/g, '/');
    const segments = normalized.split('/').filter(Boolean);
    const reposIndex = segments.lastIndexOf('repos');
    if (reposIndex < 0) {
        return undefined;
    }
    const afterRepos = segments.slice(reposIndex + 1);
    if (afterRepos[0] === QAAP_USER_REPOS_SEGMENT && afterRepos.length >= 4) {
        return `${afterRepos[2]}/${afterRepos[3]}`.toLowerCase();
    }
    if (afterRepos.length >= 2) {
        return `${afterRepos[0]}/${afterRepos[1]}`.toLowerCase();
    }
    return undefined;
}

/** Browser localStorage key suffix so caches never cross users on the same origin. */
export function qaapUserScopedStorageKey(baseKey: string, userLogin: string | undefined): string {
    if (!userLogin?.trim()) {
        return baseKey;
    }
    return `${baseKey}@${safeUserIdSegment(userLogin)}`;
}
