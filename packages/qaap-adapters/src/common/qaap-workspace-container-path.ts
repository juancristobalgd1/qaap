// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Purely lexical container detection, safe to import from `browser`, `node` and `common`
 * (unlike `qaap-user-isolation`, which needs `os`/`path` and the authenticated login).
 *
 * A "container" is any level of the managed workspace tree ABOVE a repository:
 * `/workspace`, `/workspace/repos`, `.../repos/users`, `.../repos/users/{login}`,
 * `.../repos/users/{login}/{owner}` and the legacy flat `.../repos/{owner}`.
 * Repositories live one level deeper.
 *
 * Handing a container to an agent as its `cwd` makes it ingest EVERY repository the user
 * owns in a single turn — the wrong scope, and an enormous (billed) LLM context. Callers
 * must treat a container as "no project selected", never as a usable cwd.
 *
 * Unmanaged paths (a local dev folder such as `/Users/jc/qaap`) are NOT containers: the
 * check only recognizes the two managed layouts, so local development is unaffected.
 */

/** Shared message for the HTTP 400 and for the thrown error, so every surface reads the same. */
export const QAAP_CONTAINER_CWD_ERROR =
    'Select a project first — this path is the workspace container, not a repository.';

const DEV_REPOS_ROOT_PARENT = '.qaap';
const DEV_REPOS_ROOT_SEGMENT = 'workspaces';
const QAAP_USERS_SEGMENT = 'users';

function toSegments(fsPath: string): string[] {
    return fsPath.replace(/\\/g, '/').split('/').filter(Boolean);
}

/**
 * Segments below the repositories root, or `undefined` when `fsPath` is not inside a
 * managed tree. `[]` means the path IS the repositories root.
 */
function segmentsBelowReposRoot(segments: string[]): string[] | undefined {
    if (segments[0] === 'workspace') {
        if (segments.length === 1) {
            return [];
        }
        return segments[1] === 'repos' ? segments.slice(2) : undefined;
    }
    for (let i = segments.length - 1; i > 0; i--) {
        if (segments[i] === DEV_REPOS_ROOT_SEGMENT && segments[i - 1] === DEV_REPOS_ROOT_PARENT) {
            return segments.slice(i + 1);
        }
    }
    return undefined;
}

/** True when `fsPath` is a managed workspace container rather than a single repository. */
export function isQaapWorkspaceContainerPath(fsPath: string | undefined): boolean {
    const trimmed = fsPath?.trim();
    if (!trimmed) {
        return false;
    }
    const segments = toSegments(trimmed);
    if (segments.length === 0) {
        return true;
    }
    const tail = segmentsBelowReposRoot(segments);
    if (tail === undefined) {
        return false;
    }
    // `users/{login}/{owner}/{repo}` (per-user layout) vs legacy flat `{owner}/{repo}`.
    const requiredDepth = tail[0] === QAAP_USERS_SEGMENT ? 4 : 2;
    return tail.length < requiredDepth;
}

/** The cwd to send for an agent turn: `undefined` when it would be a container. */
export function asQaapRepositoryCwd(fsPath: string | undefined): string | undefined {
    const trimmed = fsPath?.trim();
    if (!trimmed || isQaapWorkspaceContainerPath(trimmed)) {
        return undefined;
    }
    return trimmed;
}
