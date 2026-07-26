// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapWorkflowNode } from './qaap-workflow-ir';
import {
    appendQaapWorkflowTrace,
    describeQaapWorkflowStep,
    MAX_QAAP_WORKFLOW_TRACE_ENTRIES,
    QaapWorkflowTraceEntry,
} from './qaap-workflow-trace';

const verifyNode: QaapWorkflowNode = { kind: 'deterministic', id: 'verify', op: 'verify' };
const riskNode: QaapWorkflowNode = { kind: 'deterministic', id: 'risk-classify', op: 'risk-classify' };
const judgeNode: QaapWorkflowNode = {
    kind: 'agent-turn', id: 'judge', capability: 'judge', isolation: 'cwd-readonly', promptRef: 'adversarial-review',
};

function entry(nodeId: string): QaapWorkflowTraceEntry {
    return { nodeId, kind: 'deterministic', outcome: 'success', finishedAt: 1 };
}

describe('describeQaapWorkflowStep', () => {

    it('names the check that failed, which is the whole question when a run goes red', () => {
        expect(describeQaapWorkflowStep(verifyNode, 'fail', { failedScript: 'test' }))
            .to.equal('`npm run test` failed.');
    });

    it('says what passed rather than just "success"', () => {
        expect(describeQaapWorkflowStep(verifyNode, 'success', { scripts: ['typecheck', 'test'] }))
            .to.equal('Passed: typecheck, test.');
        expect(describeQaapWorkflowStep(verifyNode, 'success', { scripts: [] }))
            .to.equal('Nothing to verify in this workspace.');
    });

    it('explains a risk verdict with the count behind it', () => {
        expect(describeQaapWorkflowStep(riskNode, 'risk:high', { files: [{}, {}, {}] }))
            .to.equal('High risk: 3 files changed since the run started.');
        expect(describeQaapWorkflowStep(riskNode, 'risk:low', { files: [{}] }))
            .to.equal('Low risk: 1 file changed since the run started.');
    });

    it('explains the outcome that confuses people most', () => {
        expect(describeQaapWorkflowStep(judgeNode, 'verdict:inconclusive'))
            .to.contain('no verdict');
    });

    it('never carries repository output out of the backend', () => {
        // Details are composed here, so a failing test's stderr — which can print secrets — cannot
        // reach the API through the trace.
        const detail = describeQaapWorkflowStep(verifyNode, 'fail', {
            failedScript: 'test',
            summary: 'AWS_SECRET_ACCESS_KEY=hunter2 leaked in the stack trace',
        });
        expect(detail).to.not.contain('hunter2');
    });

    it('caps a detail it did generate', () => {
        const detail = describeQaapWorkflowStep(verifyNode, 'fail', { failedScript: 'x'.repeat(400) });
        expect(detail!.length).to.be.at.most(161);
    });

    it('stays silent when the outcome already says everything', () => {
        expect(describeQaapWorkflowStep(judgeNode, 'success')).to.equal(undefined);
        expect(describeQaapWorkflowStep(undefined, 'success')).to.equal(undefined);
    });
});

describe('appendQaapWorkflowTrace', () => {
    it('keeps the most recent entries and drops the oldest', () => {
        let trace: readonly QaapWorkflowTraceEntry[] = [];
        for (let i = 0; i < MAX_QAAP_WORKFLOW_TRACE_ENTRIES + 25; i++) {
            trace = appendQaapWorkflowTrace(trace, entry(`node-${i}`));
        }
        expect(trace).to.have.length(MAX_QAAP_WORKFLOW_TRACE_ENTRIES);
        expect(trace[trace.length - 1].nodeId).to.equal(`node-${MAX_QAAP_WORKFLOW_TRACE_ENTRIES + 24}`);
        expect(trace[0].nodeId).to.equal('node-25');
    });
});
