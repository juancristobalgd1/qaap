// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

/** The workspace sheet tabs are plain text with a 2px underline on the active one, no box or fill. */
describe('workspace sheet tabs CSS', () => {
    const css = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'mobile-workbench-conversation.css'),
        'utf8',
    );
    const tabSelector = '.qaap-sticky-composer-sheet-popover .theia-qaap-segmented-bar.theia-mod-composer-workspace-sheet-nav > .theia-qaap-segmented-option';

    /** The last rule for the tab selector: later rules win the cascade. */
    function lastDeclarations(selector: string): string {
        const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const matches = [...css.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, 'g'))];
        expect(matches.length, `rule ${selector}`).to.be.greaterThan(0);
        return matches[matches.length - 1][1];
    }

    it('gives the tabs no box and no fill, with the description colour', () => {
        const tab = lastDeclarations(tabSelector);
        expect(tab).to.match(/background:\s*transparent;/);
        expect(tab).to.match(/border:\s*none;/);
        expect(tab).to.match(/color:\s*var\(--theia-descriptionForeground\);/);
        expect(tab).to.match(/font-size:\s*13px;/);
    });

    it('underlines the active tab with a 2px bar in the focus colour', () => {
        const underline = lastDeclarations(`${tabSelector}::after`);
        expect(underline).to.match(/height:\s*2px;/);
        const active = lastDeclarations('.qaap-sticky-composer-sheet-popover .theia-qaap-segmented-bar.theia-mod-composer-workspace-sheet-nav .theia-qaap-segmented-option[aria-pressed="true"]::after');
        expect(active).to.match(/var\(--theia-focusBorder/);
    });
});
