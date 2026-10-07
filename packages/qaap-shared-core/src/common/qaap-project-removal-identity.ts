// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import URI from '@theia/core/lib/common/uri';
import { parseGithubFullNameFromWorkspacePath } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { normalizeQaapPreviewProjectId } from './qaap-preview-identity';

/** Every task worktree lives in `{tmpdir}/qaap-worktrees/{tenant}/{slug}` (`resolveQaapWorktreesRoot`). */
const QAAP_WORKTREES_SEGMENT = 'qaap-worktrees';

/**
 * Canonical identity of a Work Hub project for removal checks: `github:owner/repo`, lower-cased, or
 * `worktree:tenant/slug` for a task worktree card (removed on its own, its source clone may still be listed).
 *
 * The hub addresses one clone through several keys: `github:owner/repo`,
 * `ws:file:///…/users/<login>/<owner>/<repo>`, `recent:file:///…`, a bare `file:` URI, or a
 * filesystem cwd (also one below the clone root, e.g. a conversation's cwd). Removals are recorded
 * under the `github:` key, so every other form must resolve to it, or a path-keyed session brings
 * the removed project back. Returns `undefined` when the key does not identify a repository clone.
 *
 * `userReposRoot` (the backend's `{reposRoot}/users/{login}`) resolves paths whatever the repos root
 * is called; without it the `…/repos/…` layout of {@link parseGithubFullNameFromWorkspacePath} applies.
 */
export function qaapProjectRemovalIdentity(projectKey: string | undefined, userReposRoot?: string): string | undefined {
    const trimmed = projectKey?.trim();
    if (!trimmed) {
        return undefined;
    }
    const keyed = /^(github|worktree):/i.exec(trimmed);
    if (keyed) {
        const [owner, name] = trimmed.slice(keyed[0].length).split('/');
        return owner && name ? `${keyed[1]}:${owner}/${name}`.toLowerCase() : undefined;
    }
    const location = normalizeQaapPreviewProjectId(trimmed);
    let filesystemPath: string;
    if (/^file:\/\//i.test(location)) {
        filesystemPath = new URI(location).path.toString();
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(location) && !/^[a-z]:[\\/]/i.test(location)) {
        return undefined;
    } else {
        filesystemPath = location;
    }
    const fullName = fullNameUnderUserReposRoot(filesystemPath, userReposRoot);
    if (fullName) {
        return `github:${fullName}`;
    }
    const worktree = worktreeOfPath(filesystemPath);
    if (worktree) {
        return `worktree:${worktree}`;
    }
    const parsedFullName = parseGithubFullNameFromWorkspacePath(filesystemPath);
    return parsedFullName ? `github:${parsedFullName}` : undefined;
}

/** `tenant/slug` (lower-cased) of a path in a task worktree. */
function worktreeOfPath(filesystemPath: string): string | undefined {
    const segments = filesystemPath.replace(/\\/g, '/').split('/').filter(Boolean);
    const root = segments.lastIndexOf(QAAP_WORKTREES_SEGMENT);
    const [tenant, slug] = root >= 0 ? segments.slice(root + 1) : [];
    return tenant && slug ? `${tenant}/${slug}`.toLowerCase() : undefined;
}

function fullNameUnderUserReposRoot(filesystemPath: string, userReposRoot: string | undefined): string | undefined {
    if (!userReposRoot) {
        return undefined;
    }
    // Windows: `C:\\…` roots meet `/C:/…` or `/c:/…` URI paths; drive letters and NTFS paths are case-insensitive.
    const comparable = (value: string): string => value.trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '')
        .replace(/^\/(?=[a-z]:\/)/i, '');
    const root = comparable(userReposRoot);
    const candidate = comparable(filesystemPath);
    const isWindowsPath = /^[a-z]:\//i.test(root);
    const rootPrefix = `${root}/`;
    const under = isWindowsPath ? candidate.toLowerCase().startsWith(rootPrefix.toLowerCase()) : candidate.startsWith(rootPrefix);
    if (!root || !under) {
        return undefined;
    }
    const [owner, name] = candidate.slice(rootPrefix.length).split('/');
    return owner && name ? `${owner}/${name}`.toLowerCase() : undefined;
}
