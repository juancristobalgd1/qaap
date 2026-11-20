// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapWorkflowAgentTurnNode } from './qaap-workflow-ir';
import { resolveAgentTurnOutcome } from './qaap-workflow-outcome';

function judgeNode(promptRef: string): QaapWorkflowAgentTurnNode {
    return { kind: 'agent-turn', id: 'judge', capability: 'judge', isolation: 'cwd-readonly', promptRef, requireSentinel: true } as QaapWorkflowAgentTurnNode;
}

describe('resolveAgentTurnOutcome sentinel judges', () => {
    const uncitedFail = 'out\n@@QAAP:VERDICT@@ fail server.js rewrites';
    const citedFail = 'out\n@@QAAP:VERDICT@@ fail src/a.js:3 — SyntaxError: Unexpected token )';
    const pass = 'out\n@@QAAP:VERDICT@@ pass all good';

    it('adversarial-review: a rejection with no file:line defect routes as approved with notes', () => {
        expect(resolveAgentTurnOutcome(judgeNode('adversarial-review'), 'completed', uncitedFail)).to.equal('verdict:pass');
    });

    it('adversarial-review: a rejection citing a real defect still routes as a failure', () => {
        expect(resolveAgentTurnOutcome(judgeNode('adversarial-review'), 'completed', citedFail)).to.equal('verdict:fail');
    });

    it('adversarial-review: a silent judge stays inconclusive and a pass stays a pass', () => {
        expect(resolveAgentTurnOutcome(judgeNode('adversarial-review'), 'completed', 'no sentinel')).to.equal('verdict:inconclusive');
        expect(resolveAgentTurnOutcome(judgeNode('adversarial-review'), 'completed', pass)).to.equal('verdict:pass');
    });

    it('other judges (plan-review) keep an uncited rejection as a failure', () => {
        expect(resolveAgentTurnOutcome(judgeNode('plan-review'), 'completed', uncitedFail)).to.equal('verdict:fail');
    });
});
