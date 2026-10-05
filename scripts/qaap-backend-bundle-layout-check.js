#!/usr/bin/env node
// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************
'use strict';

/**
 * Lists what the esbuild backend bundle (lib/backend/main.js) would fail to load in an application
 * layout. See doc/qaap-backend-bundle.md.
 *
 *   node scripts/qaap-backend-bundle-layout-check.js [--load-native] [--report-only] [appRoot]
 *
 * appRoot defaults to /app/examples/browser (the image). --load-native also require()s every native
 * module (run it inside the image). --report-only prints the problems but exits 0.
 * Needs the compiled @theia/qaap-cloud-workspace (npm run compile).
 */
const path = require('node:path');

const args = process.argv.slice(2);
const loadNative = args.includes('--load-native');
const reportOnly = args.includes('--report-only');
const appRoot = args.find(arg => !arg.startsWith('--')) || '/app/examples/browser';
const { QaapBackendBundleLayoutCheck } = require(path.join(__dirname, '..', 'packages', 'qaap-cloud-workspace', 'lib', 'node', 'qaap-backend-bundle-layout.js'));

const report = new QaapBackendBundleLayoutCheck({ appRoot, loadNative }).run();
for (const missing of report.toleratedMissing) {
    console.log(`[qaap-backend-bundle] tolerated missing ${missing.path} (${missing.source}): ${missing.detail}`);
}
for (const problem of report.problems) {
    console.error(`[qaap-backend-bundle] ${problem.reason.toUpperCase()} ${problem.path} (needed by ${problem.source})${problem.detail ? `: ${problem.detail}` : ''}`);
}
if (report.problems.length === 0) {
    console.log(`[qaap-backend-bundle] OK: ${report.checked} paths under ${appRoot} exist${loadNative ? ', native modules load' : ''}.`);
} else {
    console.error(`[qaap-backend-bundle] ${report.problems.length} of ${report.checked} paths would break lib/backend/main.js under ${appRoot}.`);
    if (!reportOnly) {
        process.exit(1);
    }
}
