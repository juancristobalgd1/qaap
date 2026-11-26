// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export const MOBILE_TURN_RESULT_CLASS = 'theia-mobile-turn-result';

/** The verification verdict a successful turn closed with (`done` or `warning`; blocked and failed turns have their own rows). */
export interface MobileTurnResultVerdict {
    readonly tone: 'done' | 'warning';
    readonly title: string;
    readonly details: readonly string[];
    /** True when the independent review rejected this turn's change (the composer's Create PR asks before going on). */
    readonly reviewRejected?: boolean;
}

/**
 * The verdict line that closes the Files Changed card once a turn succeeded. It carries no actions: the
 * next steps (open or run the preview, review the changes, commit, create a PR) are the pills above the
 * composer, so the transcript never repeats them per turn. `undefined` when the turn has no verdict.
 */
export function createMobileTurnResultFooterElement(verdict: MobileTurnResultVerdict | undefined): HTMLElement | undefined {
    if (!verdict) {
        return undefined;
    }
    const footer = document.createElement('div');
    footer.className = MOBILE_TURN_RESULT_CLASS;
    footer.append(createVerdictElement(verdict));
    return footer;
}

function createVerdictElement(verdict: MobileTurnResultVerdict): HTMLElement {
    const row = document.createElement('div');
    row.className = `${MOBILE_TURN_RESULT_CLASS}-verdict theia-mod-${verdict.tone}`;
    const icon = document.createElement('span');
    icon.className = `codicon ${verdict.tone === 'warning' ? 'codicon-warning' : 'codicon-pass'} ${MOBILE_TURN_RESULT_CLASS}-verdict-icon`;
    icon.setAttribute('aria-hidden', 'true');
    const title = document.createElement('span');
    title.className = `${MOBILE_TURN_RESULT_CLASS}-verdict-title`;
    title.textContent = verdict.title;
    row.append(icon, title);
    if (verdict.details.length > 0) {
        const details = document.createElement('span');
        details.className = `${MOBILE_TURN_RESULT_CLASS}-verdict-details`;
        details.textContent = verdict.details.join(' · ');
        row.append(details);
    }
    return row;
}
