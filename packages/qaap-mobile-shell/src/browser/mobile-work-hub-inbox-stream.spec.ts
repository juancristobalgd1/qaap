// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { type QaapGithubPullRequestSummary } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import { MobileWorkHubInboxStream } from './mobile-work-hub-inbox-stream';

class TestInboxStream extends MobileWorkHubInboxStream {
    firePullRequest(pullRequest: QaapGithubPullRequestSummary, action = 'opened'): void {
        this.onPullRequestEvent({
            data: JSON.stringify({
                type: 'pull_request',
                action,
                pullRequest,
                linkedConversationCount: 0,
            }),
        } as MessageEvent<string>);
    }
}

function createPullRequest(number: number, updatedAt = `2026-06-26T10:00:0${number}Z`): QaapGithubPullRequestSummary {
    return {
        owner: 'qaap',
        repo: 'mobile',
        number,
        title: `PR ${number}`,
        branch: `feature-${number}`,
        base: 'main',
        author: 'codex',
        files: 1,
        adds: 1,
        dels: 0,
        tests: 'unknown',
        htmlUrl: `https://github.com/qaap/mobile/pull/${number}`,
        filesPreview: [],
        updatedAt,
    };
}

describe('MobileWorkHubInboxStream', () => {

    let previousRequestAnimationFrame: typeof requestAnimationFrame | undefined;
    let previousCancelAnimationFrame: typeof cancelAnimationFrame | undefined;

    afterEach(() => {
        if (previousRequestAnimationFrame) {
            globalThis.requestAnimationFrame = previousRequestAnimationFrame;
        } else {
            delete (globalThis as Partial<typeof globalThis>).requestAnimationFrame;
        }
        if (previousCancelAnimationFrame) {
            globalThis.cancelAnimationFrame = previousCancelAnimationFrame;
        } else {
            delete (globalThis as Partial<typeof globalThis>).cancelAnimationFrame;
        }
    });

    it('coalesces bursty inbox events into one change notification per frame', () => {
        previousRequestAnimationFrame = globalThis.requestAnimationFrame;
        previousCancelAnimationFrame = globalThis.cancelAnimationFrame;
        let rafCallback: (() => void) | undefined;
        globalThis.requestAnimationFrame = callback => {
            rafCallback = () => callback(0);
            return 1;
        };
        globalThis.cancelAnimationFrame = () => {
            rafCallback = undefined;
        };

        const stream = new TestInboxStream();
        let changeCount = 0;
        stream.onDidChange(() => { changeCount++; });

        stream.firePullRequest(createPullRequest(1));
        stream.firePullRequest(createPullRequest(2));
        stream.firePullRequest(createPullRequest(3));

        expect(changeCount).to.equal(0);
        expect(stream.getLivePullRequests()).to.have.length(3);

        rafCallback?.();

        expect(changeCount).to.equal(1);
    });
});
