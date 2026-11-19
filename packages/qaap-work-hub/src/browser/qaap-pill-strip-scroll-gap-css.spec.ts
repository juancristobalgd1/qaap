// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

/** The transcript tail must clear the Changes / Approve / Preview pill strip on every sticky-composer surface. */
describe('pill strip scroll gap CSS', () => {
    const css = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'mobile-workbench-conversation.css'),
        'utf8',
    ).replace(/\r\n/g, '\n');

    it('derives the scroll gap from the measured strip height without requiring the agents hub classes', () => {
        const match = /(?:^|\n)((?:\.theia-mobile-projects[^{]*,\n)*\.theia-mobile-projects[^{]*)\{([^}]*--theia-mobile-transcript-composer-scroll-gap:\s*calc\(-1 \* \(var\(--qaap-composer-pill-strip-height[^}]*)\}/.exec(css);
        expect(match, 'strip-derived gap rule').to.not.equal(null);
        const selectors = match![1].split(',\n').map(selector => selector.trim());
        expect(selectors).to.include('.theia-mobile-projects.theia-mod-sticky-composer.theia-mod-has-changes-pill');
    });
});
