// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapHostedProjectGit, QaapHostedProjectLayout, QaapHostedProjectResolver } from './qaap-hosted-project-resolver';

describe('QaapHostedProjectResolver', () => {
    let reposRoot: string;
    let userRoot: string;

    const git: QaapHostedProjectGit = async (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' });

    const layout = (): QaapHostedProjectLayout => ({
        userRoot,
        repositoryPath: (owner, repo) => path.join(userRoot, owner, repo),
        lookupWorktree: () => undefined,
    });

    const clone = (owner: string, repo: string): string => {
        const dir = path.join(userRoot, owner, repo);
        fs.mkdirSync(dir, { recursive: true });
        execFileSync('git', ['init', '-q'], { cwd: dir });
        return dir;
    };

    beforeEach(() => {
        reposRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-hosted-project-')));
        userRoot = path.join(reposRoot, 'users', 'me');
    });

    afterEach(() => {
        fs.rmSync(reposRoot, { recursive: true, force: true });
    });

    it('resolves a canonical GitHub clone to its owner and repository', async () => {
        const checkout = clone('acme', 'app');
        const project = await new QaapHostedProjectResolver().resolve('me', checkout, git, layout());
        expect(project && { owner: project.owner, repo: project.repo }).to.deep.equal({ owner: 'acme', repo: 'app' });
    });

    it('never treats a local project as a GitHub repository (no pull request for local/<name>)', async () => {
        const checkout = clone('local', 'qa-e2e-todo');
        expect(await new QaapHostedProjectResolver().resolve('me', checkout, git, layout())).to.equal(undefined);
    });
});
