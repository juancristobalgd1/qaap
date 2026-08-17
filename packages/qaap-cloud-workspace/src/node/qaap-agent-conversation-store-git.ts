// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// Git utility helpers extracted from QaapAgentConversationStore.
// Pure functions that operate only on their parameters.

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { parseGitNumstat } from './qaap-agent-conversation-store-constants';

/** True only when `cwd` itself is a git root/worktree — never walk to a parent repository. */
export function cwdIsGitRepository(cwd: string): boolean {
    try {
        return fs.existsSync(path.join(cwd, '.git'));
    } catch {
        return false;
    }
}

/**
 * Parse `owner/repo` from a GitHub remote URL. Uses `URL` for https remotes so a path like
 * `/juancristobalgd1/qaap.git` cannot match as owner=`juancristobalgd1`, name=`q` (the previous
 * unanchored `(.+?)(?:\.git)?` regex stopped at the first "git" substring).
 */
export function parseGithubRepoFromRemoteUrl(url: string): { owner: string; name: string } | undefined {
    const trimmed = url.trim();
    if (!trimmed) {
        return undefined;
    }
    const ssh = /^git@github\.com:([^/]+)\/([^/]+)$/i.exec(trimmed);
    if (ssh) {
        return { owner: ssh[1], name: ssh[2].replace(/\.git$/i, '') };
    }
    try {
        const withProtocol = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
            ? trimmed
            : `https://${trimmed}`;
        const parsed = new URL(withProtocol);
        if (!/(^|\.)github\.com$/i.test(parsed.hostname)) {
            return undefined;
        }
        const parts = parsed.pathname.replace(/^\/+/, '').replace(/\.git$/i, '').split('/');
        if (parts.length >= 2 && parts[0] && parts[1]) {
            return { owner: parts[0], name: parts[1] };
        }
    } catch {
        return undefined;
    }
    return undefined;
}

export function parseGithubRepoFromCwd(cwd: string): { owner: string; name: string } | undefined {
    if (!cwdIsGitRepository(cwd)) {
        return undefined;
    }
    try {
        const result = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf8' });
        if (result.status !== 0) {
            return undefined;
        }
        return parseGithubRepoFromRemoteUrl(result.stdout);
    } catch { /* not a git repo */ }
    return undefined;
}

export function readGitBranch(cwd: string): string | undefined {
    try {
        const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8' });
        if (result.status === 0) {
            const branch = result.stdout.trim();
            return branch && branch !== 'HEAD' ? branch : undefined;
        }
    } catch { /* not a git repo */ }
    return undefined;
}

export function captureGitSha(cwd: string): string | undefined {
    try {
        const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
        if (result.status === 0) {
            return result.stdout.trim();
        }
    } catch { /* not a git repo */ }
    return undefined;
}

export function computeGitDiffStats(cwd: string, startSha?: string): { added: number; removed: number } | undefined {
    try {
        let added = 0;
        let removed = 0;
        if (startSha) {
            const committed = spawnSync('git', ['diff', '--numstat', `${startSha}..HEAD`], { cwd, encoding: 'utf8' });
            if (committed.status === 0 && committed.stdout) {
                const stats = parseGitNumstat(committed.stdout);
                added += stats.added;
                removed += stats.removed;
            }
        }
        const uncommitted = spawnSync('git', ['diff', '--numstat', 'HEAD'], { cwd, encoding: 'utf8' });
        if (uncommitted.status === 0 && uncommitted.stdout) {
            const stats = parseGitNumstat(uncommitted.stdout);
            added += stats.added;
            removed += stats.removed;
        }
        if (added === 0 && removed === 0) {
            return undefined;
        }
        return { added, removed };
    } catch {
        return undefined;
    }
}

export function checkpointLabel(content: string): string {
    const clean = content.replace(/\s+/g, ' ').trim();
    return clean.length > 60 ? `${clean.slice(0, 57)}…` : (clean || 'Turn');
}

export function isDirectory(target: string): boolean {
    try {
        return fs.statSync(target).isDirectory();
    } catch {
        return false;
    }
}
