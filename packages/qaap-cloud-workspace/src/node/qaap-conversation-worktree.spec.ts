// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveQaapWorktreesRoot } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { QaapConversationWorktreeApplyResult, QaapConversationWorktreeService } from './qaap-conversation-worktree';

describe('QaapConversationWorktreeService.apply', function (): void {
    this.timeout(20_000);

    let scratch: string;
    let baseRepo: string;
    let worktreePath: string;
    let branch: string;

    const git = (cwd: string, ...args: string[]): string =>
        execFileSync('git', ['-C', cwd, ...args], {
            encoding: 'utf8',
            env: {
                ...process.env,
                GIT_AUTHOR_NAME: 'apply-spec', GIT_AUTHOR_EMAIL: 'apply@spec',
                GIT_COMMITTER_NAME: 'apply-spec', GIT_COMMITTER_EMAIL: 'apply@spec',
            },
        });

    const buildService = (): QaapConversationWorktreeService => {
        const service = Object.create(QaapConversationWorktreeService.prototype) as QaapConversationWorktreeService;
        Object.assign(service, {
            tenantSpawn: {
                wrapGitForTenant: (cwd: string, args: readonly string[]) => ({
                    file: 'git',
                    args: ['-c', 'core.hooksPath=/dev/null', '-C', cwd, ...args],
                }),
                prepareTenantIsolation: () => undefined,
                provisionTenantDir: () => undefined,
            },
        });
        return service;
    };

    beforeEach(() => {
        scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-wt-apply-'));
        baseRepo = path.join(scratch, 'base');
        fs.mkdirSync(baseRepo, { recursive: true });
        git(baseRepo, 'init', '-q', '-b', 'main');
        git(baseRepo, 'config', 'core.autocrlf', 'false');
        fs.writeFileSync(path.join(baseRepo, 'README.md'), 'hi\n');
        git(baseRepo, 'add', '.');
        git(baseRepo, 'commit', '-qm', 'init');
        branch = 'qaap/worktree/abcd1234';
        worktreePath = path.join(scratch, 'worktrees', 'abcd1234');
        fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
        git(baseRepo, 'worktree', 'add', '-b', branch, worktreePath, 'HEAD');
        fs.writeFileSync(path.join(worktreePath, 'fork.txt'), 'from fork\n');
    });

    afterEach(() => {
        fs.rmSync(scratch, { recursive: true, force: true });
    });

    it('keep-branch commits dirty files, drops the worktree, and keeps the branch', async () => {
        const result = await buildService().apply({
            worktreePath,
            branch,
            baseCwd: baseRepo,
            action: 'keep-branch',
        });
        expect(result).to.deep.equal({ ok: true, branch });
        expect(fs.existsSync(worktreePath)).to.equal(false);
        expect(git(baseRepo, 'branch', '--list', branch)).to.contain('abcd1234');
        expect(git(baseRepo, 'log', '-1', '--pretty=%s', branch)).to.contain('qaap: parallel fork');
        expect(git(baseRepo, 'show', `${branch}:fork.txt`).replaceAll('\r\n', '\n')).to.equal('from fork\n');
        expect(fs.existsSync(path.join(baseRepo, 'fork.txt'))).to.equal(false);
    });

    const read = (file: string): string => fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
    const head = (): string => git(baseRepo, 'rev-parse', 'HEAD').trim();
    const worktreeCount = (): number => git(baseRepo, 'worktree', 'list', '--porcelain').split('\n').filter(line => line.startsWith('worktree ')).length;
    const merge = (service = buildService()): Promise<QaapConversationWorktreeApplyResult> => service.apply({ worktreePath, branch, baseCwd: baseRepo, action: 'merge' });

    /** Refusals change nothing: base HEAD, the thread worktree and its branch stay, no integration worktree is left. */
    const expectUntouched = (baseHead: string): void => {
        expect(head()).to.equal(baseHead);
        expect(git(baseRepo, 'symbolic-ref', '--short', '-q', 'HEAD').trim()).to.equal('main');
        expect(fs.existsSync(path.join(baseRepo, 'fork.txt'))).to.equal(false);
        expect(fs.existsSync(worktreePath)).to.equal(true);
        expect(git(baseRepo, 'branch', '--list', branch)).to.contain('abcd1234');
        expect(worktreeCount()).to.equal(2);
    };

    it('merge lands the fork on the checked-out branch through an integration worktree and deletes the worktree branch', async () => {
        const result = await merge();
        expect(result).to.deep.equal({ ok: true, branch });
        expect(fs.existsSync(worktreePath)).to.equal(false);
        expect(git(baseRepo, 'branch', '--list', branch).trim()).to.equal('');
        expect(read(path.join(baseRepo, 'fork.txt'))).to.equal('from fork\n');
        expect(git(baseRepo, 'symbolic-ref', '--short', 'HEAD').trim()).to.equal('main');
        expect(git(baseRepo, 'rev-list', '--parents', '-n', '1', 'HEAD').trim().split(' ')).to.have.length(3);
        expect(git(baseRepo, 'status', '--porcelain').trim()).to.equal('');
        expect(worktreeCount()).to.equal(1);
    });

    it('a conflicting merge reports the conflicted files and changes nothing', async () => {
        fs.writeFileSync(path.join(baseRepo, 'README.md'), 'base\n');
        git(baseRepo, 'commit', '-qam', 'base edit');
        fs.writeFileSync(path.join(worktreePath, 'README.md'), 'fork\n');
        const baseHead = head();
        const result = await merge();
        expect(result.ok).to.equal(false);
        expect(result.reason).to.equal('conflict');
        expect(result.conflicts).to.deep.equal(['README.md']);
        expectUntouched(baseHead);
        expect(read(path.join(baseRepo, 'README.md'))).to.equal('base\n');
        expect(git(baseRepo, 'status', '--porcelain').trim()).to.equal('');
    });

    it('refuses when the target branch moves before the fast-forward lands', async () => {
        const service = buildService();
        let movedHead = '';
        const mutatingGit = (QaapConversationWorktreeService.prototype as unknown as {
            mutatingGit(cwd: string, args: string[]): Promise<string>;
        }).mutatingGit;
        Object.assign(service, {
            mutatingGit: async (cwd: string, args: string[]): Promise<string> => {
                if (args[0] === 'merge' && args[1] === '--ff-only') {
                    fs.writeFileSync(path.join(baseRepo, 'late.txt'), 'late\n');
                    git(baseRepo, 'add', 'late.txt');
                    git(baseRepo, 'commit', '-qm', 'late commit');
                    movedHead = head();
                }
                return mutatingGit.call(service, cwd, args);
            },
        });
        const result = await merge(service);
        expect(result.ok).to.equal(false);
        expect(result.reason).to.equal('target-moved');
        expectUntouched(movedHead);
    });

    it('refuses when uncommitted changes in the base tree would be overwritten, keeping them', async () => {
        fs.writeFileSync(path.join(worktreePath, 'README.md'), 'fork\n');
        fs.writeFileSync(path.join(baseRepo, 'README.md'), 'local edit\n');
        const baseHead = head();
        const result = await merge();
        expect(result.ok).to.equal(false);
        expect(result.reason).to.equal('local-changes');
        expectUntouched(baseHead);
        expect(read(path.join(baseRepo, 'README.md'))).to.equal('local edit\n');
    });

    it('lands while preserving uncommitted changes to files the merge does not touch', async () => {
        fs.writeFileSync(path.join(baseRepo, 'README.md'), 'local edit\n');
        fs.writeFileSync(path.join(baseRepo, 'scratch.txt'), 'untracked\n');
        const result = await merge();
        expect(result).to.deep.equal({ ok: true, branch });
        expect(read(path.join(baseRepo, 'fork.txt'))).to.equal('from fork\n');
        expect(read(path.join(baseRepo, 'README.md'))).to.equal('local edit\n');
        expect(read(path.join(baseRepo, 'scratch.txt'))).to.equal('untracked\n');
    });

    it('refuses on a detached HEAD without changing anything', async () => {
        git(baseRepo, 'checkout', '-q', '--detach');
        const baseHead = head();
        const result = await merge();
        expect(result.ok).to.equal(false);
        expect(result.reason).to.equal('detached');
        expect(head()).to.equal(baseHead);
        expect(fs.existsSync(path.join(baseRepo, 'fork.txt'))).to.equal(false);
        expect(git(baseRepo, 'branch', '--list', branch)).to.contain('abcd1234');
        expect(worktreeCount()).to.equal(2);
    });

    it('none discards the worktree and branch without touching the base tree', async () => {
        const result = await buildService().apply({
            worktreePath,
            branch,
            baseCwd: baseRepo,
            action: 'none',
        });
        expect(result).to.deep.equal({ ok: true, branch });
        expect(fs.existsSync(worktreePath)).to.equal(false);
        expect(git(baseRepo, 'branch', '--list', branch).trim()).to.equal('');
        expect(fs.existsSync(path.join(baseRepo, 'fork.txt'))).to.equal(false);
    });
});

describe('QaapConversationWorktreeService.removeForDeletedConversation', function (): void {
    this.timeout(20_000);

    let scratch: string;
    let baseRepo: string;
    let root: string;
    const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });

    const buildService = (): QaapConversationWorktreeService => {
        const service = Object.create(QaapConversationWorktreeService.prototype) as QaapConversationWorktreeService;
        Object.assign(service, {
            tenantSpawn: {
                wrapGitForTenant: (cwd: string, args: readonly string[]) => ({ file: 'git', args: ['-c', 'core.hooksPath=/dev/null', '-C', cwd, ...args] }),
                prepareTenantIsolation: () => undefined,
            },
        });
        return service;
    };

    beforeEach(() => {
        scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-wt-remove-'));
        root = path.join(resolveQaapWorktreesRoot(), `spec-${path.basename(scratch)}`);
        baseRepo = path.join(scratch, 'base');
        fs.mkdirSync(baseRepo, { recursive: true });
        git(baseRepo, 'init', '-q', '-b', 'main');
        git(baseRepo, 'config', 'user.email', 'a@b');
        git(baseRepo, 'config', 'user.name', 'a');
        fs.writeFileSync(path.join(baseRepo, 'README.md'), 'hi\n');
        git(baseRepo, 'add', '.');
        git(baseRepo, 'commit', '-qm', 'init');
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(scratch, { recursive: true, force: true });
    });

    it('removes the worktree and its branch', async () => {
        const worktreePath = path.join(root, 'abcd1234');
        fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
        git(baseRepo, 'worktree', 'add', '-b', 'qaap/worktree/abcd1234', worktreePath, 'HEAD');
        const removed = await buildService().removeForDeletedConversation({ worktreePath, branch: 'qaap/worktree/abcd1234', baseCwd: baseRepo });
        expect(removed).to.equal(true);
        expect(fs.existsSync(worktreePath)).to.equal(false);
        expect(git(baseRepo, 'branch', '--list', 'qaap/worktree/abcd1234').trim()).to.equal('');
    });

    it('refuses paths outside the worktrees root, the base checkout, and non-qaap branches', async () => {
        const service = buildService();
        const outside = path.join(scratch, 'outside');
        fs.mkdirSync(outside);
        const attempt = (worktreePath: string, branch = 'qaap/worktree/x'): Promise<boolean> =>
            service.removeForDeletedConversation({ worktreePath, branch, baseCwd: baseRepo });
        expect(await attempt(outside)).to.equal(false);
        expect(await attempt(baseRepo)).to.equal(false);
        expect(await attempt(root)).to.equal(false);
        expect(await attempt(path.dirname(root))).to.equal(false);
        expect(await attempt(path.join(root, '..', '..', 'outside'))).to.equal(false);
        const inside = path.join(root, 'abcd1234');
        fs.mkdirSync(inside, { recursive: true });
        expect(await attempt(inside, 'main')).to.equal(false);
        expect(fs.existsSync(outside)).to.equal(true);
        expect(fs.existsSync(baseRepo)).to.equal(true);
        expect(fs.existsSync(inside)).to.equal(true);
    });
});
