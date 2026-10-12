// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable } from '@theia/core/lib/common/disposable';
import type { Event } from '@theia/core/lib/common/event';
import URI from '@theia/core/lib/common/uri';
import type { FileChangesEvent } from '@theia/filesystem/lib/common/files';

/**
 * Calls `onChange` for every file-change event that touches a resource under `rootUri`. The Changes
 * review uses it as its refresh trigger when no SCM provider tracks the repository (the mobile entry
 * has no git plugin, so `ScmService.repositories` stays empty there).
 */
export function watchReviewRootFileChanges(
    fileService: { readonly onDidFilesChange: Event<FileChangesEvent> },
    rootUri: string | undefined,
    onChange: () => void,
): Disposable {
    if (!rootUri) {
        return Disposable.NULL;
    }
    const root = new URI(rootUri);
    return fileService.onDidFilesChange(event => {
        if (event.changes.some(change => root.isEqualOrParent(change.resource))) {
            onChange();
        }
    });
}
