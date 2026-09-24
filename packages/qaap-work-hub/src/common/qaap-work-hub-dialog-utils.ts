// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** True when a Theia modal dialog overlay is open above the Work Hub. */
export function isWorkHubTheiaDialogOpen(): boolean {
    for (const overlay of document.querySelectorAll('.lm-Widget.dialogOverlay')) {
        if (!overlay.classList.contains('hidden') && overlay.querySelector('.dialogBlock')) {
            return true;
        }
    }
    return false;
}
