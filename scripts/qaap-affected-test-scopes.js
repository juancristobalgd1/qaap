#!/usr/bin/env node
// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Prints the `lerna run test` scope flags for the packages changed since <base-ref> plus their
 * transitive dependents, minus the example applications (their `test` is the browser api-test
 * suite, which needs the `Test (browser)` environment). Prints nothing when no package changed.
 *
 * `--scope` cannot do this filtering itself: lerna's `--include-dependents` adds dependents
 * regardless of `--scope`/`--ignore`, which pulled @theia/example-browser into headless runs.
 * Exits non-zero when lerna fails, so callers can fall back to the full suite.
 */
'use strict';

const { execFileSync } = require('child_process');

const base = process.argv[2];
if (!base) {
    console.error('usage: qaap-affected-test-scopes.js <base-ref>');
    process.exit(2);
}

const output = execFileSync('npx', ['lerna', 'ls', '--all', '--json', '--loglevel', 'silent', '--since', base, '--include-dependents'], {
    encoding: 'utf8',
    env: { ...process.env, NX_DAEMON: 'false' },
    stdio: ['ignore', 'pipe', 'inherit'],
}).trim();
const packages = output ? JSON.parse(output) : [];
const names = packages
    .map(entry => entry.name)
    .filter(name => typeof name === 'string' && name.startsWith('@theia/') && !name.startsWith('@theia/example-'));
process.stdout.write(names.map(name => `--scope=${name}`).join(' '));
