// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapReviewChangedFile } from './qaap-agent-review';
import {
    buildImplementThenReviewWorkflow,
    dryRunQaapWorkflowPath,
    validateQaapWorkflowDef,
    type QaapWorkflowReviewMode,
} from './qaap-workflow-ir';
import {
    judgeOutcome,
    REVIEW_DECISION_BINDING,
    riskOutcome,
    runnerReviewDecision,
    type QaapReviewDecision,
} from './qaap-workflow-review-conformance';

/** Terminal emit node ids in the template, keyed by decision. */
const DECISION_EMIT_NODE: Readonly<Record<QaapReviewDecision, string>> = {
    skipped: 'done-skip',
    passed: 'done-pass',
    failed: 'done-fail',
    inconclusive: 'done-inconclusive',
};

/** Drive the graph with outcomes derived from the same helpers the runner uses. */
function graphDecision(
    changedFiles: readonly QaapReviewChangedFile[],
    reviewerOutput: string | undefined,
    reviewMode: QaapWorkflowReviewMode = 'high-risk',
): string {
    const def = buildImplementThenReviewWorkflow({ reviewMode });
    const path = dryRunQaapWorkflowPath(def, {
        implement: 'success',
        'risk-classify': riskOutcome(changedFiles),
        'git-diff': 'success',
        judge: judgeOutcome(reviewerOutput),
    });
    return path[path.length - 1];
}

const lowRisk: QaapReviewChangedFile[] = [{ path: 'src/util.ts', added: 3, removed: 1 }];
const highRiskBySize: QaapReviewChangedFile[] = [{ path: 'src/util.ts', added: 30, removed: 20 }];
const highRiskBySensitivePath: QaapReviewChangedFile[] = [{ path: 'src/auth/login.ts', added: 2, removed: 0 }];
const passOutput = 'stream…\n@@QAAP:VERDICT@@ pass all good';
const failOutput = 'stream…\n@@QAAP:VERDICT@@ fail broken';
const noVerdictOutput = 'the reviewer forgot to emit a sentinel';

describe('workflow review conformance', () => {
    const cases: { name: string; files: QaapReviewChangedFile[]; output: string | undefined; expected: QaapReviewDecision }[] = [
        { name: 'low-risk diff skips review', files: lowRisk, output: passOutput, expected: 'skipped' },
        { name: 'high-risk by size, reviewer passes', files: highRiskBySize, output: passOutput, expected: 'passed' },
        { name: 'high-risk by size, reviewer fails', files: highRiskBySize, output: failOutput, expected: 'failed' },
        { name: 'sensitive path, reviewer passes', files: highRiskBySensitivePath, output: passOutput, expected: 'passed' },
        { name: 'high-risk, silent reviewer is inconclusive', files: highRiskBySize, output: noVerdictOutput, expected: 'inconclusive' },
    ];

    for (const testCase of cases) {
        it(`${testCase.name}: graph terminal matches the runner decision`, () => {
            // The runner's own decision for these inputs.
            const decision = runnerReviewDecision(testCase.files, testCase.output);
            expect(decision, 'runner decision').to.equal(testCase.expected);

            // The graph reaches the emit node and binding for exactly that decision.
            expect(graphDecision(testCase.files, testCase.output), 'graph terminal node')
                .to.equal(DECISION_EMIT_NODE[decision]);

            const def = buildImplementThenReviewWorkflow();
            const emit = def.nodes.find(node => node.id === DECISION_EMIT_NODE[decision]);
            expect(emit?.kind === 'emit' && emit.bindingKey, 'graph binding key')
                .to.equal(REVIEW_DECISION_BINDING[decision]);
        });
    }

    it('a low-risk diff never reaches the judge node', () => {
        const def = buildImplementThenReviewWorkflow();
        const path = dryRunQaapWorkflowPath(def, {
            implement: 'success',
            'risk-classify': riskOutcome(lowRisk),
        });
        expect(path).to.not.include('judge');
    });

    describe('mode conformance', () => {
        it("'off' mode skips review regardless of risk or verdict", () => {
            expect(runnerReviewDecision(highRiskBySize, failOutput, 'off')).to.equal('skipped');
            expect(graphDecision(highRiskBySize, failOutput, 'off')).to.equal(DECISION_EMIT_NODE.skipped);
        });

        it("'all' mode reviews a low-risk diff instead of skipping it", () => {
            expect(runnerReviewDecision(lowRisk, passOutput, 'all')).to.equal('passed');
            expect(graphDecision(lowRisk, passOutput, 'all')).to.equal(DECISION_EMIT_NODE.passed);
            // The same low-risk diff skips under the default high-risk mode.
            expect(graphDecision(lowRisk, passOutput, 'high-risk')).to.equal(DECISION_EMIT_NODE.skipped);
        });

        it("'all' mode still fails on a fail verdict for a low-risk diff", () => {
            expect(runnerReviewDecision(lowRisk, failOutput, 'all')).to.equal('failed');
            expect(graphDecision(lowRisk, failOutput, 'all')).to.equal(DECISION_EMIT_NODE.failed);
        });

        it("'off' mode produces a graph with no judge node", () => {
            const def = buildImplementThenReviewWorkflow({ reviewMode: 'off' });
            expect(def.nodes.some(node => node.id === 'judge')).to.equal(false);
        });

        for (const reviewMode of ['high-risk', 'all', 'off'] as const) {
            it(`${reviewMode} mode builds a valid definition`, () => {
                expect(validateQaapWorkflowDef(buildImplementThenReviewWorkflow({ reviewMode })))
                    .to.deep.include({ ok: true });
            });

            it(`${reviewMode} mode with verification builds a valid definition`, () => {
                expect(validateQaapWorkflowDef(buildImplementThenReviewWorkflow({ reviewMode, withVerify: true })))
                    .to.deep.include({ ok: true });
            });
        }
    });

    describe('verification fix-loop', () => {
        it('is absent by default, so the proven review graph is unchanged', () => {
            const def = buildImplementThenReviewWorkflow();
            expect(def.nodes.some(node => node.id === 'verify')).to.equal(false);
            expect(def.edges.some(edge => edge.from === 'implement' && edge.to === 'risk-classify')).to.equal(true);
        });

        it('routes a passing verification on to the review', () => {
            const def = buildImplementThenReviewWorkflow({ withVerify: true });
            const path = dryRunQaapWorkflowPath(def, {
                implement: 'success',
                verify: 'success',
                'risk-classify': riskOutcome(highRiskBySize),
                'git-diff': 'success',
                judge: judgeOutcome(passOutput),
            });
            expect(path).to.deep.equal(['implement', 'verify', 'risk-classify', 'git-diff', 'judge', 'done-pass']);
        });

        it('sends a failed verification into a fix turn and back to verify', () => {
            const def = buildImplementThenReviewWorkflow({ withVerify: true });
            expect(def.edges).to.deep.include({ from: 'verify', to: 'implement-fix', when: 'fail' });
            expect(def.edges).to.deep.include({ from: 'implement-fix', to: 'verify', when: 'success' });
        });

        it('ends as unverified when the fix turn itself cannot run', () => {
            const def = buildImplementThenReviewWorkflow({ withVerify: true });
            const path = dryRunQaapWorkflowPath(def, {
                implement: 'success',
                verify: 'fail',
                'implement-fix': 'blocked',
            });
            expect(path[path.length - 1]).to.equal('done-unverified');
        });

        it('accepts the sequential implement and implement-fix cwd writers', () => {
            // Both write the shared cwd but never concurrently; the fan-out check must not reject them.
            const result = validateQaapWorkflowDef(buildImplementThenReviewWorkflow({ withVerify: true }));
            expect(result).to.deep.equal({ ok: true, issues: [] });
        });
    });
});
