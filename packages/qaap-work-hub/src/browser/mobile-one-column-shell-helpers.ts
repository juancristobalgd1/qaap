// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only With Classpath-exception-2.0
// *****************************************************************************

// Pure helpers extracted from MobileOneColumnShellContribution.

import { Widget as LuminoWidget } from '@lumino/widgets';

export function isMainPreviewWidgetLive(preview: LuminoWidget): boolean {
    if (!preview.isAttached) {
        return false;
    }
    return !!preview.node.querySelector(
        '.theia-mini-browser-toolbar, .theia-mini-browser-toolbar-read-only, .qaap-mini-browser-shell .theia-mini-browser'
    );
}
