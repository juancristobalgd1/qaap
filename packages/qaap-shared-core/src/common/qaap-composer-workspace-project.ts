// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Minimal project shape for composer cwd resolution (QA-001). */
export interface ComposerWorkspaceProjectCandidate {
    readonly id: string;
    readonly isCurrent?: boolean;
}

/**
 * Prefer the project card that matches the workspace open in this window, not the first
 * browsable hub entry when the current workspace is omitted from the hub list.
 */
export function findProjectMatchingWorkspaceCwd<T extends ComposerWorkspaceProjectCandidate>(
    projects: readonly T[],
    workspaceCwd: string | undefined,
    getProjectCwd: (project: T) => string | undefined,
    projectMatchesCurrentWorkspace: (project: T) => boolean,
): T | undefined {
    if (!workspaceCwd) {
        return undefined;
    }
    const needle = workspaceCwd.toLowerCase();
    const matchesWorkspace = (project: T): boolean => {
        if (projectMatchesCurrentWorkspace(project)) {
            return true;
        }
        const cwd = getProjectCwd(project)?.toLowerCase();
        return !!cwd && cwd === needle;
    };
    return projects.find(project => project.isCurrent && matchesWorkspace(project))
        ?? projects.find(project => projectMatchesCurrentWorkspace(project))
        ?? projects.find(project => {
            const cwd = getProjectCwd(project)?.toLowerCase();
            return !!cwd && cwd === needle;
        });
}
