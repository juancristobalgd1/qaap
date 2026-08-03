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
