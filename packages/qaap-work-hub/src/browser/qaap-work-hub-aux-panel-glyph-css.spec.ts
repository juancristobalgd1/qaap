// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

/** The chat-header view trigger swaps chevrons ↔ right-panel glyph with the viewport, not with a build-time class. */
describe('work hub aux panel trigger glyph CSS', () => {
    // Windows checkouts get CRLF; the selectors below are matched with `\n`.
    const css = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'qaap-work-hub-aux-panel.css'),
        'utf8',
    ).replace(/\r\n/g, '\n');
    const desktopMedia = '@media (min-width: 768px) and (pointer: fine) {';
    const trigger = 'body:not(.theia-mobile-mod-desktop-ide) .theia-mobile-transcript-tab-icon-select-double-chevron';

    function declarations(source: string, selector: string): string | undefined {
        const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(source)?.[1];
    }

    it('hides the right-panel glyph by default (phone layout)', () => {
        expect(declarations(css, '.theia-mobile-transcript-tab-icon-select-double-chevron .qaap-glyph-right-panel'))
            .to.match(/display:\s*none;/);
    });

    it('shows the right-panel glyph in the desktop layout without needing the toggle class', () => {
        const start = css.indexOf(desktopMedia);
        expect(start, 'desktop media block').to.be.greaterThan(-1);
        const desktopBlock = css.slice(start);
        expect(declarations(desktopBlock, `${trigger} .qaap-glyph-view-menu`)).to.match(/display:\s*none;/);
        expect(declarations(desktopBlock, `${trigger} .qaap-glyph-right-panel`)).to.match(/display:\s*inline;/);
        expect(desktopBlock).to.not.contain('.qaap-mod-aux-panel-toggle .qaap-glyph');
    });
});
