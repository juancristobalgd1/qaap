// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import URI from '@theia/core/lib/common/uri';
import { isQaapWorkspaceContainerPath } from '@theia/qaap-adapters/lib/common/qaap-workspace-container-path';
import { isUserRepositoryFilesystemPath } from '@theia/qaap-mobile-shell/lib/common/qaap-hub-project-eligibility';

/** True when `uri` must never be opened as a Theia workspace root on hosted deployments. */
export function isForbiddenHostedWorkspaceUri(uri: URI | undefined): boolean {
    if (!uri || uri.scheme !== 'file') {
        return false;
    }
    return isQaapWorkspaceContainerPath(uri.path.toString());
}

/**
 * True when `uri` is a safe workspace root for hosted redirect/open handlers.
 * Unmanaged local paths (outside `/workspace`) remain allowed for dev.
 */
export function isAllowedHostedRepositoryWorkspaceUri(uri: URI | undefined): boolean {
    if (!uri || uri.scheme !== 'file') {
        return false;
    }
    const fsPath = uri.path.toString();
    if (isQaapWorkspaceContainerPath(fsPath)) {
        return false;
    }
    if (isUserRepositoryFilesystemPath(fsPath)) {
        return true;
    }
    return !fsPath.startsWith('/workspace');
}

/** Filters hosted container/infrastructure paths out of persisted workspace lists. */
export function filterHostedWorkspaceUris(uris: readonly string[]): string[] {
    return uris.filter(raw => {
        if (!raw?.trim()) {
            return false;
        }
        try {
            return !isForbiddenHostedWorkspaceUri(new URI(raw));
        } catch {
            return false;
        }
    });
}
