// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

const packagesRoot = path.resolve(__dirname, '../../..');
const stylesheet = path.join(packagesRoot, 'qaap-product-theme', 'src', 'browser', 'style', 'qaap-electron-macos-titlebar.css');

interface CssRule {
    readonly selectors: string[];
    readonly declarations: string;
}

const parseRules = (): CssRule[] => {
    const css = fs.readFileSync(stylesheet, 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
    const rules: CssRule[] = [];
    const pattern = /([^{}]+)\{([^{}]*)\}/g;
    let match = pattern.exec(css);
    while (match) {
        rules.push({ selectors: [match[1]], declarations: match[2] });
        match = pattern.exec(css);
    }
    return rules;
};

describe('qaap-electron-macos-titlebar.css click-through guards', () => {
    const rules = parseRules();
    const noDragText = rules.filter(rule => /-webkit-app-region:\s*no-drag/.test(rule.declarations)).map(rule => rule.selectors[0]).join('\n');
    const dragRules = rules.filter(rule => /-webkit-app-region:\s*drag/.test(rule.declarations));

    it('declares drag regions', () => {
        expect(dragRules.length).to.be.greaterThan(0);
    });

    for (const token of [
        "[role='dialog']", "[aria-modal='true']", "[role='menu']", "[role='listbox']",
        '.dialogOverlay', '.quick-input-widget', '.monaco-quick-input-widget', '.p-Menu', '.lm-Menu',
        '.monaco-menu-container', '.context-view', '.theia-hover', '.monaco-hover', '.theia-notifications-container',
        '.theia-qaap-account-menu', '.theia-mobile-work-hub-unified-search', '.theia-mobile-work-hub-preferences',
        '.theia-mobile-sheet-backdrop'
    ]) {
        it(`opts the overlay ${token} out of the drag region`, () => {
            expect(noDragText).to.contain(token);
        });
    }

    for (const token of ["[tabindex]:not([tabindex='-1'])", '[contenteditable', "[role='tab']", "[role='switch']", "[role='checkbox']", "[role='option']", "[role='link']"]) {
        it(`opts the interactive ${token} out of the drag region`, () => {
            expect(noDragText).to.contain(token);
        });
    }

    it('does not use :has()', () => {
        expect(fs.readFileSync(stylesheet, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')).to.not.match(/:has\(/);
    });
});
