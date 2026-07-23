// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Header execution tabs (overflow select) — shared by transcript sheet and project task detail. */
export type ExecutionSurfaceHeaderTabId = 'messages' | 'plan' | 'review' | 'preview' | 'files' | 'terminal';

/**
 * View switcher trigger only — excludes the Terminal agent-TUI control that shares the same
 * base `.theia-mobile-transcript-tab-icon-select` class when both sit in the header strip.
 */
export const EXECUTION_SURFACE_VIEW_SELECT_SELECTOR =
    '.theia-mobile-transcript-tab-icon-select:not(.theia-mobile-transcript-terminal-agent-tui)';

export function queryExecutionSurfaceViewSelect(strip: HTMLElement): HTMLButtonElement | null {
    return strip.querySelector(EXECUTION_SURFACE_VIEW_SELECT_SELECTOR);
}

/** Keeps the header view picker in sync with the active execution surface tab. */
export function applyExecutionSurfaceHeaderChrome(
    strip: HTMLElement,
    _activeTab: ExecutionSurfaceHeaderTabId,
): void {
    const selectBtn = queryExecutionSurfaceViewSelect(strip);
    if (selectBtn) {
        selectBtn.classList.remove('theia-mod-active');
        selectBtn.classList.add('theia-mod-selected');
        selectBtn.dataset.surfaceActive = 'true';
        selectBtn.setAttribute('aria-selected', 'true');
    }
}
