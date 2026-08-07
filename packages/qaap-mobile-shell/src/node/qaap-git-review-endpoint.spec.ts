// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isBinaryGitPatch, parseUnifiedDiff, type QaapGitChangedFile } from '../common/qaap-git-review';
import { QaapGitReviewEndpoint } from './qaap-git-review-endpoint';

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
        fs.symlinkSync(os.tmpdir(), path.join(repo, 'untracked-directory-link'), 'dir');
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

    it('classifies an untracked symlink-to-directory as metadata instead of a missing diff', async () => {
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
