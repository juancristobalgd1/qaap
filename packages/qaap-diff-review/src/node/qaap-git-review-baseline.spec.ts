// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapGitReviewEndpoint } from './qaap-git-review-endpoint';
import type { QaapGitChangedFile } from '@theia/qaap-shared-core/lib/common/qaap-git-review';
import { snapshotWorktreeTree } from '@theia/qaap-shared-core/lib/node/qaap-git-tree-diff';

class BaselineGitReviewEndpoint extends QaapGitReviewEndpoint {
    changedSinceBaselineForTest(root: string, baseCommit: string): Promise<QaapGitChangedFile[]> {
        return this.collectChangedFilesSinceBaseline(root, baseCommit);
    }

    /** Skips the auth-bound repository resolution; the validation under test runs after it. */
    protected override resolveRepository(): Promise<string | undefined> {
        return Promise.resolve(this.repoRootForTest);
    }

    protected override resolveRepositoryBody(): Promise<string | undefined> {
        return Promise.resolve(this.repoRootForTest);
    }

    discardFileForTest(root: string, file: string, baseCommit: string): Promise<void> {
        return this.discardFile(root, file, baseCommit);
    }

    commitForTest(req: unknown, res: unknown): Promise<void> {
        return (this as unknown as { handleCommitWorkflow(req: unknown, res: unknown): Promise<void> }).handleCommitWorkflow(req, res);
    }

    repoRootForTest: string | undefined;

    snapshotCount = 0;

    changedForTest(root: string, baseCommit: string, reuseSnapshot: boolean): Promise<QaapGitChangedFile[]> {
        return this.collectChangedFilesSinceBaseline(root, baseCommit, reuseSnapshot);
    }

    protected override takeTaskSnapshot(root: string): Promise<string> {
        this.snapshotCount++;
        return super.takeTaskSnapshot(root);
    }

    diffSinceBaselineForTest(root: string, file: string, baseCommit: string): Promise<string> {
        return (this as unknown as { computeFileDiffSinceBaseline(r: string, f: string, b: string, s: undefined): Promise<string> })
            .computeFileDiffSinceBaseline(root, file, baseCommit, undefined);
    }

    handleChangesForTest(req: unknown, res: unknown): Promise<void> {
        return (this as unknown as { handleChanges(req: unknown, res: unknown): Promise<void> }).handleChanges(req, res);
    }
}

/** True when `promise` rejects; the value is not needed by the caller. */
async function rejectsWith(promise: Promise<unknown>): Promise<boolean> {
    try {
        await promise;
        return false;
    } catch {
        return true;
    }
}

interface FakeRes {
    statusCode: number;
    body: unknown;
    status(code: number): FakeRes;
    json(payload: unknown): FakeRes;
}

const fakeRes = (): FakeRes => ({
    statusCode: 200,
    body: undefined,
    status(code: number): FakeRes { this.statusCode = code; return this; },
    json(payload: unknown): FakeRes { this.body = payload; return this; },
});

describe('qaap-git-review-endpoint task baseline', function (): void {
    this.timeout(20_000);

    let repo: string;
    const endpoint = new BaselineGitReviewEndpoint();
    const git = (args: string[]): string => execFileSync(
        'git', ['-c', 'core.autocrlf=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: repo, encoding: 'utf8' },
    ).trim();

    beforeEach(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-git-review-baseline-'));
        git(['init', '-q']);
        git(['config', 'user.email', 'spec@qaap.test']);
        git(['config', 'user.name', 'qaap spec']);
        fs.writeFileSync(path.join(repo, 'README.md'), 'base\n');
        fs.writeFileSync(path.join(repo, 'a.ts'), 'one\n');
        git(['add', '-A']);
        git(['commit', '-qm', 'init']);
    });

    afterEach(() => {
        fs.rmSync(repo, { recursive: true, force: true });
    });

    it('lists only the files the task changed, not the dirt that was there before it', async () => {
        // Uncommitted edit made by the user before the task started.
        fs.writeFileSync(path.join(repo, 'README.md'), 'user edit before task\n');
        const indexDir = path.join(repo, '.git');
        const preTree = await snapshotWorktreeTree(
            repo,
            async (cwd, args, env) => ({ status: 0, stdout: execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } }) }),
            indexDir,
        );
        expect(preTree).to.match(/^[0-9a-f]{40}$/);
        const baseCommit = execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.hooksPath=/dev/null', '-c', 'user.email=spec@qaap.test', '-c', 'user.name=qaap spec', 'commit-tree', preTree!, '-m', 'pre'], {
            cwd: repo,
            encoding: 'utf8',
        }).trim();

        // The task's own changes.
        fs.writeFileSync(path.join(repo, 'hello.txt'), 'hi\n');
        fs.writeFileSync(path.join(repo, 'a.ts'), 'one\ntwo\n');

        const files = await endpoint.changedSinceBaselineForTest(repo, baseCommit);
        expect(files.map(file => [file.path, file.status]).sort()).to.deep.equal([['a.ts', 'M'], ['hello.txt', 'A']]);
        const hello = files.find(file => file.path === 'hello.txt');
        expect(hello?.adds).to.equal(1);
        expect(files.every(file => file.staged === false)).to.equal(true);
        expect(git(['status', '--porcelain'])).to.contain('README.md');
    });

    /** Pre-task dirt in README, a pre-task untracked file, then the baseline snapshot. */
    async function snapshotBaseline(): Promise<string> {
        fs.writeFileSync(path.join(repo, 'README.md'), 'user edit before task\n');
        fs.writeFileSync(path.join(repo, 'notes.txt'), 'untracked before task\n');
        const preTree = await snapshotWorktreeTree(
            repo,
            async (cwd, args, env) => ({ status: 0, stdout: execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } }) }),
            path.join(repo, '.git'),
        );
        return execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.hooksPath=/dev/null', '-c', 'user.email=spec@qaap.test', '-c', 'user.name=qaap spec', 'commit-tree', preTree!, '-m', 'pre'], {
            cwd: repo,
            encoding: 'utf8',
        }).trim();
    }

    it('discard with a baseline restores the pre-task content, not HEAD, and removes only task-created files', async () => {
        const baseCommit = await snapshotBaseline();
        fs.writeFileSync(path.join(repo, 'README.md'), 'task edit on top of user dirt\n');
        fs.writeFileSync(path.join(repo, 'hello.txt'), 'created by the task\n');
        await endpoint.discardFileForTest(repo, 'README.md', baseCommit);
        expect(fs.readFileSync(path.join(repo, 'README.md'), 'utf8')).to.equal('user edit before task\n');
        await endpoint.discardFileForTest(repo, 'hello.txt', baseCommit);
        expect(fs.existsSync(path.join(repo, 'hello.txt'))).to.equal(false);
        // Pre-task untracked file is untouched by discarding other files.
        expect(fs.readFileSync(path.join(repo, 'notes.txt'), 'utf8')).to.equal('untracked before task\n');
    });

    it('commit with a baseline stages and commits only the task changes, not pre-task dirt', async () => {
        const baseCommit = await snapshotBaseline();
        fs.writeFileSync(path.join(repo, 'a.ts'), 'one\ntwo\n');
        fs.writeFileSync(path.join(repo, 'hello.txt'), 'created by the task\n');
        endpoint.repoRootForTest = repo;
        const res = { statusCode: 200, body: undefined as unknown, status(code: number) { this.statusCode = code; return this; }, json(payload: unknown) { this.body = payload; return this; } };
        await endpoint.commitForTest({ body: { action: 'commit', message: 'task work', baseCommit } }, res);
        expect(res.statusCode, JSON.stringify(res.body)).to.equal(200);
        const committed = git(['show', '--name-only', '--format=', 'HEAD']).split('\n').filter(Boolean).sort();
        expect(committed).to.deep.equal(['a.ts', 'hello.txt']);
        // The pre-task edit is still uncommitted in the worktree.
        expect(git(['status', '--porcelain'])).to.contain('README.md');
    });

    it('discard fails without deleting anything when the baseline cannot be read', async () => {
        await snapshotBaseline();
        fs.writeFileSync(path.join(repo, 'hello.txt'), 'created by the task\n');
        const missing = '1'.repeat(40);
        expect(await rejectsWith(endpoint.discardFileForTest(repo, 'hello.txt', missing))).to.equal(true);
        expect(fs.readFileSync(path.join(repo, 'hello.txt'), 'utf8')).to.equal('created by the task\n');
    });

    it('discard takes the file state from the task diff, so a change the agent already committed is still discarded', async () => {
        const baseCommit = await snapshotBaseline();
        fs.writeFileSync(path.join(repo, 'hello.txt'), 'created by the task\n');
        git(['add', '--', 'hello.txt']);
        git(['commit', '-qm', 'agent commit']);
        await endpoint.discardFileForTest(repo, 'hello.txt', baseCommit);
        expect(fs.existsSync(path.join(repo, 'hello.txt'))).to.equal(false);
    });

    it('discard refuses a file the task did not change, instead of answering ok silently', async () => {
        const baseCommit = await snapshotBaseline();
        expect(await rejectsWith(endpoint.discardFileForTest(repo, 'notes.txt', baseCommit))).to.equal(true);
        expect(fs.readFileSync(path.join(repo, 'notes.txt'), 'utf8')).to.equal('untracked before task\n');
    });

    it('commit with a baseline succeeds when the task deleted a file that was never tracked', async () => {
        const baseCommit = await snapshotBaseline();
        fs.writeFileSync(path.join(repo, 'a.ts'), 'one\ntwo\n');
        fs.rmSync(path.join(repo, 'notes.txt'));
        endpoint.repoRootForTest = repo;
        const res = fakeRes();
        await endpoint.commitForTest({ body: { action: 'commit', message: 'task work', baseCommit } }, res);
        expect(res.statusCode, JSON.stringify(res.body)).to.equal(200);
        expect(git(['show', '--name-only', '--format=', 'HEAD']).split('\n').filter(Boolean)).to.deep.equal(['a.ts']);
    });

    it('commit with a baseline keeps what the user had already staged out of the task commit', async () => {
        fs.writeFileSync(path.join(repo, 'staged.txt'), 'staged before the task\n');
        git(['add', '--', 'staged.txt']);
        const baseCommit = await snapshotBaseline();
        fs.writeFileSync(path.join(repo, 'a.ts'), 'one\ntwo\n');
        endpoint.repoRootForTest = repo;
        const res = fakeRes();
        await endpoint.commitForTest({ body: { action: 'commit', message: 'task work', baseCommit } }, res);
        expect(res.statusCode, JSON.stringify(res.body)).to.equal(200);
        expect(git(['show', '--name-only', '--format=', 'HEAD']).split('\n').filter(Boolean)).to.deep.equal(['a.ts']);
        expect(git(['diff', '--cached', '--name-only'])).to.equal('staged.txt');
    });

    it('commit with a baseline refuses (409) a file whose pre-task dirt the task also changed, and makes no commit', async () => {
        const baseCommit = await snapshotBaseline();
        fs.writeFileSync(path.join(repo, 'README.md'), 'task edit on top of user dirt\n');
        const head = git(['rev-parse', 'HEAD']);
        endpoint.repoRootForTest = repo;
        const res = fakeRes();
        await endpoint.commitForTest({ body: { action: 'commit', message: 'task work', baseCommit } }, res);
        expect(res.statusCode).to.equal(409);
        expect(git(['rev-parse', 'HEAD'])).to.equal(head);
    });

    it('the per-file diff compares the baseline with the worktree: a file untracked before the task shows its task edit, not a deletion', async () => {
        const baseCommit = await snapshotBaseline();
        // notes.txt was untracked before the task; `git diff <commit> -- file` would read it as deleted.
        fs.writeFileSync(path.join(repo, 'notes.txt'), 'changed by the task\n');
        const patch = await endpoint.diffSinceBaselineForTest(repo, 'notes.txt', baseCommit);
        expect(patch).to.contain('+changed by the task');
        expect(patch).to.not.contain('deleted file');
        // The baseline line is the removed side: the patch is against the baseline, not against HEAD.
        expect(patch).to.contain('-untracked before task');
    });

    it('the per-file diff shows a task-created file as added', async () => {
        const baseCommit = await snapshotBaseline();
        fs.writeFileSync(path.join(repo, 'hello.txt'), 'hi\n');
        const patch = await endpoint.diffSinceBaselineForTest(repo, 'hello.txt', baseCommit);
        expect(patch).to.contain('+hi');
        expect(patch).to.not.contain('deleted file');
    });

    it('concurrent reads share one worktree snapshot, and a fresh read takes another', async () => {
        const baseCommit = await snapshotBaseline();
        const probe = new BaselineGitReviewEndpoint();
        const before = probe.snapshotCount;
        await Promise.all([
            probe.changedForTest(repo, baseCommit, true),
            probe.changedForTest(repo, baseCommit, true),
            probe.changedForTest(repo, baseCommit, true),
        ]);
        expect(probe.snapshotCount - before).to.equal(1);
        await probe.changedForTest(repo, baseCommit, false);
        expect(probe.snapshotCount - before).to.equal(2);
    });

    it('answers 400 for a baseCommit that is not a full commit id or does not exist', async () => {
        endpoint.repoRootForTest = repo;
        for (const baseCommit of ['zz', 'HEAD', '0'.repeat(40)]) {
            const res = fakeRes();
            await endpoint.handleChangesForTest({ query: { root: repo, baseCommit } }, res);
            expect(res.statusCode, baseCommit).to.equal(400);
        }
    });
});
