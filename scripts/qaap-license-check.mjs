#!/usr/bin/env node
// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repositoryRoot = resolve('.');
const wrapperPath = resolve(repositoryRoot, 'node_modules/@eclipse-dash/nodejs-wrapper/src/dash-licenses-wrapper.js');
const configPath = resolve(repositoryRoot, 'configs/license-check-config.json');
const summaryPath = resolve(repositoryRoot, 'license-check-summary.txt');
const lockPath = resolve(repositoryRoot, 'package-lock.json');
const PERMISSIVE_LICENSES = new Set([
    '0BSD',
    'Apache-2.0',
    'BSD-2-Clause',
    'BSD-3-Clause',
    'BlueOak-1.0.0',
    'CC0-1.0',
    'ISC',
    'MIT',
    'Unlicense',
    'WTFPL'
]);

const wrapperArguments = [`--configFile=${configPath}`];
if (process.argv.includes('--review')) {
    wrapperArguments.push('--review');
}

const result = spawnSync(process.execPath, [wrapperPath, ...wrapperArguments], {
    cwd: repositoryRoot,
    stdio: 'inherit'
});

if (result.error) {
    console.error(`[qaap-license-check] Could not start dash-licenses: ${result.error.message}`);
    process.exit(1);
}

if (result.status === 0) {
    process.exit(0);
}

if (!existsSync(summaryPath)) {
    console.error('[qaap-license-check] dash-licenses did not produce a summary; the check is inconclusive.');
    process.exit(result.status ?? 1);
}

const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
const restricted = readRestrictedEntries(summaryPath);
const unsafeEntries = restricted.filter(entry => !isLocallySafe(entry, lock));

if (restricted.length > 0 && unsafeEntries.length === 0) {
    console.warn(
        `[qaap-license-check] dash-licenses returned ${restricted.length} unmapped/restricted entries, ` +
        'but every entry is either a local workspace link or has an explicitly permissive license in package-lock.json. ' +
        'Treating the external catalog result as a warning; non-permissive local licenses remain blocking.'
    );
    process.exit(0);
}

if (unsafeEntries.length > 0) {
    console.error(
        `[qaap-license-check] ${unsafeEntries.length} restricted entries are not cleared by local package metadata:`
    );
    for (const entry of unsafeEntries) {
        console.error(`  - ${entry.dependency}: ${entry.license || 'unknown'}`);
    }
}

process.exit(result.status ?? 1);

function readRestrictedEntries(summary) {
    return readFileSync(summary, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .map(line => {
            const [dependency, license, status, source] = line.split(', ');
            return { dependency, license, status, source };
        })
        .filter(entry => entry.status?.toLowerCase() === 'restricted');
}

function isLocallySafe(entry, lock) {
    const catalogLicense = entry.license?.trim().toLowerCase();
    if (catalogLicense && catalogLicense !== 'unknown' && catalogLicense !== 'noassertion' && !hasPermissiveLicense(entry.license)) {
        return false;
    }

    const dependency = entry.dependency.replace(/^Invalid:\s*/, '');
    if (dependency.startsWith('node_modules/')) {
        const packageInfo = lock.packages?.[dependency];
        if (packageInfo?.link === true) {
            return true;
        }
        return hasPermissiveLicense(packageInfo?.license);
    }

    const npmPackage = parseNpmDependency(dependency);
    if (!npmPackage) {
        return false;
    }

    const matchingPackages = Object.entries(lock.packages ?? {})
        .filter(([packagePath, packageInfo]) =>
            packageInfo?.version === npmPackage.version && packageNameFromLockPath(packagePath) === npmPackage.name
        )
        .map(([, packageInfo]) => packageInfo);

    return matchingPackages.length > 0 && matchingPackages.every(packageInfo => hasPermissiveLicense(packageInfo.license));
}

function parseNpmDependency(dependency) {
    const parts = dependency.split('/');
    if (parts.length < 4 || parts[0] !== 'npm' || parts[1] !== 'npmjs') {
        return undefined;
    }
    const version = parts.at(-1);
    const packageParts = parts.slice(2, -1);
    if (packageParts[0] === '-') {
        packageParts.shift();
    }
    const name = packageParts.join('/');
    return name && version ? { name, version } : undefined;
}

function packageNameFromLockPath(packagePath) {
    const marker = '/node_modules/';
    const markerIndex = packagePath.lastIndexOf(marker);
    return markerIndex >= 0 ? packagePath.slice(markerIndex + marker.length) : packagePath.slice('node_modules/'.length);
}

function hasPermissiveLicense(license) {
    if (typeof license !== 'string' || license.trim() === '') {
        return false;
    }
    const expressions = license
        .replace(/[()]/g, ' ')
        .split(/\s+(?:OR|AND)\s+/i)
        .map(value => value.trim())
        .filter(Boolean);
    return expressions.length > 0 && expressions.every(value => PERMISSIVE_LICENSES.has(value));
}
