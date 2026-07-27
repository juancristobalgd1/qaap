// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    buildEvidenceAuditWorkflow,
    buildImplementThenReviewWorkflow,
    dryRunQaapWorkflowPath,
    stepQaapWorkflow,
    validateQaapWorkflowDef,
    type QaapWorkflowDef,
} from './qaap-workflow-ir';

describe('validateQaapWorkflowDef', () => {
    it('accepts the implement-then-review product template', () => {
        const result = validateQaapWorkflowDef(buildImplementThenReviewWorkflow());
        expect(result.ok).to.equal(true);
        expect(result.issues).to.deep.equal([]);
    });

    it('rejects a router node, which has no policy engine to report an outcome', () => {
        const def: QaapWorkflowDef = {
            id: 'routed', version: 1, name: 'Routed', entry: 'pick',
            nodes: [
                { kind: 'router', id: 'pick', policyId: 'cheapest-first' },
                { kind: 'emit', id: 'done', bindingKey: 'result' },
            ],
            edges: [{ from: 'pick', to: 'done', when: 'always' }],
        };
        const result = validateQaapWorkflowDef(def);
        expect(result.ok).to.equal(false);
        expect(result.issues.map(issue => issue.message).join(' ')).to.contain('not executable yet');
    });

    it('rejects unknown entry and duplicate ids', () => {
        const def: QaapWorkflowDef = {
            id: 'bad',
            version: 1,
            name: 'Bad',
            entry: 'missing',
            nodes: [
                { kind: 'emit', id: 'a', bindingKey: 'x' },
                { kind: 'emit', id: 'a', bindingKey: 'y' },
            ],
            edges: [],
        };
        const result = validateQaapWorkflowDef(def);
        expect(result.ok).to.equal(false);
        expect(result.issues.some(i => i.path === 'entry')).to.equal(true);
        expect(result.issues.some(i => i.message.includes('Duplicate'))).to.equal(true);
    });

    it('rejects judge nodes that are not cwd-readonly', () => {
        const def = buildImplementThenReviewWorkflow();
        const nodes = def.nodes.map(node =>
            node.id === 'judge' && node.kind === 'agent-turn'
                ? { ...node, isolation: 'cwd' as const }
                : node,
        );
        const result = validateQaapWorkflowDef({ ...def, nodes });
        expect(result.ok).to.equal(false);
        expect(result.issues.some(i => i.message.includes('cwd-readonly'))).to.equal(true);
    });

    it('accepts sequential cwd writers such as implement → fix', () => {
        const def: QaapWorkflowDef = {
            id: 'seq',
            version: 1,
            name: 'Implement then fix',
            entry: 'implement',
            nodes: [
                { kind: 'agent-turn', id: 'implement', capability: 'implement', isolation: 'cwd', promptRef: 'task' },
                { kind: 'agent-turn', id: 'fix', capability: 'implement', isolation: 'cwd', promptRef: 'fix' },
                { kind: 'emit', id: 'done', bindingKey: 'x' },
            ],
            edges: [
                { from: 'implement', to: 'fix', when: 'fail' },
                { from: 'implement', to: 'done', when: 'success' },
                { from: 'fix', to: 'done', when: 'always' },
            ],
        };
        expect(validateQaapWorkflowDef(def)).to.deep.equal({ ok: true, issues: [] });
    });

    it('rejects a fan-out whose sibling branches both write the shared cwd', () => {
        const def: QaapWorkflowDef = {
            id: 'fan',
            version: 1,
            name: 'Racing writers',
            entry: 'plan',
            nodes: [
                { kind: 'deterministic', id: 'plan', op: 'parse-sentinel' },
                { kind: 'agent-turn', id: 'left', capability: 'implement', isolation: 'cwd', promptRef: 'a' },
                { kind: 'agent-turn', id: 'right', capability: 'implement', isolation: 'cwd', promptRef: 'b' },
                { kind: 'emit', id: 'done', bindingKey: 'x' },
            ],
            edges: [
                { from: 'plan', to: 'left', when: 'success' },
                { from: 'plan', to: 'right', when: 'success' },
                { from: 'left', to: 'done', when: 'always' },
                { from: 'right', to: 'done', when: 'always' },
            ],
        };
        const result = validateQaapWorkflowDef(def);
        expect(result.ok).to.equal(false);
        expect(result.issues.some(i => i.message.includes('concurrently on isolation "cwd"'))).to.equal(true);
    });

    // The isolation union used to carry a `worktree` value, and this suite used to assert that it
    // let a concurrent-writer fan-out through. Nothing ever read it: such a node was dispatched on
    // the run's own cwd like any other writer, so the escape hatch silenced the error and left both
    // turns writing the same tree. There is no remedy to point at, so the fan-out is simply refused.
    it('rejects a fan-out that runs two writers at once, with no isolation escape hatch', () => {
        const def: QaapWorkflowDef = {
            id: 'fan-writers',
            version: 1,
            name: 'Parallel run',
            entry: 'plan',
            nodes: [
                { kind: 'deterministic', id: 'plan', op: 'parse-sentinel' },
                { kind: 'agent-turn', id: 'left', capability: 'implement', isolation: 'cwd', promptRef: 'a' },
                { kind: 'agent-turn', id: 'right', capability: 'implement', isolation: 'cwd', promptRef: 'b' },
                { kind: 'join', id: 'join', wait: 'all' },
                { kind: 'emit', id: 'done', bindingKey: 'x' },
            ],
            edges: [
                { from: 'plan', to: 'left', when: 'success' },
                { from: 'plan', to: 'right', when: 'success' },
                { from: 'left', to: 'join', when: 'always' },
                { from: 'right', to: 'join', when: 'always' },
                { from: 'join', to: 'done', when: 'always' },
            ],
        };
        const result = validateQaapWorkflowDef(def);
        expect(result.ok).to.equal(false);
        const message = result.issues.map(issue => issue.message).join(' ');
        expect(message).to.include('"left"');
        expect(message).to.include('"right"');
        // Never advertise an isolation mode that does not isolate.
        expect(message).to.not.include('worktree');
    });

    it('ignores a cwd writer on the branch suffix the fan-out reconverges into', () => {
        const def: QaapWorkflowDef = {
            id: 'reconverge',
            version: 1,
            name: 'Explore then implement once',
            entry: 'plan',
            nodes: [
                { kind: 'deterministic', id: 'plan', op: 'parse-sentinel' },
                { kind: 'agent-turn', id: 'left', capability: 'explore', isolation: 'cwd-readonly', promptRef: 'a' },
                { kind: 'agent-turn', id: 'right', capability: 'explore', isolation: 'cwd-readonly', promptRef: 'b' },
                { kind: 'join', id: 'join', wait: 'all' },
                { kind: 'agent-turn', id: 'implement', capability: 'implement', isolation: 'cwd', promptRef: 'c' },
                { kind: 'emit', id: 'done', bindingKey: 'x' },
            ],
            edges: [
                { from: 'plan', to: 'left', when: 'success' },
                { from: 'plan', to: 'right', when: 'success' },
                { from: 'left', to: 'join', when: 'always' },
                { from: 'right', to: 'join', when: 'always' },
                { from: 'join', to: 'implement', when: 'always' },
                { from: 'implement', to: 'done', when: 'always' },
            ],
        };
        expect(validateQaapWorkflowDef(def)).to.deep.equal({ ok: true, issues: [] });
    });
});

describe('buildImplementThenReviewWorkflow', () => {
    it('wires implement → risk → judge with sentinel on the judge', () => {
        const def = buildImplementThenReviewWorkflow({
            implementAgentRef: 'qaiq',
            judgeAgentRef: 'codex',
        });
        const implement = def.nodes.find(n => n.id === 'implement');
        const judge = def.nodes.find(n => n.id === 'judge');
        expect(implement?.kind).to.equal('agent-turn');
        expect(judge?.kind).to.equal('agent-turn');
        if (implement?.kind === 'agent-turn' && judge?.kind === 'agent-turn') {
            expect(implement.agentRef).to.equal('qaiq');
            expect(implement.capability).to.equal('implement');
            expect(judge.agentRef).to.equal('codex');
            expect(judge.capability).to.equal('judge');
            expect(judge.isolation).to.equal('cwd-readonly');
            expect(judge.requireSentinel).to.equal(true);
        }
    });
});

describe('buildEvidenceAuditWorkflow', () => {
    it('fans out three read-only investigators before synthesis and independent review', () => {
        const def = buildEvidenceAuditWorkflow();
        expect(validateQaapWorkflowDef(def)).to.deep.equal({ ok: true, issues: [] });
        expect(def.entry).to.deep.equal(['audit-auth', 'audit-inputs', 'audit-integrations']);
        const judge = def.nodes.find(node => node.id === 'audit-judge');
        expect(judge?.kind === 'agent-turn' && judge.requireSentinel).to.equal(true);
        expect(def.edges).to.deep.include({ from: 'audit-mapped', to: 'audit-synthesis', when: 'always' });
        expect(def.edges).to.deep.include({ from: 'audit-synthesis', to: 'audit-judge', when: 'success' });
    });

    it('revises a rejected report and re-enters the judge', () => {
        const def = buildEvidenceAuditWorkflow();
        expect(def.edges).to.deep.include({ from: 'audit-judge', to: 'audit-revise', when: 'verdict:fail' });
        expect(def.edges).to.deep.include({ from: 'audit-revise', to: 'audit-judge', when: 'success' });
    });
});

describe('stepQaapWorkflow / dryRunQaapWorkflowPath', () => {
    it('skips review on low-risk success path', () => {
        const def = buildImplementThenReviewWorkflow();
        const path = dryRunQaapWorkflowPath(def, {
            implement: 'success',
            'risk-classify': 'risk:low',
        });
        expect(path).to.deep.equal(['implement', 'risk-classify', 'done-skip']);
    });

    it('runs high-risk path through judge to pass', () => {
        const def = buildImplementThenReviewWorkflow();
        const path = dryRunQaapWorkflowPath(def, {
            implement: 'success',
            'risk-classify': 'risk:high',
            'git-diff': 'success',
            judge: 'verdict:pass',
        });
        expect(path).to.deep.equal([
            'implement',
            'risk-classify',
            'git-diff',
            'judge',
            'done-pass',
        ]);
    });

    it('routes judge fail verdict to done-fail', () => {
        const def = buildImplementThenReviewWorkflow();
        const path = dryRunQaapWorkflowPath(def, {
            implement: 'success',
            'risk-classify': 'risk:high',
            'git-diff': 'success',
            judge: 'verdict:fail',
        });
        expect(path[path.length - 1]).to.equal('done-fail');
    });

    it('ends when implement is blocked without entering the judge', () => {
        const def = buildImplementThenReviewWorkflow();
        const step = stepQaapWorkflow(def, ['implement'], 'implement', 'blocked');
        expect(step.done).to.equal(true);
        expect(step.next).to.deep.equal(['done-skip']);
        expect(step.terminalReason).to.equal('emit');
    });
});
