// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { QaapConversationCheckpoint } from '../common/qaap-agent-conversation';
import {
    computeRewindPreview,
    planRewindRestore,
    QaapRewindConfirmationRequiredError,
    snapshotRewindWorkingTree,
    type QaapRewindGitRunner,
} from './qaap-agent-conversation-rewind-preview-git';

describe('qaap-agent-conversation-rewind-preview-git', function (): void {
    this.timeout(30000);

    let cwd: string;
    let git: QaapRewindGitRunner;

    function write(file: string, content: string): void {
        fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
        fs.writeFileSync(path.join(cwd, file), content);
    }

    /** Same shape as the store's capture: a commit of the full working tree. */
    function checkpoint(id: string, label: string = id): QaapConversationCheckpoint {
        const tree = snapshotRewindWorkingTree(git);
        const commit = git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit-tree', tree, '-m', id]).stdout.trim();
        return { id, messageId: `m-${id}`, label, commit, ref: `refs/qaap/test/${id}`, capturedAt: Date.now() };
    }

    beforeEach(() => {
        cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-rewind-preview-'));
        git = (args, env) => spawnSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd, env: env ?? process.env, encoding: 'utf8' });
        git(['init', '-q']);
        write('.gitignore', 'secret.env\n');
        write('keep.txt', 'base\n');
        write('agent.txt', 'one\n');
        write('user.txt', 'one\n');
        git(['add', '-A']);
        git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init']);
    });

    afterEach(() => {
        fs.rmSync(cwd, { recursive: true, force: true });
    });

    it('classifies agent vs external changes and restores only safe files', () => {
        const target = checkpoint('turn1');
        // Agent turn 2: edits two files and creates one.
        write('agent.txt', 'one\ntwo\n');
        write('user.txt', 'one\nagent\n');
        write('created.txt', 'agent made\n');
        write('user-created.txt', 'agent made too\n');
        const turn2 = checkpoint('turn2');
        // After the turn, the user edits one file, an agent-created one, and adds ignored content.
        write('user.txt', 'one\nagent\nuser\n');
        write('user-created.txt', 'user edited\n');
        write('notes.txt', 'mine\n');
        write('secret.env', 'x\n');
        const conv = { id: 'c', cwd, checkpoints: [target, turn2] };

        const { preview } = computeRewindPreview(git, conv, target);
        const byPath = new Map(preview.files.map(file => [file.path, file]));
        expect([...byPath.keys()].sort()).to.deep.equal(['agent.txt', 'created.txt', 'user-created.txt', 'user.txt']);
        expect(byPath.get('agent.txt')).to.include({ action: 'restore', safety: 'safe', added: 0, removed: 1 });
        expect(byPath.get('created.txt')).to.include({ action: 'delete', safety: 'safe' });
        expect(byPath.get('user.txt')?.reasons).to.deep.equal(['modified-externally']);
        expect(byPath.get('user-created.txt')).to.include({ action: 'delete', safety: 'unsafe' });
        expect(preview).to.include({ hasRestore: true, safeCount: 2, unsafeCount: 2, baselineCommit: turn2.commit });

        expect(() => planRewindRestore(git, conv, target, { mode: 'all' })).to.throw(QaapRewindConfirmationRequiredError);
        planRewindRestore(git, conv, target, { mode: 'safe' })();
        expect(fs.readFileSync(path.join(cwd, 'agent.txt'), 'utf8')).to.equal('one\n');
        expect(fs.existsSync(path.join(cwd, 'created.txt'))).to.equal(false);
        expect(fs.readFileSync(path.join(cwd, 'user.txt'), 'utf8')).to.equal('one\nagent\nuser\n');
        expect(fs.readFileSync(path.join(cwd, 'user-created.txt'), 'utf8')).to.equal('user edited\n');
        expect(fs.existsSync(path.join(cwd, 'notes.txt'))).to.equal(true);
        expect(fs.existsSync(path.join(cwd, 'secret.env'))).to.equal(true);
    });

    it('restores everything with explicit confirmation', () => {
        const target = checkpoint('turn1');
        write('user.txt', 'agent\n');
        const turn2 = checkpoint('turn2');
        write('user.txt', 'user\n');
        fs.rmSync(path.join(cwd, 'keep.txt'));
        const conv = { id: 'c', cwd, checkpoints: [target, turn2] };
        const { preview } = computeRewindPreview(git, conv, target);
        expect(preview.files.find(file => file.path === 'keep.txt')).to.include({ action: 'recreate', safety: 'unsafe' });
        write('notes.txt', 'untracked user file\n');
        write('secret.env', 'ignored\n');
        planRewindRestore(git, conv, target, { mode: 'all', confirmUnsafe: true })();
        // git clean only ever receives explicit delete paths: unrelated untracked/ignored files survive.
        expect(fs.readFileSync(path.join(cwd, 'notes.txt'), 'utf8')).to.equal('untracked user file\n');
        expect(fs.readFileSync(path.join(cwd, 'secret.env'), 'utf8')).to.equal('ignored\n');
        expect(fs.readFileSync(path.join(cwd, 'user.txt'), 'utf8')).to.equal('one\n');
        expect(fs.readFileSync(path.join(cwd, 'keep.txt'), 'utf8')).to.equal('base\n');
        expect(computeRewindPreview(git, conv, target).preview.files).to.deep.equal([]);
    });

    it('reports no restore when there is no checkpoint', () => {
        const { preview } = computeRewindPreview(git, { id: 'c', cwd, checkpoints: [] }, undefined);
        expect(preview).to.include({ hasRestore: false, safeCount: 0, unsafeCount: 0 });
    });
});
