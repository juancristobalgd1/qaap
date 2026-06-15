// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    bodyMentionsQaap,
    buildGithubIssueAgentPrompt,
    githubCommentTriggersAgent,
    isLikelyQaapAckComment,
    issueHasTriggerLabel,
    stripQaapMentionFromPrompt,
} from './qaap-github-agent-trigger';

describe('qaap-github-agent-trigger', () => {
    it('detects @qaap mentions case-insensitively', () => {
        expect(bodyMentionsQaap('@qaap fix the flaky test')).to.be.true;
        expect(bodyMentionsQaap('@QAAP please refactor')).to.be.true;
        expect(bodyMentionsQaap('qaap without at-sign')).to.be.false;
    });

    it('matches configured trigger labels on issues', () => {
        expect(issueHasTriggerLabel([{ name: 'qaap' }], 'qaap')).to.be.true;
        expect(issueHasTriggerLabel([{ name: 'bug' }], 'qaap')).to.be.false;
    });

    it('combines mention and label triggers', () => {
        expect(githubCommentTriggersAgent({ body: 'hello' })).to.be.false;
        expect(githubCommentTriggersAgent({ body: '@qaap run tests' })).to.be.true;
        expect(githubCommentTriggersAgent({
            body: 'please help',
            issueLabels: [{ name: 'qaap' }],
        })).to.be.true;
    });

    it('strips @qaap from the agent prompt', () => {
        expect(stripQaapMentionFromPrompt('@qaap   fix   tests')).to.equal('fix tests');
    });

    it('builds a contextual GitHub prompt header', () => {
        const prompt = buildGithubIssueAgentPrompt({
            prompt: 'fix tests',
            issueNumber: 42,
            issueTitle: 'Flaky CI',
            commentAuthor: 'dev',
            htmlUrl: 'https://github.com/o/r/issues/42#issuecomment-1',
        });
        expect(prompt).to.contain('[GitHub #42: Flaky CI]');
        expect(prompt).to.contain('Requested by @dev');
        expect(prompt).to.contain('fix tests');
    });

    it('ignores Qaap ack comments', () => {
        expect(isLikelyQaapAckComment('Qaap started a task on this thread.')).to.be.true;
        expect(isLikelyQaapAckComment('@qaap fix tests', 'human')).to.be.false;
    });
});
