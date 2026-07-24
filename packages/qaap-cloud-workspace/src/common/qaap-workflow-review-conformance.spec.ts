// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapReviewChangedFile } from './qaap-agent-review';
import { buildImplementThenReviewWorkflow, dryRunQaapWorkflowPath } from './qaap-workflow-ir';
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
function graphDecision(changedFiles: readonly QaapReviewChangedFile[], reviewerOutput: string | undefined): string {
    const def = buildImplementThenReviewWorkflow();
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
});
