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

class TestGitReviewEndpoint extends QaapGitReviewEndpoint {
    applyHunk(root: string, file: string, index: number, mode: 'stage' | 'discard'): Promise<boolean> {
        return this.applyFileHunk(root, file, index, mode);
    }
}

describe('QaapGitReviewEndpoint.applyFileHunk (integration, real git)', () => {
    let repo: string;
    const endpoint = new TestGitReviewEndpoint();
    const git = (...args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });

    // A 12-line file; edits produce two separate, non-adjacent hunks.
    const base = Array.from({ length: 12 }, (_, i) => `line${i + 1}`).join('\n') + '\n';
    const edited = base.replace('line2\n', 'line2\nADDED-TOP\n').replace('line11\n', 'line11\nADDED-BOTTOM\n');

    beforeEach(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-hunk-'));
        git('init', '-b', 'main');
        git('config', 'user.email', 't@e.com');
        git('config', 'user.name', 'T');
        fs.writeFileSync(path.join(repo, 'f.txt'), base);
        git('add', '-A');
        git('commit', '-m', 'base');
        fs.writeFileSync(path.join(repo, 'f.txt'), edited);
    });

    afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

    it('stages only the selected hunk, leaving the other unstaged', async () => {
        const ok = await endpoint.applyHunk(repo, 'f.txt', 0, 'stage');
        expect(ok).to.equal(true);
        // The staged diff contains only the top change; the bottom change is still unstaged.
        expect(git('diff', '--cached')).to.contain('ADDED-TOP').and.not.contain('ADDED-BOTTOM');
        expect(git('diff')).to.contain('ADDED-BOTTOM').and.not.contain('ADDED-TOP');
        // The working file is untouched — both edits still present on disk.
        const onDisk = fs.readFileSync(path.join(repo, 'f.txt'), 'utf8');
        expect(onDisk).to.contain('ADDED-TOP');
        expect(onDisk).to.contain('ADDED-BOTTOM');
    });

    it('discards only the selected hunk from the working tree, keeping the other', async () => {
        const ok = await endpoint.applyHunk(repo, 'f.txt', 0, 'discard');
        expect(ok).to.equal(true);
        const onDisk = fs.readFileSync(path.join(repo, 'f.txt'), 'utf8');
        expect(onDisk).to.not.contain('ADDED-TOP');    // discarded
        expect(onDisk).to.contain('ADDED-BOTTOM');     // kept
    });

    it('returns false for an out-of-range hunk index (no tree mutation)', async () => {
        const ok = await endpoint.applyHunk(repo, 'f.txt', 9, 'stage');
        expect(ok).to.equal(false);
        expect(git('diff', '--cached')).to.equal('');
    });
});
