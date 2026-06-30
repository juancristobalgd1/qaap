// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable } from '@theia/core/lib/common/disposable';
import { nls } from '@theia/core/lib/common/nls';
import { markTranscriptUserScrollIntent } from './qaap-transcript-scroll-intent';

const TRANSCRIPT_DENSITY_STORAGE_KEY = 'qaap.transcript.density';
const DENSITY_BUTTON_CLASS = 'theia-mobile-agent-transcript-density-toggle';

export type QaapTranscriptDensity = 'comfortable' | 'compact';

function readTranscriptDensity(): QaapTranscriptDensity {
    try {
        return window.localStorage.getItem(TRANSCRIPT_DENSITY_STORAGE_KEY) === 'compact' ? 'compact' : 'comfortable';
    } catch {
        return 'comfortable';
    }
}

function writeTranscriptDensity(density: QaapTranscriptDensity): void {
    try {
        window.localStorage.setItem(TRANSCRIPT_DENSITY_STORAGE_KEY, density);
    } catch {
        // Storage can be unavailable in private contexts; keep the in-DOM state.
    }
}

function applyTranscriptDensity(scroller: HTMLElement, density: QaapTranscriptDensity): void {
    scroller.classList.toggle('theia-mod-density-compact', density === 'compact');
    scroller.classList.toggle('theia-mod-density-comfortable', density !== 'compact');
}

export function attachTranscriptDensityToggle(mountHost: HTMLElement, scroller: HTMLElement): Disposable {
    mountHost.querySelector(`.${DENSITY_BUTTON_CLASS}`)?.remove();

    let density = readTranscriptDensity();
    applyTranscriptDensity(scroller, density);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `${DENSITY_BUTTON_CLASS} codicon codicon-list-selection`;

    const syncLabel = (): void => {
        const label = density === 'compact'
            ? nls.localize('qaap/mobileProjects/transcriptDensityComfortable', 'Use comfortable density')
            : nls.localize('qaap/mobileProjects/transcriptDensityCompact', 'Use compact density');
        button.title = label;
        button.setAttribute('aria-label', label);
        button.setAttribute('aria-pressed', density === 'compact' ? 'true' : 'false');
    };
    syncLabel();

    const toggle = (): void => {
        const scrollTop = scroller.scrollTop;
        density = density === 'compact' ? 'comfortable' : 'compact';
        writeTranscriptDensity(density);
        applyTranscriptDensity(scroller, density);
        markTranscriptUserScrollIntent(scroller, 'density');
        scroller.scrollTop = scrollTop;
        syncLabel();
    };

    button.addEventListener('click', toggle);
    mountHost.append(button);

    return Disposable.create(() => {
        button.removeEventListener('click', toggle);
        button.remove();
    });
}
