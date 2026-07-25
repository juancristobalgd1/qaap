// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import {
    diffSensitiveFiles,
    hashSensitiveFiles,
    listSensitiveFileNames,
    restoreSensitiveFiles,
    snapshotSensitiveFiles,
} from './qaap-sensitive-files';

describe('qaap-sensitive-files', () => {
    let dir: string;
    beforeEach(() => dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-sensitive-')));
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('lists only root-level .env-style files', () => {
        fs.writeFileSync(path.join(dir, '.env'), 'A=1\n');
        fs.writeFileSync(path.join(dir, '.env.local'), 'B=2\n');
        fs.writeFileSync(path.join(dir, 'env.txt'), 'not sensitive\n');
        fs.mkdirSync(path.join(dir, '.env.d'));
        expect(listSensitiveFileNames(dir)).to.deep.equal(['.env', '.env.local']);
    });

    it('detects a modified, a created, and a deleted secrets file', () => {
        fs.writeFileSync(path.join(dir, '.env'), 'A=1\n');
        fs.writeFileSync(path.join(dir, '.env.local'), 'B=2\n');
        const baseline = hashSensitiveFiles(dir);

        fs.writeFileSync(path.join(dir, '.env'), 'A=OVERWRITTEN\n');
        fs.rmSync(path.join(dir, '.env.local'));
        fs.writeFileSync(path.join(dir, '.env.production'), 'C=3\n');

        expect(diffSensitiveFiles(baseline, hashSensitiveFiles(dir)))
            .to.deep.equal(['.env', '.env.local', '.env.production']);
    });

    it('reports no changes without a baseline (pre-existing persisted tasks)', () => {
        fs.writeFileSync(path.join(dir, '.env'), 'A=1\n');
        expect(diffSensitiveFiles(undefined, hashSensitiveFiles(dir))).to.deep.equal([]);
    });

    it('reports no changes when contents are identical', () => {
        fs.writeFileSync(path.join(dir, '.env'), 'A=1\n');
        const baseline = hashSensitiveFiles(dir);
        expect(diffSensitiveFiles(baseline, hashSensitiveFiles(dir))).to.deep.equal([]);
    });

    it('snapshot + restore round-trips .env bytes after overwrite', () => {
        const original = 'SECRET=real-value\nOTHER=x\n';
        fs.writeFileSync(path.join(dir, '.env'), original);
        const snap = path.join(dir, 'snap');
        expect(snapshotSensitiveFiles(dir, snap)).to.deep.equal(['.env']);

        fs.writeFileSync(path.join(dir, '.env'), 'NEXT_PUBLIC_SUPABASE_URL=https://your-supabase-url.com');
        expect(restoreSensitiveFiles(snap, dir, ['.env'])).to.deep.equal(['.env']);
        expect(fs.readFileSync(path.join(dir, '.env'), 'utf8')).to.equal(original);
    });

    it('restore refuses path-traversal names', () => {
        const snap = path.join(dir, 'snap');
        fs.mkdirSync(snap, { recursive: true });
        fs.writeFileSync(path.join(snap, '.env'), 'ok\n');
        expect(restoreSensitiveFiles(snap, dir, ['../etc/passwd', '.env/../.env'])).to.deep.equal([]);
        expect(fs.existsSync(path.join(dir, '.env'))).to.equal(false);
    });
});

/** Exposes the protected seams without the DI container. */
class TestableRunner extends QaapAgentTaskRunner {
    baseline(cwd: string): Pick<QaapAgentTask, 'worktreeBaselineFingerprint' | 'worktreeBaselineStatus' | 'sensitiveBaselineHashes'> {
        return this.captureWorktreeBaseline(cwd);
    }
    hasEdits(task: QaapAgentTask): Promise<boolean> {
        return this.hasEditedFilesForVerification(task, {});
    }
    restore(task: QaapAgentTask): string[] {
        return this.restoreBaselineSensitiveFiles(task);
    }
    /** No-op log sink so restore does not touch ~/.qaap/agent-tasks. */
    protected override appendAndFireOutput(_taskId: string, _chunk: string): void { /* test stub */ }
}

describe('runner edit detection for gitignored secrets', () => {
    let repo: string;
    beforeEach(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-sensitive-repo-'));
        const git = (...args: string[]): void => { execFileSync('git', args, { cwd: repo, stdio: 'pipe' }); };
        git('init', '-q');
        git('config', 'user.email', 't@e.com');
        git('config', 'user.name', 'T');
        fs.writeFileSync(path.join(repo, '.gitignore'), '.env\n');
        fs.writeFileSync(path.join(repo, '.env'), 'SECRET=real-value\nOTHER=x\n');
        git('add', '.');
        git('commit', '-q', '-m', 'base');
    });
    afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

    function runner(): TestableRunner {
        const instance = Object.create(TestableRunner.prototype) as TestableRunner;
        Object.assign(instance, { tasks: new Map(), detectedAgents: new Map() });
        return instance;
    }

    function task(baseline: ReturnType<TestableRunner['baseline']>, extra?: Partial<QaapAgentTask>): QaapAgentTask {
        return {
            id: 't1', title: 'x', command: 'qaiq', cwd: repo, state: 'running', createdAt: 0,
            agentId: 'qaiq', ...baseline, ...extra,
        };
    }

    it('REGRESSION: an agent overwriting a gitignored .env counts as edits', async () => {
        // Live incident: a weak model replaced the whole .env with a one-line placeholder; git
        // baselines saw "no edits", so verification AND adversarial review were skipped and the
        // task completed clean while every real credential was destroyed.
        const instance = runner();
        const baseline = instance.baseline(repo);
        expect(baseline.sensitiveBaselineHashes).to.have.property('.env');

        fs.writeFileSync(path.join(repo, '.env'), 'NEXT_PUBLIC_SUPABASE_URL=https://your-supabase-url.com');
        expect(await instance.hasEdits(task(baseline))).to.equal(true);
    });

    it('an untouched .env does not create phantom edits', async () => {
        const instance = runner();
        const baseline = instance.baseline(repo);
        expect(await instance.hasEdits(task(baseline))).to.equal(false);
    });

    it('REGRESSION: mechanical restore recovers overwritten .env without a model', () => {
        const instance = runner();
        const baseline = instance.baseline(repo);
        const snap = path.join(repo, 'sensitive-snapshot');
        expect(snapshotSensitiveFiles(repo, snap)).to.deep.equal(['.env']);
        const original = fs.readFileSync(path.join(repo, '.env'), 'utf8');

        fs.writeFileSync(path.join(repo, '.env'), 'NEXT_PUBLIC_SUPABASE_URL=https://your-supabase-url.com');
        const restored = instance.restore(task(baseline, { sensitiveSnapshotDir: snap }));
        expect(restored).to.deep.equal(['.env']);
        expect(fs.readFileSync(path.join(repo, '.env'), 'utf8')).to.equal(original);
    });
});
