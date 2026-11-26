// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    QAAP_DESKTOP_TASK_SANDBOX_DEFAULT,
    QAAP_SANDBOX_EXEC_PATH,
    QaapDesktopTaskSandbox,
    QaapDesktopTaskSandboxProfileInput,
    QaapDesktopTaskSandboxUnavailableError,
} from './qaap-desktop-task-sandbox';
import { QaapTaskWorktreeContainment } from './qaap-task-worktree-containment';

/** Containment whose worktree root is a per-test directory. */
class TestContainment extends QaapTaskWorktreeContainment {
    constructor(protected readonly root: string) {
        super();
    }
    protected override worktreeRoots(): string[] {
        return [path.join(this.root, 'worktrees')];
    }
}

class TestSandbox extends QaapDesktopTaskSandbox {
    platformValue: NodeJS.Platform = 'darwin';
    executable = true;
    compileError: string | undefined = undefined;
    checkedProfiles: string[] = [];
    constructor(protected readonly root: string, containment: QaapTaskWorktreeContainment = new TestContainment(root)) {
        super(containment);
    }
    protected override platform(): NodeJS.Platform {
        return this.platformValue;
    }
    protected override isExecutable(): boolean {
        return this.executable;
    }
    protected override checkProfile(profile: string): Promise<string | undefined> {
        this.checkedProfiles.push(profile);
        return Promise.resolve(this.compileError);
    }
    protected override worktreeRoots(): string[] {
        return [path.join(this.root, 'worktrees'), path.join(this.root, 'parallel')];
    }
    roots(): string[] {
        return this.tempRoots();
    }
}

/** The real profile with the per-test dir standing in for the temp dir (the base repo must not sit in a temp root). */
class EnforcementSandbox extends QaapDesktopTaskSandbox {
    constructor(protected readonly root: string) {
        super(new TestContainment(root));
    }
    protected override tempRoots(): string[] {
        return [path.join(this.root, 'scratch')];
    }
    protected override worktreeRoots(): string[] {
        return [path.join(this.root, 'worktrees')];
    }
}

const quote = (value: string): string => `'${value.replace(/'/g, '\'\\\'\'')}'`;
const desktopEnv = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({ QAAP_DESKTOP: '1', HOME: os.homedir(), ...extra });

/** A base repo and a linked worktree laid out like git does it (no git binary needed). */
function makeLinkedWorktree(root: string, name = 'task1'): { base: string; worktree: string } {
    const base = path.join(root, 'repo');
    const worktree = path.join(root, 'worktrees', 'tenant', name);
    const admin = path.join(base, '.git', 'worktrees', name);
    fs.mkdirSync(admin, { recursive: true });
    fs.mkdirSync(worktree, { recursive: true });
    fs.writeFileSync(path.join(admin, 'commondir'), '../..\n');
    fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${admin}\n`);
    return { base, worktree };
}

describe('QaapDesktopTaskSandbox', () => {
    let root: string;

    beforeEach(() => {
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-desktop-sandbox-')));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    describe('switch', () => {
        it('applies the default on the macOS desktop app', () => {
            expect(new TestSandbox(root).isEnabled(desktopEnv())).to.equal(QAAP_DESKTOP_TASK_SANDBOX_DEFAULT);
        });

        it('honours QAAP_DESKTOP_TASK_SANDBOX', () => {
            const sandbox = new TestSandbox(root);
            expect(sandbox.isEnabled(desktopEnv({ QAAP_DESKTOP_TASK_SANDBOX: '0' }))).to.equal(false);
            expect(sandbox.isEnabled(desktopEnv({ QAAP_DESKTOP_TASK_SANDBOX: 'off' }))).to.equal(false);
            expect(sandbox.isEnabled(desktopEnv({ QAAP_DESKTOP_TASK_SANDBOX: 'true' }))).to.equal(true);
        });

        it('never applies outside the desktop runtime or on another platform, even when forced on', () => {
            const sandbox = new TestSandbox(root);
            expect(sandbox.isEnabled({ QAAP_DESKTOP_TASK_SANDBOX: '1' })).to.equal(false);
            sandbox.platformValue = 'linux';
            expect(sandbox.isEnabled(desktopEnv({ QAAP_DESKTOP_TASK_SANDBOX: '1' }))).to.equal(false);
            sandbox.platformValue = 'win32';
            expect(sandbox.isEnabled(desktopEnv({ QAAP_DESKTOP_TASK_SANDBOX: '1' }))).to.equal(false);
        });

        it('wraps only isolated worktree tasks, never a shared working tree', () => {
            const { base, worktree } = makeLinkedWorktree(root);
            const sandbox = new TestSandbox(root);
            const env = desktopEnv({ QAAP_DESKTOP_TASK_SANDBOX: '1' });
            expect(sandbox.appliesTo(worktree, env)).to.equal(true);
            expect(sandbox.appliesTo(base, env)).to.equal(false);
            expect(sandbox.appliesTo(undefined, env)).to.equal(false);
            expect(sandbox.appliesTo(worktree, desktopEnv({ QAAP_DESKTOP_TASK_SANDBOX: '0' }))).to.equal(false);
        });
    });

    describe('profile', () => {
        const input = (overrides: Partial<QaapDesktopTaskSandboxProfileInput> = {}): QaapDesktopTaskSandboxProfileInput => ({
            worktree: '/private/var/folders/x/y/T/qaap-worktrees/t/abc',
            git: { commonDir: '/Users/u/repo/.git', adminDir: '/Users/u/repo/.git/worktrees/abc' },
            home: '/Users/u',
            tempRoots: ['/private/tmp', '/private/var/folders/x/y'],
            worktreeRoots: ['/private/var/folders/x/y/T/qaap-worktrees'],
            extraWritableDirs: [],
            ...overrides,
        });

        it('allows everything, denies writes, then re-allows the worktree after carving out the other worktrees', () => {
            const profile = new TestSandbox(root).buildProfile(input());
            const lines = profile.trim().split('\n');
            expect(lines[0]).to.equal('(version 1)');
            expect(lines).to.include('(allow default)');
            const denyAll = lines.indexOf('(deny file-write*)');
            const denyRoots = lines.indexOf('(deny file-write* (subpath "/private/var/folders/x/y/T/qaap-worktrees"))');
            const allowWorktree = lines.indexOf('(allow file-write* (subpath "/private/var/folders/x/y/T/qaap-worktrees/t/abc"))');
            const allowTemp = lines.indexOf('(allow file-write* (subpath "/private/var/folders/x/y"))');
            expect(denyAll).to.be.greaterThan(0);
            expect(allowTemp).to.be.greaterThan(denyAll);
            expect(denyRoots).to.be.greaterThan(allowTemp);
            expect(allowWorktree).to.be.greaterThan(denyRoots);
            expect(lines).to.include('(allow file-write* (subpath "/dev"))');
            expect(lines).to.include('(deny appleevent-send)');
        });

        it('opens only the object and ref store of the base repository, plus this worktree\'s admin dir', () => {
            const profile = new TestSandbox(root).buildProfile(input());
            expect(profile).to.include('(allow file-write* (subpath "/Users/u/repo/.git/objects"))');
            expect(profile).to.include('(allow file-write* (subpath "/Users/u/repo/.git/refs"))');
            expect(profile).to.include('(allow file-write* (prefix "/Users/u/repo/.git/packed-refs"))');
            expect(profile).to.include('(allow file-write* (subpath "/Users/u/repo/.git/worktrees/abc"))');
            expect(profile).not.to.include('(subpath "/Users/u/repo/.git")');
            expect(profile).not.to.include('/Users/u/repo/.git/hooks');
            expect(profile).not.to.include('/Users/u/repo/.git/config');
            expect(profile).not.to.match(/"\/Users\/u\/repo"\)/);
        });

        it('opens the curated harness dirs, never all of HOME', () => {
            const profile = new TestSandbox(root).buildProfile(input());
            for (const dir of ['.claude', '.codex', '.local/share/opencode', '.config/opencode', '.pi', '.copilot', '.cursor', '.gemini', '.cache', '.npm', 'Library/Caches']) {
                expect(profile).to.include(`(allow file-write* (subpath "/Users/u/${dir}"))`);
            }
            expect(profile).to.include('(allow file-write* (prefix "/Users/u/.claude.json"))');
            expect(profile).not.to.include('(subpath "/Users/u")');
        });

        it('escapes quotes and backslashes and refuses control characters', () => {
            const sandbox = new TestSandbox(root);
            const profile = sandbox.buildProfile(input({ worktree: '/tmp/we"ird\\name' }));
            expect(profile).to.include('(subpath "/tmp/we\\"ird\\\\name")');
            expect(() => sandbox.buildProfile(input({ worktree: '/tmp/bad\nname' }))).to.throw(QaapDesktopTaskSandboxUnavailableError);
        });

        it('omits git rules when the worktree is not a linked worktree', () => {
            const profile = new TestSandbox(root).buildProfile(input({ git: undefined }));
            expect(profile).not.to.include('.git');
        });
    });

    describe('resolveProfileInput', () => {
        it('resolves the base repository from the worktree .git pointer', () => {
            const { base, worktree } = makeLinkedWorktree(root);
            const resolved = new TestSandbox(root).resolveProfileInput(worktree, desktopEnv());
            expect(resolved.worktree).to.equal(worktree);
            expect(resolved.git).to.deep.equal({ commonDir: path.join(base, '.git'), adminDir: path.join(base, '.git', 'worktrees', 'task1') });
        });

        it('refuses a gitdir that is not in <common>/worktrees', () => {
            const worktree = path.join(root, 'worktrees', 'tenant', 'odd');
            fs.mkdirSync(worktree, { recursive: true });
            fs.mkdirSync(path.join(root, 'elsewhere'));
            fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${path.join(root, 'elsewhere')}\n`);
            expect(new TestSandbox(root).resolveLinkedWorktreeGitDirs(worktree)).to.equal(undefined);
        });

        it('uses real paths (/var is /private/var on macOS) and the per-user temp folder', function (): void {
            if (process.platform !== 'darwin') {
                this.skip();
            }
            const sandbox = new TestSandbox(root);
            const resolved = sandbox.resolveProfileInput('/var/../var/tmp', desktopEnv());
            expect(resolved.worktree).to.equal('/private/var/tmp');
            const tmp = fs.realpathSync(os.tmpdir());
            expect(sandbox.roots()).to.include(path.basename(tmp) === 'T' ? path.dirname(tmp) : tmp);
            expect(sandbox.roots()).to.include('/private/tmp');
        });

        it('adds harness state dirs moved by env, but never /, HOME or an ancestor of the worktree', () => {
            const { worktree } = makeLinkedWorktree(root);
            const codexHome = path.join(root, 'codex-home');
            const xdgData = path.join(root, 'xdg-data');
            fs.mkdirSync(codexHome);
            const resolved = new TestSandbox(root).resolveProfileInput(worktree, desktopEnv({
                CODEX_HOME: codexHome,
                XDG_DATA_HOME: xdgData,
                CLAUDE_CONFIG_DIR: '/',
                PI_CODING_AGENT_DIR: os.homedir(),
                COPILOT_HOME: root,
                GROK_HOME: 'relative/dir',
            }));
            expect(resolved.extraWritableDirs).to.have.members([codexHome, path.join(xdgData, 'opencode')]);
        });
    });

    describe('wrapCommand', () => {
        it('wraps the command in sandbox-exec with exec, so the agent keeps its pid', async () => {
            const { worktree } = makeLinkedWorktree(root);
            const sandbox = new TestSandbox(root);
            const wrapped = await sandbox.wrapCommand('claude -p "hi"', worktree, desktopEnv(), quote);
            expect(wrapped.startsWith(`exec ${QAAP_SANDBOX_EXEC_PATH} -p '(version 1)`)).to.equal(true);
            expect(wrapped.endsWith(' /bin/sh -c \'claude -p "hi"\'')).to.equal(true);
            expect(sandbox.checkedProfiles).to.have.length(1);
        });

        it('fails closed when sandbox-exec is missing', async () => {
            const { worktree } = makeLinkedWorktree(root);
            const sandbox = new TestSandbox(root);
            sandbox.executable = false;
            const error = await sandbox.wrapCommand('claude', worktree, desktopEnv(), quote).then(() => undefined, (e: unknown) => e);
            expect(error).to.be.instanceOf(QaapDesktopTaskSandboxUnavailableError);
            expect(String((error as Error).message)).to.include('QAAP_DESKTOP_TASK_SANDBOX=0');
        });

        it('fails closed when the profile does not compile', async () => {
            const { worktree } = makeLinkedWorktree(root);
            const sandbox = new TestSandbox(root);
            sandbox.compileError = 'syntax error';
            const error = await sandbox.wrapCommand('claude', worktree, desktopEnv(), quote).then(() => undefined, (e: unknown) => e);
            expect(error).to.be.instanceOf(QaapDesktopTaskSandboxUnavailableError);
            expect(String((error as Error).message)).to.include('syntax error');
        });
    });

    describe('wrapArgv (preview dev servers)', () => {
        it('runs the argv under sandbox-exec with the same profile and no shell', async () => {
            const { worktree } = makeLinkedWorktree(root);
            const sandbox = new TestSandbox(root);
            const wrapped = await sandbox.wrapArgv('npm', ['run', 'dev'], worktree, desktopEnv());
            expect(wrapped.command).to.equal(QAAP_SANDBOX_EXEC_PATH);
            expect(wrapped.args[0]).to.equal('-p');
            expect(wrapped.args[1].startsWith('(version 1)')).to.equal(true);
            expect(wrapped.args.slice(2)).to.deep.equal(['npm', 'run', 'dev']);
            expect(sandbox.checkedProfiles).to.deep.equal([wrapped.args[1]]);
        });

        it('fails closed when sandbox-exec is missing', async () => {
            const { worktree } = makeLinkedWorktree(root);
            const sandbox = new TestSandbox(root);
            sandbox.executable = false;
            const error = await sandbox.wrapArgv('npm', ['start'], worktree, desktopEnv()).then(() => undefined, (e: unknown) => e);
            expect(error).to.be.instanceOf(QaapDesktopTaskSandboxUnavailableError);
        });
    });

    describe('enforcement (macOS only, real sandbox-exec)', () => {
        it('allows writes in the worktree and temp, denies the base checkout, its git config, other worktrees and HOME', function (): void {
            if (process.platform !== 'darwin' || !fs.existsSync(QAAP_SANDBOX_EXEC_PATH)) {
                this.skip();
            }
            const { base, worktree } = makeLinkedWorktree(root);
            const { worktree: otherWorktree } = makeLinkedWorktree(root, 'task2');
            fs.mkdirSync(path.join(root, 'scratch'));
            const homeProbe = path.join(os.homedir(), `.qaap-sandbox-spec-${process.pid}`);
            const sandbox = new EnforcementSandbox(root);
            const profile = sandbox.buildProfile(sandbox.resolveProfileInput(worktree, desktopEnv()));
            const attempt = (target: string): boolean => spawnSync(QAAP_SANDBOX_EXEC_PATH, ['-p', profile, '/bin/sh', '-c', 'echo x > "$1"', 'sh', target]).status === 0;
            try {
                expect(attempt(path.join(worktree, 'inside.txt')), 'worktree').to.equal(true);
                expect(attempt(path.join(base, '.git', 'worktrees', 'task1', 'index')), 'admin dir').to.equal(true);
                expect(attempt(path.join(root, 'scratch', 'tmp.txt')), 'temp').to.equal(true);
                expect(attempt(path.join(otherWorktree, 'x.txt')), 'another task worktree').to.equal(false);
                expect(attempt(path.join(base, 'escape.txt')), 'base checkout').to.equal(false);
                expect(attempt(path.join(base, '.git', 'config')), 'base git config').to.equal(false);
                expect(attempt(homeProbe), 'home').to.equal(false);
            } finally {
                fs.rmSync(homeProbe, { force: true });
            }
        });
    });
});
