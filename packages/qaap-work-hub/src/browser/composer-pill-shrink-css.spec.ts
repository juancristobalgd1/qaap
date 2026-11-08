// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

/** The model pill shrinks with an ellipsis and the send control never gives way. */
describe('composer pill shrink CSS', () => {
    const css = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'qaap-composer-model-picker.css'),
        'utf8',
    // A Windows checkout has CRLF line endings; the multi-line selectors below use \n.
    ).replace(/\r\n/g, '\n');

    function declarations(selector: string): string {
        const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
        expect(match, `rule ${selector}`).to.not.equal(null);
        return match![1];
    }

    it('lets the controls-left group shrink, and keeps the right group and actions at full size', () => {
        expect(declarations('.theia-mobile-projects-sticky-composer-controls-left')).to.match(/min-width:\s*0;/);
        expect(declarations('.theia-mobile-projects-sticky-composer-controls-right,\n.theia-mobile-projects-sticky-composer-input-actions'))
            .to.match(/flex-shrink:\s*0;/);
    });

    it('ellipsises the pill label and lets the pill itself shrink', () => {
        expect(declarations('.theia-mobile-projects-sticky-composer-agent')).to.match(/min-width:\s*0;/);
        const label = declarations('.theia-mobile-projects-sticky-composer-agent .theia-mobile-projects-sticky-composer-agent-label');
        expect(label).to.match(/text-overflow:\s*ellipsis;/);
        expect(label).to.match(/white-space:\s*nowrap;/);
        expect(label).to.match(/overflow:\s*hidden;/);
    });

    it('keeps effort and chevron from shrinking', () => {
        expect(declarations('.theia-mobile-projects-sticky-composer-agent .theia-mobile-projects-sticky-composer-agent-effort,\n.theia-mobile-projects-sticky-composer-agent .codicon-chevron-down'))
            .to.match(/flex:\s*0 0 auto;/);
    });
});
