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
import type { QaapGitPrReadiness } from '../common/qaap-git-review';

class TestGitReviewEndpoint extends QaapGitReviewEndpoint {
    prReadiness(root: string): Promise<QaapGitPrReadiness | undefined> {
        return this.readPrReadiness(root);
    }
}

describe('QaapGitReviewEndpoint.readPrReadiness (integration, real git)', () => {
    let repo: string;
    const endpoint = new TestGitReviewEndpoint();
    const git = (...args: string[]): void => { execFileSync('git', args, { cwd: repo, stdio: 'ignore' }); };

    beforeEach(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-pr-'));
        git('init', '-b', 'main');
        git('config', 'user.email', 'test@example.com');
        git('config', 'user.name', 'Test');
        fs.writeFileSync(path.join(repo, 'a.txt'), 'one');
        git('add', '-A');
        git('commit', '-m', 'first');
    });

    afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

    it('does not offer a PR while on the default branch', async () => {
        const readiness = await endpoint.prReadiness(repo);
        expect(readiness?.canCreatePr).to.equal(false);
        expect(readiness?.defaultBranch).to.equal('main');
    });

    it('offers a PR on a feature branch with commits ahead of main', async () => {
        git('checkout', '-b', 'feature/x');
        fs.writeFileSync(path.join(repo, 'b.txt'), 'two');
        git('add', '-A');
        git('commit', '-m', 'second');
        const readiness = await endpoint.prReadiness(repo);
        expect(readiness?.canCreatePr).to.equal(true);
        expect(readiness?.aheadCount).to.equal(1);
        expect(readiness?.defaultBranch).to.equal('main');
    });

    it('does not offer a PR on a feature branch with no commits ahead', async () => {
        git('checkout', '-b', 'feature/empty');
        const readiness = await endpoint.prReadiness(repo);
        expect(readiness?.canCreatePr).to.equal(false);
        expect(readiness?.aheadCount).to.equal(0);
    });
});
