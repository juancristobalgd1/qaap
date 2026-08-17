// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

describe('turn-failure shell body padding', () => {

    const css = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'mobile-workbench-transcript.css'),
        'utf8',
    );

    it('insets the open failure body so copy is not flush to the card edges', () => {
        expect(css).to.match(
            /\.theia-mobile-agent-shell-window\.theia-mod-turn-failure\[open\]\s+\.theia-mobile-agent-shell-body\s*\{[^}]*padding:\s*12px 14px 14px/s,
        );
    });

    it('does not zero inline padding on the open failure body', () => {
        const openBlock = css.match(
            /\.theia-mobile-agent-shell-window\.theia-mod-turn-failure\[open\]\s+\.theia-mobile-agent-shell-body\s*\{[^}]+\}/s,
        );
        expect(openBlock).to.not.equal(null);
        expect(openBlock![0]).to.not.include('padding-inline: 0');
        expect(css).to.include(
            '.theia-mobile-agent-shell-window.theia-mod-turn-failure:not([open]) .theia-mobile-agent-shell-body',
        );
    });
});
