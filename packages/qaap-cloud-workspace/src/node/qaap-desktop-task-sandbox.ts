// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { nls } from '@theia/core/lib/common/nls';
import { isQaapDesktopRuntime } from '@theia/qaap-adapters/lib/common/qaap-desktop-runtime';
import { resolveQaapParallelRoot, resolveQaapWorktreesRoot } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { QaapTaskWorktreeContainment } from './qaap-task-worktree-containment';

/** `1`/`true`/`on` forces the sandbox on, `0`/`false`/`off` turns it off; unset uses {@link QAAP_DESKTOP_TASK_SANDBOX_DEFAULT}. */
export const QAAP_DESKTOP_TASK_SANDBOX_ENV = 'QAAP_DESKTOP_TASK_SANDBOX';

/** Default when the switch is unset (isolated-worktree tasks on the macOS desktop app only). */
export const QAAP_DESKTOP_TASK_SANDBOX_DEFAULT = true;

/** Apple's Seatbelt launcher. Deprecated in its man page since 10.8, still shipped and used by Codex, Claude Code and Gemini CLI. */
export const QAAP_SANDBOX_EXEC_PATH = '/usr/bin/sandbox-exec';

/**
 * Directories below `$HOME` a harness or the dev tools it runs must write. Each entry says who needs it.
 * Everything else below `$HOME` is read-only for the task.
 */
const HOME_WRITABLE_SUBPATHS: readonly (readonly [string, string])[] = [
    ['.claude', 'Claude Code: sessions, todos, shell snapshots, statsig, credentials fallback'],
    ['.codex', 'Codex: sessions, auth.json refresh, logs, version check'],
    ['.local/share/claude', 'Claude Code native installer: versions'],
    ['.local/state/claude', 'Claude Code native installer: locks'],
    ['.local/share/opencode', 'OpenCode: sessions, auth.json, snapshot git repos, logs'],
    ['.local/state/opencode', 'OpenCode: TUI/model state'],
    ['.config/opencode', 'OpenCode: installs its plugin dependencies (package.json, node_modules) at startup'],
    ['.opencode', 'OpenCode: installer dir, auto-update replaces the binary'],
    ['.local/share/cursor-agent', 'Cursor Agent: versions (auto-update)'],
    ['.cursor', 'Cursor Agent: cli-config.json, chats, projects'],
    ['.pi', 'Pi: ~/.pi/agent sessions, settings, auth'],
    ['.copilot', 'GitHub Copilot CLI: session state, logs, config'],
    ['.gemini', 'Gemini CLI / Antigravity: tmp, history, oauth creds, settings'],
    ['.antigravity', 'Antigravity (agy): state'],
    ['.grok', 'Grok CLI: sessions, settings'],
    ['.config/qaiq', 'QAIQ: state'],
    ['.qaiq', 'QAIQ: state'],
    ['.openclaude', 'OpenClaude: state'],
    ['.config/configstore', 'update-notifier of npm-distributed CLIs (Copilot, Gemini)'],
    ['.cache', 'XDG cache: OpenCode models/bun cache, pip, node-gyp, git credential-cache socket'],
    ['.npm', 'npm/npx cache and logs'],
    ['.yarn', 'Yarn Berry global cache'],
    ['Library/pnpm', 'pnpm store'],
    ['.bun/install', 'Bun install cache'],
    ['.cargo/registry', 'Cargo registry cache'],
    ['.cargo/git', 'Cargo git dependency cache'],
    ['.rustup', 'rustup: toolchains named by rust-toolchain.toml'],
    ['go/pkg', 'Go module cache'],
    ['.gradle', 'Gradle caches and daemons'],
    ['.m2', 'Maven local repository'],
    ['.cocoapods', 'CocoaPods spec repos'],
    ['Library/Caches', 'macOS per-user caches (Playwright browsers, Yarn, go-build, deno, Homebrew downloads)'],
    ['Library/Developer/Xcode/DerivedData', 'xcodebuild output'],
];

/**
 * Files directly in `$HOME` (matched as a prefix, so atomic-write temps, backups and locks are covered).
 */
const HOME_WRITABLE_FILE_PREFIXES: readonly (readonly [string, string])[] = [
    ['.claude.json', 'Claude Code: global state, rewritten atomically via .claude.json.tmp.<pid>.<n> and .backup'],
    ['.openclaude.json', 'OpenClaude: global state (same layout as Claude Code)'],
];

/** Environment variables naming a harness state dir that replaces one of the defaults above. */
const HARNESS_STATE_DIR_ENV_KEYS: readonly string[] = [
    'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'OPENCODE_CONFIG_DIR', 'PI_CODING_AGENT_DIR', 'COPILOT_HOME', 'GEMINI_CLI_HOME', 'GROK_HOME',
];

/** XDG base dirs whose harness subdir moves with the variable (OpenCode honours all four). */
const XDG_HARNESS_SUBDIRS: readonly (readonly [string, string])[] = [
    ['XDG_DATA_HOME', 'opencode'],
    ['XDG_STATE_HOME', 'opencode'],
    ['XDG_CONFIG_HOME', 'opencode'],
    ['XDG_CACHE_HOME', 'opencode'],
];

/**
 * Entries of the base repository's git directory a commit, fetch or gc in a linked worktree writes. The base
 * checkout's own `index`, `HEAD`, `config` and `hooks` are not among them: `config` and `hooks` would let the task
 * run code in the user's own git commands, the others would change the user's checkout.
 */
const GIT_COMMON_WRITABLE_SUBPATHS: readonly string[] = ['objects', 'refs', 'logs/refs', 'modules', 'lfs', 'rr-cache'];
/** `opencode`: OpenCode caches the project id of a repository in `<common>/opencode`. */
const GIT_COMMON_WRITABLE_FILE_PREFIXES: readonly string[] = ['packed-refs', 'shallow', 'gc.pid', 'gc.log', 'opencode'];

/** Git paths of a linked worktree, all real paths. */
export interface QaapLinkedWorktreeGitDirs {
    /** The worktree's own admin dir (`<common>/worktrees/<name>`): its HEAD, index, logs, FETCH_HEAD. */
    readonly adminDir: string;
    /** The base repository's git dir shared by all its worktrees. */
    readonly commonDir: string;
}

/** Everything one Seatbelt profile is built from. All paths are real (symlink-free) absolute paths. */
export interface QaapDesktopTaskSandboxProfileInput {
    readonly worktree: string;
    readonly git?: QaapLinkedWorktreeGitDirs;
    readonly home: string;
    /** Per-user temp roots (`/private/tmp`, `/private/var/folders/<a>/<b>`). */
    readonly tempRoots: readonly string[];
    /** Roots that hold every task worktree: denied inside the temp roots, except {@link worktree}. */
    readonly worktreeRoots: readonly string[];
    /** Extra writable dirs from harness env overrides (`CODEX_HOME`, `CLAUDE_CONFIG_DIR`, …). */
    readonly extraWritableDirs: readonly string[];
}

/** Thrown when the sandbox is on but cannot be applied. The task fails instead of running unconfined. */
export class QaapDesktopTaskSandboxUnavailableError extends Error {
    constructor(reason: string) {
        super(nls.localize(
            'theia/qaap-cloud-workspace/desktopTaskSandboxUnavailable',
            'The task sandbox could not be applied, so the agent was not started: {0} '
            + 'Set QAAP_DESKTOP_TASK_SANDBOX=0 to run worktree tasks without it.',
            reason,
        ));
        this.name = 'QaapDesktopTaskSandboxUnavailableError';
    }
}

/**
 * OS-level write sandbox for agent tasks that run in their own git worktree on the macOS desktop app. The
 * harness process (and everything it starts: shell tools, scripts, git) runs under Seatbelt with a profile
 * that allows everything except file writes outside the worktree, the base repository's object/ref store,
 * temp dirs, `/dev` and a curated list of harness and dev-tool state dirs. The Tool Gate's lexical
 * containment ({@link QaapTaskWorktreeContainment}) cannot see paths a shell builds at run time; this can.
 *
 * Shared-tree tasks, hosted backends and other platforms are never wrapped. Reads and network stay open.
 */
export class QaapDesktopTaskSandbox {

    constructor(
        protected readonly containment: QaapTaskWorktreeContainment = QaapTaskWorktreeContainment.shared,
    ) { }

    /** The switch, the platform and the desktop runtime allow the sandbox (independent of the task). */
    isEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
        if (this.platform() !== 'darwin' || !isQaapDesktopRuntime(env)) {
            return false;
        }
        const raw = env[QAAP_DESKTOP_TASK_SANDBOX_ENV]?.trim().toLowerCase();
        if (raw === '1' || raw === 'true' || raw === 'on') {
            return true;
        }
        if (raw === '0' || raw === 'false' || raw === 'off') {
            return false;
        }
        return QAAP_DESKTOP_TASK_SANDBOX_DEFAULT;
    }

    /** True when a harness started in `cwd` is wrapped: sandbox enabled and `cwd` is a Qaap linked worktree. */
    appliesTo(cwd: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
        return this.isEnabled(env) && this.containment.isIsolatedWorktree(cwd);
    }

    /**
     * `command` wrapped in Seatbelt for the worktree `cwd`, ready for `/bin/sh -c`. Throws
     * {@link QaapDesktopTaskSandboxUnavailableError} when `sandbox-exec` is missing or rejects the profile.
     */
    async wrapCommand(command: string, cwd: string, env: NodeJS.ProcessEnv, quote: (value: string) => string): Promise<string> {
        if (!this.isExecutable(QAAP_SANDBOX_EXEC_PATH)) {
            throw new QaapDesktopTaskSandboxUnavailableError(nls.localize(
                'theia/qaap-cloud-workspace/desktopTaskSandboxMissing', '{0} was not found or is not executable.', QAAP_SANDBOX_EXEC_PATH));
        }
        const profile = this.buildProfile(this.resolveProfileInput(cwd, env));
        const compileError = await this.checkProfile(profile);
        if (compileError !== undefined) {
            throw new QaapDesktopTaskSandboxUnavailableError(nls.localize(
                'theia/qaap-cloud-workspace/desktopTaskSandboxProfileRejected', 'sandbox-exec rejected the generated profile ({0}).', compileError));
        }
        // `exec` keeps one process: the agent stays the process-group leader Stop signals.
        return `exec ${QAAP_SANDBOX_EXEC_PATH} -p ${quote(profile)} /bin/sh -c ${quote(command)}`;
    }

    /** Collects the real paths the profile for worktree `cwd` is built from. */
    resolveProfileInput(cwd: string, env: NodeJS.ProcessEnv = process.env): QaapDesktopTaskSandboxProfileInput {
        const worktree = this.realpath(cwd);
        const home = this.realpath(env.HOME?.trim() || os.homedir());
        const extra = new Set<string>();
        for (const key of HARNESS_STATE_DIR_ENV_KEYS) {
            this.addExtraDir(extra, env[key], home, worktree);
        }
        for (const [key, subdir] of XDG_HARNESS_SUBDIRS) {
            const base = env[key]?.trim();
            if (base && path.isAbsolute(base)) {
                this.addExtraDir(extra, path.join(base, subdir), home, worktree);
            }
        }
        return {
            worktree,
            git: this.resolveLinkedWorktreeGitDirs(worktree),
            home,
            tempRoots: this.tempRoots(),
            worktreeRoots: this.worktreeRoots().map(root => this.realpath(root)),
            extraWritableDirs: [...extra],
        };
    }

    /**
     * The Seatbelt profile. Rules are evaluated last-match-wins, so the order is: allow everything, deny every
     * write, re-allow the writable areas, carve the other task worktrees out of the temp dirs, re-allow this one.
     */
    buildProfile(input: QaapDesktopTaskSandboxProfileInput): string {
        const lines: string[] = [
            '(version 1)',
            '; Qaap desktop task sandbox: writes are confined to the task worktree (see qaap-desktop-task-sandbox.ts).',
            '(allow default)',
            '(deny file-write*)',
            '(allow file-write* (subpath "/dev"))',
        ];
        const allow = (filter: string): void => {
            lines.push(`(allow file-write* ${filter})`);
        };
        for (const root of input.tempRoots) {
            allow(this.subpath(root));
        }
        for (const [relative] of HOME_WRITABLE_SUBPATHS) {
            allow(this.subpath(path.join(input.home, relative)));
        }
        for (const [file] of HOME_WRITABLE_FILE_PREFIXES) {
            allow(this.prefix(path.join(input.home, file)));
        }
        for (const dir of input.extraWritableDirs) {
            allow(this.subpath(dir));
        }
        if (input.git) {
            for (const relative of GIT_COMMON_WRITABLE_SUBPATHS) {
                allow(this.subpath(path.join(input.git.commonDir, relative)));
            }
            for (const file of GIT_COMMON_WRITABLE_FILE_PREFIXES) {
                allow(this.prefix(path.join(input.git.commonDir, file)));
            }
        }
        // Other tasks' worktrees sit in the same temp dir: deny them, then re-allow this task's own tree.
        for (const root of input.worktreeRoots) {
            lines.push(`(deny file-write* ${this.subpath(root)})`);
        }
        allow(this.subpath(input.worktree));
        if (input.git) {
            allow(this.subpath(input.git.adminDir));
        }
        // AppleScript to another app (`tell application "Terminal" to do script …`) would run code outside the sandbox.
        lines.push('(deny appleevent-send)');
        return `${lines.join('\n')}\n`;
    }

    /**
     * The admin and common git dirs of the linked worktree `worktree` (whose `.git` is a `gitdir:` file), or
     * undefined when it is not a linked worktree. The admin dir must live in `<common>/worktrees/`.
     */
    resolveLinkedWorktreeGitDirs(worktree: string): QaapLinkedWorktreeGitDirs | undefined {
        let pointer: string;
        try {
            pointer = fs.readFileSync(path.join(worktree, '.git'), 'utf8');
        } catch {
            return undefined;
        }
        const match = /^gitdir:\s*(.+?)\s*$/m.exec(pointer);
        if (!match) {
            return undefined;
        }
        const adminDir = this.realpath(path.resolve(worktree, match[1]));
        let commonDir: string;
        try {
            const relative = fs.readFileSync(path.join(adminDir, 'commondir'), 'utf8').trim();
            commonDir = this.realpath(path.resolve(adminDir, relative));
        } catch {
            commonDir = this.realpath(path.resolve(adminDir, '..', '..'));
        }
        if (path.dirname(adminDir) !== path.join(commonDir, 'worktrees')) {
            return undefined;
        }
        return { adminDir, commonDir };
    }

    /** True when `text` shows a write the task sandbox refused (EPERM on a file operation). */
    static isDenialText(text: string): boolean {
        return /Operation not permitted|EPERM: operation not permitted/i.test(text);
    }

    protected checkProfile(profile: string): Promise<string | undefined> {
        return new Promise(resolve => {
            execFile(QAAP_SANDBOX_EXEC_PATH, ['-p', profile, '/usr/bin/true'], { timeout: 10_000 }, (error, _stdout, stderr) => {
                resolve(error ? (String(stderr).trim() || error.message) : undefined);
            });
        });
    }

    protected addExtraDir(into: Set<string>, raw: string | undefined, home: string, worktree: string): void {
        const value = raw?.trim();
        if (!value || !path.isAbsolute(value)) {
            return;
        }
        const real = this.realpath(value);
        // Never widen the sandbox to `/`, all of `$HOME`, or a parent of the worktree.
        if (real === path.parse(real).root || this.contains(real, home) || this.contains(real, worktree)) {
            return;
        }
        into.add(real);
    }

    /** `/private/tmp`, `/private/var/tmp` and the per-user `/private/var/folders/<a>/<b>` (its `T`, `C` and `0`). */
    protected tempRoots(): string[] {
        const roots = new Set<string>(['/private/tmp', '/private/var/tmp']);
        const tmp = this.realpath(os.tmpdir());
        roots.add(path.basename(tmp) === 'T' ? path.dirname(tmp) : tmp);
        return [...roots];
    }

    protected worktreeRoots(): string[] {
        return [resolveQaapWorktreesRoot(), resolveQaapParallelRoot()];
    }

    protected platform(): NodeJS.Platform {
        return process.platform;
    }

    protected isExecutable(file: string): boolean {
        try {
            fs.accessSync(file, fs.constants.X_OK);
            return true;
        } catch {
            return false;
        }
    }

    protected realpath(target: string): string {
        return this.containment.realpathNearest(target);
    }

    /** True when `target` is `dir` or inside it. */
    protected contains(dir: string, target: string): boolean {
        const relative = path.relative(dir, target);
        return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
    }

    protected subpath(target: string): string {
        return `(subpath ${this.quote(target)})`;
    }

    protected prefix(target: string): string {
        return `(prefix ${this.quote(target)})`;
    }

    /** A Seatbelt (Scheme) string literal: backslash and double quote escaped, control characters refused. */
    protected quote(value: string): string {
        if (/[\u0000-\u001f]/.test(value)) {
            throw new QaapDesktopTaskSandboxUnavailableError(`the path ${JSON.stringify(value)} contains a control character.`);
        }
        return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
}

export namespace QaapDesktopTaskSandbox {
    /** Shared stateless instance. */
    export const shared = new QaapDesktopTaskSandbox();
}
