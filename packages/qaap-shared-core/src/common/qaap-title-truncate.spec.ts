// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { truncateTitleAtWordBoundary } from './qaap-title-truncate';

describe('truncateTitleAtWordBoundary', () => {
    it('returns short text unchanged apart from whitespace collapse', () => {
        expect(truncateTitleAtWordBoundary('  fix   the\nbug ', 120)).to.equal('fix the bug');
    });

    it('cuts at a word boundary with an ellipsis within the limit', () => {
        const text = 'npm run build -- --filter the quick brown fox jumps over the lazy dog repeatedly until the end';
        const title = truncateTitleAtWordBoundary(text, 80);
        expect(title).to.equal('npm run build -- --filter the quick brown fox jumps over the lazy dog…');
        expect(title.length).to.be.lessThanOrEqual(80);
    });

    it('falls back to a hard cut when there is no late word boundary', () => {
        expect(truncateTitleAtWordBoundary('a'.repeat(100), 80)).to.equal(`${'a'.repeat(79)}…`);
    });

    it('never ends the cut with a separator before the ellipsis', () => {
        const text = `${'word '.repeat(14)}, and more text that runs past the limit of eighty characters`;
        const title = truncateTitleAtWordBoundary(text, 80);
        expect(title.endsWith('and…')).to.equal(true);
        expect(title).to.not.match(/[\s,;:.-]…$/);
    });
});
