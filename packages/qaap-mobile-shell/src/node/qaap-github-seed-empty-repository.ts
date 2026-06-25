// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs/promises';
import * as path from 'path';
import {
    buildStaticIndexHtml,
    buildStaticPackageJson,
} from '../common/qaap-project-bootstrap-static';

/**
 * Seeds a freshly cloned repository with a minimal runnable scaffold when it is empty
 * (only `.git` and optionally a `README.md`). Creates `package.json` and `index.html`,
 * commits them, and pushes to origin. Returns true when files were written.
 */
export async function seedEmptyRepository(
    target: string,
    repoName: string,
    runGit: (args: string[]) => Promise<void>,
): Promise<boolean> {
    const entries = await fs.readdir(target);
    const meaningful = entries.filter(entry => entry !== '.git');
    if (meaningful.length > 0 && !(meaningful.length === 1 && meaningful[0]?.toLowerCase() === 'readme.md')) {
        return false;
    }
    const packageJsonPath = path.join(target, 'package.json');
    const indexHtmlPath = path.join(target, 'index.html');
    if (await pathExists(packageJsonPath) && await pathExists(indexHtmlPath)) {
        return false;
    }
    await fs.writeFile(packageJsonPath, buildStaticPackageJson(repoName), 'utf-8');
    await fs.writeFile(indexHtmlPath, buildStaticIndexHtml(repoName), 'utf-8');
    await runGit(['-C', target, 'add', 'package.json', 'index.html']);
    await runGit(['-C', target, '-c', 'user.email=qaaq@qaap.dev', '-c', 'user.name=Qaaq', 'commit', '-m', 'Initial scaffold']);
    await runGit(['-C', target, 'push', 'origin', 'HEAD']);
    return true;
}

async function pathExists(target: string): Promise<boolean> {
    try {
        await fs.access(target);
        return true;
    } catch {
        return false;
    }
}
