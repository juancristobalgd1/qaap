// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { getFileIconClass } from '../common/qaap-file-icon-utils';

/** Maps a file path to the active file-icon theme's classes (Theia's `LabelProvider.getIcon`). */
export type QaapFileThemeIconResolver = (path: string) => string | undefined;

let themeIconResolver: QaapFileThemeIconResolver | undefined;

/**
 * Installed once by the Work Hub composition root (it owns the `LabelProvider`), so the transcript and
 * diff views paint the same per-type file icons as the explorer, the quick pick and the composer's
 * "File" view without each of them depending on the label provider.
 */
export function setQaapFileThemeIconResolver(resolver: QaapFileThemeIconResolver | undefined): void {
    themeIconResolver = resolver;
}

/**
 * Full class list for a file icon element: the theme icon (`<theme classes> file-icon`) when a theme
 * resolves the path, else the codicon chosen from the extension (`codicon codicon-…`).
 */
export function resolveQaapFileIconClasses(path: string): string {
    const trimmed = path.trim();
    if (trimmed && themeIconResolver) {
        try {
            const themed = themeIconResolver(trimmed)?.trim();
            if (themed) {
                return `${themed} file-icon`;
            }
        } catch {
            // A theme that cannot resolve the path falls back to the codicon below.
        }
    }
    return `codicon ${getFileIconClass(trimmed)}`;
}
