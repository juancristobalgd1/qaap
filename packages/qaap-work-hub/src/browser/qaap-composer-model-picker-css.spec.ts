// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Rows keep one height whatever the harness: few models must not stretch or spread them.
 * The stylesheet is read directly, as the other CSS specs of this package do.
 */
describe('qaap composer model picker CSS', () => {
    const css = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'qaap-composer-model-picker.css'),
        'utf8',
    );

    /** Declarations of the first top-level rule whose selector list matches `selector`. */
    function declarations(selector: RegExp): string {
        const match = new RegExp(`(?:^|\\n)(${selector.source})\\s*\\{([^}]*)\\}`, 'm').exec(css);
        expect(match, `rule for ${selector}`).to.not.equal(null);
        return match![2];
    }

    it('gives every model row the same fixed height, with no flex growth', () => {
        const row = declarations(/\.qaap-model-picker-row/);
        expect(row).to.match(/height:\s*36px;/);
        expect(row).to.match(/min-height:\s*36px;/);
        expect(row).to.match(/max-height:\s*36px;/);
        expect(row).to.match(/flex:\s*0 0 auto;/);
        expect(row).to.not.match(/flex(?:-grow)?:\s*[1-9]/);
    });

    it('keeps rows at the top of the list, with the spare space left empty below', () => {
        const rows = declarations(/\.qaap-model-picker-rows/);
        expect(rows).to.match(/justify-content:\s*flex-start;/);
        expect(rows).to.match(/align-content:\s*flex-start;/);
    });

    it('uses 40px rows in the narrow layout', () => {
        const narrow = /@media \(max-width: 767px\)\s*\{[\s\S]*?\.qaap-model-picker-row\s*\{([^}]*)\}/.exec(css);
        expect(narrow, 'narrow row rule').to.not.equal(null);
        expect(narrow![1]).to.match(/height:\s*40px;/);
    });

    it('keeps rail items and footer groups from stretching', () => {
        expect(declarations(/\.qaap-model-picker-rail-item/)).to.match(/flex:\s*0 0 auto;/);
        expect(declarations(/\.qaap-model-picker-footer-left,\s*\.qaap-model-picker-footer-right/)).to.match(/flex:\s*0 0 auto;/);
    });
});
