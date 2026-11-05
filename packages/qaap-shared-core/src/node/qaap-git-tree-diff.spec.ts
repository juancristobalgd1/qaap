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
    assertTemporaryIndexFile,
    computeTreeDiff,
    parseNameStatusZ,
    parseNumstatZ,
    resolveTemporaryIndexDir,
    snapshotWorktreeTree,
    type QaapTreeGitResult,
} from './qaap-git-tree-diff';

function git(cwd: string, args: readonly string[]): QaapTreeGitResult {
    const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.autocrlf=false', ...args], {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' },
    });
    return { status: result.status, stdout: result.stdout ?? '' };
}

async function gitRead(cwd: string, args: readonly string[]): Promise<QaapTreeGitResult> {
    return git(cwd, args);
}

async function gitWrite(cwd: string, args: string[], env: NodeJS.ProcessEnv): Promise<QaapTreeGitResult> {
    const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.autocrlf=false', ...args], {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, ...env, GIT_CONFIG_NOSYSTEM: '1' },
    });
    return { status: result.status, stdout: result.stdout ?? '' };
}

describe('qaap-git-tree-diff index guard', () => {
    it('accepts a throwaway index file', () => {
        expect(assertTemporaryIndexFile(path.join('/tmp', 'repo', '.git', 'qaap-ckpt-1.index'), '/tmp/repo')).to.be.a('string');
    });

    it('refuses an unset index, the repository index and any file named index', () => {
        expect(() => assertTemporaryIndexFile(undefined, '/tmp/repo')).to.throw(/without a temporary/);
        expect(() => assertTemporaryIndexFile(path.join('/tmp', 'repo', '.git', 'index'), '/tmp/repo')).to.throw(/repository index/);
        expect(() => assertTemporaryIndexFile(path.join('/elsewhere', 'index'), '/tmp/repo')).to.throw(/repository index/);
    });
});

describe('qaap-git-tree-diff parsers', () => {
    it('parses numstat -z plain entries and rename entries keyed by the new path', () => {
        const counts = parseNumstatZ('3\t1\tsrc/a.ts\0-\t-\tbin.png\0' + '2\t0\t\0old name.ts\0new.ts\0');
        expect(counts.get('src/a.ts')).to.deep.equal({ added: 3, removed: 1 });
        expect(counts.get('bin.png')).to.deep.equal({ added: 0, removed: 0 });
        expect(counts.get('new.ts')).to.deep.equal({ added: 2, removed: 0 });
    });

    it('parses name-status -z including paths with spaces and renames', () => {
        const entries = parseNameStatusZ('M\0src/a.ts\0A\0hello world.txt\0R100\0old.ts\0new.ts\0');
        expect(entries).to.deep.equal([
            { path: 'src/a.ts', status: 'M' },
            { path: 'hello world.txt', status: 'A' },
            { path: 'new.ts', oldPath: 'old.ts', status: 'R' },
        ]);
    });
});

describe('qaap-git-tree-diff against a real repository', () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-tree-diff-'));
        git(root, ['init', '-q']);
        fs.writeFileSync(path.join(root, 'README.md'), 'base\n');
        fs.writeFileSync(path.join(root, 'a.ts'), 'one\n');
        git(root, ['add', '-A']);
        git(root, ['-c', 'user.email=qaap@test', '-c', 'user.name=qaap', 'commit', '-q', '-m', 'init']);
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('counts only what the turn changed, excluding dirt that existed before the turn', async () => {
        fs.writeFileSync(path.join(root, 'README.md'), 'dirty before turn\n');
        const indexDir = path.join(root, '.git');
        const preTree = await snapshotWorktreeTree(root, gitWrite, indexDir);
        expect(preTree).to.match(/^[0-9a-f]{40}$/);
        const baseCommit = git(root, ['-c', 'user.email=qaap@test', '-c', 'user.name=qaap', 'commit-tree', preTree!, '-m', 'pre']).stdout.trim();

        fs.writeFileSync(path.join(root, 'hello.txt'), 'hi\n');
        fs.writeFileSync(path.join(root, 'a.ts'), 'one\ntwo\n');
        const currentTree = await snapshotWorktreeTree(root, gitWrite, indexDir);
        expect(currentTree).to.match(/^[0-9a-f]{40}$/);

        const diff = await computeTreeDiff(root, baseCommit, currentTree!, gitRead);
        expect(diff).to.not.equal(undefined);
        expect(diff!.files.map(file => [file.path, file.status]).sort()).to.deep.equal([['a.ts', 'M'], ['hello.txt', 'A']]);
        expect(diff!.added).to.equal(2);
        expect(diff!.removed).to.equal(0);
        expect(fs.readdirSync(indexDir).filter(name => name.startsWith('qaap-ckpt-'))).to.deep.equal([]);
    });

    it('returns an empty file list when the worktree matches the baseline', async () => {
        const tree = await snapshotWorktreeTree(root, gitWrite, path.join(root, '.git'));
        const baseCommit = git(root, ['-c', 'user.email=qaap@test', '-c', 'user.name=qaap', 'commit-tree', tree!, '-m', 'same']).stdout.trim();
        const diff = await computeTreeDiff(root, baseCommit, tree!, gitRead);
        expect(diff).to.deep.equal({ added: 0, removed: 0, files: [] });
    });

    it('resolves the index directory to the git directory, and to undefined outside a repository', async () => {
        expect(await resolveTemporaryIndexDir(root, gitRead)).to.equal(path.join(root, '.git'));
        expect(await resolveTemporaryIndexDir(os.tmpdir(), gitRead)).to.equal(undefined);
    });

    it('a seeded index copy that git rejects is replaced by HEAD and the snapshot still succeeds', async () => {
        const indexDir = path.join(root, '.git');
        const corrupt = path.join(root, 'corrupt.index');
        fs.writeFileSync(corrupt, 'not an index');
        const tree = await snapshotWorktreeTree(root, gitWrite, indexDir, corrupt);
        expect(tree).to.match(/^[0-9a-f]{40}$/);
        expect(git(root, ['rev-parse', 'HEAD^{tree}']).stdout.trim()).to.not.equal(tree);
        expect(fs.readdirSync(indexDir).filter(name => name.startsWith('qaap-ckpt-'))).to.deep.equal([]);
    });

    it('a seeded copy of the real index is read only: the real index file is unchanged', async () => {
        fs.writeFileSync(path.join(root, 'hello.txt'), 'hi\n');
        const indexFile = path.join(root, '.git', 'index');
        const before = fs.readFileSync(indexFile);
        const tree = await snapshotWorktreeTree(root, gitWrite, path.join(root, '.git'), indexFile);
        expect(tree).to.match(/^[0-9a-f]{40}$/);
        expect(fs.readFileSync(indexFile).equals(before)).to.equal(true);
    });

    it('returns undefined when the baseline commit does not exist', async () => {
        const tree = await snapshotWorktreeTree(root, gitWrite, path.join(root, '.git'));
        expect(await computeTreeDiff(root, '0'.repeat(40), tree!, gitRead)).to.equal(undefined);
    });
});
