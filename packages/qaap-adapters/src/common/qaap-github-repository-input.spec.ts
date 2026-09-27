// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { parseQaapGithubRepositoryInput } from './qaap-github-repository-input';

describe('parseQaapGithubRepositoryInput', () => {

    it('accepts shorthand, HTTPS, and SSH repository forms', () => {
        expect(parseQaapGithubRepositoryInput('octocat/Hello-World')).to.deep.equal({
            owner: 'octocat',
            name: 'Hello-World',
        });
        expect(parseQaapGithubRepositoryInput('https://github.com/octocat/Hello-World.git')).to.deep.equal({
            owner: 'octocat',
            name: 'Hello-World',
        });
        expect(parseQaapGithubRepositoryInput('git@github.com:octocat/Hello-World.git')).to.deep.equal({
            owner: 'octocat',
            name: 'Hello-World',
        });
    });

    it('rejects non-repository GitHub paths and non-GitHub hosts', () => {
        expect(parseQaapGithubRepositoryInput('https://github.com/octocat/Hello-World/issues')).to.equal(undefined);
        expect(parseQaapGithubRepositoryInput('https://www.github.com/octocat/Hello-World')).to.equal(undefined);
        expect(parseQaapGithubRepositoryInput('https://example.com/octocat/Hello-World')).to.equal(undefined);
        expect(parseQaapGithubRepositoryInput('octocat')).to.equal(undefined);
    });
});
