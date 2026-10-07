// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import URI from '@theia/core/lib/common/uri';
import { parseGithubFullNameFromWorkspacePath } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { normalizeQaapPreviewProjectId } from './qaap-preview-identity';

/**
 * Canonical identity of a Work Hub project for removal checks: `github:owner/repo`, lower-cased.
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
    if (/^github:/i.test(trimmed)) {
        const [owner, name] = trimmed.slice('github:'.length).split('/');
        return owner && name ? `github:${owner}/${name}`.toLowerCase() : undefined;
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
    const fullName = fullNameUnderUserReposRoot(filesystemPath, userReposRoot) ?? parseGithubFullNameFromWorkspacePath(filesystemPath);
    return fullName ? `github:${fullName}` : undefined;
}

function fullNameUnderUserReposRoot(filesystemPath: string, userReposRoot: string | undefined): string | undefined {
    if (!userReposRoot) {
        return undefined;
    }
    const separatorsOnly = (value: string): string => value.trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
    const root = separatorsOnly(userReposRoot);
    const candidate = separatorsOnly(filesystemPath);
    if (!root || !candidate.startsWith(`${root}/`)) {
        return undefined;
    }
    const [owner, name] = candidate.slice(root.length + 1).split('/');
    return owner && name ? `${owner}/${name}`.toLowerCase() : undefined;
}
