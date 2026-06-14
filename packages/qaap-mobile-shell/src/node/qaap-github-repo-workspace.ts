// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import type { QaapGithubRepositorySummary } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';

const QAAP_REPOS_ROOT = process.env.QAAP_REPOS_ROOT?.trim()
    || (process.env.NODE_ENV === 'production' ? '/workspace/repos' : path.join(os.homedir(), '.qaap', 'workspaces'));

export function resolveQaapReposRoot(): string {
    return QAAP_REPOS_ROOT;
}

export function resolveGithubRepoWorkspacePath(owner: string, repo: string): string {
    return path.join(QAAP_REPOS_ROOT, safePathSegment(owner), safePathSegment(repo));
}

export function parseGithubRemoteUrl(url: string): { owner: string; name: string } | undefined {
    const trimmed = url.trim();
    const ssh = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i.exec(trimmed);
    if (ssh) {
        return { owner: ssh[1], name: ssh[2].replace(/\.git$/, '') };
    }
    const https = /github\.com[/:]([^/]+)\/(.+?)(?:\.git)?/i.exec(trimmed);
    if (https) {
        return { owner: https[1], name: https[2].replace(/\.git$/, '') };
    }
    return undefined;
}

export async function cwdMatchesGithubRepo(cwd: string, owner: string, repo: string): Promise<boolean> {
    const remote = await readGitRemoteOrigin(cwd);
    if (!remote) {
        return false;
    }
    const parsed = parseGithubRemoteUrl(remote);
    if (!parsed) {
        return false;
    }
    return parsed.owner.toLowerCase() === owner.toLowerCase()
        && parsed.name.toLowerCase() === repo.toLowerCase();
}

export async function ensureGithubRepositoryWorkspace(
    repository: Pick<QaapGithubRepositorySummary, 'owner' | 'name' | 'cloneUrl'>,
    accessToken: string | undefined,
): Promise<string> {
    const target = resolveGithubRepoWorkspacePath(repository.owner, repository.name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    if (await isGitRepository(target)) {
        await runGit(['-C', target, 'fetch', '--all', '--prune'], accessToken);
        await runGit(['-C', target, 'pull', '--ff-only'], accessToken);
        return target;
    }
    try {
        const entries = await fs.readdir(target);
        if (entries.length > 0) {
            throw new Error(`Workspace path already exists and is not a Git repository: ${target}`);
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
    }
    await runGit(['clone', repository.cloneUrl, target], accessToken);
    return target;
}

async function readGitRemoteOrigin(cwd: string): Promise<string | undefined> {
    try {
        return await runGitOutput(['-C', cwd, 'remote', 'get-url', 'origin']);
    } catch {
        return undefined;
    }
}

function safePathSegment(value: string): string {
    return value.replace(/[^A-Za-z0-9_.-]/g, '_');
}

async function isGitRepository(target: string): Promise<boolean> {
    try {
        const stat = await fs.stat(path.join(target, '.git'));
        return stat.isDirectory() || stat.isFile();
    } catch {
        return false;
    }
}

function runGit(args: string[], accessToken: string | undefined): Promise<void> {
    return new Promise((resolve, reject) => {
        const gitArgs = accessToken
            ? [
                '-c',
                `http.https://github.com/.extraheader=AUTHORIZATION: basic ${
                    Buffer.from(`x-access-token:${accessToken}`).toString('base64')
                }`,
                ...args,
            ]
            : args;
        const child = spawn('git', gitArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', chunk => { stderr += String(chunk); });
        child.on('error', reject);
        child.on('close', code => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(stderr.trim() || `git exited with status ${code}`));
            }
        });
    });
}

function runGitOutput(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn('git', args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', chunk => { stdout += String(chunk); });
        child.stderr.on('data', chunk => { stderr += String(chunk); });
        child.on('error', reject);
        child.on('close', code => {
            if (code === 0) {
                resolve(stdout.trim());
            } else {
                reject(new Error(stderr.trim() || `git exited with status ${code}`));
            }
        });
    });
}
