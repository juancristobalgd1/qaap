// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

const VPS_WORKSPACE_MOUNT = '/workspace';
const VPS_REPOS_ROOT = '/workspace/repos';

export function normalizeFilesystemPath(path: string): string {
    let normalized = path.replace(/\\/g, '/');
    while (normalized.length > 1 && normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
    }
    return normalized;
}

/** True for the VPS container mount (`/workspace`) or its bare `repos` directory. */
export function isVpsWorkspaceInfrastructurePath(fsPath: string): boolean {
    const normalized = normalizeFilesystemPath(fsPath);
    if (normalized === VPS_WORKSPACE_MOUNT || normalized === VPS_REPOS_ROOT) {
        return true;
    }
    const segments = normalized.split('/').filter(Boolean);
    if (segments.length === 2 && segments[0] === 'workspace') {
        const child = segments[1];
        return child === 'repos' || child.startsWith('.');
    }
    return false;
}

/**
 * True for a repositories-root tail that names exactly one repository: `{owner}/{repo}`, or
 * `users/{login}/{owner}/{repo}` in the per-user tenant layout. Anything shorter is a container
 * (the users root, a tenant root, an owner directory) and must never be treated as a project.
 */
function isOwnerRepoTail(relative: string): boolean {
    const parts = relative.split('/').filter(Boolean);
    const tail = parts[0] === 'users' ? parts.slice(2) : parts;
    if (parts[0] === 'users' && parts.length < 4) {
        return false;
    }
    return tail.length === 2 && !tail[0].startsWith('.') && !tail[1].startsWith('.');
}

/**
 * A path is a user repository when it resolves to `{reposRoot}/{owner}/{repo}` — or
 * `{reposRoot}/users/{login}/{owner}/{repo}` — on the VPS (`/workspace/repos/...`) or the local
 * dev mirror (`~/.qaap/workspaces/...`).
 */
export function isUserRepositoryFilesystemPath(fsPath: string): boolean {
    const normalized = normalizeFilesystemPath(fsPath);
    if (!normalized || isVpsWorkspaceInfrastructurePath(normalized)) {
        return false;
    }

    if (normalized.startsWith(`${VPS_REPOS_ROOT}/`)) {
        return isOwnerRepoTail(normalized.slice(VPS_REPOS_ROOT.length + 1));
    }

    const workspacesMarker = '/.qaap/workspaces/';
    const workspacesIdx = normalized.indexOf(workspacesMarker);
    if (workspacesIdx >= 0) {
        return isOwnerRepoTail(normalized.slice(workspacesIdx + workspacesMarker.length));
    }

    const segments = normalized.split('/').filter(Boolean);
    const reposIndex = segments.lastIndexOf('repos');
    if (reposIndex >= 0 && segments.length === reposIndex + 3) {
        const owner = segments[reposIndex + 1];
        const name = segments[reposIndex + 2];
        return !!owner && !!name && !owner.startsWith('.') && !name.startsWith('.');
    }

    return false;
}

export function isValidHubUserRepositoryProjectCandidate(options: {
    readonly hasGithub: boolean;
    readonly filesystemPath?: string;
}): boolean {
    if (options.hasGithub) {
        return true;
    }
    if (!options.filesystemPath) {
        return false;
    }
    return isUserRepositoryFilesystemPath(options.filesystemPath);
}
