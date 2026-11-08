// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';

/**
 * Readable window-title segment for a preview tab.
 *
 * The preview widget URI ends in an opaque project digest, so the upstream title updater would
 * otherwise put that id into `document.title`. The window-title template appends the workspace
 * name itself, which yields e.g. `Preview - qaap`.
 */
export function qaapPreviewWindowTitle(): string {
    return nls.localize('qaap/preview/windowTitle', 'Preview');
}
