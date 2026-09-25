#!/usr/bin/env node
// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Keeps qaap specs independent of mocha's file order. Mocha loads every spec file before running any
 * suite, so a DOM one file leaves behind makes other files pass in one order only. Two rules:
 *
 * 1. A top-level `enableJSDOM()` must be undone after the imports, before the first `describe()`:
 *
 *        const disableImportJSDOM = enableJSDOM();
 *        // ...imports...
 *        disableImportJSDOM();
 *
 * 2. A spec that uses the DOM in its tests (`document.createElement`, `window.addEventListener`, …)
 *    must set one up itself — `useSuiteJSDOM()` from
 *    packages/qaap-mobile-shell/src/browser/test/qaap-jsdom-suite.ts, or its own `enableJSDOM()`
 *    hooks — instead of relying on one another spec file left on. Packages whose `test` script
 *    preloads jsdom (`--require …jsdom…`) are exempt.
 *
 * Usage: node scripts/qaap-spec-jsdom-check.js [dir ...]   (default: every packages/qaap-* /src)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function defaultDirs() {
    const packages = path.join(root, 'packages');
    return fs.readdirSync(packages)
        .filter(name => name.startsWith('qaap-') && fs.existsSync(path.join(packages, name, 'src')))
        .map(name => path.join('packages', name, 'src'));
}

const dirs = process.argv.slice(2).length ? process.argv.slice(2) : defaultDirs();

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

/** True when the spec's package test script preloads a DOM for every spec file. */
const preloadCache = new Map();
function packagePreloadsDom(file) {
    let dir = path.dirname(file);
    while (dir.startsWith(root) && !fs.existsSync(path.join(dir, 'package.json'))) {
        dir = path.dirname(dir);
    }
    if (!preloadCache.has(dir)) {
        let preloads = false;
        try {
            const test = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).scripts?.test ?? '';
            preloads = /--require\s+\S*jsdom/i.test(test);
        } catch {
            preloads = false;
        }
        preloadCache.set(dir, preloads);
    }
    return preloadCache.get(dir);
}

// Runtime DOM use that needs a real document/window (type positions like `HTMLElement` do not count).
// `run.document.x` / `dom.window.x` are someone else's DOM, so a leading `.` does not count.
const DOM_USE = /(?<![.\w$])(?:document\.(?:createElement|createTextNode|createRange|body|head|documentElement|querySelector(?:All)?|getElementById|activeElement|addEventListener|dispatchEvent)|window\.(?:addEventListener|dispatchEvent|getComputedStyle|matchMedia|innerWidth|innerHeight|location|requestAnimationFrame)|new (?:window\.)?(?:KeyboardEvent|MouseEvent|PointerEvent|CustomEvent|MutationObserver))\b/;
// A local variable / parameter named `document` or `window` shadows the global.
const SHADOWED = /\b(?:const|let|var)\s+(?:document|window)\b|\(\s*(?:document|window)\s*[:,)]/;
// Any DOM setup of the spec's own.
const DOM_SETUP = /\b(?:enableJSDOM|useSuiteJSDOM|JSDOM|parseHTML|linkedom|happy-dom)\b/;

function checkSpec(file) {
    const source = fs.readFileSync(file, 'utf8');
    const firstDescribe = source.search(/^describe\(/m);
    const loadTime = firstDescribe < 0 ? source : source.slice(0, firstDescribe);
    const problems = [];
    // Rule 1 — only column-0 statements are load-time; calls inside hooks/tests are indented.
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
    // Rule 2 — DOM used in tests with no setup of its own.
    // Setup must live where the tests run: the load-time enable/disable pair (and its import) is gone by then.
    // Without a column-0 describe() the whole file minus its imports is the test body.
    const testsStart = firstDescribe < 0 ? 0 : firstDescribe;
    const tests = firstDescribe < 0 ? source.replace(/^import\b.*$/gm, '') : source.slice(firstDescribe);
    const use = DOM_USE.exec(tests);
    if (use && !DOM_SETUP.test(tests) && !SHADOWED.test(source) && !packagePreloadsDom(file)) {
        const line = firstDescribe < 0 ? '?' : source.slice(0, testsStart + use.index).split('\n').length;
        problems.push(`${line}: uses '${use[0]}' without any jsdom setup; add useSuiteJSDOM() to the suite`);
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
    console.error(`[qaap-spec-jsdom] ${failures} problem(s); see the header of scripts/qaap-spec-jsdom-check.js.`);
    process.exit(1);
}
console.log('[qaap-spec-jsdom] OK — specs set up and tear down their own jsdom.');
