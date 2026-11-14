// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import * as path from 'path';

/**
 * Builds the error thrown when a conversation or task has no usable project folder.
 * Call it only after the caller's own validity check (absolute path that is an existing directory) has failed.
 *
 * - An empty, missing or relative `cwd` means the conversation has no project folder at all.
 * - An absolute `cwd` that failed the check means the folder was moved or deleted; the path is included.
 */
export function qaapMissingCwdError(cwd: string | undefined): Error {
    const trimmed = (cwd ?? '').trim();
    if (!trimmed || !path.isAbsolute(trimmed)) {
        return new Error(nls.localize(
            'qaap/agentTasks/noProjectFolder',
            'This task has no project folder. Open the project again from its folder and retry.',
        ));
    }
    return new Error(nls.localize(
        'qaap/agentTasks/missingProjectFolder',
        'The project folder no longer exists: {0}. It may have been moved or deleted — open the project again from its current folder.',
        trimmed,
    ));
}
