// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Removes comments and quoted strings so that braces inside them are not counted.
 */
function stripCommentsAndStrings(source: string): string {
    let output = '';
    let index = 0;
    while (index < source.length) {
        const char = source[index];
        const next = source[index + 1];
        if (char === '/' && next === '*') {
            const end = source.indexOf('*/', index + 2);
            index = end < 0 ? source.length : end + 2;
            output += ' ';
            continue;
        }
        if (char === '"' || char === '\'') {
            let end = index + 1;
            while (end < source.length && source[end] !== char && source[end] !== '\n') {
                if (source[end] === '\\') {
                    end++;
                }
                end++;
            }
            index = end + 1;
            output += ' ';
            continue;
        }
        output += char;
        index++;
    }
    return output;
}

/**
 * Returns a description of the first brace problem in the CSS source, or `undefined` when braces are balanced.
 */
function findBraceProblem(source: string): string | undefined {
    const stripped = stripCommentsAndStrings(source);
    let depth = 0;
    let line = 1;
    for (const char of stripped) {
        if (char === '\n') {
            line++;
        } else if (char === '{') {
            depth++;
        } else if (char === '}') {
            depth--;
            if (depth < 0) {
                return `unexpected '}' at line ${line}`;
            }
        }
    }
    return depth === 0 ? undefined : `${depth} unclosed '{' at end of file`;
}

function collectCssFiles(directory: string): string[] {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            return collectCssFiles(entryPath);
        }
        return entry.name.endsWith('.css') ? [entryPath] : [];
    });
}

describe('qaap CSS brace balance', () => {

    // Compiled specs live in packages/<pkg>/lib/browser/style, so four levels up is `packages/`.
    const packagesDirectory = path.resolve(__dirname, '..', '..', '..', '..');

    it('every packages/qaap-*/src stylesheet has balanced braces', () => {
        expect(fs.existsSync(packagesDirectory), `packages directory not found: ${packagesDirectory}`).to.be.true;
        const qaapPackages = fs.readdirSync(packagesDirectory).filter(name => name.startsWith('qaap-'));
        expect(qaapPackages.length).to.be.greaterThan(0);
        const problems: string[] = [];
        let checked = 0;
        for (const pkg of qaapPackages) {
            const srcDirectory = path.join(packagesDirectory, pkg, 'src');
            if (!fs.existsSync(srcDirectory)) {
                continue;
            }
            for (const cssFile of collectCssFiles(srcDirectory)) {
                checked++;
                const problem = findBraceProblem(fs.readFileSync(cssFile, 'utf8'));
                if (problem) {
                    problems.push(`${path.relative(packagesDirectory, cssFile)}: ${problem}`);
                }
            }
        }
        expect(checked).to.be.greaterThan(0);
        expect(problems).to.deep.equal([]);
    });

    it('detects unbalanced braces and ignores braces in comments and strings', () => {
        expect(findBraceProblem('.a { color: red; }')).to.be.undefined;
        expect(findBraceProblem('/* { */ .a { content: "}"; }')).to.be.undefined;
        expect(findBraceProblem('.a { color: red;')).to.be.a('string');
        expect(findBraceProblem('.a { } }')).to.be.a('string');
    });
});
