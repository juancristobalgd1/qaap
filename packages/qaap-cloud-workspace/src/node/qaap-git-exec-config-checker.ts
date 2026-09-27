// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { QaapGitReadSync } from './qaap-agent-task-runner-utils2';

/**
 * Git keys (canonical lowercase form printed by `git config --get-regexp`) that make "read-only"
 * commands like `git diff` / `git log -p` / `git status` run an external program.
 */
const GIT_EXEC_CONFIG_REGEXP = '^(core\\.fsmonitor|core\\.pager|pager\\.|diff\\.external|diff\\..*\\.(textconv|command)$'
    + '|filter\\..*\\.(clean|smudge|process)$|interactive\\.difftool|gpg\\.|log\\.showsignature)';

/** A `diff=` or `filter=` attribute points git at a (possibly configured) external driver. */
const GIT_DRIVER_ATTRIBUTE_RE = /(?:^|\s)(?:diff|filter)=/m;

/** Values of the matched keys that do NOT run anything. */
function isHarmlessGitExecValue(key: string, value: string): boolean {
    const normalized = value.trim().toLowerCase();
    if (key === 'core.fsmonitor') {
        return normalized === '' || normalized === 'false' || normalized === 'no' || normalized === 'off' || normalized === '0';
    }
    if (key === 'log.showsignature') {
        return normalized === 'false' || normalized === 'no' || normalized === 'off' || normalized === '0';
    }
    if (key === 'core.pager' || key.startsWith('pager.')) {
        return normalized === 'cat' || normalized === 'false' || normalized === '';
    }
    return false;
}

/**
 * Decides whether the effective git configuration of a working directory could turn a read-only git
 * command into program execution (fsmonitor, pagers, external diff / textconv drivers, filters, gpg).
 * Results are cached per cwd, keyed by the mtimes of the config and attribute files that feed them.
 */
export class QaapGitExecConfigChecker {

    protected readonly cache = new Map<string, { readonly key: string; readonly risk: string | undefined }>();

    constructor(
        protected readonly gitRead: QaapGitReadSync,
        protected readonly homeDir: string = os.homedir(),
    ) { }

    /** Returns a reason when git may execute a program in `cwd` (or the check failed); `undefined` when safe. */
    check(cwd: string): string | undefined {
        const gitDirs = this.locateGitDirs(cwd);
        const watched = [
            ...(gitDirs ? [path.join(gitDirs.commonDir, 'config'), path.join(gitDirs.gitDir, 'config.worktree'),
                path.join(gitDirs.commonDir, 'info', 'attributes'), path.join(gitDirs.workTree, '.gitattributes')] : []),
            path.join(this.homeDir, '.gitconfig'),
            path.join(this.homeDir, '.config', 'git', 'config'),
            path.join(this.homeDir, '.config', 'git', 'attributes'),
        ];
        const cacheKey = watched.map(file => `${file}@${this.mtime(file)}`).join('|');
        const cached = this.cache.get(cwd);
        if (cached && cached.key === cacheKey) {
            return cached.risk;
        }
        const risk = this.evaluate(cwd, gitDirs);
        this.cache.set(cwd, { key: cacheKey, risk });
        return risk;
    }

    protected evaluate(cwd: string, gitDirs: QaapGitDirs | undefined): string | undefined {
        let result: ReturnType<QaapGitReadSync>;
        try {
            result = this.gitRead(cwd, ['config', '--get-regexp', GIT_EXEC_CONFIG_REGEXP], 1024 * 1024);
        } catch (error) {
            return `git config check failed: ${error instanceof Error ? error.message : String(error)}`;
        }
        // Exit 1 = no key matched. Anything else but 0 (or a spawn error) is an unverifiable config.
        if (result.error || (result.status !== 0 && result.status !== 1)) {
            return 'git config check failed';
        }
        if (result.status === 0) {
            for (const line of (result.stdout ?? '').split('\n')) {
                const trimmed = line.trim();
                if (!trimmed) {
                    continue;
                }
                const space = trimmed.indexOf(' ');
                const key = (space < 0 ? trimmed : trimmed.slice(0, space)).toLowerCase();
                const value = space < 0 ? '' : trimmed.slice(space + 1);
                if (!isHarmlessGitExecValue(key, value)) {
                    return `git config ${key} can run a program`;
                }
            }
        }
        const attributeFiles = [
            ...(gitDirs ? [path.join(gitDirs.workTree, '.gitattributes'), path.join(gitDirs.commonDir, 'info', 'attributes')] : []),
            path.join(this.homeDir, '.config', 'git', 'attributes'),
        ];
        for (const file of attributeFiles) {
            const text = this.readText(file);
            if (text !== undefined && GIT_DRIVER_ATTRIBUTE_RE.test(text)) {
                return `${path.basename(file)} sets a diff/filter driver`;
            }
        }
        return undefined;
    }

    /** Walks up from `cwd` to the repository; follows `.git` files (worktrees, submodules) and `commondir`. */
    protected locateGitDirs(cwd: string): QaapGitDirs | undefined {
        let dir = path.resolve(cwd);
        for (; ;) {
            const dotGit = path.join(dir, '.git');
            try {
                const stat = fs.statSync(dotGit);
                let gitDir = dotGit;
                if (stat.isFile()) {
                    const match = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, 'utf8'));
                    if (!match) {
                        return undefined;
                    }
                    gitDir = path.resolve(dir, match[1].trim());
                }
                const commonDirText = this.readText(path.join(gitDir, 'commondir'));
                const commonDir = commonDirText?.trim() ? path.resolve(gitDir, commonDirText.trim()) : gitDir;
                return { workTree: dir, gitDir, commonDir };
            } catch {
                // no .git here — keep walking up
            }
            const parent = path.dirname(dir);
            if (parent === dir) {
                return undefined;
            }
            dir = parent;
        }
    }

    protected mtime(file: string): number {
        try {
            return fs.statSync(file).mtimeMs;
        } catch {
            return 0;
        }
    }

    protected readText(file: string): string | undefined {
        try {
            return fs.readFileSync(file, 'utf8');
        } catch {
            return undefined;
        }
    }
}

interface QaapGitDirs {
    readonly workTree: string;
    readonly gitDir: string;
    readonly commonDir: string;
}
