// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapGitChangedFile } from '../common/qaap-git-review';

/**
 * Decide which file to (re)load after a refresh. Always returns the currently selected
 * file when it is still in the changes list so the diff is reloaded — not just when the
 * selection changes or no diff was loaded yet.
 */
export function selectFileAfterRefresh(
    files: readonly QaapGitChangedFile[],
    selectedPath: string | undefined,
): string | undefined {
    const stillThere = files.some(file => file.path === selectedPath);
    return stillThere ? selectedPath : files[0]?.path;
}

/** Preserve explicit accordion choices, prune vanished files, and expand only the first by default. */
export function reconcileExpandedReviewFiles(
    expandedPaths: Set<string>,
    files: readonly QaapGitChangedFile[],
): void {
    const currentPaths = new Set(files.map(file => file.path));
    for (const path of expandedPaths) {
        if (!currentPaths.has(path)) {
            expandedPaths.delete(path);
        }
    }
    if (expandedPaths.size === 0 && files[0]) {
        expandedPaths.add(files[0].path);
    }
}
