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

/** Root under which per-conversation git worktrees live: `{tmpdir}/qaap-worktrees/{segment}/{slug}`. */
export function resolveQaapWorktreesRoot(): string {
    return path.join(os.tmpdir(), 'qaap-worktrees');
}

/**
 * Root under which parallel-run variant worktrees live: `{tmpdir}/qaap-parallel/{segment}/{slug}/{variant}`.
 * The `{segment}` MUST be {@link safeUserIdSegment} of the login (like the repos + worktrees roots) so
 * the tenant-isolation model ({@link resolveTenantIsolationRoot}) and the uid registry recognize it.
 */
export function resolveQaapParallelRoot(): string {
    return path.join(os.tmpdir(), 'qaap-parallel');
}

/**
 * Root under which each tenant gets its own agent HOME in uid-per-user mode:
 * `{QAAP_TENANT_HOME_ROOT}/{segment}` (default `/home/qaap-tenants/{segment}`). A distinct,
 * tenant-owned (0700) HOME is required because the shared `QAAP_AGENT_HOME` (`/home/qaap-agent`)
 * is owned by the single fallback uid 1001 — under a per-tenant uid it is neither writable nor
 * private, so all tenants would otherwise share one home (leaking `~/.claude`, caches, tokens).
 */
export function resolveQaapTenantHomeRoot(): string {
    return process.env.QAAP_TENANT_HOME_ROOT?.trim() || '/home/qaap-tenants';
}

/** A single tenant's agent HOME: `{tenantHomeRoot}/{segment}`. `segment` is a {@link safeUserIdSegment}. */
export function resolveTenantHome(segment: string): string {
    return path.join(resolveQaapTenantHomeRoot(), segment);
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

/**
 * Local skip-auth / anonymous buckets may still read the shared `~/.theia/settings.json`.
 * Authenticated GitHub/GitLab logins must never fall back to that file — it is one backend
 * process and would leak User A's API keys into User B's agent spawn.
 */
export function usesSharedAiSettingsFallback(ownerLogin: string | undefined): boolean {
    const login = ownerLogin?.trim();
    if (!login) {
        return true;
    }
    return login === QAAP_SKIP_AUTH_USER_LOGIN || login === QAAP_ANONYMOUS_USER_LOGIN;
}

/** Per-user AI/BYOK settings: `{home}/.qaap/users/{login}/settings.json`. */
export function resolveUserSettingsFilePath(userLogin: string, homeDir: string = os.homedir()): string {
    return path.join(homeDir, '.qaap', 'users', safeUserIdSegment(userLogin), 'settings.json');
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

/**
 * Which path semantics to use when normalizing workspace/cwd strings.
 * Always the **backend/host** OS — never the browser navigator — so a Windows laptop
 * talking to a Linux VPS still produces `/workspace/...`, and a Windows Electron host
 * still produces `C:\...`.
 */
export type IsolationPathHost = 'win32' | 'posix';

/** Host for the current Node/browserify process (`darwin`/`linux` → posix). */
export function resolveIsolationPathHost(): IsolationPathHost {
    return process.platform === 'win32' ? 'win32' : 'posix';
}

function pathApiForHost(host: IsolationPathHost): path.PlatformPath {
    return host === 'win32' ? path.win32 : path.posix;
}

/** True when `targetPath` is inside the authenticated user's workspace tree. */
export function isPathUnderUserWorkspace(
    targetPath: string,
    reposRoot: string,
    userLogin: string,
    host: IsolationPathHost = resolveIsolationPathHost(),
): boolean {
    const api = pathApiForHost(host);
    const resolved = normalizeIsolationPath(targetPath, host);
    const userRoot = normalizeIsolationPath(resolveUserReposRoot(reposRoot, userLogin), host);
    const relative = api.relative(userRoot, resolved);
    return relative === '' || (!relative.startsWith('..') && !api.isAbsolute(relative));
}

/**
 * Extract the per-user path segment ({@link safeUserIdSegment} of the login) from a workspace path of
 * the form `{reposRoot}/users/{segment}/...`, or `undefined` when the path is not under the per-user
 * tree. Used to derive which tenant a spawned process belongs to from its cwd, so it can run under
 * that tenant's uid (uid-per-user isolation).
 */
export function resolveTenantSegmentFromWorkspacePath(
    reposRoot: string,
    targetPath: string,
    host: IsolationPathHost = resolveIsolationPathHost(),
): string | undefined {
    const api = pathApiForHost(host);
    return firstPathSegmentUnder(api.resolve(reposRoot, QAAP_USER_REPOS_SEGMENT), targetPath, host);
}

/**
 * Canonical absolute filesystem path for tenant isolation and workspace-scoped spawns.
 *
 * Cross-OS contract:
 * - Linux / macOS host (`posix`): `/workspace\\repos\\...` and `"/\workspace\repos\..."`
 *   (Windows-browser `FileUri.fsPath` of a POSIX URI) become `/workspace/repos/...`.
 * - Windows host (`win32`): `C:\Users\...`, `C:/Users/...`, and `file:///C:/Users/...`
 *   become a resolved absolute Windows path; separators are unified safely.
 *
 * Pass {@link IsolationPathHost} explicitly from the browser using `OS.backend` so the
 * client never resolves with the laptop's OS when the workspace lives on another OS.
 */
export function normalizeIsolationPath(
    input: string,
    host: IsolationPathHost = resolveIsolationPathHost(),
): string {
    const api = pathApiForHost(host);
    const trimmed = input.trim();
    if (!trimmed) {
        return api.resolve('.');
    }
    let candidate = trimmed;
    if (/^file:/i.test(candidate)) {
        try {
            if (typeof URL !== 'undefined') {
                const parsed = new URL(candidate);
                if (parsed.protocol === 'file:') {
                    candidate = decodeURIComponent(parsed.pathname);
                }
            } else {
                const withoutScheme = candidate.replace(/^file:\/\//i, '');
                if (withoutScheme.startsWith('/')) {
                    candidate = decodeURIComponent(withoutScheme);
                } else {
                    const slash = withoutScheme.indexOf('/');
                    candidate = slash >= 0 ? decodeURIComponent(withoutScheme.slice(slash)) : withoutScheme;
                }
            }
        } catch {
            // keep candidate as trimmed input
        }
    }
    // Unify separators. Collapse runs so "/\workspace" → "//workspace" → "/workspace".
    // Preserve real Windows UNC only when the input already looked like \\server\share or //server/share —
    // never when it was the Windows-browser mangling of a POSIX absolute ("/\workspace\...").
    const preserveUnc = host === 'win32' && (
        candidate.startsWith('\\\\')
        || (candidate.startsWith('//') && !candidate.startsWith('///'))
    );
    let unified = candidate.replace(/\\/g, '/');
    if (preserveUnc && /^\/\/[^/]/.test(unified)) {
        unified = `//${unified.slice(2).replace(/\/+/g, '/')}`;
    } else {
        unified = unified.replace(/\/+/g, '/');
    }
    // file:///C:/Users/... → pathname `/C:/Users/...` → `C:/Users/...` for win32.resolve
    const drivePrefixed = unified.match(/^\/([A-Za-z]:)(\/.*)?$/);
    if (drivePrefixed) {
        unified = drivePrefixed[1] + (drivePrefixed[2] || '/');
    }
    return api.resolve(unified);
}

/** The first path segment of `targetPath` directly under `base`, or `undefined` when not under it. */
export function firstPathSegmentUnder(
    base: string,
    targetPath: string,
    host: IsolationPathHost = resolveIsolationPathHost(),
): string | undefined {
    const api = pathApiForHost(host);
    const relative = api.relative(normalizeIsolationPath(base, host), normalizeIsolationPath(targetPath, host));
    if (!relative || relative.startsWith('..') || api.isAbsolute(relative)) {
        return undefined;
    }
    const [segment] = relative.split(api.sep);
    return segment || undefined;
}

/**
 * The directory whose owner-only (0700) lock isolates the tenant that `cwd` belongs to, plus that
 * tenant's path segment — covering BOTH the per-user repos root (`{reposRoot}/users/{segment}`) and
 * the per-conversation worktree root (`{worktreesRoot}/{segment}`). `undefined` when `cwd` is under
 * neither. The `segment` is the {@link safeUserIdSegment} of the login, so it keys the uid registry.
 */
export function resolveTenantIsolationRoot(
    reposRoot: string,
    worktreesRoot: string,
    cwd: string,
    host: IsolationPathHost = resolveIsolationPathHost(),
): { readonly root: string; readonly segment: string } | undefined {
    const api = pathApiForHost(host);
    const usersRoot = api.resolve(reposRoot, QAAP_USER_REPOS_SEGMENT);
    const reposSegment = firstPathSegmentUnder(usersRoot, cwd, host);
    if (reposSegment) {
        return { root: api.join(usersRoot, reposSegment), segment: reposSegment };
    }
    const worktreeSegment = firstPathSegmentUnder(worktreesRoot, cwd, host);
    if (worktreeSegment) {
        return { root: api.join(api.resolve(worktreesRoot), worktreeSegment), segment: worktreeSegment };
    }
    // Parallel-run variant worktrees ({tmpdir}/qaap-parallel/{segment}/{slug}/{variant}) are tenant
    // trees too — recognize them so the fail-closed cwd guard and the uid drop apply there as well.
    const parallelRoot = resolveQaapParallelRoot();
    const parallelSegment = firstPathSegmentUnder(parallelRoot, cwd, host);
    if (parallelSegment) {
        return { root: api.join(parallelRoot, parallelSegment), segment: parallelSegment };
    }
    return undefined;
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
    host: IsolationPathHost = resolveIsolationPathHost(),
): boolean {
    if (!isPathUnderUserWorkspace(targetPath, reposRoot, userLogin, host)) {
        return false;
    }
    const api = pathApiForHost(host);
    const resolved = normalizeIsolationPath(targetPath, host);
    const userRoot = normalizeIsolationPath(resolveUserReposRoot(reposRoot, userLogin), host);
    const relative = api.relative(userRoot, resolved);
    const depth = relative === '' ? 0 : relative.split(api.sep).length;
    return depth < 2;
}

/**
 * Parse `owner/repo` from a workspace URI path.
 * Supports `.../repos/users/{login}/{owner}/{repo}` and legacy `.../repos/{owner}/{repo}`.
 */
export function parseGithubFullNameFromWorkspacePath(workspacePath: string): string | undefined {
    // Separator-only normalize — do not host-resolve (Windows drive letters must stay parseable on any OS).
    const normalized = workspacePath.trim().replace(/\\/g, '/').replace(/\/+/g, '/');
    const segments = normalized.split('/').filter(Boolean);
    const reposIndex = segments.lastIndexOf('repos');
    if (reposIndex < 0) {
        return undefined;
    }
    const afterRepos = segments.slice(reposIndex + 1);
    if (afterRepos[0] === QAAP_USER_REPOS_SEGMENT) {
        if (afterRepos.length >= 4) {
            return `${afterRepos[2]}/${afterRepos[3]}`.toLowerCase();
        }
        // Legacy per-user paths (`users/{login}/{repo}`) do not encode the
        // repository owner. Treat them as ambiguous instead of falling through
        // and incorrectly identifying every repo as `users/{login}`.
        return undefined;
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
