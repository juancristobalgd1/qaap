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

    handleChangesForTest(req: unknown, res: unknown): Promise<void> {
        return (this as unknown as { handleChanges(req: unknown, res: unknown): Promise<void> }).handleChanges(req, res);
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

    it('answers 400 for a baseCommit that is not a full commit id or does not exist', async () => {
        endpoint.repoRootForTest = repo;
        for (const baseCommit of ['zz', 'HEAD', '0'.repeat(40)]) {
            const res = fakeRes();
            await endpoint.handleChangesForTest({ query: { root: repo, baseCommit } }, res);
            expect(res.statusCode, baseCommit).to.equal(400);
        }
    });
});
