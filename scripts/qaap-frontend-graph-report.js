#!/usr/bin/env node
// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************
// @ts-check
'use strict';
/**
 * Frontend bundle report from the esbuild metafile (`lib/.qaap-frontend-metafile.json`):
 *   - total JS / CSS, raw and gzip,
 *   - the top 20 packages by bytes actually emitted,
 *   - bytes per entry (the entry file itself and everything it loads through the output graph).
 *
 * In production `FrontendGenerator.importOrRequire()` returns `require`, so esbuild inlines every
 * frontend module and `bundle.js` is ONE file with no lazy chunks: the closure of an entry is then
 * just that file. In development the modules are `import()`ed and split into `chunk-*` files. Both
 * shapes are reported the same way.
 *
 * Usage: node scripts/qaap-frontend-graph-report.js [--metafile <file>] [--top <n>] [--no-gzip]
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const lib = require('./qaap-frontend-metafile-lib');

function arg(name, fallback) {
    const index = process.argv.indexOf(name);
    return index === -1 ? fallback : process.argv[index + 1];
}

/**
 * Gzip size of an emitted file (level 9 approximates what copy-frontend-static writes). When the
 * file is not on disk (metafile from another checkout) fall back to a 0.27 ratio estimate.
 * @param {string} output metafile output path (relative to the build cwd)
 * @param {number} bytes
 * @param {boolean} enabled
 */
function gzipSize(output, bytes, enabled) {
    if (!enabled) {
        return Math.round(bytes * 0.27);
    }
    const file = path.join(lib.FRONTEND_DIR, path.basename(output));
    if (fs.existsSync(file)) {
        return zlib.gzipSync(fs.readFileSync(file), { level: 9 }).length;
    }
    return Math.round(bytes * 0.27);
}

function main() {
    const metafile = arg('--metafile', lib.DEFAULT_METAFILE);
    const top = Number(arg('--top', '20'));
    const exact = !process.argv.includes('--no-gzip');
    const meta = lib.readMetafile(metafile);

    const outputs = Object.entries(meta.outputs).filter(([output]) => lib.isJsOrCss(output));
    const totals = { js: { raw: 0, gzip: 0, files: 0 }, css: { raw: 0, gzip: 0, files: 0 } };
    const gzipByOutput = new Map();
    for (const [output, info] of outputs) {
        const kind = output.endsWith('.css') ? 'css' : 'js';
        const gz = gzipSize(output, info.bytes, exact);
        gzipByOutput.set(output, gz);
        totals[kind].raw += info.bytes;
        totals[kind].gzip += gz;
        totals[kind].files++;
    }

    console.log(`Frontend bundle report (${path.relative(lib.repoRoot, metafile)})`);
    console.log(`gzip is ${exact ? 'measured on lib/frontend files (level 9; estimated at 0.27 for files not on disk)' : 'estimated at 0.27'}`);
    console.log('');
    for (const kind of /** @type {const} */ (['js', 'css'])) {
        const t = totals[kind];
        console.log(`Total ${kind.toUpperCase().padEnd(3)} ${lib.formatBytes(t.raw).padStart(10)} raw  ${lib.formatBytes(t.gzip).padStart(10)} gzip  (${t.files} file${t.files === 1 ? '' : 's'})`);
    }

    /** @type {Map<string, number>} */
    const byPackage = new Map();
    for (const [, info] of outputs) {
        for (const [input, { bytesInOutput }] of Object.entries(info.inputs || {})) {
            const pkg = lib.packageOf(input);
            byPackage.set(pkg, (byPackage.get(pkg) || 0) + bytesInOutput);
        }
    }
    const emitted = [...byPackage.values()].reduce((a, b) => a + b, 0) || 1;
    console.log('');
    console.log(`Top ${top} packages by emitted bytes (JS+CSS inputs, a module in several outputs counts per output)`);
    [...byPackage.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).forEach(([pkg, bytes], index) => {
        console.log(`${String(index + 1).padStart(3)}. ${lib.formatBytes(bytes).padStart(10)} ${(bytes / emitted * 100).toFixed(1).padStart(5)}%  ${pkg}`);
    });

    console.log('');
    console.log('Bytes per entry, JS+CSS (own file / everything it loads through static+dynamic imports)');
    for (const [output, info] of lib.entryOutputs(meta)) {
        if (output.endsWith('.css')) {
            continue;
        }
        const closure = lib.outputClosure(meta, output);
        let raw = 0;
        let gzip = 0;
        for (const member of closure) {
            raw += meta.outputs[member].bytes;
            gzip += gzipByOutput.get(member) ?? Math.round(meta.outputs[member].bytes * 0.27);
        }
        const chunks = closure.size - 1;
        console.log(`  ${lib.entryName(output).padEnd(18)} own ${lib.formatBytes(info.bytes).padStart(10)}  graph ${lib.formatBytes(raw).padStart(10)} raw ${lib.formatBytes(gzip).padStart(10)} gzip  `
            + (chunks === 0 ? '(single file, no lazy chunks)' : `(+${chunks} chunk file${chunks === 1 ? '' : 's'})`));
    }
}

try {
    main();
} catch (error) {
    console.error(`[qaap-frontend-graph-report] ${error instanceof Error ? error.message : error}`);
    process.exit(2);
}
