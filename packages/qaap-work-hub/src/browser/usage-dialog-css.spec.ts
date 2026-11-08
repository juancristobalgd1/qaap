// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

describe('usage dialog stylesheet', () => {

    const css = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'qaap-usage-dialog.css'), 'utf8');

    function ruleBody(selector: string): string {
        const start = css.indexOf(`${selector} {`);
        expect(start, `rule ${selector}`).to.be.greaterThan(-1);
        return css.slice(start, css.indexOf('}', start));
    }

    it('gives the notice a 16px top offset from the body, a 20px gap below and a 1.4 line height', () => {
        const notice = ruleBody('.theia-qaap-usage-notice');
        expect(notice).to.contain('line-height: 1.4');
        // Body padding supplies the 16px top edge; the notice's bottom margin plus the 16px content gap gives 20px.
        expect(notice).to.contain('margin: 0 0 4px');
        expect(css).to.match(/\.theia-qaap-usage-body \{[^}]*padding: 16px 20px 24px/);
    });

    it('uses 12px top and 16px bottom spacing for the notice on narrow viewports', () => {
        const media = css.slice(css.indexOf('@media (max-width: 767px)'));
        expect(media).to.match(/\.theia-qaap-usage-body \{\s*padding: 12px 16px/);
        expect(media).to.match(/\.theia-qaap-usage-notice \{\s*margin-bottom: 0;/);
    });

    it('keeps the provider menu a popover with a shadow and 10px radius', () => {
        expect(ruleBody('.theia-qaap-usage-provider-menu')).to.contain('border-radius: 10px');
        expect(ruleBody('.theia-qaap-usage-provider-menu')).to.contain('box-shadow: var(--theia-widget-shadow)');
        expect(ruleBody('.theia-qaap-usage-provider-option')).to.contain('min-height: 34px');
    });
});
