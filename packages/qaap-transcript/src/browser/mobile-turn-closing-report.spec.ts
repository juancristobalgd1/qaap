// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { createMobileTurnClosingReportElement, MOBILE_TURN_CLOSING_REPORT_CLASS, parseMobileTurnClosingReport } from './mobile-turn-closing-report';

describe('parseMobileTurnClosingReport', () => {
    it('reads a blocked headline into the blocked tone with the question as first detail', () => {
        const parsed = parseMobileTurnClosingReport('Blocked — needs your input: pick a database.');
        expect(parsed.tone).to.equal('blocked');
        expect(parsed.details[0]).to.equal('pick a database');
    });

    it('drops detail lines that say nothing', () => {
        const parsed = parseMobileTurnClosingReport([
            'Blocked — needs your input: pick a database.',
            'Checks: not run.',
            'Independent review: not run.',
            'Changes: not measured.',
            'Changes: none.',
        ].join('\n'));
        expect(parsed.details).to.deep.equal(['pick a database']);
    });

    it('keeps an informative detail that only mentions none inside a list', () => {
        const parsed = parseMobileTurnClosingReport('Failed — checks did not pass.\nChecks: failing (npm test), none.');
        expect(parsed.tone).to.equal('failed');
        expect(parsed.details).to.deep.equal(['Checks: failing (npm test), none']);
    });

    it('reads a warning headline into the warning tone', () => {
        const parsed = parseMobileTurnClosingReport('Completed with warnings — x');
        expect(parsed.tone).to.equal('warning');
        expect(parsed.title).to.equal('Completed with warnings — x');
    });

    it('reads a done headline into the done tone without details', () => {
        const parsed = parseMobileTurnClosingReport('Done.\nChecks: passing (npm test).');
        expect(parsed.tone).to.equal('done');
        expect(parsed.title).to.equal('Done');
        expect(parsed.details).to.deep.equal([]);
    });
});

describe('createMobileTurnClosingReportElement', () => {
    it('renders a row without a status role and with a decorative icon', () => {
        const row = createMobileTurnClosingReportElement('Done.\nChecks: passing (npm test).');
        expect(row.classList.contains(MOBILE_TURN_CLOSING_REPORT_CLASS)).to.equal(true);
        expect(row.classList.contains('theia-mod-done')).to.equal(true);
        expect(row.hasAttribute('role')).to.equal(false);
        const icon = row.querySelector('.codicon');
        expect(icon?.getAttribute('aria-hidden')).to.equal('true');
    });
});
