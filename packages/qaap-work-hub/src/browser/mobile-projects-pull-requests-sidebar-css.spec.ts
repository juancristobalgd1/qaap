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

    it('keeps pull request detail scrollport stretched and free of horizontal overflow', () => {
        const detailScroll = declarationsFor(
            css,
            '.theia-mobile-projects.theia-mod-pull-request-detail > .theia-mobile-projects-scroll',
        );
        expect(detailScroll).to.match(/align-items:\s*stretch\s*!important/);
        expect(detailScroll).to.match(/padding:\s*0\s*!important/);
        expect(detailScroll).to.match(/overflow-x:\s*hidden\s*!important/);
        expect(detailScroll).to.match(/overflow-y:\s*auto\s*!important/);

        const detail = declarationsFor(css, '.qaap-pr');
        expect(detail).to.match(/box-sizing:\s*border-box/);
        expect(detail).to.match(/width:\s*100%/);
        expect(detail).to.match(/min-width:\s*0/);
    });

    it('styles the floating comment trigger and popover instead of a sticky footer bar', () => {
        expect(css).to.not.include('.theia-mobile-work-hub-pull-request-comment-row');
        const dock = declarationsFor(css, '.qaap-pr-floating-dock');
        expect(dock).to.match(/position:\s*sticky/);
        expect(dock).to.match(/pointer-events:\s*none/);

        const fab = declarationsFor(css, '.qaap-pr-fab');
        expect(fab).to.match(/display:\s*inline-flex/);
        expect(fab).to.match(/align-items:\s*center/);
        expect(fab).to.match(/justify-content:\s*center/);

        const popover = declarationsFor(css, '.qaap-pr-comment-popover');
        expect(popover).to.match(/box-sizing:\s*border-box/);
        expect(popover).to.match(/max-width:/);
    });

    it('centers sidebar header icon buttons symmetrically', () => {
        const sidebarCss = fs.readFileSync(
            path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'qaap-work-hub-sessions-sidebar.css'),
            'utf8',
        );
        for (const selector of [
            '.theia-mobile-work-hub-sessions-sidebar-back',
            '.theia-mobile-work-hub-sessions-sidebar-close',
            '.theia-mobile-work-hub-sessions-sidebar-pull-request-search',
        ]) {
            const decls = declarationsFor(sidebarCss, selector);
            expect(decls, selector).to.match(/display:\s*inline-flex/);
            expect(decls, selector).to.match(/align-items:\s*center/);
            expect(decls, selector).to.match(/justify-content:\s*center/);
            expect(decls, selector).to.match(/padding:\s*0/);
        }
    });
});
