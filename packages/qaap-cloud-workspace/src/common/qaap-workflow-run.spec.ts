// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { buildImplementThenReviewWorkflow, type QaapWorkflowDef } from './qaap-workflow-ir';
import {
    advanceQaapWorkflowRun,
    startQaapWorkflowRun,
    type QaapWorkflowRun,
} from './qaap-workflow-run';

function fanOutDef(wait: 'all' | 'any' | 'n', n?: number): QaapWorkflowDef {
    return {
        id: 'fan',
        version: 1,
        name: 'Fan out then join',
        entry: 'plan',
        nodes: [
            { kind: 'deterministic', id: 'plan', op: 'parse-sentinel' },
            { kind: 'agent-turn', id: 'left', capability: 'explore', isolation: 'cwd-readonly', promptRef: 'a' },
            { kind: 'agent-turn', id: 'right', capability: 'explore', isolation: 'cwd-readonly', promptRef: 'b' },
            { kind: 'join', id: 'join', wait, n },
            { kind: 'agent-turn', id: 'synthesize', capability: 'synthesize', isolation: 'cwd-readonly', promptRef: 'c' },
            { kind: 'emit', id: 'done', bindingKey: 'advice' },
        ],
        edges: [
            { from: 'plan', to: 'left', when: 'success' },
            { from: 'plan', to: 'right', when: 'success' },
            { from: 'left', to: 'join', when: 'always' },
            { from: 'right', to: 'join', when: 'always' },
            { from: 'join', to: 'synthesize', when: 'always' },
            { from: 'synthesize', to: 'done', when: 'always' },
        ],
    };
}

describe('startQaapWorkflowRun', () => {
    it('dispatches the entry node and counts the visit', () => {
        const def = buildImplementThenReviewWorkflow();
        const { run, dispatch } = startQaapWorkflowRun(def, { runId: 'r1' });
        expect(dispatch).to.deep.equal(['implement']);
        expect(run.status).to.equal('running');
        expect(run.active).to.deep.equal(['implement']);
        expect(run.visits).to.deep.equal({ implement: 1 });
        expect(run.nodeRuns).to.equal(1);
    });
});

describe('advanceQaapWorkflowRun', () => {
    it('walks the review template to a pass verdict and records the binding', () => {
        const def = buildImplementThenReviewWorkflow();
        let state = startQaapWorkflowRun(def, { runId: 'r1' }).run;
        state = advanceQaapWorkflowRun(def, state, 'implement', 'success').run;
        state = advanceQaapWorkflowRun(def, state, 'risk-classify', 'risk:high').run;
        state = advanceQaapWorkflowRun(def, state, 'git-diff', 'success').run;
        const final = advanceQaapWorkflowRun(def, state, 'judge', 'verdict:pass', 'artifacts/review.json');

        expect(final.dispatch).to.deep.equal([]);
        expect(final.run.status).to.equal('succeeded');
        expect(final.run.active).to.deep.equal([]);
        expect(final.run.bindings).to.deep.equal({ 'review.passed': 'artifacts/review.json' });
    });

    it('marks a blocked implement turn as failed', () => {
        const def = buildImplementThenReviewWorkflow();
        const started = startQaapWorkflowRun(def, { runId: 'r2' });
        const final = advanceQaapWorkflowRun(def, started.run, 'implement', 'blocked');
        expect(final.run.status).to.equal('failed');
        expect(final.run.bindings).to.have.property('review.skipped');
    });

    it('holds a wait-all join until every branch arrives', () => {
        const def = fanOutDef('all');
        let state = startQaapWorkflowRun(def, { runId: 'r3' }).run;
        const fan = advanceQaapWorkflowRun(def, state, 'plan', 'success');
        expect(fan.dispatch).to.deep.equal(['left', 'right']);
        state = fan.run;

        const first = advanceQaapWorkflowRun(def, state, 'left', 'success');
        expect(first.dispatch).to.deep.equal([]);
        expect(first.run.status).to.equal('running');
        expect(first.run.active).to.deep.equal(['right']);

        const second = advanceQaapWorkflowRun(def, first.run, 'right', 'success');
        expect(second.dispatch).to.deep.equal(['join']);
        expect(second.run.joinArrivals.join).to.deep.equal(['left', 'right']);
    });

    it('fires a wait-any join on the first arrival and ignores the straggler', () => {
        const def = fanOutDef('any');
        let state = advanceQaapWorkflowRun(def, startQaapWorkflowRun(def, { runId: 'r4' }).run, 'plan', 'success').run;
        const first = advanceQaapWorkflowRun(def, state, 'left', 'success');
        expect(first.dispatch).to.deep.equal(['join']);
        state = first.run;

        const straggler = advanceQaapWorkflowRun(def, state, 'right', 'success');
        expect(straggler.dispatch).to.deep.equal([]);
        expect(straggler.run.firedJoins).to.deep.equal(['join']);
    });

    it('detects a stalled wait-all join when the last live branch dies', () => {
        const def: QaapWorkflowDef = {
            ...fanOutDef('all'),
            edges: [
                { from: 'plan', to: 'left', when: 'success' },
                { from: 'plan', to: 'right', when: 'success' },
                { from: 'left', to: 'join', when: 'success' },
                { from: 'right', to: 'join', when: 'success' },
                { from: 'join', to: 'synthesize', when: 'always' },
                { from: 'synthesize', to: 'done', when: 'always' },
            ],
        };
        let state = advanceQaapWorkflowRun(def, startQaapWorkflowRun(def, { runId: 'r5' }).run, 'plan', 'success').run;
        state = advanceQaapWorkflowRun(def, state, 'left', 'success').run;
        const dead = advanceQaapWorkflowRun(def, state, 'right', 'fail');
        expect(dead.run.status).to.equal('failed');
        expect(dead.run.terminationReason).to.equal('stalled');
    });

    it('stops a cycle once a node exhausts its visit budget', () => {
        const def: QaapWorkflowDef = {
            id: 'loop',
            version: 1,
            name: 'Fix loop',
            entry: 'implement',
            nodes: [
                { kind: 'agent-turn', id: 'implement', capability: 'implement', isolation: 'cwd', promptRef: 'a' },
                { kind: 'deterministic', id: 'verify', op: 'verify' },
                { kind: 'emit', id: 'done', bindingKey: 'ok' },
            ],
            edges: [
                { from: 'implement', to: 'verify', when: 'always' },
                { from: 'verify', to: 'implement', when: 'fail' },
                { from: 'verify', to: 'done', when: 'success' },
            ],
        };
        let state: QaapWorkflowRun = startQaapWorkflowRun(def, {
            runId: 'r6',
            budget: { maxNodeRuns: 64, maxVisitsPerNode: 3 },
        }).run;
        let guard = 0;
        while (state.status === 'running' && guard++ < 20) {
            state = advanceQaapWorkflowRun(def, state, 'implement', 'success').run;
            if (state.status !== 'running') {
                break;
            }
            state = advanceQaapWorkflowRun(def, state, 'verify', 'fail').run;
        }
        expect(state.status).to.equal('budget-exhausted');
        expect(state.terminationReason).to.equal('max-visits');
        expect(state.visits.implement).to.equal(3);
    });

    it('parks the run on a human gate and resumes on continue', () => {
        const def: QaapWorkflowDef = {
            id: 'gate',
            version: 1,
            name: 'Gated deploy',
            entry: 'implement',
            nodes: [
                { kind: 'agent-turn', id: 'implement', capability: 'implement', isolation: 'cwd', promptRef: 'a' },
                { kind: 'human-gate', id: 'gate', reasonRef: 'confirm-deploy' },
                { kind: 'emit', id: 'done', bindingKey: 'deployed' },
            ],
            edges: [
                { from: 'implement', to: 'gate', when: 'success' },
                { from: 'gate', to: 'done', when: 'human:continue' },
            ],
        };
        const started = startQaapWorkflowRun(def, { runId: 'r7' });
        const gated = advanceQaapWorkflowRun(def, started.run, 'implement', 'success');
        expect(gated.dispatch).to.deep.equal(['gate']);
        expect(gated.run.status).to.equal('awaiting-human');

        const resumed = advanceQaapWorkflowRun(def, gated.run, 'gate', 'human:continue');
        expect(resumed.run.status).to.equal('succeeded');
        expect(resumed.run.bindings).to.have.property('deployed');
    });

    it('ignores outcomes reported after the run finished', () => {
        const def = buildImplementThenReviewWorkflow();
        const started = startQaapWorkflowRun(def, { runId: 'r8' });
        const finished = advanceQaapWorkflowRun(def, started.run, 'implement', 'fail').run;
        const late = advanceQaapWorkflowRun(def, finished, 'implement', 'success');
        expect(late.run).to.equal(finished);
        expect(late.dispatch).to.deep.equal([]);
    });
});
