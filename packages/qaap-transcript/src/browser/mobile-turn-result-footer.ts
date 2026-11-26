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
 * The verdict line that closes the Files Changed card once a turn succeeded with warnings. Clean
 * `done` turns stay quiet (no footer); warning verdicts with details collapse into a compact
 * one-line disclosure so the transcript stays calm while keeping review feedback one tap away.
 * Carries no actions: the composer pills own preview, review, commit and Create PR.
 */
export function createMobileTurnResultFooterElement(verdict: MobileTurnResultVerdict | undefined): HTMLElement | undefined {
    if (!verdict || verdict.tone === 'done') {
        return undefined;
    }
    const footer = document.createElement('div');
    footer.className = MOBILE_TURN_RESULT_CLASS;
    footer.append(createVerdictElement(verdict));
    return footer;
}

function createVerdictElement(verdict: MobileTurnResultVerdict): HTMLElement {
    const icon = document.createElement('span');
    icon.className = `codicon codicon-warning ${MOBILE_TURN_RESULT_CLASS}-verdict-icon`;
    icon.setAttribute('aria-hidden', 'true');
    const title = document.createElement('span');
    title.className = `${MOBILE_TURN_RESULT_CLASS}-verdict-title`;
    title.textContent = verdict.title;
    if (verdict.details.length === 0) {
        const row = document.createElement('div');
        row.className = `${MOBILE_TURN_RESULT_CLASS}-verdict theia-mod-${verdict.tone}`;
        row.append(icon, title);
        return row;
    }
    const disclosure = document.createElement('details');
    disclosure.className = `${MOBILE_TURN_RESULT_CLASS}-verdict theia-mod-${verdict.tone}`;
    const summary = document.createElement('summary');
    summary.className = `${MOBILE_TURN_RESULT_CLASS}-verdict-summary`;
    const chevron = document.createElement('span');
    chevron.className = `codicon codicon-chevron-right ${MOBILE_TURN_RESULT_CLASS}-verdict-chevron`;
    chevron.setAttribute('aria-hidden', 'true');
    summary.append(icon, title, chevron);
    const details = document.createElement('div');
    details.className = `${MOBILE_TURN_RESULT_CLASS}-verdict-details`;
    details.textContent = verdict.details.join('\n');
    disclosure.append(summary, details);
    return disclosure;
}
