#!/usr/bin/env node
// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Ratchet for `// @ts-nocheck` in `packages/qaap-*`.
 *
 * `@ts-nocheck` disables type checking for a whole file; the mechanical *Extracted() refactor left
 * it on ~130 files (`ctx: any` modules), where it hid real bugs. The allowed set is the list in
 * scripts/qaap-ts-nocheck-baseline.txt and may only shrink:
 *
 * - a file with `@ts-nocheck` that is not in the baseline fails (no new untyped files);
 * - a baseline entry whose file no longer has `@ts-nocheck` (or no longer exists) also fails, so
 *   every PR that types a file must remove it from the baseline and the ratchet tightens.
 *
 * Usage:
 *   node scripts/qaap-ts-nocheck-ratchet.js          # check
 *   node scripts/qaap-ts-nocheck-ratchet.js --write  # rewrite the baseline from the tree
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASELINE = path.join(__dirname, 'qaap-ts-nocheck-baseline.txt');
const PRAGMA = /^\s*\/\/\s*@ts-nocheck\b/m;

function listSourceFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== 'node_modules' && entry.name !== 'lib') {
                out.push(...listSourceFiles(full));
            }
        } else if (/\.tsx?$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

function currentNoCheckFiles() {
    const packagesDir = path.join(ROOT, 'packages');
    const files = [];
    for (const pkg of fs.readdirSync(packagesDir)) {
        const src = path.join(packagesDir, pkg, 'src');
        if (!pkg.startsWith('qaap-') || !fs.existsSync(src)) {
            continue;
        }
        for (const file of listSourceFiles(src)) {
            if (PRAGMA.test(fs.readFileSync(file, 'utf8'))) {
                files.push(path.relative(ROOT, file).split(path.sep).join('/'));
            }
        }
    }
    return files.sort();
}

function readBaseline() {
    if (!fs.existsSync(BASELINE)) {
        return [];
    }
    return fs.readFileSync(BASELINE, 'utf8')
        .split(/\r?\n/)
        .map(line => line.replace(/#.*/, '').trim())
        .filter(Boolean);
}

function writeBaseline(files) {
    const header = [
        '# Files allowed to keep `// @ts-nocheck`. This list may only shrink.',
        '# Type a file, remove its `@ts-nocheck`, then delete its line (or run with --write).',
        `# ${files.length} files.`,
    ];
    fs.writeFileSync(BASELINE, [...header, ...files, ''].join('\n'));
}

function main() {
    const current = currentNoCheckFiles();
    if (process.argv.includes('--write')) {
        const previous = readBaseline();
        const added = current.filter(file => !previous.includes(file));
        if (previous.length > 0 && added.length > 0 && !process.argv.includes('--allow-growth')) {
            console.error('[qaap-ts-nocheck] Refusing to grow the baseline; these files are new:');
            added.forEach(file => console.error(`  + ${file}`));
            console.error('Type them instead (or pass --allow-growth with a reviewed justification).');
            process.exit(1);
        }
        writeBaseline(current);
        console.log(`[qaap-ts-nocheck] Baseline written: ${current.length} files.`);
        return;
    }
    const baseline = readBaseline();
    const added = current.filter(file => !baseline.includes(file));
    const stale = baseline.filter(file => !current.includes(file));
    if (added.length === 0 && stale.length === 0) {
        console.log(`[qaap-ts-nocheck] OK: ${current.length} files still use @ts-nocheck (baseline ${baseline.length}).`);
        return;
    }
    if (added.length > 0) {
        console.error('[qaap-ts-nocheck] New @ts-nocheck files (not allowed; type them instead):');
        added.forEach(file => console.error(`  + ${file}`));
    }
    if (stale.length > 0) {
        console.error('[qaap-ts-nocheck] These files are typed now; remove them from scripts/qaap-ts-nocheck-baseline.txt');
        console.error('  (or run `node scripts/qaap-ts-nocheck-ratchet.js --write`):');
        stale.forEach(file => console.error(`  - ${file}`));
    }
    process.exit(1);
}

main();
