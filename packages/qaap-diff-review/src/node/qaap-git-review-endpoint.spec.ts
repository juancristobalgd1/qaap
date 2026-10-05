// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isBinaryGitPatch, parseUnifiedDiff, type QaapGitChangedFile, type QaapGitPushDestination } from '@theia/qaap-shared-core/lib/common/qaap-git-review';
import type { QaapGithubAuthContext, QaapGithubAuthGuard } from '@theia/qaap-shared-core/lib/node/qaap-github-auth-guard';
import type { QaapGithubStoredSession } from '@theia/qaap-shared-core/lib/node/qaap-github-session-store';
import { QaapGitReviewEndpoint } from './qaap-git-review-endpoint';
import { QaapHostedGitPush, type QaapHostedGitPushRequest } from '@theia/qaap-shared-core/lib/node/qaap-hosted-git-push';
import { QaapHostedWorktreeRegistry } from '@theia/qaap-shared-core/lib/node/qaap-hosted-worktree-registry';
import { resolveQaapWorktreesRoot } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';

/** Create the symlink fixture when the host permits it; Windows may require Developer Mode. */
function createDirectoryLinkIfSupported(target: string, linkPath: string): boolean {
    try {
        fs.symlinkSync(target, linkPath, 'dir');
        return true;
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (process.platform !== 'win32' || (code !== 'EPERM' && code !== 'EACCES')) {
            throw error;
        }
        return false;
    }
}

/** Test seam: expose the protected git helpers without spinning up express or DI. */
class TestableGitReviewEndpoint extends QaapGitReviewEndpoint {
    statusCalls = 0;
    lastStatusArgs: string[] | undefined;

    protected override git(root: string, args: string[]): Promise<string> {
        if (args[0] === 'status') {
            this.statusCalls++;
            this.lastStatusArgs = args;
        }
        return super.git(root, args);
    }

    computeFileDiffForTest(root: string, file: string): Promise<string> {
        return this.computeFileDiff(root, file);
    }

    collectChangedFilesForTest(root: string): Promise<QaapGitChangedFile[]> {
        return this.collectChangedFiles(root);
    }

    rememberChangedFilesSnapshotForTest(root: string, files: readonly QaapGitChangedFile[]): void {
        this.rememberChangedFilesSnapshot(root, files);
    }

    async computeFileDiffFromSnapshotForTest(root: string, file: string): Promise<string> {
        const state = await this.resolveFileDiffState(root, file);
        return this.computeFileDiff(root, file, state);
    }

    discardFileForTest(root: string, file: string): Promise<void> {
        return this.discardFile(root, file);
    }

    sanitizeRelativePathForTest(value: unknown): string | undefined {
        return this.sanitizeRelativePath(value);
    }

    isMetadataOnlyUntrackedFileForTest(root: string, file: string): Promise<boolean> {
        return this.isMetadataOnlyUntrackedFile(root, file);
    }

    deleteLocalBranchForTest(root: string, branch: string): Promise<void> {
        return this.deleteLocalBranch(root, branch);
    }

    parseWorktreePathsForBranchForTest(porcelain: string, branch: string): string[] {
        return this.parseWorktreePathsForBranch(porcelain, branch);
    }
}

describe('qaap-git-review-endpoint computeFileDiff', function (): void {
    // git subprocess churn � allow slack on slow CI runners.
    this.timeout(20_000);

    let repo: string;
    let directoryLinkAvailable = false;
    const endpoint = new TestableGitReviewEndpoint();

    const git = (args: string[], cwd: string = repo): string =>
        execFileSync('git', args, { cwd, encoding: 'utf8' });

    before(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-git-review-spec-'));
        git(['init', '-q'], repo);
        git(['config', 'user.email', 'spec@qaap.test']);
        git(['config', 'user.name', 'qaap spec']);
        fs.writeFileSync(path.join(repo, 'index.html'), '<html>v1</html>\n');
        fs.writeFileSync(path.join(repo, 'rename-old.ts'), 'export const renamed = true;\n');
        fs.writeFileSync(path.join(repo, 'deleted.ts'), 'export const removed = true;\n');
        fs.writeFileSync(path.join(repo, 'binary.bin'), Buffer.from([0, 1, 2, 3]));
        fs.writeFileSync(path.join(repo, 'mode.sh'), '#!/bin/sh\necho qaap\n', { mode: 0o644 });
        git(['add', '.']);
        git(['commit', '-qm', 'init']);
        // Working tree shaped like the reported VPS case: one modified tracked file, one untracked.
        fs.writeFileSync(path.join(repo, 'index.html'), '<html>v2</html>\n<footer/>\n');
        fs.writeFileSync(path.join(repo, 'package-lock.json'), '{ "lockfileVersion": 3 }\n');
        fs.writeFileSync(path.join(repo, 'empty-new.txt'), '');
        directoryLinkAvailable = createDirectoryLinkIfSupported(
            os.tmpdir(),
            path.join(repo, 'untracked-directory-link'),
        );
        git(['mv', 'rename-old.ts', 'rename-new.ts']);
        git(['rm', '-q', 'deleted.ts']);
        fs.writeFileSync(path.join(repo, 'binary.bin'), Buffer.from([0, 9, 8, 7]));
        fs.chmodSync(path.join(repo, 'mode.sh'), 0o755);
        // chmodSync does not toggle Git's executable bit on Windows. Stage the mode change
        // through Git so this fixture is deterministic on both POSIX and Windows hosts.
        git(['update-index', '--chmod=+x', '--', 'mode.sh']);
        // Host-level breakage that killed per-file diffs in production: an external diff driver
        // that does not exist on the server. Plumbing (--numstat/status) ignores it, so the
        // changes list works while every patch-producing diff dies � unless we pass --no-ext-diff.
        git(['config', 'diff.external', '/nonexistent-external-diff-tool']);
    });

    after(() => {
        fs.rmSync(repo, { recursive: true, force: true });
    });

    it('produces a parseable patch for a modified tracked file despite a broken diff.external', async () => {
        const patch = await endpoint.computeFileDiffForTest(repo, 'index.html');
        expect(patch).to.contain('--- a/index.html');
        const hunks = parseUnifiedDiff(patch);
        expect(hunks.length).to.be.greaterThan(0);
        expect(hunks[0].lines.some(line => line.type === 'add' && line.text.includes('<footer/>'))).to.equal(true);
    });

    it('produces a whole-file patch for an untracked file despite a broken diff.external', async () => {
        const patch = await endpoint.computeFileDiffForTest(repo, 'package-lock.json');
        expect(patch).to.contain('/dev/null');
        const hunks = parseUnifiedDiff(patch);
        expect(hunks.length).to.be.greaterThan(0);
        expect(hunks[0].lines.some(line => line.type === 'add' && line.text.includes('lockfileVersion'))).to.equal(true);
        expect(hunks[0].lines.some(line => line.type === 'del')).to.equal(false);
    });

    it('classifies an empty untracked file as a genuine metadata-only change', async () => {
        const patch = await endpoint.computeFileDiffForTest(repo, 'empty-new.txt');
        expect(patch).to.contain('new file mode');
        expect(parseUnifiedDiff(patch)).to.deep.equal([]);
        expect(await endpoint.isMetadataOnlyUntrackedFileForTest(repo, 'empty-new.txt')).to.equal(true);
    });

    it('classifies an untracked symlink-to-directory as metadata instead of a missing diff', async function (): Promise<void> {
        if (!directoryLinkAvailable) {
            this.skip();
        }
        expect(await endpoint.computeFileDiffForTest(repo, 'untracked-directory-link')).to.equal('');
        expect(await endpoint.isMetadataOnlyUntrackedFileForTest(repo, 'untracked-directory-link')).to.equal(true);
    });

    it('emits no ANSI color codes even when color.ui is forced on', async () => {
        git(['config', 'color.ui', 'always']);
        try {
            const patch = await endpoint.computeFileDiffForTest(repo, 'index.html');
            expect(patch).to.not.match(/\[/);
        } finally {
            git(['config', '--unset', 'color.ui']);
        }
    });

    it('returns staged deleted and renamed patches against HEAD', async () => {
        const deleted = await endpoint.computeFileDiffForTest(repo, 'deleted.ts');
        expect(deleted).to.contain('deleted file mode');
        expect(parseUnifiedDiff(deleted).some(hunk => hunk.lines.some(line => line.type === 'del'))).to.equal(true);

        const renamed = await endpoint.computeFileDiffForTest(repo, 'rename-new.ts');
        expect(renamed).to.contain('rename from rename-old.ts');
        expect(renamed).to.contain('rename to rename-new.ts');
    });

    it('distinguishes binary and metadata-only patches from missing textual data', async () => {
        const binary = await endpoint.computeFileDiffForTest(repo, 'binary.bin');
        expect(binary).to.contain('Binary files');
        expect(isBinaryGitPatch(binary)).to.equal(true);
        expect(parseUnifiedDiff(binary)).to.deep.equal([]);

        const modeOnly = await endpoint.computeFileDiffForTest(repo, 'mode.sh');
        expect(modeOnly).to.contain('old mode 100644');
        expect(modeOnly).to.contain('new mode 100755');
        expect(isBinaryGitPatch(modeOnly)).to.equal(false);
        expect(parseUnifiedDiff(modeOnly)).to.deep.equal([]);
    });

    it('does not treat source code mentioning Git binary markers as a binary patch', () => {
        const textual = [
            'diff --git a/source.ts b/source.ts',
            '@@ -1 +1 @@',
            "-const marker = 'Binary files ';",
            "+const marker = 'GIT binary patch';",
        ].join('\n');
        expect(isBinaryGitPatch(textual)).to.equal(false);
    });

    it('parses rename records without creating a phantom old-path file', async () => {
        const files = await endpoint.collectChangedFilesForTest(repo);
        const renamed = files.find(file => file.path === 'rename-new.ts');
        expect(renamed?.status).to.equal('R');
        expect(renamed?.oldPath).to.equal('rename-old.ts');
        expect(files.some(file => file.path === 'rename-old.ts')).to.equal(false);
    });

    it('reuses the recent changes snapshot instead of running git status per diff', async () => {
        const files = await endpoint.collectChangedFilesForTest(repo);
        endpoint.rememberChangedFilesSnapshotForTest(repo, files);
        endpoint.statusCalls = 0;
        const patch = await endpoint.computeFileDiffFromSnapshotForTest(repo, 'package-lock.json');
        expect(patch).to.contain('/dev/null');
        expect(endpoint.statusCalls).to.equal(0);
    });

    it('limits the status fallback to the requested path', async () => {
        const uncachedEndpoint = new TestableGitReviewEndpoint();
        await uncachedEndpoint.computeFileDiffForTest(repo, 'index.html');
        expect(uncachedEndpoint.lastStatusArgs?.slice(-2)).to.deep.equal(['--', 'index.html']);
    });

    it('discards both sides of a staged rename and refreshes to a clean state', async () => {
        await endpoint.discardFileForTest(repo, 'rename-new.ts');
        expect(fs.existsSync(path.join(repo, 'rename-new.ts'))).to.equal(false);
        expect(fs.existsSync(path.join(repo, 'rename-old.ts'))).to.equal(true);
        const files = await endpoint.collectChangedFilesForTest(repo);
        expect(files.some(file => file.path === 'rename-new.ts' || file.path === 'rename-old.ts')).to.equal(false);
    });

    it('rejects absolute paths and parent traversal', () => {
        expect(endpoint.sanitizeRelativePathForTest('../outside.ts')).to.equal(undefined);
        expect(endpoint.sanitizeRelativePathForTest('/tmp/outside.ts')).to.equal(undefined);
        expect(endpoint.sanitizeRelativePathForTest('src/../../outside.ts')).to.equal(undefined);
        expect(endpoint.sanitizeRelativePathForTest('src/inside.ts')).to.equal('src/inside.ts');
    });
});

describe('qaap-git-review-endpoint deleteLocalBranch', function (): void {
    this.timeout(20_000);

    let repo: string;
    const endpoint = new TestableGitReviewEndpoint();

    const git = (args: string[], cwd: string = repo): string =>
        execFileSync('git', args, { cwd, encoding: 'utf8' });

    beforeEach(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-git-delete-branch-'));
        git(['init', '-q'], repo);
        git(['config', 'user.email', 'spec@qaap.test'], repo);
        git(['config', 'user.name', 'qaap spec'], repo);
        git(['commit', '--allow-empty', '-qm', 'init'], repo);
    });

    afterEach(() => {
        fs.rmSync(repo, { recursive: true, force: true });
    });

    it('parses worktree porcelain blocks for a nested branch name', () => {
        const porcelain = [
            'worktree /tmp/main',
            'HEAD abc',
            'branch refs/heads/main',
            '',
            'worktree /tmp/parallel/claude',
            'HEAD def',
            'branch refs/heads/qaap/parallel/08343a1f/claude',
        ].join('\n');
        expect(endpoint.parseWorktreePathsForBranchForTest(porcelain, 'qaap/parallel/08343a1f/claude'))
            .to.deep.equal(['/tmp/parallel/claude']);
    });

    it('deletes a branch that is checked out in a linked worktree', async () => {
        const branch = 'qaap/parallel/08343a1f/claude';
        git(['branch', branch], repo);
        const worktreePath = path.join(repo, 'linked-wt');
        git(['worktree', 'add', worktreePath, branch], repo);
        await endpoint.deleteLocalBranchForTest(repo, branch);
        expect(git(['branch', '--list', branch], repo).trim()).to.equal('');
        expect(fs.existsSync(worktreePath)).to.equal(false);
    });

    it('deletes a plain local branch without a linked worktree', async () => {
        git(['branch', 'feature/plain'], repo);
        await endpoint.deleteLocalBranchForTest(repo, 'feature/plain');
        expect(git(['branch', '--list', 'feature/plain'], repo).trim()).to.equal('');
    });
});

/** Hosted mode with agent-uid git replaced by a recorded local git, and a recorded hosted push. */
class HostedPushGitReviewEndpoint extends QaapGitReviewEndpoint {
    readonly agentGitCalls: string[][] = [];
    readonly pushes: QaapHostedGitPushRequest[] = [];

    constructor(userRoot: string, worktreeRegistry?: QaapHostedWorktreeRegistry) {
        super();
        const hostedPush = new QaapHostedGitPush();
        hostedPush.push = async request => {
            this.pushes.push(request);
        };
        Object.assign(this, {
            hostedPush,
            worktreeRegistry,
            auth: {
                ownsWorkspacePath: () => true,
                resolveUserLogin: (auth: QaapGithubAuthContext) => auth.kind === 'authenticated' ? auth.userLogin : undefined,
                userWorkspaceRoot: () => userRoot,
                repositoryWorkspacePath: (_auth: QaapGithubAuthContext, owner: string, name: string) => path.join(userRoot, owner, name),
            } as unknown as QaapGithubAuthGuard,
        });
    }

    protected override git(root: string, args: string[]): Promise<string> {
        this.agentGitCalls.push(args);
        return Promise.resolve(execFileSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }));
    }

    pushCurrentBranchForTest(root: string, auth: QaapGithubAuthContext): Promise<QaapGitPushDestination | undefined> {
        return this.pushCurrentBranch(root, auth);
    }
}

/** The worktree registry on a throwaway SQLite file, with `base` as the repos root. */
class SpecHostedWorktreeRegistry extends QaapHostedWorktreeRegistry {
    static readonly opened: SpecHostedWorktreeRegistry[] = [];

    constructor(protected readonly base: string) {
        super();
        SpecHostedWorktreeRegistry.opened.push(this);
    }

    protected override databasePath(): string {
        return path.join(this.base, 'registry.sqlite');
    }

    protected override reposRoot(): string {
        return this.base;
    }
}

describe('qaap-git-review-endpoint hosted push', function (): void {
    this.timeout(20_000);
    const TOKEN = 'gho_hostedPushSpecToken';
    const saved = { QAAP_CLOUD_MODE: process.env.QAAP_CLOUD_MODE, NODE_ENV: process.env.NODE_ENV };
    let base: string;
    let userRoot: string;
    let repo: string;
    const auth: QaapGithubAuthContext = {
        kind: 'authenticated',
        sessionId: 'tenant-backend:octo',
        userLogin: 'octo',
        session: { accessToken: TOKEN, user: { login: 'octo', provider: 'github' } as QaapGithubStoredSession['user'] },
    };
    const run = (args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
    const worktrees: string[] = [];

    beforeEach(() => {
        delete process.env.NODE_ENV;
        process.env.QAAP_CLOUD_MODE = 'docker';
        base = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-hosted-push-endpoint-'));
        // The project's canonical clone: {reposRoot}/users/{login}/{owner}/{repo}.
        userRoot = path.join(base, 'users', 'octo');
        repo = path.join(userRoot, 'acme', 'widget');
        fs.mkdirSync(repo, { recursive: true });
        run(['init', '--quiet', '-b', 'main']);
        run(['config', 'user.email', 'spec@qaap.test']);
        run(['config', 'user.name', 'Spec']);
        run(['remote', 'add', 'origin', 'git@github.com:acme/widget.git']);
        fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
        run(['add', 'a.txt']);
        run(['commit', '--quiet', '-m', 'one']);
        run(['checkout', '--quiet', '-b', 'feature/x']);
    });

    afterEach(() => {
        for (const registry of SpecHostedWorktreeRegistry.opened.splice(0)) {
            registry.close();
        }
        fs.rmSync(base, { recursive: true, force: true });
        for (const worktree of worktrees.splice(0)) {
            fs.rmSync(worktree, { recursive: true, force: true });
        }
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    });

    it('pushes through the root backend: agent-uid git never pushes and never sees the token', async () => {
        const endpoint = new HostedPushGitReviewEndpoint(userRoot);
        const destination = await endpoint.pushCurrentBranchForTest(repo, auth);

        expect(destination).to.deep.equal({ repository: 'acme/widget', branch: 'feature/x', url: 'https://github.com/acme/widget.git' });
        expect(endpoint.pushes).to.have.length(1);
        // Windows may hand back the temp dir as an 8.3 short name (RUNNER~1), so compare real paths.
        const pushed = { ...endpoint.pushes[0], objectsDirectory: fs.realpathSync.native(endpoint.pushes[0].objectsDirectory) };
        expect(pushed).to.deep.equal({
            objectsDirectory: path.join(fs.realpathSync.native(repo), '.git', 'objects'),
            url: 'https://github.com/acme/widget.git',
            sha: run(['rev-parse', 'HEAD']),
            ref: 'refs/heads/feature/x',
            token: TOKEN,
        });
        for (const args of endpoint.agentGitCalls) {
            expect(args).not.to.include('push');
            expect(args.join(' ')).not.to.contain(TOKEN);
        }
        // Same local state as `git push -u origin feature/x`.
        expect(run(['rev-parse', 'refs/remotes/origin/feature/x'])).to.equal(run(['rev-parse', 'HEAD']));
        expect(run(['config', '--get', 'branch.feature/x.merge'])).to.equal('refs/heads/feature/x');
    });

    it('keeps the plain push for a remote that is not GitHub', async () => {
        run(['remote', 'set-url', 'origin', path.join(repo, 'nowhere.git')]);
        const endpoint = new HostedPushGitReviewEndpoint(userRoot);
        let error: unknown;
        try {
            await endpoint.pushCurrentBranchForTest(repo, auth);
        } catch (caught) {
            error = caught;
        }
        expect(error).to.be.instanceOf(Error);
        expect(endpoint.pushes).to.have.length(0);
        expect(endpoint.agentGitCalls.some(args => args[0] === 'push')).to.equal(true);
    });

    async function expectRefusedPush(endpoint: HostedPushGitReviewEndpoint, message: RegExp): Promise<void> {
        let error: unknown;
        try {
            await endpoint.pushCurrentBranchForTest(repo, auth);
        } catch (caught) {
            error = caught;
        }
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.match(message);
        expect(endpoint.pushes).to.have.length(0);
        expect(endpoint.agentGitCalls.some(args => args[0] === 'push')).to.equal(false);
    }

    it('refuses a push URL an agent pointed at another GitHub repository', async () => {
        run(['config', 'remote.origin.pushurl', 'https://github.com/victim-org/payroll.git']);
        await expectRefusedPush(new HostedPushGitReviewEndpoint(userRoot), /victim-org\/payroll.*acme\/widget/);
    });

    it('pushes to the current branch name whatever branch.<name>.merge says', async () => {
        run(['config', 'branch.feature/x.remote', 'origin']);
        run(['config', 'branch.feature/x.merge', 'refs/heads/main']);
        const endpoint = new HostedPushGitReviewEndpoint(userRoot);
        await endpoint.pushCurrentBranchForTest(repo, auth);

        expect(endpoint.pushes.map(request => request.ref)).to.deep.equal(['refs/heads/feature/x']);
        expect(run(['config', '--get', 'branch.feature/x.merge'])).to.equal('refs/heads/feature/x');
    });

    it('refuses a project whose .git borrows another clone and its GitHub remote', async () => {
        const other = path.join(userRoot, 'victim-org', 'payroll');
        fs.mkdirSync(other, { recursive: true });
        execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: other });
        execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/victim-org/payroll.git'], { cwd: other });
        execFileSync('git', ['-c', 'user.email=a@b.test', '-c', 'user.name=A', 'commit', '--quiet', '--allow-empty', '-m', 'x'], { cwd: other });
        execFileSync('git', ['checkout', '--quiet', '-b', 'feature/x'], { cwd: other });
        fs.rmSync(path.join(repo, '.git'), { recursive: true, force: true });
        fs.writeFileSync(path.join(repo, '.git'), `gitdir: ${path.join(other, '.git')}\n`);
        await expectRefusedPush(new HostedPushGitReviewEndpoint(userRoot), /project's own GitHub repository/);
    });

    it('refuses a repository that is not one of the caller\'s project clones', async () => {
        const stray = path.join(base, 'stray');
        fs.renameSync(repo, stray);
        repo = stray;
        await expectRefusedPush(new HostedPushGitReviewEndpoint(userRoot), /project's own GitHub repository/);
    });
    /** An agent-made clone `users/octo/victim-org/prod` whose origin is the victim repository, on `feature/x`. */
    function agentVictimClone(): string {
        const victim = path.join(userRoot, 'victim-org', 'prod');
        fs.mkdirSync(victim, { recursive: true });
        const victimGit = (args: string[]): string => execFileSync('git', args, { cwd: victim, encoding: 'utf8' }).trim();
        victimGit(['init', '--quiet', '-b', 'main']);
        victimGit(['remote', 'add', 'origin', 'https://github.com/victim-org/prod.git']);
        victimGit(['-c', 'user.email=a@b.test', '-c', 'user.name=A', 'commit', '--quiet', '--allow-empty', '-m', 'agent']);
        victimGit(['checkout', '--quiet', '-b', 'feature/x']);
        return victim;
    }

    /** A fresh worktree path under the real worktrees root, `{tmpdir}/qaap-worktrees/octo/{slug}`. */
    function worktreePath(): string {
        const tenantDir = path.join(resolveQaapWorktreesRoot(), 'octo');
        fs.mkdirSync(tenantDir, { recursive: true });
        const worktree = path.join(fs.mkdtempSync(path.join(tenantDir, 'spec-')), 'wt');
        worktrees.push(path.dirname(worktree));
        return worktree;
    }

    it('refuses a project directory the agent replaced with a symlink to another clone (R3-1 A)', async function (): Promise<void> {
        const victim = agentVictimClone();
        fs.rmSync(repo, { recursive: true, force: true });
        if (!createDirectoryLinkIfSupported(victim, repo)) {
            this.skip();
        }
        await expectRefusedPush(new HostedPushGitReviewEndpoint(userRoot), /project's own GitHub repository/);
    });

    it('refuses a project whose .git the agent replaced with a symlink to another clone (R3-1 A)', async function (): Promise<void> {
        const victim = agentVictimClone();
        fs.rmSync(path.join(repo, '.git'), { recursive: true, force: true });
        if (!createDirectoryLinkIfSupported(path.join(victim, '.git'), path.join(repo, '.git'))) {
            this.skip();
        }
        await expectRefusedPush(new HostedPushGitReviewEndpoint(userRoot), /project's own GitHub repository/);
    });

    it('refuses a worktree the backend did not create, whatever its .git file points at (R3-1 B)', async () => {
        const victim = agentVictimClone();
        const worktree = worktreePath();
        execFileSync('git', ['worktree', 'add', '--quiet', '-b', 'agent-branch', worktree, 'HEAD'], { cwd: victim });
        repo = worktree;
        await expectRefusedPush(new HostedPushGitReviewEndpoint(userRoot, new SpecHostedWorktreeRegistry(base)), /project's own GitHub repository/);
    });

    it('pushes a worktree the backend created to the project it recorded', async () => {
        const registry = new SpecHostedWorktreeRegistry(base);
        const worktree = worktreePath();
        run(['worktree', 'add', '--quiet', '-b', 'qaap/worktree/spec', worktree, 'HEAD']);
        expect(registry.register('octo', repo, worktree)).to.deep.equal({ login: 'octo', owner: 'acme', repo: 'widget' });
        const project = repo;
        repo = worktree;
        const endpoint = new HostedPushGitReviewEndpoint(userRoot, registry);
        const destination = await endpoint.pushCurrentBranchForTest(worktree, auth);

        expect(destination).to.deep.equal({ repository: 'acme/widget', branch: 'qaap/worktree/spec', url: 'https://github.com/acme/widget.git' });
        expect(fs.realpathSync.native(endpoint.pushes[0].objectsDirectory)).to.equal(path.join(fs.realpathSync.native(project), '.git', 'objects'));
        expect(endpoint.pushes[0].ref).to.equal('refs/heads/qaap/worktree/spec');
    });

    it('refuses a recorded worktree whose .git file the agent pointed at another clone (R3-1 B)', async () => {
        const registry = new SpecHostedWorktreeRegistry(base);
        const worktree = worktreePath();
        run(['worktree', 'add', '--quiet', '-b', 'qaap/worktree/spec', worktree, 'HEAD']);
        registry.register('octo', repo, worktree);
        const victim = agentVictimClone();
        // Even with the victim's origin rewritten to the project URL, the git dir must be the project's own.
        execFileSync('git', ['remote', 'set-url', 'origin', 'https://github.com/acme/widget.git'], { cwd: victim });
        const victimWorktree = worktreePath();
        execFileSync('git', ['worktree', 'add', '--quiet', '-b', 'agent-branch', victimWorktree, 'HEAD'], { cwd: victim });
        fs.copyFileSync(path.join(victimWorktree, '.git'), path.join(worktree, '.git'));
        repo = worktree;
        await expectRefusedPush(new HostedPushGitReviewEndpoint(userRoot, registry), /project's own GitHub repository/);
    });

    it('refuses a recorded worktree for another login', async () => {
        const registry = new SpecHostedWorktreeRegistry(base);
        const worktree = worktreePath();
        run(['worktree', 'add', '--quiet', '-b', 'qaap/worktree/spec', worktree, 'HEAD']);
        registry.register('mallory', path.join(base, 'users', 'mallory', 'acme', 'widget'), worktree);
        repo = worktree;
        await expectRefusedPush(new HostedPushGitReviewEndpoint(userRoot, registry), /project's own GitHub repository/);
    });
});
