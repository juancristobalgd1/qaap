// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

/** Declarations of every top-level rule whose selector list contains `selector`. */
function declarationsFor(css: string, selector: string): string {
    const blocks: string[] = [];
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (match[1].split(',').map(part => part.trim()).includes(selector)) {
            blocks.push(match[2]);
        }
    }
    return blocks.join('\n');
}

describe('pull requests sidebar scroll CSS', () => {
    const css = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'qaap-work-hub-pull-requests.css'),
        'utf8',
    );
    const mode = '.theia-mobile-work-hub-sessions-sidebar.theia-mod-pull-requests';

    it('locks the outer sidebar scroller even against the mobile native-scroll !important rule', () => {
        const outer = declarationsFor(css, `${mode} .theia-mobile-work-hub-sessions-sidebar-scroll`);
        expect(outer).to.match(/overflow:\s*hidden\s*!important/);
        expect(outer).to.match(/display:\s*flex/);
        expect(outer).to.match(/flex-direction:\s*column/);
    });

    it('bounds every level down to the results list so it is the one that scrolls', () => {
        for (const level of ['.theia-mobile-work-hub-sessions-sidebar-list', '.theia-mobile-work-hub-pull-requests']) {
            const declarations = declarationsFor(css, `${mode} ${level}`);
            expect(declarations, level).to.match(/flex:\s*1 1 0/);
            expect(declarations, level).to.match(/min-height:\s*0/);
            // `height: 100%` against an auto-height parent resolves to auto: the list never overflowed.
            expect(declarations, level).to.not.match(/height:\s*100%/);
        }
        const results = declarationsFor(css, '.theia-mobile-work-hub-pull-requests-results');
        expect(results).to.match(/min-height:\s*0/);
        expect(results).to.match(/overflow:\s*auto/);
    });
});
