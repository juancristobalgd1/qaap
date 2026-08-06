// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';

export interface TranscriptReviewChrome {
    readonly diffHost: HTMLElement;
    readonly checksHost: HTMLElement;
    readonly historyToggleHost: HTMLElement;
    readonly historyResizeHandle: HTMLElement;
    readonly historyPanel: HTMLElement;
}

/** Builds the external controls expected by the transcript-embedded diff widget. */
export function createTranscriptReviewChrome(
    host: HTMLElement,
    historyPanelOpen: boolean,
    historyPanelHeightPx?: number,
): TranscriptReviewChrome {
    host.replaceChildren();

    const diffHost = document.createElement('div');
    diffHost.className = 'theia-mobile-transcript-review-diff-host';

    const historyResizeHandle = document.createElement('div');
    historyResizeHandle.className = 'theia-mobile-transcript-history-resize';
    historyResizeHandle.tabIndex = 0;
    historyResizeHandle.setAttribute('role', 'separator');
    historyResizeHandle.setAttribute('aria-orientation', 'horizontal');
    historyResizeHandle.setAttribute('aria-label', nls.localize(
        'qaap/mobileProjects/historyResizePanel',
        'Resize history panel',
    ));
    historyResizeHandle.setAttribute('aria-valuemin', '150');
    historyResizeHandle.setAttribute('aria-valuenow', String(historyPanelHeightPx ?? 320));
    historyResizeHandle.hidden = !historyPanelOpen;

    const historyPanel = document.createElement('div');
    historyPanel.className = 'theia-mobile-transcript-history-panel';
    historyPanel.hidden = !historyPanelOpen;
    historyPanel.setAttribute('role', 'region');
    historyPanel.setAttribute('aria-label', nls.localize('qaap/mobileProjects/historyTitle', 'History'));
    if (historyPanelHeightPx !== undefined) {
        historyPanel.style.setProperty('--qaap-transcript-history-height', `${historyPanelHeightPx}px`);
    }

    const dock = document.createElement('div');
    dock.className = 'theia-mobile-transcript-changes-dock';
    const dockControls = document.createElement('div');
    dockControls.className = 'theia-mobile-transcript-changes-controls';
    const checksHost = document.createElement('div');
    checksHost.className = 'theia-mobile-transcript-review-checks';
    const historyToggleHost = document.createElement('div');
    historyToggleHost.className = 'theia-mobile-transcript-history-toggle-host';
    dockControls.append(checksHost, historyToggleHost);
    dock.append(dockControls);
    host.append(diffHost, historyResizeHandle, historyPanel, dock);

    return { diffHost, checksHost, historyToggleHost, historyResizeHandle, historyPanel };
}
