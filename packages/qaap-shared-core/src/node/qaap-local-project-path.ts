// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as path from 'path';
import { isPathUnderUserWorkspace, resolveUserReposRoot } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';

/** Folder under the caller's repos root that holds the local (non-GitHub) projects. */
export const QAAP_LOCAL_PROJECTS_SEGMENT = 'local';

const MAX_LOCAL_PROJECT_NAME_LENGTH = 100;

/**
 * Only plain folder names: letters, digits, `_`, `-` and `.`, no leading dot, so `.`, `..`, hidden
 * folders, separators and drive prefixes can never reach the path join below.
 */
export function isValidLocalProjectName(name: string): boolean {
    return name.length > 0
        && name.length <= MAX_LOCAL_PROJECT_NAME_LENGTH
        && /^[A-Za-z0-9_.-]+$/.test(name)
        && !name.startsWith('.');
}

/**
 * Absolute folder for a new local project of `userLogin`: `{reposRoot}/users/{login}/local/{name}`.
 * `undefined` when the name is not a plain folder name or the result would leave the caller's own
 * repos root (the hosted ownership guard; it always holds for a valid name, checked anyway).
 */
export function resolveLocalProjectWorkspacePath(reposRoot: string, userLogin: string, name: string): string | undefined {
    if (!isValidLocalProjectName(name)) {
        return undefined;
    }
    const localRoot = path.join(resolveUserReposRoot(reposRoot, userLogin), QAAP_LOCAL_PROJECTS_SEGMENT);
    const target = path.join(localRoot, name);
    if (path.dirname(target) !== localRoot || !isPathUnderUserWorkspace(target, reposRoot, userLogin)) {
        return undefined;
    }
    return target;
}
