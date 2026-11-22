// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { SpawnSyncReturns } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapGitExecConfigChecker } from './qaap-git-exec-config-checker';
import type { QaapGitReadSync } from './qaap-agent-task-runner-utils2';

function gitResult(status: number | null, stdout = ''): SpawnSyncReturns<string> {
    return { pid: 1, output: [], stdout, stderr: '', status, signal: null } as SpawnSyncReturns<string>;
}

/** `git config -z --show-origin [--show-scope]` records: `[scope NUL] origin NUL key NL value NUL`. */
function records(entries: ReadonlyArray<readonly [string, string, string] | readonly [string, string, string, string]>, withScope = false): string {
    return entries.map(entry => {
        const [first, second, third, fourth] = entry as readonly string[];
        return withScope ? `${first}\0${second}\0${third}\n${fourth ?? ''}\0` : `${first}\0${second}\n${third ?? ''}\0`;
    }).join('');
}

describe('QaapGitExecConfigChecker', () => {
    let root: string;
    let repo: string;
    let home: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-git-exec-'));
        repo = path.join(root, 'repo');
        home = path.join(root, 'home');
        fs.mkdirSync(path.join(repo, '.git', 'info'), { recursive: true });
        fs.writeFileSync(path.join(repo, '.git', 'config'), '[core]\n');
        fs.mkdirSync(home, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    const checkerWith = (read: QaapGitReadSync): QaapGitExecConfigChecker => new QaapGitExecConfigChecker(read, home);

    it('is safe when no exec-capable key is configured (git exits 1)', () => {
        expect(checkerWith(() => gitResult(1)).check(repo)).to.equal(undefined);
    });

    it('flags diff.external, textconv drivers and filters', () => {
        expect(checkerWith(() => gitResult(0, records([['file:.git/config', 'diff.external', '/tmp/x.sh']]))).check(repo)).to.contain('diff.external');
        expect(checkerWith(() => gitResult(0, records([['file:.git/config', 'diff.bin.textconv', 'hexdump']]))).check(repo)).to.contain('textconv');
        expect(checkerWith(() => gitResult(0, records([['file:.git/config', 'filter.lfs.process', 'git-lfs filter-process']]))).check(repo)).to.contain('filter.lfs.process');
    });

    describe('userScopesNeutralized', () => {
        const neutral = { userScopesNeutralized: true };
        const scoped = (...lines: Array<readonly [string, string, string, string]>): QaapGitReadSync => (_cwd, args) => {
            expect(args).to.include('--show-scope');
            expect(args).to.include('-z');
            expect(args.slice(0, 2)).to.deep.equal(['-c', 'safe.directory=*']);
            return gitResult(0, records(lines, true));
        };

        it('ignores global and system entries (the standard git-lfs filter) but not local or worktree ones', () => {
            const lfs = [
                ['global', 'file:/home/u/.gitconfig', 'filter.lfs.clean', 'git-lfs clean -- %f'],
                ['global', 'file:/home/u/.gitconfig', 'filter.lfs.process', 'git-lfs filter-process'],
                ['system', 'file:/etc/gitconfig', 'filter.lfs.smudge', 'git-lfs smudge -- %f'],
            ] as const;
            expect(checkerWith(scoped(...lfs)).check(repo, neutral)).to.equal(undefined);
            expect(checkerWith(scoped(...lfs, ['local', 'file:.git/config', 'filter.x.clean', 'sh -c evil'])).check(repo, neutral)).to.contain('filter.x.clean');
            expect(checkerWith(scoped(...lfs, ['worktree', 'file:.git/config.worktree', 'filter.x.clean', 'evil'])).check(repo, neutral)).to.contain('filter.x.clean');
            expect(checkerWith(scoped(...lfs, ['worktree', 'file:.git/config.worktree', 'merge.x.driver', 'evil'])).check(repo, neutral)).to.contain('merge.x.driver');
        });

        it('rejects an enabled extensions.worktreeConfig (its config.worktree is another model-writable scope)', () => {
            expect(checkerWith(scoped(['local', 'file:.git/config', 'extensions.worktreeconfig', 'true'])).check(repo, neutral)).to.contain('worktreeConfig');
            expect(checkerWith(scoped(['local', 'file:.git/config', 'extensions.worktreeconfig', 'false'])).check(repo, neutral)).to.equal(undefined);
        });

        it('cannot be fooled by a newline inside a value: -z records keep one entry per key', () => {
            const read = scoped(['local', 'file:.git/config', 'core.pager', 'cat\nfilter.x.clean evil']);
            expect(checkerWith(read).check(repo, neutral)).to.contain('core.pager');
        });

        it('never serves a cached answer, so a forged mtime cannot reuse an earlier verdict', () => {
            let calls = 0;
            const checker = checkerWith(() => {
                calls++;
                return gitResult(1);
            });
            checker.check(repo, neutral);
            checker.check(repo, neutral);
            expect(calls).to.equal(2);
        });

        it('still flags the same global entries when the caller does not neutralize user config', () => {
            const read: QaapGitReadSync = () => gitResult(0, records([['file:/home/u/.gitconfig', 'filter.lfs.clean', 'git-lfs clean -- %f']]));
            expect(checkerWith(read).check(repo)).to.contain('filter.lfs.clean');
        });

        it('does not flag diff=/filter= attributes, which are inert without a definition', () => {
            fs.writeFileSync(path.join(repo, '.gitattributes'), '*.bin filter=lfs diff=hex\n');
            expect(checkerWith(() => gitResult(1)).check(repo, neutral)).to.equal(undefined);
            expect(checkerWith(() => gitResult(1)).check(repo)).to.contain('.gitattributes');
        });

        it('keeps the two modes in separate cache entries', () => {
            const checker = checkerWith(() => gitResult(1));
            fs.writeFileSync(path.join(repo, '.gitattributes'), '*.bin filter=x\n');
            expect(checker.check(repo, neutral)).to.equal(undefined);
            expect(checker.check(repo)).to.contain('.gitattributes');
            expect(checker.check(repo, neutral)).to.equal(undefined);
        });
    });

    it('tolerates harmless values of fsmonitor and pager keys', () => {
        expect(checkerWith(() => gitResult(0, records([['file:.git/config', 'core.fsmonitor', 'false'], ['file:.git/config', 'core.pager', 'cat']]))).check(repo)).to.equal(undefined);
        expect(checkerWith(() => gitResult(0, records([['file:.git/config', 'core.fsmonitor', '/tmp/hook.sh']]))).check(repo)).to.contain('core.fsmonitor');
        expect(checkerWith(() => gitResult(0, records([['file:.git/config', 'core.pager', 'less -R']]))).check(repo)).to.contain('core.pager');
    });

    it('fails closed when git errors or cannot be spawned', () => {
        expect(checkerWith(() => gitResult(128)).check(repo)).to.contain('failed');
        expect(checkerWith(() => {
            throw new Error('ENOENT');
        }).check(repo)).to.contain('ENOENT');
    });

    it('flags diff=/filter= attributes in .gitattributes and .git/info/attributes', () => {
        fs.writeFileSync(path.join(repo, '.gitattributes'), '*.bin diff=hex\n');
        expect(checkerWith(() => gitResult(1)).check(repo)).to.contain('.gitattributes');
        fs.writeFileSync(path.join(repo, '.gitattributes'), '*.png binary\n');
        fs.writeFileSync(path.join(repo, '.git', 'info', 'attributes'), '*.dat filter=crypt\n');
        expect(checkerWith(() => gitResult(1)).check(repo)).to.contain('attributes');
    });

    it('finds the repository from a subdirectory', () => {
        const sub = path.join(repo, 'src', 'lib');
        fs.mkdirSync(sub, { recursive: true });
        fs.writeFileSync(path.join(repo, '.gitattributes'), '*.x diff=custom\n');
        expect(checkerWith(() => gitResult(1)).check(sub)).to.contain('.gitattributes');
    });

    it('caches per cwd until the git config mtime changes', () => {
        let calls = 0;
        const checker = checkerWith(() => {
            calls++;
            return gitResult(1);
        });
        checker.check(repo);
        checker.check(repo);
        expect(calls).to.equal(1);
        const configPath = path.join(repo, '.git', 'config');
        const later = new Date(Date.now() + 60_000);
        fs.utimesSync(configPath, later, later);
        checker.check(repo);
        expect(calls).to.equal(2);
    });

    it('does not verify repositories with submodules (their config is separate)', () => {
        fs.writeFileSync(path.join(repo, '.gitmodules'), '[submodule "x"]\n\tpath = x\n');
        expect(checkerWith(() => gitResult(1)).check(repo)).to.contain('submodule');
    });

    it('re-checks when an included config file changes', () => {
        const included = path.join(root, 'shared.gitconfig');
        fs.writeFileSync(included, '[core]\n');
        let calls = 0;
        const checker = checkerWith(() => {
            calls++;
            return gitResult(0, records([[`file:${path.join(repo, '.git', 'config')}`, 'include.path', included]]));
        });
        expect(checker.check(repo)).to.equal(undefined);
        checker.check(repo);
        expect(calls).to.equal(1);
        const later = new Date(Date.now() + 60_000);
        fs.utimesSync(included, later, later);
        checker.check(repo);
        expect(calls).to.equal(2);
    });
});
