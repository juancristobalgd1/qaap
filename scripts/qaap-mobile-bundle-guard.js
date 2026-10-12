#!/usr/bin/env node
// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************
// @ts-check
'use strict';
/**
 * Mobile bundle guard. Product rule: on mobile the Theia IDE never loads, so `bundle-mobile.js`
 * (entry input `src-gen/frontend/index-mobile.js`) must not reach IDE code. Reads the esbuild
 * metafile written by `examples/browser/esbuild.mjs` and walks the INPUT import graph from the
 * mobile entry (static imports, require calls and dynamic imports alike):
 *
 *   - HARD FAIL when any reachable input matches FORBIDDEN (plugin host, debug, notebook, vsx,
 *     terminal, task, xterm).
 *   - RATCHET for Monaco (`monaco-editor-core`, `packages/monaco/`): fails only when the reachable
 *     source bytes exceed `scripts/qaap-mobile-bundle-budget.json` -> `monacoBytes`. Source bytes
 *     (not emitted bytes) so the number is the same in development and production builds. Lower
 *     the budget whenever an import cut shrinks it; never raise it.
 *   - HARD FAIL when a whole vendor barrel listed in WHOLE_BARRELS is reachable (all date-fns
 *     functions and locales, all highlight.js languages): `vendorShimPlugin` in
 *     `examples/browser/esbuild.mjs` narrows those imports, a new importer must be narrowed too.
 *
 * `--report` prints the findings and exits 0 (use while the Work Hub still imports IDE code). For
 * every forbidden package the SHORTEST import chain from the entry is printed: that list is the
 * to-do list of import cuts. Without `--report` the process exits 1 on any finding.
 *
 * Usage: node scripts/qaap-mobile-bundle-guard.js [--report] [--metafile <file>] [--budget <file>]
 *                                                 [--entry <name>] [--json <file>]
 */
const fs = require('fs');
const path = require('path');
const lib = require('./qaap-frontend-metafile-lib');

const FORBIDDEN = [
    /packages\/(plugin-ext|plugin-ext-vscode|debug|notebook|vsx-registry|terminal|task)\//,
    /node_modules\/(@xterm|xterm)/
];
const WHOLE_BARRELS = [/node_modules\/date-fns\/(?:index|locale)\.c?js$/, /node_modules\/highlight\.js\/lib\/index\.js$/];
const MONACO = [/monaco-editor-core/, /packages\/monaco\//];
const DEFAULT_BUDGET = path.join(__dirname, 'qaap-mobile-bundle-budget.json');

function arg(name, fallback) {
    const index = process.argv.indexOf(name);
    return index === -1 ? fallback : process.argv[index + 1];
}

/** @param {string} input */
const normalize = input => input.replace(/\\/g, '/');

/**
 * Group an input path belongs to when forbidden: `packages/<dir>` or `node_modules/<xterm package>`.
 * @param {string} input
 * @returns {string | undefined}
 */
function forbiddenGroup(input) {
    const normalized = normalize(input);
    for (const pattern of FORBIDDEN) {
        const match = pattern.exec(normalized);
        if (match) {
            return pattern === FORBIDDEN[0] ? `packages/${match[1]}` : `node_modules/${match[1]}`;
        }
    }
    return undefined;
}

/** @param {string} input */
function isMonaco(input) {
    const normalized = normalize(input);
    return MONACO.some(pattern => pattern.test(normalized));
}

/** @param {string} input */
const display = input => normalize(input).replace(/^(?:\.\.\/)+/, '');

function main() {
    const report = process.argv.includes('--report');
    const entry = arg('--entry', 'bundle-mobile');
    const meta = lib.readMetafile(arg('--metafile', lib.DEFAULT_METAFILE));
    const found = lib.entryOutputs(meta).find(([output]) => lib.entryName(output) === entry && output.endsWith('.js'));
    if (!found) {
        console.error(`[qaap-mobile-bundle-guard] no "${entry}" entry in the metafile. Build the browser example first; `
            + 'the entry exists once @theia/qaap-product declares `qaapMobile` and `theia generate` has run.');
        return 2;
    }
    const [entryOutput, entryInfo] = found;
    const entryInput = entryInfo.entryPoint;

    const { chains, reachable } = lib.shortestChains(meta, entryInput, forbiddenGroup);
    const forbiddenInputs = [...reachable].filter(input => forbiddenGroup(input) !== undefined);
    const monacoInputs = [...reachable].filter(isMonaco);
    const monacoBytes = monacoInputs.reduce((sum, input) => sum + (meta.inputs[input]?.bytes || 0), 0);
    const budget = JSON.parse(fs.readFileSync(arg('--budget', DEFAULT_BUDGET), 'utf8'));
    const monacoBudget = Number(budget.monacoBytes);

    const closure = lib.outputClosure(meta, entryOutput);
    const graphBytes = [...closure].reduce((sum, output) => sum + meta.outputs[output].bytes, 0);
    console.log(`Mobile bundle guard: entry ${display(entryInput)} -> ${path.basename(entryOutput)}`
        + ` (${reachable.size} inputs reachable, ${closure.size} output file(s), ${lib.formatBytes(graphBytes)} emitted JS+CSS)`);

    const groups = [...chains.keys()].sort();
    console.log('');
    if (!groups.length) {
        console.log('Forbidden IDE packages reachable: none');
    } else {
        console.log(`Forbidden IDE packages reachable: ${groups.length} (${forbiddenInputs.length} input files). Shortest chain per package:`);
        for (const group of groups) {
            const chain = /** @type {string[]} */ (chains.get(group));
            const files = forbiddenInputs.filter(input => forbiddenGroup(input) === group);
            const bytes = files.reduce((sum, input) => sum + (meta.inputs[input]?.bytes || 0), 0);
            console.log('');
            console.log(`  FORBIDDEN ${group}  (${files.length} files, ${lib.formatBytes(bytes)} source)`);
            console.log(`    packages: ${lib.packageHops(chain).join(' > ')}`);
            chain.forEach((input, index) => console.log(`    ${String(index).padStart(2)}. ${display(input)}`));
        }
    }

    console.log('');
    const overBudget = monacoBytes > monacoBudget;
    console.log(`Monaco (monaco-editor-core + packages/monaco): ${lib.formatBytes(monacoBytes)} source in ${monacoInputs.length} files`
        + ` / budget ${lib.formatBytes(monacoBudget)} -> ${overBudget ? 'OVER BUDGET' : 'ok'}`);
    if (monacoInputs.length) {
        const { chains: monacoChains } = lib.shortestChains(meta, entryInput, input => isMonaco(input) ? 'monaco' : undefined);
        const chain = monacoChains.get('monaco');
        if (chain) {
            console.log(`    shortest chain: ${lib.packageHops(chain).join(' > ')}`);
            chain.forEach((input, index) => console.log(`    ${String(index).padStart(2)}. ${display(input)}`));
        }
    }

    const barrels = [...reachable].filter(input => WHOLE_BARRELS.some(pattern => pattern.test(normalize(input))));
    console.log('');
    console.log(`Whole vendor barrels reachable: ${barrels.length ? '' : 'none'}`);
    if (barrels.length) {
        const { chains: barrelChains } = lib.shortestChains(meta, entryInput, input => barrels.includes(input) ? display(input) : undefined);
        for (const [barrel, chain] of barrelChains) {
            console.log(`  WHOLE BARREL ${barrel} <- ${display(chain[chain.length - 2] || entryInput)}`);
        }
    }

    const jsonFile = arg('--json', undefined);
    if (jsonFile) {
        fs.writeFileSync(jsonFile, JSON.stringify({
            entry: display(entryInput),
            forbidden: Object.fromEntries(groups.map(group => [group, (chains.get(group) || []).map(display)])),
            monacoBytes, monacoBudget,
            wholeBarrels: barrels.map(display)
        }, undefined, 2) + '\n');
    }

    const failures = groups.length + (overBudget ? 1 : 0) + barrels.length;
    if (failures) {
        console.log('');
        console.log(`${failures} finding(s)${report ? ' (report mode: not failing)' : ''}.`);
    }
    return report ? 0 : (failures ? 1 : 0);
}

try {
    process.exit(main());
} catch (error) {
    console.error(`[qaap-mobile-bundle-guard] ${error instanceof Error ? error.message : error}`);
    process.exit(2);
}
