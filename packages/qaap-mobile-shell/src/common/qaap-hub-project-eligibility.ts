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
 * A path is a user repository when it resolves to `{reposRoot}/{owner}/{repo}` on the VPS
 * (`/workspace/repos/...`) or the local dev mirror (`~/.qaap/workspaces/...`).
 */
export function isUserRepositoryFilesystemPath(fsPath: string): boolean {
    const normalized = normalizeFilesystemPath(fsPath);
    if (!normalized || isVpsWorkspaceInfrastructurePath(normalized)) {
        return false;
    }

    if (normalized.startsWith(`${VPS_REPOS_ROOT}/`)) {
        const relative = normalized.slice(VPS_REPOS_ROOT.length + 1);
        const parts = relative.split('/').filter(Boolean);
        return parts.length === 2 && !parts[0].startsWith('.') && !parts[1].startsWith('.');
    }

    const workspacesMarker = '/.qaap/workspaces/';
    const workspacesIdx = normalized.indexOf(workspacesMarker);
    if (workspacesIdx >= 0) {
        const relative = normalized.slice(workspacesIdx + workspacesMarker.length);
        const parts = relative.split('/').filter(Boolean);
        return parts.length === 2 && !parts[0].startsWith('.') && !parts[1].startsWith('.');
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
