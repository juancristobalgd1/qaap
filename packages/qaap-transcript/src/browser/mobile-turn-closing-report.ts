// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';

/** Visual tone of a turn's closing report. */
export type MobileTurnClosingTone = 'blocked' | 'warning' | 'failed' | 'done';

export const MOBILE_TURN_CLOSING_REPORT_CLASS = 'theia-mobile-turn-closing-report';

/**
 * Reads the store's closing report ("Blocked — needs your input: …", then "Checks: …",
 * "Independent review: …", "Changes: …") into a tone, a short title and the informative details.
 * Details that say nothing ("not run", "not measured", "none", "skipped") are dropped so the row stays quiet.
 */
export function parseMobileTurnClosingReport(report: string): { tone: MobileTurnClosingTone; title: string; details: string[] } {
    const [headline = '', ...rest] = report.split('\n').map(line => line.trim()).filter(Boolean);
    const details = rest.filter(line => !/^[^:]+:\s*(?:not run|not measured|none|skipped)\.?$/i.test(line)).map(line => line.replace(/\.$/, ''));
    if (/^blocked\b/i.test(headline)) {
        const need = headline.match(/needs your input:\s*(.+)$/i)?.[1]?.trim().replace(/\.$/, '');
        return {
            tone: 'blocked',
            title: nls.localize('qaap/transcript/closing/needsInput', 'Needs your input'),
            details: need ? [need, ...details] : details,
        };
    }
    if (/^failed\b/i.test(headline)) {
        return { tone: 'failed', title: stripTrailingPeriod(headline), details };
    }
    if (/^completed with warnings\b/i.test(headline)) {
        return { tone: 'warning', title: stripTrailingPeriod(headline), details };
    }
    return { tone: 'done', title: stripTrailingPeriod(headline), details: [] };
}

function stripTrailingPeriod(text: string): string {
    return text.replace(/\.$/, '');
}

const TONE_ICONS: Record<MobileTurnClosingTone, string> = {
    blocked: 'codicon-comment-discussion',
    warning: 'codicon-warning',
    failed: 'codicon-error',
    done: 'codicon-pass',
};

/** A quiet one-line closing row under the answer, in place of a raw "Error: …" text block. */
export function createMobileTurnClosingReportElement(report: string): HTMLElement {
    const { tone, title, details } = parseMobileTurnClosingReport(report);
    const row = document.createElement('div');
    row.className = `${MOBILE_TURN_CLOSING_REPORT_CLASS} theia-mod-${tone}`;
    const icon = document.createElement('span');
    icon.className = `codicon ${TONE_ICONS[tone]} ${MOBILE_TURN_CLOSING_REPORT_CLASS}-icon`;
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = `${MOBILE_TURN_CLOSING_REPORT_CLASS}-title`;
    label.textContent = title;
    row.append(icon, label);
    if (details.length > 0) {
        const detail = document.createElement('span');
        detail.className = `${MOBILE_TURN_CLOSING_REPORT_CLASS}-details`;
        detail.textContent = details.join(' · ');
        row.append(detail);
    }
    row.title = report;
    return row;
}
