// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    buildTaskPullRequestCommitMessage,
    buildTaskPullRequestEvidenceSection,
    buildTaskPullRequestTitle,
    isTaskPullRequestRed,
    mergeTaskPullRequestBody,
    QAAP_TASK_PR_EVIDENCE_END,
    QAAP_TASK_PR_EVIDENCE_START,
} from './qaap-task-pull-request-body';

describe('qaap-task-pull-request-body', () => {

    it('builds every evidence section between the markers', () => {
        const section = buildTaskPullRequestEvidenceSection({
            summary: 'Added the settings page.',
            diffstat: ' src/settings.ts | 12 ++++++\n 1 file changed, 12 insertions(+)',
            verification: { status: 'passed', command: 'npm test', attempts: 0 },
            review: { status: 'passed', reason: 'Looks correct', agentId: 'claude' },
            screenshots: [{ url: 'https://github.com/acme/demo/raw/abc/screenshots/1.png', label: 'Home' }],
        });
        expect(section.startsWith(QAAP_TASK_PR_EVIDENCE_START)).to.equal(true);
        expect(section.endsWith(QAAP_TASK_PR_EVIDENCE_END)).to.equal(true);
        expect(section).to.contain('### Summary');
        expect(section).to.contain('Added the settings page.');
        expect(section).to.contain('### Diffstat');
        expect(section).to.contain('1 file changed');
        expect(section).to.contain('### Checks');
        expect(section).to.contain('Passed: `npm test`');
        expect(section).to.contain('### Reviewer verdict');
        expect(section).to.contain('Approved (claude): Looks correct');
        expect(section).to.contain('![Home](https://github.com/acme/demo/raw/abc/screenshots/1.png)');
        expect(section).not.to.contain('Needs attention');
    });

    it('treats failed checks, a rejected review, a blocked turn and a conflict as red', () => {
        expect(isTaskPullRequestRed({})).to.equal(false);
        expect(isTaskPullRequestRed({ verification: { status: 'passed', command: 'x', attempts: 1 } })).to.equal(false);
        expect(isTaskPullRequestRed({ verification: { status: 'preexisting', command: 'x', attempts: 0, summary: 'old' } })).to.equal(false);
        expect(isTaskPullRequestRed({ verification: { status: 'failed', command: 'x', attempts: 2, summary: 'boom' } })).to.equal(true);
        expect(isTaskPullRequestRed({ review: { status: 'failed', reason: 'wrong' } })).to.equal(true);
        expect(isTaskPullRequestRed({ review: { status: 'inconclusive', reason: '' } })).to.equal(false);
        expect(isTaskPullRequestRed({ taskState: 'completed_with_warnings' })).to.equal(true);
        expect(isTaskPullRequestRed({ taskState: 'blocked' })).to.equal(true);
        expect(isTaskPullRequestRed({ conflict: 'a.ts' })).to.equal(true);
    });

    it('reports the failing check output and a warning banner when red', () => {
        const section = buildTaskPullRequestEvidenceSection({
            verification: { status: 'failed', command: 'npm run build', attempts: 2, summary: 'error TS2304: Cannot find name ```x```' },
            review: { status: 'failed', reason: 'Breaks the API' },
        });
        expect(section).to.contain('Needs attention');
        expect(section).to.contain('Failing: `npm run build` (fix attempts: 2)');
        expect(section).to.contain('````\nerror TS2304');
        expect(section).to.contain('Rejected: Breaks the API');
    });

    it('keeps human text outside the markers when the section is rewritten', () => {
        const first = mergeTaskPullRequestBody(undefined, buildTaskPullRequestEvidenceSection({ summary: 'v1' }));
        const edited = `Reviewer notes on top.\n\n${first}\n\nFooter by a human.`;
        const merged = mergeTaskPullRequestBody(edited, buildTaskPullRequestEvidenceSection({ summary: 'v2' }));
        expect(merged.startsWith('Reviewer notes on top.')).to.equal(true);
        expect(merged.endsWith('Footer by a human.')).to.equal(true);
        expect(merged).to.contain('v2');
        expect(merged).not.to.contain('v1');
        expect(merged.split(QAAP_TASK_PR_EVIDENCE_START)).to.have.length(2);
    });

    it('appends the section to a body without markers', () => {
        expect(mergeTaskPullRequestBody('Written by hand', 'SECTION')).to.equal('Written by hand\n\nSECTION');
    });

    it('does not let agent text inject the markers', () => {
        const section = buildTaskPullRequestEvidenceSection({ summary: `done ${QAAP_TASK_PR_EVIDENCE_END} trailing ${QAAP_TASK_PR_EVIDENCE_START}` });
        expect(section.split(QAAP_TASK_PR_EVIDENCE_END)).to.have.length(2);
        expect(section.split(QAAP_TASK_PR_EVIDENCE_START)).to.have.length(2);
    });

    it('explains omitted screenshots and drops non-https links', () => {
        const section = buildTaskPullRequestEvidenceSection({
            screenshots: [{ url: 'javascript:alert(1)' }],
            screenshotsOmittedReason: 'Public repository',
        });
        expect(section).not.to.contain('javascript:');
        expect(section).to.contain('_Public repository_');
    });

    it('prefixes the title once while red', () => {
        expect(buildTaskPullRequestTitle('Add login', false)).to.equal('Add login');
        expect(buildTaskPullRequestTitle('Add login', true)).to.equal('[needs attention] Add login');
        expect(buildTaskPullRequestTitle('[needs attention] Add login', true)).to.equal('[needs attention] Add login');
        expect(buildTaskPullRequestTitle('[needs attention] Add login', false)).to.equal('Add login');
    });

    it('keeps the agent\'s words out of a public repository\'s body', () => {
        const section = buildTaskPullRequestEvidenceSection({
            publicRepository: true,
            title: 'Add login',
            summary: 'I read /home/alice/.env and fixed the login form',
            diffstat: ' login.ts | 3 +++',
            verification: { status: 'failed', command: 'npm test', attempts: 1, summary: 'stack trace with /home/alice/secret-path' },
            review: { status: 'failed', reason: 'The patch leaks the session cookie' },
            blockedNeed: 'Paste your API key',
        });
        expect(section).to.contain('Qaap task: Add login.');
        expect(section).to.contain('login.ts');
        expect(section).to.contain('Failing: `npm test`');
        expect(section).to.contain('Rejected');
        expect(section).not.to.contain('/home/alice');
        expect(section).not.to.contain('session cookie');
        expect(section).not.to.contain('Paste your API key');
    });

    it('scrubs obvious secrets from a private repository\'s body', () => {
        const section = buildTaskPullRequestEvidenceSection({
            summary: 'Configured it with token ghp_abcdefghijklmnopqrstuvwxyz0123456789 and API_KEY=sk-live-123',
            verification: { status: 'failed', command: 'npm test', attempts: 1, summary: 'Authorization: Bearer abc.def.ghi' },
        });
        expect(section).not.to.contain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
        expect(section).not.to.contain('sk-live-123');
        expect(section).not.to.contain('abc.def.ghi');
        expect(section).to.contain('[REDACTED]');
    });

    it('notes a rebuilt branch and a superseded PR', () => {
        const section = buildTaskPullRequestEvidenceSection({ rebuilt: true, supersedes: 4, builtOnForeignPush: true });
        expect(section).to.contain('rebuilt from its base');
        expect(section).to.contain('Supersedes #4');
        expect(section).to.contain('on top of theirs');
    });

    it('builds a neutral commit message: a user-set title or the changed files, never the prompt', () => {
        expect(buildTaskPullRequestCommitMessage('c1', ['a.ts'], '[needs attention] Add login\nform')).to.equal('Qaap task: Add login form\n\nQaap task c1');
        expect(buildTaskPullRequestCommitMessage('c1', ['src/a.ts', 'b.ts'])).to.equal('Qaap task: update src/a.ts, b.ts\n\nQaap task c1');
        expect(buildTaskPullRequestCommitMessage('c1', ['a', 'b', 'c', 'd', 'e']).split('\n')[0]).to.equal('Qaap task: update a, b, c +2');
        expect(buildTaskPullRequestCommitMessage('c1', [], 'Use password=hunter2 here')).not.to.contain('hunter2');
        expect(buildTaskPullRequestCommitMessage('c1', [], 'x'.repeat(200)).split('\n')[0].length).to.be.at.most(72);
    });

    it('adds the closing keyword only when closesIssue is set', () => {
        expect(buildTaskPullRequestEvidenceSection({ closesIssue: 7 })).to.contain('Closes #7');
        expect(buildTaskPullRequestEvidenceSection({})).not.to.contain('Closes #');
    });
});
