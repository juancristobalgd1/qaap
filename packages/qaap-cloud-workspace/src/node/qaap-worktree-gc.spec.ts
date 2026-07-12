// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapWorktreeGcContribution } from './qaap-worktree-gc';

const OLD_DATE = '2020-01-01T00:00:00Z';
const OLD_EPOCH_MS = Date.parse('2020-01-02T00:00:00Z');

describe('QaapWorktreeGcContribution.sweep', function (): void {
    // Real git repos on disk — slower than a pure unit test but exercises the actual
    // worktree-remove + prune behavior the GC exists for.
    this.timeout(20_000);

    let scratch: string;
    let baseRepo: string;
    let worktreesRoot: string;

    const git = (cwd: string, ...args: string[]): string =>
        execFileSync('git', ['-C', cwd, ...args], {
            encoding: 'utf8',
            env: {
                ...process.env,
                GIT_AUTHOR_NAME: 'gc-spec', GIT_AUTHOR_EMAIL: 'gc@spec',
                GIT_COMMITTER_NAME: 'gc-spec', GIT_COMMITTER_EMAIL: 'gc@spec',
                GIT_AUTHOR_DATE: OLD_DATE, GIT_COMMITTER_DATE: OLD_DATE,
            },
        });

    const buildGc = (overrides: Partial<Record<'activeCwds', () => Set<string>>> = {}): QaapWorktreeGcContribution => {
        const gc = Object.create(QaapWorktreeGcContribution.prototype) as QaapWorktreeGcContribution;
        Object.assign(gc, {
            worktreesRoot: () => worktreesRoot,
            activeCwds: overrides.activeCwds ?? (() => new Set<string>()),
        });
        return gc;
    };

    const addWorktree = (slug: string): string => {
        const dir = path.join(worktreesRoot, 'alice', slug);
        fs.mkdirSync(path.dirname(dir), { recursive: true });
        git(baseRepo, 'worktree', 'add', '-b', `qaap/worktree/${slug}`, dir, 'HEAD');
        return dir;
    };

    /** Make the dir LOOK abandoned (mtime in 2020; commits already dated 2020). */
    const age = (dir: string): void => {
        fs.utimesSync(dir, new Date(OLD_EPOCH_MS), new Date(OLD_EPOCH_MS));
    };

    beforeEach(() => {
        scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-wt-gc-'));
        baseRepo = path.join(scratch, 'base');
        worktreesRoot = path.join(scratch, 'worktrees');
        fs.mkdirSync(baseRepo, { recursive: true });
        git(baseRepo, 'init', '-q');
        fs.writeFileSync(path.join(baseRepo, 'README.md'), 'hi');
        git(baseRepo, 'add', '.');
        git(baseRepo, 'commit', '-qm', 'init');
    });

    afterEach(() => {
        fs.rmSync(scratch, { recursive: true, force: true });
    });

    it('collects an abandoned clean worktree and prunes its registration in the base repo', async () => {
        const dir = addWorktree('dead1234');
        age(dir);
        await buildGc().sweep();
        expect(fs.existsSync(dir)).to.equal(false);
        expect(git(baseRepo, 'worktree', 'list')).to.not.contain('dead1234');
        // Committed work survives: the branch is still there.
        expect(git(baseRepo, 'branch', '--list', 'qaap/worktree/dead1234')).to.contain('dead1234');
    });

    it('never touches a DIRTY worktree (unmerged agent/user work)', async () => {
        const dir = addWorktree('dirty567');
        fs.writeFileSync(path.join(dir, 'wip.txt'), 'uncommitted');
        age(dir);
        await buildGc().sweep();
        expect(fs.existsSync(dir)).to.equal(true);
    });

    it('keeps a recent worktree even when clean', async () => {
        const dir = addWorktree('fresh890');
        // dir mtime is NOW (just created) — recency wins even though commits are dated 2020.
        await buildGc().sweep();
        expect(fs.existsSync(dir)).to.equal(true);
    });

    it('never collects under a running/queued task cwd', async () => {
        const dir = addWorktree('live4321');
        age(dir);
        const gc = buildGc({ activeCwds: () => new Set([path.resolve(dir)]) });
        await gc.sweep();
        expect(fs.existsSync(dir)).to.equal(true);
    });
});
