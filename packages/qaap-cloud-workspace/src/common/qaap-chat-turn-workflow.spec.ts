// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapAgentTaskState } from './qaap-agent-task';
import {
    QAAP_CHAT_TURN_NODE,
    QAAP_CHAT_TURN_WORKFLOW_ID,
    buildChatTurnWorkflow,
    resolveChatTurnOutcome,
    resolveChatTurnRunBudget,
} from './qaap-chat-turn-workflow';
import { QaapWorkflowDef, stepQaapWorkflow, validateQaapWorkflowDef } from './qaap-workflow-ir';
import { QaapWorkflowRun, advanceQaapWorkflowRun, startQaapWorkflowRun } from './qaap-workflow-run';

/** Start a chat-turn run and report the given outcome for the entry turn node. */
function settleTurn(outcome: Parameters<typeof advanceQaapWorkflowRun>[3]): QaapWorkflowRun {
    const def = buildChatTurnWorkflow();
    const started = startQaapWorkflowRun(def, { runId: 'run-1', budget: resolveChatTurnRunBudget(1) });
    expect(started.dispatch).to.deep.equal([QAAP_CHAT_TURN_NODE]);
    return advanceQaapWorkflowRun(def, started.run, QAAP_CHAT_TURN_NODE, outcome).run;
}

describe('qaap-chat-turn-workflow (ADR-002)', () => {

    it('builds a valid definition', () => {
        const def = buildChatTurnWorkflow();
        expect(def.id).to.equal(QAAP_CHAT_TURN_WORKFLOW_ID);
        const validation = validateQaapWorkflowDef(def);
        expect(validation.issues).to.deep.equal([]);
        expect(validation.ok).to.be.true;
    });

    // Conformance mini-matrix: the graph terminal must match the conversation store's decision for
    // every task terminal state (delivered / failed / blocked), including the state the review
    // resolver maps differently.
    const CONFORMANCE: ReadonlyArray<{ state: QaapAgentTaskState; binding: string }> = [
        { state: 'completed', binding: 'turn.delivered' },
        // The chat's key divergence from resolveAgentTurnOutcome: a clean exit with red
        // self-verification is a DELIVERED turn (warning trace), never a failure to retry.
        { state: 'completed_with_warnings', binding: 'turn.delivered' },
        { state: 'failed', binding: 'turn.failed' },
        { state: 'interrupted', binding: 'turn.failed' },
        { state: 'blocked', binding: 'turn.blocked' },
        { state: 'cancelled', binding: 'turn.blocked' },
    ];
    for (const { state, binding } of CONFORMANCE) {
        it(`settles a '${state}' task on the ${binding} emit, like the imperative store`, () => {
            const run = settleTurn(resolveChatTurnOutcome(state));
            expect(run.status).to.not.equal('running');
            expect(run.bindings).to.have.property(binding);
        });
    }

    it('re-visits the same turn node on resume:restart and keeps the run running', () => {
        const def = buildChatTurnWorkflow();
        const started = startQaapWorkflowRun(def, { runId: 'run-2', budget: resolveChatTurnRunBudget(1) });
        const resumed = advanceQaapWorkflowRun(def, started.run, QAAP_CHAT_TURN_NODE, 'resume:restart');
        expect(resumed.dispatch).to.deep.equal([QAAP_CHAT_TURN_NODE]);
        expect(resumed.run.status).to.equal('running');
        expect(resumed.run.visits[QAAP_CHAT_TURN_NODE]).to.equal(2);
        // The re-dispatched turn then settles normally.
        const settled = advanceQaapWorkflowRun(def, resumed.run, QAAP_CHAT_TURN_NODE, 'success');
        expect(settled.run.bindings).to.have.property('turn.delivered');
    });

    it('bounds runaway resumes with the visit backstop even if the product ceiling miscounts', () => {
        const def = buildChatTurnWorkflow();
        const budget = resolveChatTurnRunBudget(1);
        let state = startQaapWorkflowRun(def, { runId: 'run-3', budget });
        for (let i = 0; i < budget.maxVisitsPerNode + 1 && state.run.status === 'running'; i++) {
            state = advanceQaapWorkflowRun(def, state.run, QAAP_CHAT_TURN_NODE, 'resume:restart');
        }
        expect(state.run.status).to.equal('budget-exhausted');
    });

    it('scales the backstop above a raised QAAP_MAX_RESTART_RESUMES ceiling', () => {
        expect(resolveChatTurnRunBudget(1).maxVisitsPerNode).to.be.at.least(3);
        expect(resolveChatTurnRunBudget(5).maxVisitsPerNode).to.be.at.least(7);
        // Nonsense input falls back to the default ceiling instead of a zero budget.
        expect(resolveChatTurnRunBudget(Number.NaN).maxVisitsPerNode).to.be.at.least(3);
        // No wall clocks: the imperative watchdog stays the one executioner until its piece.
        expect(resolveChatTurnRunBudget(1).maxNodeMs).to.equal(undefined);
        expect(resolveChatTurnRunBudget(1).maxRunMs).to.equal(undefined);
    });

    describe('rich-outcome degradation for pre-ADR-002 definitions', () => {
        const legacy: QaapWorkflowDef = {
            id: 'legacy.def',
            version: 1,
            name: 'Legacy',
            entry: 'work',
            nodes: [
                { kind: 'agent-turn', id: 'work', capability: 'implement', isolation: 'cwd', promptRef: 'user-task' },
                { kind: 'emit', id: 'done', bindingKey: 'done' },
                { kind: 'emit', id: 'broken', bindingKey: 'broken' },
            ],
            edges: [
                { from: 'work', to: 'done', when: 'success' },
                { from: 'work', to: 'broken', when: 'fail' },
            ],
        };

        it('routes resume:restart along the fail edge when no resume edge is declared', () => {
            const step = stepQaapWorkflow(legacy, ['work'], 'work', 'resume:restart');
            expect(step.next).to.deep.equal(['broken']);
        });

        it('routes success:warned along the fail edge, matching resolveAgentTurnOutcome', () => {
            const step = stepQaapWorkflow(legacy, ['work'], 'work', 'success:warned');
            expect(step.next).to.deep.equal(['broken']);
        });

        it('routes continue:auto along the success edge', () => {
            const step = stepQaapWorkflow(legacy, ['work'], 'work', 'continue:auto');
            expect(step.next).to.deep.equal(['done']);
        });

        it('prefers a declared rich edge over the degraded base edge', () => {
            const rich: QaapWorkflowDef = {
                ...legacy,
                edges: [...legacy.edges, { from: 'work', to: 'done', when: 'resume:restart' }],
            };
            const step = stepQaapWorkflow(rich, ['work'], 'work', 'resume:restart');
            expect(step.next).to.deep.equal(['done']);
        });

        it('still ends no-edge when neither the rich outcome nor its base is routable', () => {
            const bare: QaapWorkflowDef = {
                ...legacy,
                edges: [{ from: 'work', to: 'done', when: 'success' }],
            };
            const step = stepQaapWorkflow(bare, ['work'], 'work', 'resume:restart');
            expect(step.done).to.be.true;
            expect(step.terminalReason).to.equal('no-edge');
        });
    });
});
