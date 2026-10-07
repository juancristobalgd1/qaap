// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Owner and repository of a per-user server clone, `.../repos/users/{login}/{owner}/{repo}`.
 * Case is preserved: the clone directory on disk keeps GitHub's casing (e.g. `leoMirandaa`).
 * Anything else (the container roots, a nested folder inside a clone, legacy flat paths) is not a
 * clone the plan counts, so it returns undefined.
 */
export function parseUserRepositoryCloneFromWorkspacePath(
    workspacePath: string,
): { readonly owner: string; readonly name: string } | undefined {
    const segments = workspacePath.trim().replace(/\\/g, '/').split('/').filter(Boolean);
    const reposIndex = segments.lastIndexOf('repos');
    if (reposIndex < 0) {
        return undefined;
    }
    const rest = segments.slice(reposIndex + 1);
    if (rest.length !== 4 || rest[0] !== 'users') {
        return undefined;
    }
    const [, login, owner, name] = rest;
    if (!login || !owner || !name || owner.startsWith('.') || name.startsWith('.') || login.startsWith('.')) {
        return undefined;
    }
    return { owner, name };
}
