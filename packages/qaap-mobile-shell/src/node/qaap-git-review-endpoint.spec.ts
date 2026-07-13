// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseUnifiedDiff } from '../common/qaap-git-review';
import { QaapGitReviewEndpoint } from './qaap-git-review-endpoint';

/** Test seam: expose the protected git helpers without spinning up express or DI. */
class TestableGitReviewEndpoint extends QaapGitReviewEndpoint {
    computeFileDiffForTest(root: string, file: string): Promise<string> {
        return this.computeFileDiff(root, file);
    }
}

describe('qaap-git-review-endpoint computeFileDiff', function (): void {
    // git subprocess churn — allow slack on slow CI runners.
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
        git(['add', '.']);
        git(['commit', '-qm', 'init']);
        // Working tree shaped like the reported VPS case: one modified tracked file, one untracked.
        fs.writeFileSync(path.join(repo, 'index.html'), '<html>v2</html>\n<footer/>\n');
        fs.writeFileSync(path.join(repo, 'package-lock.json'), '{ "lockfileVersion": 3 }\n');
        // Host-level breakage that killed per-file diffs in production: an external diff driver
        // that does not exist on the server. Plumbing (--numstat/status) ignores it, so the
        // changes list works while every patch-producing diff dies — unless we pass --no-ext-diff.
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

    it('emits no ANSI color codes even when color.ui is forced on', async () => {
        git(['config', 'color.ui', 'always']);
        try {
            const patch = await endpoint.computeFileDiffForTest(repo, 'index.html');
            expect(patch).to.not.match(/\[/);
        } finally {
            git(['config', '--unset', 'color.ui']);
        }
    });
});
