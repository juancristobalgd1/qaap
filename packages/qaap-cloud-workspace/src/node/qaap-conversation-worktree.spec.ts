// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapConversationWorktreeService } from './qaap-conversation-worktree';

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

    it('merge brings the fork into the base branch and deletes the worktree branch', async () => {
        const result = await buildService().apply({
            worktreePath,
            branch,
            baseCwd: baseRepo,
            action: 'merge',
        });
        expect(result).to.deep.equal({ ok: true, branch });
        expect(fs.existsSync(worktreePath)).to.equal(false);
        expect(git(baseRepo, 'branch', '--list', branch).trim()).to.equal('');
        expect(fs.readFileSync(path.join(baseRepo, 'fork.txt'), 'utf8').replaceAll('\r\n', '\n')).to.equal('from fork\n');
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
