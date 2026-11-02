// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as path from 'path';

/** Package-relative folder holding the files this package ships to harnesses (`resources/`). */
const RESOURCES_DIRECTORY = 'resources';
const PACKAGE_SEGMENTS = ['@theia', 'qaap-cloud-workspace'];

/**
 * Absolute path of a file this package ships in `resources/` (the Pi gate extension, the Codex hook,
 * the OpenCode plugin), resolved at spawn time from the module location.
 *
 * - Unbundled (compiled `lib/node`, or the prod `src-gen` backend resolving through its
 *   `node_modules` symlink): `<package>/resources/<file>` is two levels above the module.
 * - Bundled (`examples/browser/lib/backend/main.js`): the module sits in the app's bundle folder, so the
 *   package is found by walking up to a `node_modules/@theia/qaap-cloud-workspace/resources` folder.
 *
 * Returns the first existing candidate; if none exists, the unbundled candidate, so the error that a
 * harness then reports names the expected location. `require.resolve` is deliberately not used: the
 * bundler rewrites it.
 */
export function resolveQaapCloudWorkspaceResource(file: string, startDirectory: string = __dirname): string {
    const direct = path.resolve(startDirectory, '..', '..', RESOURCES_DIRECTORY, file);
    if (fs.existsSync(direct)) {
        return direct;
    }
    const packageRelative = path.join('node_modules', ...PACKAGE_SEGMENTS, RESOURCES_DIRECTORY, file);
    let directory = startDirectory;
    for (;;) {
        const candidate = path.join(directory, packageRelative);
        if (fs.existsSync(candidate)) {
            return candidate;
        }
        const parent = path.dirname(directory);
        if (parent === directory) {
            return direct;
        }
        directory = parent;
    }
}
