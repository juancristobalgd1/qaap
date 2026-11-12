// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** True when a Theia modal dialog overlay, or a Work Hub server settings dialog, is open above the Work Hub. */
export function isWorkHubTheiaDialogOpen(): boolean {
    if (document.querySelector('.theia-mobile-work-hub-mcp-server-dialog.theia-mod-visible')) {
        return true;
    }
    for (const overlay of document.querySelectorAll('.lm-Widget.dialogOverlay')) {
        if (!overlay.classList.contains('hidden') && overlay.querySelector('.dialogBlock')) {
            return true;
        }
    }
    return false;
}
