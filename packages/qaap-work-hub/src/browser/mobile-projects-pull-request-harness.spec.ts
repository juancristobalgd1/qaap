// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapTaskPullRequest } from '@theia/qaap-shared-core/lib/common/qaap-task-pull-request';
import {
    indexMobileProjectsPullRequestHarnesses,
    mobileProjectsPullRequestHarnessKey,
    resolveMobileProjectsPullRequestHarness,
    type MobileProjectsPullRequestHarnessSummary,
} from './mobile-projects-pull-request-harness';

function taskPullRequest(overrides: Partial<QaapTaskPullRequest>): QaapTaskPullRequest {
    return { owner: 'acme', repo: 'app', branch: 'qaap/task/1', ...overrides } as QaapTaskPullRequest;
}

describe('mobile-projects-pull-request-harness', () => {

    it('builds a case-insensitive key from the number or the GitHub URL', () => {
        expect(mobileProjectsPullRequestHarnessKey({ owner: 'Acme', repo: 'App', number: 7 })).to.equal('acme/app#7');
        expect(mobileProjectsPullRequestHarnessKey({ owner: 'acme', repo: 'app', url: 'https://github.com/Acme/App/pull/12' })).to.equal('acme/app#12');
        expect(mobileProjectsPullRequestHarnessKey({ owner: '', repo: '', url: 'https://github.com/Acme/App/pull/3' })).to.equal('acme/app#3');
        expect(mobileProjectsPullRequestHarnessKey({ owner: 'acme', repo: 'app' })).to.equal(undefined);
    });

    it('resolves the harness of the task that opened the pull request, preferring the last turn agent', () => {
        const index = indexMobileProjectsPullRequestHarnesses([
            { agentId: 'codex', lastTurnAgentId: 'claude-code', updatedAt: 1, taskPullRequest: taskPullRequest({ number: 4 }) },
            { agentId: 'codex', updatedAt: 1, taskPullRequest: taskPullRequest({ url: 'https://github.com/acme/app/pull/5' }) },
        ]);
        expect(resolveMobileProjectsPullRequestHarness(index, { owner: 'ACME', repo: 'app', number: 4 })).to.equal('claude-code');
        expect(resolveMobileProjectsPullRequestHarness(index, { owner: 'acme', repo: 'app', number: 5 })).to.equal('codex');
        expect(resolveMobileProjectsPullRequestHarness(index, { owner: 'acme', repo: 'app', number: 6 })).to.equal(undefined);
        expect(resolveMobileProjectsPullRequestHarness(index, { owner: 'acme', repo: 'other', number: 4 })).to.equal(undefined);
    });

    it('lets the most recently updated conversation win, and an opened pull request beat a linked one', () => {
        const summaries: MobileProjectsPullRequestHarnessSummary[] = [
            { agentId: 'codex', updatedAt: 10, taskPullRequest: taskPullRequest({ number: 1 }) },
            { agentId: 'claude-code', updatedAt: 20, taskPullRequest: taskPullRequest({ number: 1 }) },
            { agentId: 'gemini', updatedAt: 99, linkedPullRequest: { owner: 'acme', repo: 'app', number: 1 } },
            { agentId: 'gemini', updatedAt: 5, linkedPullRequest: { owner: 'acme', repo: 'app', number: 2 } },
        ];
        const index = indexMobileProjectsPullRequestHarnesses(summaries);
        expect(resolveMobileProjectsPullRequestHarness(index, { owner: 'acme', repo: 'app', number: 1 })).to.equal('claude-code');
        expect(resolveMobileProjectsPullRequestHarness(index, { owner: 'acme', repo: 'app', number: 2 })).to.equal('gemini');
    });

    it('ignores task pull requests that do not exist yet and summaries without an agent', () => {
        const index = indexMobileProjectsPullRequestHarnesses([
            { agentId: 'codex', updatedAt: 1, taskPullRequest: taskPullRequest({}) },
            { agentId: '', updatedAt: 1, linkedPullRequest: { owner: 'acme', repo: 'app', number: 9 } },
        ]);
        expect(index.size).to.equal(0);
    });
});
