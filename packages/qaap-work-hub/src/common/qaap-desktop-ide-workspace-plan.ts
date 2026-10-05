// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { isQaapWorkspaceContainerPath } from '@theia/qaap-adapters/lib/common/qaap-workspace-container-path';

export type QaapDesktopIdeWorkspacePlan =
    | { readonly kind: 'proceed' }
    | { readonly kind: 'reload-empty' }
    | { readonly kind: 'open-project'; readonly projectIndex: number };

/** Hub project row used when deciding how to root the IDE on "Open IDE". */
export interface QaapDesktopIdeHubProject {
    readonly id: string;
    readonly cwd?: string;
    /** GitHub `owner/name` when the project is a GitHub repository. */
    readonly githubFullName?: string;
    readonly pinned?: boolean;
}

/** Compares filesystem cwds regardless of separator style and trailing slashes. */
export function sameDesktopIdeCwd(a: string | undefined, b: string | undefined): boolean {
    const normalize = (value: string | undefined): string => (value ?? '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
    const left = normalize(a);
    return left !== '' && left === normalize(b);
}

/**
 * Index of `target` in `projects`. The same repository can carry different ids in two lists: the
 * Work Hub paints from cached project sessions (`github:owner/repo`) while a fresh load lists the
 * recent workspace (`recent:file:///…`) first, so fall back to the cwd and the GitHub identity.
 */
function findHubProjectIndex(projects: readonly QaapDesktopIdeHubProject[], target: QaapDesktopIdeHubProject): number {
    const byId = projects.findIndex(project => project.id === target.id);
    if (byId >= 0 || (!target.cwd && !target.githubFullName)) {
        return byId;
    }
    const byCwd = target.cwd ? projects.findIndex(project => sameDesktopIdeCwd(project.cwd, target.cwd)) : -1;
    if (byCwd >= 0) {
        return byCwd;
    }
    const fullName = target.githubFullName?.toLowerCase();
    return fullName ? projects.findIndex(project => project.githubFullName?.toLowerCase() === fullName) : -1;
}

/**
 * When opening the classic IDE from Work Hub:
 * - the project the hub shows (selected, pinned or open) → open that repository;
 * - one hub project → open that repository in the IDE;
 * - several, none shown but one of them already open → keep that repository;
 * - several, none shown and a repository outside the hub open → show the IDE without a root;
 * - several, none shown and no repository open → open what the hub would show (pinned, else first).
 */
export function planDesktopIdeWorkspaceOpen(
    projects: readonly QaapDesktopIdeHubProject[],
    currentCwd: string | undefined,
    selected?: string | QaapDesktopIdeHubProject,
): QaapDesktopIdeWorkspacePlan {
    if (selected) {
        const selectedIndex = findHubProjectIndex(projects, typeof selected === 'string' ? { id: selected } : selected);
        if (selectedIndex >= 0) {
            return { kind: 'open-project', projectIndex: selectedIndex };
        }
    }
    if (projects.length === 1) {
        return { kind: 'open-project', projectIndex: 0 };
    }
    if (projects.length > 1) {
        const currentIndex = currentCwd ? projects.findIndex(project => sameDesktopIdeCwd(project.cwd, currentCwd)) : -1;
        if (currentIndex >= 0) {
            return { kind: 'open-project', projectIndex: currentIndex };
        }
        if (currentCwd && !isQaapWorkspaceContainerPath(currentCwd)) {
            return { kind: 'reload-empty' };
        }
        // Hosted Work Hub runs without a workspace root, and its header then shows the pinned or
        // most recent project; leaving the IDE empty here is the "No Folder Opened" bug.
        const pinnedIndex = projects.findIndex(project => project.pinned);
        return { kind: 'open-project', projectIndex: pinnedIndex >= 0 ? pinnedIndex : 0 };
    }
    return { kind: 'proceed' };
}
