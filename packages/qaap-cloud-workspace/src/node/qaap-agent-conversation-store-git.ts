// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// Git utility helpers extracted from QaapAgentConversationStore.
// Pure functions that operate only on their parameters.

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import { parseGitNumstat } from './qaap-agent-conversation-store-constants';

export function parseGithubRepoFromCwd(cwd: string): { owner: string; name: string } | undefined {
    try {
        const result = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf8' });
        if (result.status !== 0) {
            return undefined;
        }
        const url = result.stdout.trim();
        const ssh = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i.exec(url);
        if (ssh) {
            return { owner: ssh[1], name: ssh[2].replace(/\.git$/, '') };
        }
        const https = /github\.com[/:]([^/]+)\/(.+?)(?:\.git)?/i.exec(url);
        if (https) {
            return { owner: https[1], name: https[2].replace(/\.git$/, '') };
        }
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
