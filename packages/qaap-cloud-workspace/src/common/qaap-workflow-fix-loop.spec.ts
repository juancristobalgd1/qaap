// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_AGENT_REVIEW_VERDICT_MARKER } from './qaap-agent-review';
import {
    buildImplementThenReviewWorkflow,
    QAAP_WORKFLOW_REVIEW_DIFF_ARTIFACT,
    QAAP_WORKFLOW_REVIEW_VERDICT_ARTIFACT,
    QAAP_WORKFLOW_VERIFY_FAILURE_ARTIFACT,
    stepQaapWorkflow,
    validateQaapWorkflowDef,
    type QaapWorkflowAgentTurnNode,
    type QaapWorkflowDef,
    type QaapWorkflowDeterministicNode,
    type QaapWorkflowNodeOutcome,
} from './qaap-workflow-ir';
import { QaapWorkflowPromptRegistry } from './qaap-workflow-prompt-registry';
import {
    advanceQaapWorkflowRun,
    DEFAULT_QAAP_WORKFLOW_RUN_BUDGET,
    startQaapWorkflowRun,
    type QaapWorkflowRun,
} from './qaap-workflow-run';
import { QaapWorkflowTemplateRegistry } from './qaap-workflow-template-registry';

function agentTurn(def: QaapWorkflowDef, id: string): QaapWorkflowAgentTurnNode {
    const node = def.nodes.find(candidate => candidate.id === id);
    expect(node?.kind, `node ${id}`).to.equal('agent-turn');
    return node as QaapWorkflowAgentTurnNode;
}

function deterministic(def: QaapWorkflowDef, id: string): QaapWorkflowDeterministicNode {
    const node = def.nodes.find(candidate => candidate.id === id);
    expect(node?.kind, `node ${id}`).to.equal('deterministic');
    return node as QaapWorkflowDeterministicNode;
}

/**
 * Drive a run to termination, answering whichever node is on the frontier with a fixed outcome.
 * Returns the final state plus how many reports it took, so a test can tell "terminated" from
 * "the guard gave up".
 */
function driveToTermination(
    def: QaapWorkflowDef,
    run: QaapWorkflowRun,
    outcomes: Readonly<Record<string, QaapWorkflowNodeOutcome>>,
    guardLimit = 400,
): { readonly run: QaapWorkflowRun; readonly reports: number } {
    let state = run;
    let reports = 0;
    while (state.status === 'running' && reports < guardLimit) {
        const nodeId = state.active[0];
        const outcome = outcomes[nodeId];
        expect(outcome, `no outcome declared for node "${nodeId}"`).to.not.equal(undefined);
        state = advanceQaapWorkflowRun(def, state, nodeId, outcome).run;
        reports++;
    }
    return { run: state, reports };
}

describe('verification failure reaches the turn that must fix it', () => {
    it('makes the verify node publish what failed, like every other node with a product', () => {
        const def = buildImplementThenReviewWorkflow({ withVerify: true });
        // Without an artifactKey the 64 KB the verify function captures is computed and thrown away,
        // which is exactly what the git-diff node used to do to the reviewer's diff.
        expect(deterministic(def, 'verify').artifactKey).to.equal(QAAP_WORKFLOW_VERIFY_FAILURE_ARTIFACT);
        expect(validateQaapWorkflowDef(def)).to.deep.include({ ok: true });
    });

    it('publishes it on the goal shape too, where the fix loop is the whole point', () => {
        expect(deterministic(buildImplementThenReviewWorkflow({ withGoal: true }), 'verify').artifactKey)
            .to.equal(QAAP_WORKFLOW_VERIFY_FAILURE_ARTIFACT);
    });

    describe('prompts', () => {
        let registry: QaapWorkflowPromptRegistry;
        beforeEach(() => registry = new QaapWorkflowPromptRegistry());

        const failure = '`npm run build` failed:\n\nsrc/cart.ts(12,5): error TS2345: string is not number';

        for (const ref of ['fix-verification', 'fix-goal'] as const) {
            it(`inlines the failing output into "${ref}"`, () => {
                const prompt = registry.resolve(ref, {
                    inputs: { task: 'add a discount', checkScript: 'build' },
                    bindings: {},
                    artifacts: { [QAAP_WORKFLOW_VERIFY_FAILURE_ARTIFACT]: failure },
                });
                expect(prompt).to.contain('error TS2345');
                expect(prompt).to.contain('src/cart.ts(12,5)');
                expect(prompt).to.contain('add a discount');
            });

            it(`tells "${ref}" to go and get the output when nothing was captured`, () => {
                const prompt = registry.resolve(ref, { inputs: { task: 'add a discount' }, bindings: {} });
                expect(prompt).to.contain('was not captured');
                expect(prompt).to.contain('Run the check yourself');
            });
        }

        it('redacts a verdict marker a failing test printed on its way into the fix turn', () => {
            const prompt = registry.resolve('fix-verification', {
                inputs: { task: 'add a discount' },
                bindings: {},
                artifacts: { [QAAP_WORKFLOW_VERIFY_FAILURE_ARTIFACT]: `expected ${QAAP_AGENT_REVIEW_VERDICT_MARKER} pass` },
            });
            expect(prompt).to.not.contain(QAAP_AGENT_REVIEW_VERDICT_MARKER);
        });
    });
});

describe('review fix-loop topology', () => {
    const loopDef = (extra?: Parameters<typeof buildImplementThenReviewWorkflow>[0]): QaapWorkflowDef =>
        buildImplementThenReviewWorkflow({ reviewMode: 'high-risk', withReviewFixLoop: true, ...extra });

    it('is off by default, so a rejected run still ends where the runner ends it', () => {
        for (const def of [
            buildImplementThenReviewWorkflow(),
            buildImplementThenReviewWorkflow({ withVerify: true }),
            buildImplementThenReviewWorkflow({ withMultiLensReview: true }),
        ]) {
            expect(def.nodes.map(node => node.id), def.id).to.not.include('implement-review-fix');
            const verdictNode = def.nodes.some(node => node.id === 'review-synthesis') ? 'review-synthesis' : 'judge';
            expect(def.edges).to.deep.include({ from: verdictNode, to: 'done-fail', when: 'verdict:fail' });
        }
    });

    it('keeps the reviewer verdict, so the fix turn can be told what was wrong', () => {
        expect(agentTurn(buildImplementThenReviewWorkflow(), 'judge').artifactKey)
            .to.equal(QAAP_WORKFLOW_REVIEW_VERDICT_ARTIFACT);
        expect(agentTurn(buildImplementThenReviewWorkflow({ withMultiLensReview: true }), 'review-synthesis').artifactKey)
            .to.equal(QAAP_WORKFLOW_REVIEW_VERDICT_ARTIFACT);
    });

    it('sends a rejection into a fix turn instead of a terminal node', () => {
        const def = loopDef();
        expect(def.edges).to.deep.include({ from: 'judge', to: 'implement-review-fix', when: 'verdict:fail' });
        // Both edges at once would fan the rejection out to a fix turn AND a terminal emit.
        expect(def.edges).to.not.deep.include({ from: 'judge', to: 'done-fail', when: 'verdict:fail' });
        expect(validateQaapWorkflowDef(def)).to.deep.equal({ ok: true, issues: [] });
    });

    it('re-captures the diff and judges again, without passing back through the risk gate', () => {
        const def = loopDef();
        // Re-classifying could report risk:low on the fixed tree and route to `done-skip`, ending a
        // REJECTED run as "review skipped".
        expect(def.edges).to.deep.include({ from: 'implement-review-fix', to: 'git-diff', when: 'success' });
        expect(def.edges.filter(edge => edge.from === 'implement-review-fix' && edge.to === 'risk-classify')).to.deep.equal([]);
        expect(def.edges).to.deep.include({ from: 'implement-review-fix', to: 'done-fail', when: 'fail' });
        expect(def.edges).to.deep.include({ from: 'implement-review-fix', to: 'done-fail', when: 'blocked' });
    });

    it('gives the fix turn a write isolation and a prompt of its own', () => {
        const node = agentTurn(loopDef({ withVerify: true }), 'implement-review-fix');
        expect(node.isolation).to.equal('cwd');
        expect(node.capability).to.equal('implement');
        // Not `fix-verification`: that prompt claims the build is red, which is not why we are here —
        // and with `withVerify` off the verification fix turn does not exist at all.
        expect(node.promptRef).to.equal('fix-review');
        expect(loopDef().nodes.map(node2 => node2.id)).to.not.include('implement-fix');
    });

    it('hangs the loop off the synthesis turn in a multi-lens review, never off a lens', () => {
        const def = loopDef({ withMultiLensReview: true });
        expect(def.edges).to.deep.include({ from: 'review-synthesis', to: 'implement-review-fix', when: 'verdict:fail' });
        expect(def.edges.filter(edge => edge.to === 'implement-review-fix'))
            .to.deep.equal([{ from: 'review-synthesis', to: 'implement-review-fix', when: 'verdict:fail' }]);
        expect(validateQaapWorkflowDef(def)).to.deep.equal({ ok: true, issues: [] });
    });

    it('adds nothing when reviewing is off — there is no verdict to loop on', () => {
        const def = loopDef({ reviewMode: 'off' });
        expect(def.nodes.map(node => node.id)).to.not.include('implement-review-fix');
        expect(validateQaapWorkflowDef(def)).to.deep.include({ ok: true });
    });

    it('leaves every verdict outcome with somewhere to go', () => {
        const def = loopDef();
        for (const outcome of ['verdict:pass', 'verdict:fail', 'verdict:inconclusive', 'fail'] as const) {
            const step = stepQaapWorkflow(def, ['judge'], 'judge', outcome);
            expect(step.next, outcome).to.have.lengthOf(1);
            expect(step.terminalReason, outcome).to.not.equal('no-edge');
        }
        for (const outcome of ['success', 'fail', 'blocked'] as const) {
            const step = stepQaapWorkflow(def, ['implement-review-fix'], 'implement-review-fix', outcome);
            expect(step.next, outcome).to.have.lengthOf(1);
        }
    });
});

describe('review fix-loop runs', () => {
    const def = buildImplementThenReviewWorkflow({ reviewMode: 'high-risk', withReviewFixLoop: true });

    it('repairs a rejected change and passes on the second review', () => {
        let state = startQaapWorkflowRun(def, { runId: 'f1' }).run;
        state = advanceQaapWorkflowRun(def, state, 'implement', 'success').run;
        state = advanceQaapWorkflowRun(def, state, 'risk-classify', 'risk:high').run;
        state = advanceQaapWorkflowRun(def, state, 'git-diff', 'success').run;

        const rejected = advanceQaapWorkflowRun(def, state, 'judge', 'verdict:fail');
        expect(rejected.dispatch).to.deep.equal(['implement-review-fix']);
        expect(rejected.run.status).to.equal('running');

        const recaptured = advanceQaapWorkflowRun(def, rejected.run, 'implement-review-fix', 'success');
        expect(recaptured.dispatch).to.deep.equal(['git-diff']);
        const rejudged = advanceQaapWorkflowRun(def, recaptured.run, 'git-diff', 'success');
        expect(rejudged.dispatch).to.deep.equal(['judge']);

        const final = advanceQaapWorkflowRun(def, rejudged.run, 'judge', 'verdict:pass');
        expect(final.run.status).to.equal('succeeded');
        expect(final.run.bindings).to.have.property('review.passed');
        expect(final.run.visits.judge).to.equal(2);
        expect(final.run.visits['implement-review-fix']).to.equal(1);
    });

    it('ends rejected when the fix turn itself cannot run', () => {
        let state = startQaapWorkflowRun(def, { runId: 'f2' }).run;
        state = advanceQaapWorkflowRun(def, state, 'implement', 'success').run;
        state = advanceQaapWorkflowRun(def, state, 'risk-classify', 'risk:high').run;
        state = advanceQaapWorkflowRun(def, state, 'git-diff', 'success').run;
        state = advanceQaapWorkflowRun(def, state, 'judge', 'verdict:fail').run;

        const dead = advanceQaapWorkflowRun(def, state, 'implement-review-fix', 'blocked');
        expect(dead.run.status).to.equal('failed');
        expect(dead.run.active).to.deep.equal([]);
        expect(dead.run.bindings).to.have.property('review.failed');
    });

    it('never starts a fix turn when the reviewer passed', () => {
        let state = startQaapWorkflowRun(def, { runId: 'f3' }).run;
        state = advanceQaapWorkflowRun(def, state, 'implement', 'success').run;
        state = advanceQaapWorkflowRun(def, state, 'risk-classify', 'risk:high').run;
        state = advanceQaapWorkflowRun(def, state, 'git-diff', 'success').run;
        state = advanceQaapWorkflowRun(def, state, 'judge', 'verdict:pass').run;
        expect(state.visits).to.not.have.property('implement-review-fix');
    });

    it('terminates on the DEFAULT run budget when the reviewer never relents', () => {
        // The real budget a started run gets, not a toy one: a loop that only terminates under a
        // hand-picked budget is an unbounded loop in production.
        const started = startQaapWorkflowRun(def, { runId: 'f4' });
        expect(started.run.budget).to.deep.equal(DEFAULT_QAAP_WORKFLOW_RUN_BUDGET);

        const { run: state, reports } = driveToTermination(def, started.run, {
            implement: 'success',
            'risk-classify': 'risk:high',
            'git-diff': 'success',
            judge: 'verdict:fail',
            'implement-review-fix': 'success',
        });

        expect(state.status).to.equal('budget-exhausted');
        expect(state.terminationReason).to.be.oneOf(['max-visits', 'max-node-runs']);
        // A terminated run holds nothing: no node left active, nothing to dispatch, no live process.
        expect(state.active).to.deep.equal([]);
        expect(state.visits.judge).to.be.at.most(DEFAULT_QAAP_WORKFLOW_RUN_BUDGET.maxVisitsPerNode);
        expect(state.nodeRuns).to.be.at.most(DEFAULT_QAAP_WORKFLOW_RUN_BUDGET.maxNodeRuns);
        expect(reports).to.be.lessThan(400, 'the guard must not be what stopped it');
        // Reporting into a terminated run changes nothing, so a late runtime event cannot revive it.
        expect(advanceQaapWorkflowRun(def, state, 'judge', 'verdict:fail')).to.deep.equal({ run: state, dispatch: [] });
    });

    it('terminates on the DEFAULT budget through the multi-lens shape too', () => {
        const multiLens = buildImplementThenReviewWorkflow({
            reviewMode: 'high-risk', withReviewFixLoop: true, withMultiLensReview: true,
        });
        const { run: state, reports } = driveToTermination(multiLens, startQaapWorkflowRun(multiLens, { runId: 'f5' }).run, {
            implement: 'success',
            'risk-classify': 'risk:high',
            'git-diff': 'success',
            'judge-correctness': 'success',
            'judge-safety': 'success',
            'judge-intent': 'success',
            // The join, settled the way the dispatcher settles one (SELF_SETTLED).
            reviewed: 'success',
            'review-synthesis': 'verdict:fail',
            'implement-review-fix': 'success',
        });
        expect(state.status).to.equal('budget-exhausted');
        expect(state.active).to.deep.equal([]);
        expect(reports).to.be.lessThan(400, 'the guard must not be what stopped it');
    });

    it('terminates with the verification loop running at the same time', () => {
        // Two loops share one run budget; a red build plus a hostile reviewer must still end.
        const both = buildImplementThenReviewWorkflow({
            reviewMode: 'high-risk', withReviewFixLoop: true, withVerify: true,
        });
        const { run: state, reports } = driveToTermination(both, startQaapWorkflowRun(both, { runId: 'f6' }).run, {
            implement: 'success',
            verify: 'fail',
            'implement-fix': 'success',
            'risk-classify': 'risk:high',
            'git-diff': 'success',
            judge: 'verdict:fail',
            'implement-review-fix': 'success',
        });
        expect(state.status).to.equal('budget-exhausted');
        expect(state.active).to.deep.equal([]);
        expect(reports).to.be.lessThan(400, 'the guard must not be what stopped it');
    });
});

describe('fix-review prompt', () => {
    let registry: QaapWorkflowPromptRegistry;
    beforeEach(() => registry = new QaapWorkflowPromptRegistry());

    const objections = 'blocker | src/cart.ts:12 | the discount is applied twice';
    const diff = '--- a/src/cart.ts\n+++ b/src/cart.ts\n+ total *= 0.9;';

    it('hands the turn the objections and the diff it wrote', () => {
        const prompt = registry.resolve('fix-review', {
            inputs: { task: 'add a discount' },
            bindings: {},
            artifacts: {
                [QAAP_WORKFLOW_REVIEW_VERDICT_ARTIFACT]: objections,
                [QAAP_WORKFLOW_REVIEW_DIFF_ARTIFACT]: diff,
            },
        });
        expect(prompt).to.contain('REJECTED');
        expect(prompt).to.contain('add a discount');
        expect(prompt).to.contain('the discount is applied twice');
        // The objections point at lines of a change the turn no longer has in front of it.
        expect(prompt).to.contain('+ total *= 0.9;');
    });

    it('redacts a marker the reviewer emitted, so the fix turn cannot replay a verdict', () => {
        const prompt = registry.resolve('fix-review', {
            inputs: { task: 'add a discount' },
            bindings: {},
            artifacts: { [QAAP_WORKFLOW_REVIEW_VERDICT_ARTIFACT]: `${QAAP_AGENT_REVIEW_VERDICT_MARKER} fail ${objections}` },
        });
        expect(prompt).to.not.contain(QAAP_AGENT_REVIEW_VERDICT_MARKER);
        expect(prompt).to.contain('the discount is applied twice');
    });

    it('still asks for a fix when the verdict was lost, instead of inventing objections', () => {
        const prompt = registry.resolve('fix-review', {
            inputs: { task: 'add a discount' },
            bindings: {},
            artifacts: { [QAAP_WORKFLOW_REVIEW_DIFF_ARTIFACT]: diff },
        });
        expect(prompt).to.contain('was not captured');
        expect(prompt).to.contain('+ total *= 0.9;');
    });

    it('is a registered ref, so a graph declaring it can actually be dispatched', () => {
        expect(registry.has('fix-review')).to.equal(true);
    });
});

describe('review fix-loop as a per-run option', () => {
    class TestRegistry extends QaapWorkflowTemplateRegistry {
        protected override reviewModeEnv(): string | undefined { return 'high-risk'; }
    }

    it('is opt-in on every template and changes nothing when it is not asked for', () => {
        const registry = new TestRegistry();
        for (const summary of registry.list()) {
            const template = registry.get(summary.id)!;
            const base = template.build();
            expect(base.nodes.map(node => node.id), `${summary.id} default`)
                .to.not.include('implement-review-fix');
            const looped = template.build({ reviewFix: true });
            // The review fix-loop repairs code a judge rejected, so it only attaches to a template
            // that has an implement phase. An audit-only template (explore → synthesize → judge,
            // no writer) has nothing to fix, so asking for the loop is a no-op there rather than an
            // error — the contract is "every template that implements", not "every template".
            const implementsCode = base.nodes.some(node => node.kind === 'agent-turn' && node.capability === 'implement');
            const loopedIds = looped.nodes.map(node => node.id);
            if (implementsCode) {
                expect(loopedIds, `${summary.id} with reviewFix`).to.include('implement-review-fix');
            } else {
                expect(loopedIds, `${summary.id} with reviewFix (audit-only, nothing to fix)`).to.not.include('implement-review-fix');
            }
            expect(validateQaapWorkflowDef(looped), `${summary.id} with reviewFix`).to.deep.include({ ok: true });
        }
    });
});
