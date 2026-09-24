#!/usr/bin/env node
// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Fails when a Work Hub spec turns jsdom on at load time without turning it off again after its
 * imports. Mocha loads every spec file before running any suite, so a leaked load-time DOM makes
 * other specs pass only in one file order. Required shape (see
 * packages/qaap-work-hub/src/browser/test/qaap-jsdom-suite.ts):
 *
 *     const disableImportJSDOM = enableJSDOM();
 *     // ...imports...
 *     disableImportJSDOM();          // top level, before the first describe()
 *
 * Usage: node scripts/qaap-spec-jsdom-check.js [dir ...]   (default: packages/qaap-work-hub/src)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dirs = process.argv.slice(2).length ? process.argv.slice(2) : ['packages/qaap-work-hub/src'];

function listSpecs(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...listSpecs(full));
        } else if (/\.spec\.tsx?$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

function checkSpec(file) {
    const source = fs.readFileSync(file, 'utf8');
    const firstDescribe = source.search(/^describe\(/m);
    const loadTime = firstDescribe < 0 ? source : source.slice(0, firstDescribe);
    const problems = [];
    // Only column-0 statements are load-time; calls inside hooks/tests are indented.
    for (const match of loadTime.matchAll(/^(?:(?:const|let)\s+(\w+)\s*(?::[^=]+)?=\s*)?enableJSDOM\(\);?/gm)) {
        const line = loadTime.slice(0, match.index).split('\n').length;
        const name = match[1];
        if (!name) {
            problems.push(`${line}: top-level enableJSDOM() result is discarded; keep it and call it after the imports`);
            continue;
        }
        const disable = new RegExp(`^${name}\\(\\);?`, 'm');
        const rest = loadTime.slice(match.index + match[0].length);
        if (!disable.test(rest)) {
            problems.push(`${line}: '${name}' from top-level enableJSDOM() is never called before the first describe()`);
        }
    }
    return problems;
}

let failures = 0;
for (const dir of dirs) {
    for (const file of listSpecs(path.resolve(root, dir))) {
        for (const problem of checkSpec(file)) {
            failures += 1;
            console.error(`${path.relative(root, file)}:${problem}`);
        }
    }
}
if (failures) {
    console.error(`[qaap-spec-jsdom] ${failures} load-time jsdom leak(s); see the header of scripts/qaap-spec-jsdom-check.js.`);
    process.exit(1);
}
console.log('[qaap-spec-jsdom] OK — no spec leaks a load-time jsdom.');
