// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
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
});
