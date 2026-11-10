// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

/** Root of the `packages/` folder, from `packages/qaap-product-theme/lib/browser`. */
const packagesRoot = path.resolve(__dirname, '../../..');
const guardFile = path.join(packagesRoot, 'qaap-product-theme', 'src', 'browser', 'style', 'qaap-codicon-glyph-font.css');

interface CssRule {
    readonly file: string;
    readonly selectors: string[];
    readonly declarations: string;
}

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

const parseRules = (file: string): CssRule[] => {
    const css = stripComments(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
    const rules: CssRule[] = [];
    const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
    let match = rulePattern.exec(css);
    while (match) {
        const selectors = match[1].split(',').map(selector => selector.trim()).filter(selector => selector.length > 0);
        rules.push({ file, selectors, declarations: match[2] });
        match = rulePattern.exec(css);
    }
    return rules;
};

/** Stylesheets of every qaap-* package, read from the source tree (CSS is not compiled). */
const stylesheets = (): string[] => fs.readdirSync(packagesRoot)
    .filter(name => name.startsWith('qaap-'))
    .map(name => path.join(packagesRoot, name, 'src', 'browser', 'style'))
    .filter(folder => fs.existsSync(folder))
    .flatMap(folder => fs.readdirSync(folder)
        .filter(name => name.endsWith('.css'))
        .map(name => path.join(folder, name)));

const codiconSelector = /\.codicon[\w-]*/;
const fontDeclaration = /(?:^|[;{\s])font(?:-family)?\s*:\s*([^;}]+)/;

describe('qaap codicon glyph font guard', () => {

    it('pins the ::before glyph of every codicon to the codicon font', () => {
        const guard = parseRules(guardFile).find(rule => rule.selectors.some(selector => selector.endsWith('.codicon[class*=\'codicon-\']::before')));
        expect(guard, 'guard rule for .codicon[class*=\'codicon-\']::before').to.not.be.undefined;
        expect(guard!.declarations).to.match(/font-family\s*:\s*codicon\s*;/);
    });

    it('does not let any stylesheet replace the codicon font on a glyph pseudo-element', () => {
        const offenders: string[] = [];
        for (const file of stylesheets()) {
            for (const rule of parseRules(file)) {
                const glyphRule = rule.selectors.filter(selector => codiconSelector.test(selector) && selector.includes('::before'));
                if (glyphRule.length > 0 && fontDeclaration.test(rule.declarations)) {
                    const value = rule.declarations.match(fontDeclaration)?.[1] ?? '';
                    if (!/codicon/.test(value)) {
                        offenders.push(`${path.basename(file)}: ${glyphRule.join(', ')}`);
                    }
                }
            }
        }
        expect(offenders, 'codicon ::before rules that set a non-codicon font').to.deep.equal([]);
    });
});
