// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as path from 'path';

/**
 * Runtime file lookup for code that ships files next to its compiled output. Each lookup tries the
 * caller's direct candidate first (the unbundled layout, computed from the caller's module location, which
 * is what unbundled and prod runs use), then walks up from `startDirectory` looking for the file the
 * way an installed package is laid out. The walk-up is what finds files in a bundled backend, whose
 * `__dirname` is the bundle folder (`examples/browser/lib/backend`).
 *
 * `require.resolve` is deliberately not used: the bundler rewrites it.
 */
export interface QaapPackageFileLookup {
    /** Folder the walk-up starts from; defaults to this module's folder. */
    readonly startDirectory?: string;
    /** Absolute path tried first, computed by the caller from its own `__dirname`. */
    readonly directCandidate?: string;
}

/** The first existing `<folder>/<relativePath>` walking up from `startDirectory`, or undefined. */
export function findUpwardFile(relativePath: string, startDirectory: string = __dirname): string | undefined {
    let directory = path.resolve(startDirectory);
    for (;;) {
        const candidate = path.join(directory, relativePath);
        if (fs.existsSync(candidate)) {
            return candidate;
        }
        const parent = path.dirname(directory);
        if (parent === directory) {
            return undefined;
        }
        directory = parent;
    }
}

/**
 * A file shipped inside a Qaap package (`packageName`, e.g. `@theia/qaap-cloud-workspace`), addressed by its
 * package-relative path (e.g. `lib/node/worker.js`). Undefined when it cannot be found.
 */
export function findQaapPackageFile(
    packageName: string,
    packageRelativePath: string,
    lookup: QaapPackageFileLookup = {},
): string | undefined {
    if (lookup.directCandidate && fs.existsSync(lookup.directCandidate)) {
        return lookup.directCandidate;
    }
    return findUpwardFile(path.join('node_modules', packageName, packageRelativePath), lookup.startDirectory);
}

/** Like {@link findQaapPackageFile}, but returns the direct candidate when nothing exists, so an error names it. */
export function resolveQaapPackageFile(
    packageName: string,
    packageRelativePath: string,
    lookup: QaapPackageFileLookup = {},
): string {
    return findQaapPackageFile(packageName, packageRelativePath, lookup)
        ?? lookup.directCandidate
        ?? path.join(lookup.startDirectory ?? __dirname, packageRelativePath);
}

/**
 * A file at the repository root (for example `scripts/qaap-guarded-bash.mjs`): the direct candidate, then
 * the nearest ancestor folder that contains `repositoryRelativePath`. Undefined when none exists.
 */
export function findQaapRepositoryFile(repositoryRelativePath: string, lookup: QaapPackageFileLookup = {}): string | undefined {
    if (lookup.directCandidate && fs.existsSync(lookup.directCandidate)) {
        return lookup.directCandidate;
    }
    return findUpwardFile(repositoryRelativePath, lookup.startDirectory);
}
