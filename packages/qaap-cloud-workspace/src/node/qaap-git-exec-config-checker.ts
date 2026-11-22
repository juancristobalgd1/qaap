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
    + '|filter\\..*\\.(clean|smudge|process)$|merge\\..*\\.driver$|interactive\\.difftool|gpg\\.|log\\.showsignature'
    + '|include\\.path$|includeif\\..*\\.path$)';

/** Extra key of the neutralized mode: a per-worktree config file is another place a model-written filter can live. */
const GIT_WORKTREE_CONFIG_REGEXP = '|^extensions\\.worktreeconfig$|^core\\.(worktree|bare)$';

/** Included config files are only listed so the cache watches them; the include itself runs nothing. */
const GIT_INCLUDE_KEY_RE = /^include(?:if\..*)?\.path$/;

/** A `diff=` or `filter=` attribute points git at a (possibly configured) external driver. */
const GIT_DRIVER_ATTRIBUTE_RE = /(?:^|\s)(?:diff|filter)=/m;

/** Values of the matched keys that do NOT run anything. */
function isHarmlessGitExecValue(key: string, value: string): boolean {
    const normalized = value.trim().toLowerCase();
    if (key === 'core.bare') {
        return normalized === 'false' || normalized === 'no' || normalized === 'off' || normalized === '0';
    }
    if (key === 'extensions.worktreeconfig') {
        return normalized === 'false' || normalized === 'no' || normalized === 'off' || normalized === '0';
    }
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

/** Options of {@link QaapGitExecConfigChecker.check}. */
export interface QaapGitExecCheckOptions {
    /**
     * The caller runs git with the user's global and system config switched off (`QaapNeutralGit`), so only the
     * repository's own scopes (local, worktree, includes of those) can run a program: entries of the `global` and
     * `system` scopes are ignored, and so are `diff=`/`filter=` attributes, which are inert without a definition.
     * Never set it for commands that run with the user's normal git environment.
     */
    readonly userScopesNeutralized?: boolean;
}

/**
 * Decides whether the effective git configuration of a working directory could turn a read-only git
 * command into program execution (fsmonitor, pagers, external diff / textconv drivers, filters, gpg).
 * Results are cached per cwd, keyed by the mtimes of the config and attribute files that feed them.
 */
export class QaapGitExecConfigChecker {

    protected readonly cache = new Map<string, {
        readonly key: string;
        readonly risk: string | undefined;
        /** Config files discovered while evaluating (includes, other origins) that also key the cache. */
        readonly extraFiles: readonly string[];
    }>();

    constructor(
        protected readonly gitRead: QaapGitReadSync,
        protected readonly homeDir: string = os.homedir(),
    ) { }

    /** Returns a reason when git may execute a program in `cwd` (or the check failed); `undefined` when safe. */
    check(cwd: string, options: QaapGitExecCheckOptions = {}): string | undefined {
        const neutral = options.userScopesNeutralized === true;
        const gitDirs = this.locateGitDirs(cwd);
        const watched = [
            ...(gitDirs ? [path.join(gitDirs.commonDir, 'config'), path.join(gitDirs.gitDir, 'config.worktree'),
                path.join(gitDirs.commonDir, 'info', 'attributes'), path.join(gitDirs.workTree, '.gitattributes')] : []),
            ...(neutral ? [] : [
                path.join(this.homeDir, '.gitconfig'),
                path.join(this.homeDir, '.config', 'git', 'config'),
                path.join(this.homeDir, '.config', 'git', 'attributes'),
                '/etc/gitconfig',
            ]),
        ];
        const cacheId = neutral ? `neutral:${cwd}` : cwd;
        // Neutralized runs vet what a model can write: never reuse an answer (an mtime is forgeable with `touch -r`).
        const cached = neutral ? undefined : this.cache.get(cacheId);
        const cacheKeyFor = (extra: readonly string[]): string => [...watched, ...extra].map(file => `${file}@${this.mtime(file)}`).join('|');
        if (cached && cached.key === cacheKeyFor(cached.extraFiles)) {
            return cached.risk;
        }
        const extraFiles: string[] = [];
        const risk = this.evaluate(cwd, gitDirs, extraFiles, neutral);
        if (!neutral) {
            this.cache.set(cacheId, { key: cacheKeyFor(extraFiles), risk, extraFiles });
        }
        return risk;
    }

    protected evaluate(cwd: string, gitDirs: QaapGitDirs | undefined, extraFiles: string[] = [], neutral = false): string | undefined {
        // Submodules carry their own config (`.git/modules/*/config`) that git applies when it recurses.
        if (gitDirs && this.readText(path.join(gitDirs.workTree, '.gitmodules')) !== undefined) {
            return 'submodule configuration not verified';
        }
        let result: ReturnType<QaapGitReadSync>;
        try {
            // `-z`: NUL-terminated records, so a newline or tab inside a value cannot forge another entry. The neutral
            // run uses the same `safe.directory=*` as the git it vets, or an ownership refusal would hide the config.
            result = this.gitRead(cwd, [
                ...(neutral ? ['-c', 'safe.directory=*'] : []),
                'config', '-z', '--show-origin', ...(neutral ? ['--show-scope'] : []),
                '--get-regexp', GIT_EXEC_CONFIG_REGEXP + (neutral ? GIT_WORKTREE_CONFIG_REGEXP : '')
            ], 1024 * 1024);
        } catch (error) {
            return `git config check failed: ${error instanceof Error ? error.message : String(error)}`;
        }
        // Exit 1 = no key matched. Anything else but 0 (or a spawn error) is an unverifiable config.
        if (result.error || (result.status !== 0 && result.status !== 1)) {
            return 'git config check failed';
        }
        if (result.status === 0) {
            // Records are `[scope NUL] origin NUL key NL value NUL` (scope only with --show-scope); a include keeps
            // the scope of the file that includes it.
            const fields = (result.stdout ?? '').split('\0');
            const width = neutral ? 3 : 2;
            for (let i = 0; i + width <= fields.length; i += width) {
                const scope = neutral ? fields[i] : '';
                const origin = fields[i + width - 2];
                const entry = fields[i + width - 1];
                if (scope === 'global' || scope === 'system') {
                    continue;
                }
                const newline = entry.indexOf('\n');
                const key = (newline < 0 ? entry : entry.slice(0, newline)).trim().toLowerCase();
                const value = newline < 0 ? '' : entry.slice(newline + 1);
                if (!key) {
                    continue;
                }
                if (origin.startsWith('file:')) {
                    extraFiles.push(path.resolve(cwd, origin.slice('file:'.length)));
                }
                if (neutral && GIT_INCLUDE_KEY_RE.test(key)) {
                    // An `includeIf "gitdir:..."` can match only in another worktree of the repository (the integration
                    // worktree a merge creates), where this check never runs: an include of a model-writable scope is
                    // not verifiable, so it is a refusal instead of something to follow.
                    return `git config ${key} is not verified (an include may apply only in another worktree)`;
                }
                if (GIT_INCLUDE_KEY_RE.test(key)) {
                    const originDir = origin.startsWith('file:') ? path.dirname(path.resolve(cwd, origin.slice('file:'.length))) : cwd;
                    extraFiles.push(path.resolve(originDir, value.replace(/^~(?=\/|$)/, this.homeDir)));
                    continue;
                }
                if (!isHarmlessGitExecValue(key, value)) {
                    if (key === 'core.worktree' || key === 'core.bare') {
                        return `git config ${key} redirects the working tree of the repository`;
                    }
                    return key === 'extensions.worktreeconfig'
                        ? 'git config extensions.worktreeConfig is enabled (a per-worktree config is not verified)'
                        : `git config ${key} can run a program`;
                }
            }
        }
        if (neutral) {
            return undefined;
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
