#!/usr/bin/env node
// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************
// @ts-check
'use strict';
/**
 * Package-graph guard for `packages/qaap-*`:
 *  1. no relative import (or `../../src/...` asset import) resolves outside the importing package;
 *  2. every `@theia/qaap-*` package imported from `src/` is declared in `dependencies`;
 *  3. the `@theia/qaap-*` dependency graph has no cycles.
 * Exit code 1 on any finding.
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '..');
const pkgRoot = path.join(repoRoot, 'packages');
const SKIP = new Set(['node_modules', 'lib', 'coverage', '.nyc_output']);

function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) {
            if (!SKIP.has(e.name)) { walk(path.join(dir, e.name), out); }
        } else if (/\.tsx?$/.test(e.name)) {
            out.push(path.join(dir, e.name));
        }
    }
    return out;
}

function specifiers(file) {
    const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const out = [];
    const visit = node => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            out.push(node.moduleSpecifier.text);
        } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
            out.push(node.argument.literal.text);
        } else if (ts.isCallExpression(node) && node.arguments.length && ts.isStringLiteralLike(node.arguments[0])
            && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
            out.push(node.arguments[0].text);
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return out;
}

const packages = fs.readdirSync(pkgRoot).filter(d => d.startsWith('qaap-') && fs.existsSync(path.join(pkgRoot, d, 'package.json')))
    .map(d => {
        const pj = JSON.parse(fs.readFileSync(path.join(pkgRoot, d, 'package.json'), 'utf8'));
        return { dir: path.join(pkgRoot, d), name: pj.name, deps: Object.keys(pj.dependencies || {}) };
    });
const byName = new Map(packages.map(p => [p.name, p]));
const problems = [];

for (const p of packages) {
    const src = path.join(p.dir, 'src');
    if (!fs.existsSync(src)) { continue; }
    for (const f of walk(src)) {
        for (const s of specifiers(f)) {
            const where = path.relative(repoRoot, f).split(path.sep).join('/');
            if (s.startsWith('.')) {
                const target = path.resolve(path.dirname(f), s);
                if (!target.startsWith(p.dir + path.sep)) { problems.push(`${where}: relative import escapes ${p.name}: '${s}'`); }
            } else {
                const m = /^(@theia\/qaap-[^/]+)/.exec(s);
                if (m && m[1] !== p.name && !p.deps.includes(m[1])) {
                    problems.push(`${where}: imports undeclared dependency ${m[1]}`);
                }
            }
        }
    }
}

// cycles among qaap packages
const state = new Map();
const stack = [];
function dfs(name) {
    state.set(name, 1);
    stack.push(name);
    for (const d of (byName.get(name) || { deps: [] }).deps.filter(x => byName.has(x))) {
        if (state.get(d) === 1) { problems.push('dependency cycle: ' + stack.slice(stack.indexOf(d)).concat(d).join(' -> ')); }
        else if (!state.get(d)) { dfs(d); }
    }
    stack.pop();
    state.set(name, 2);
}
for (const p of packages) { if (!state.get(p.name)) { dfs(p.name); } }

if (problems.length) {
    console.error(`[qaap-package-graph] ${problems.length} problem(s):`);
    for (const pr of problems) { console.error('  ' + pr); }
    process.exit(1);
}
console.log(`[qaap-package-graph] OK — ${packages.length} qaap packages, no escaping imports, undeclared deps or cycles.`);
