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
}

/**
 * When opening the classic IDE from Work Hub:
 * - a selected/pinned hub project → open that repository;
 * - one hub project → open that repository in the IDE;
 * - several with none selected → show the IDE without a repository root so the user picks one later.
 */
export function planDesktopIdeWorkspaceOpen(
    projects: readonly QaapDesktopIdeHubProject[],
    currentCwd: string | undefined,
    selectedProjectId?: string,
): QaapDesktopIdeWorkspacePlan {
    if (selectedProjectId) {
        const selectedIndex = projects.findIndex(project => project.id === selectedProjectId);
        if (selectedIndex >= 0) {
            return { kind: 'open-project', projectIndex: selectedIndex };
        }
    }
    if (projects.length === 1) {
        return { kind: 'open-project', projectIndex: 0 };
    }
    if (projects.length > 1) {
        if (currentCwd && !isQaapWorkspaceContainerPath(currentCwd)) {
            return { kind: 'reload-empty' };
        }
        return { kind: 'proceed' };
    }
    return { kind: 'proceed' };
}
