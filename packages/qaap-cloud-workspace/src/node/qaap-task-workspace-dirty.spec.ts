// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { localGitRead } from './qaap-agent-conversation-store-git';
import { QAAP_DIRTY_WORKSPACE_LISTED_FILES, readDirtyWorkspace, resolveTaskIsolationMode } from './qaap-task-workspace-dirty';

describe('qaap-task-workspace-dirty', () => {
    describe('resolveTaskIsolationMode', () => {
        it('defaults to auto when the variable is unset or unknown', () => {
            expect(resolveTaskIsolationMode({})).to.equal('auto');
            expect(resolveTaskIsolationMode({ QAAP_TASK_ISOLATION: 'sometimes' })).to.equal('auto');
        });

        it('reads dirty and worktree case-insensitively', () => {
            expect(resolveTaskIsolationMode({ QAAP_TASK_ISOLATION: ' DIRTY ' })).to.equal('dirty');
            expect(resolveTaskIsolationMode({ QAAP_TASK_ISOLATION: 'worktree' })).to.equal('worktree');
        });
    });

    describe('readDirtyWorkspace', () => {
        let root: string;

        beforeEach(() => {
            root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-dirty-'));
        });

        afterEach(() => {
            fs.rmSync(root, { recursive: true, force: true });
        });

        function git(args: string[]): void {
            spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.autocrlf=false', ...args], { cwd: root, encoding: 'utf8' });
        }

        it('reports undefined for a clean repository', async () => {
            git(['init', '-q']);
            fs.writeFileSync(path.join(root, 'README.md'), 'base\n');
            git(['add', '-A']);
            git(['-c', 'user.email=qaap@test', '-c', 'user.name=qaap', 'commit', '-q', '-m', 'init']);
            expect(await readDirtyWorkspace(root, localGitRead)).to.deep.equal({ kind: 'clean' });
        });

        it('counts tracked and untracked changes and lists their paths', async () => {
            git(['init', '-q']);
            fs.writeFileSync(path.join(root, 'README.md'), 'base\n');
            git(['add', '-A']);
            git(['-c', 'user.email=qaap@test', '-c', 'user.name=qaap', 'commit', '-q', '-m', 'init']);
            fs.writeFileSync(path.join(root, 'README.md'), 'edited\n');
            fs.writeFileSync(path.join(root, 'hello.txt'), 'new\n');
            const dirty = await readDirtyWorkspace(root, localGitRead);
            expect(dirty.kind).to.equal('dirty');
            expect(dirty.kind === 'dirty' && dirty.total).to.equal(2);
            expect(dirty.kind === 'dirty' && [...dirty.files].sort()).to.deep.equal(['README.md', 'hello.txt']);
        });

        it('caps the listed paths but keeps the full total', async () => {
            git(['init', '-q']);
            for (let index = 0; index < QAAP_DIRTY_WORKSPACE_LISTED_FILES + 3; index++) {
                fs.writeFileSync(path.join(root, `file-${index}.txt`), 'x\n');
            }
            const dirty = await readDirtyWorkspace(root, localGitRead);
            expect(dirty.kind === 'dirty' && dirty.total).to.equal(QAAP_DIRTY_WORKSPACE_LISTED_FILES + 3);
            expect(dirty.kind === 'dirty' && dirty.files).to.have.length(QAAP_DIRTY_WORKSPACE_LISTED_FILES);
        });

        it('skips the check for a directory that is not a git repository', async () => {
            fs.writeFileSync(path.join(root, 'notes.txt'), 'x\n');
            expect(await readDirtyWorkspace(root, localGitRead)).to.deep.equal({ kind: 'clean' });
        });

        it('reports unknown, not clean, when git cannot answer', async () => {
            git(['init', '-q']);
            const failing = async (): Promise<{ status: number | null; stdout: string; stderr: string; timedOut?: boolean }> => ({
                status: null, stdout: '', stderr: 'boom', timedOut: true,
            });
            expect(await readDirtyWorkspace(root, failing)).to.deep.equal({ kind: 'unknown', reason: 'git status timed out' });
        });

        it('runs status with the safe git flags through the supplied seam', async () => {
            git(['init', '-q']);
            let seen: readonly string[] = [];
            await readDirtyWorkspace(root, async (_cwd, args) => {
                seen = args;
                return { status: 0, stdout: '', stderr: '' };
            });
            expect(seen).to.include.members(['core.fsmonitor=false', 'core.hooksPath=/dev/null', '--no-optional-locks']);
            expect(seen).to.include('status');
        });
    });
});
