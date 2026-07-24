// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapWorkflowAgentTurnNode } from '../common/qaap-workflow-ir';
import { QaapWorkflowPromptRegistry } from '../common/qaap-workflow-prompt-registry';
import { QaapWorkflowRoutingPolicy } from '../common/qaap-workflow-routing';
import { QaapAgentHealthTracker } from './qaap-agent-health';
import { QaapWorkflowDispatchContext } from './qaap-workflow-dispatcher';
import { QaapWorkflowAgentTurnAdapter } from './qaap-workflow-runtime-ports';

/** Judge turn: unpinned, so routing decides the backend. */
const judgeNode: QaapWorkflowAgentTurnNode = {
    kind: 'agent-turn',
    id: 'judge',
    capability: 'judge',
    isolation: 'cwd-readonly',
    promptRef: 'user-task',
    requireSentinel: true,
};

const context: QaapWorkflowDispatchContext = { runId: 'r1', nodeId: 'judge', ownerLogin: 'ada' };

interface Harness {
    adapter: QaapWorkflowAgentTurnAdapter;
    createdWith: (string | undefined)[];
}

/** Real routing policy + registry; runner/store stubbed. codex and qaiq both installed. */
function buildAdapter(): Harness {
    const createdWith: (string | undefined)[] = [];
    let counter = 0;
    const adapter = Object.create(QaapWorkflowAgentTurnAdapter.prototype) as QaapWorkflowAgentTurnAdapter;
    Object.assign(adapter, {
        routedAgentByTask: new Map(),
        agentHealth: new QaapAgentHealthTracker(),
        routing: new QaapWorkflowRoutingPolicy(),
        prompts: new QaapWorkflowPromptRegistry(),
        store: {
            get: () => ({
                run: { id: 'r1', bindings: {} },
                def: { name: 'Wf' },
                inputs: { task: 'do it' },
                cwd: '/repo',
            }),
        },
        runner: {
            listAgents: () => [
                { id: 'codex', label: 'Codex', available: true },
                { id: 'qaiq', label: 'QAIQ', available: true },
            ],
            create: (request: { agent?: string }) => {
                createdWith.push(request.agent);
                return { id: `task-${++counter}` };
            },
        },
    });
    return { adapter, createdWith };
}

describe('QaapWorkflowAgentTurnAdapter backend cooldown', () => {
    it('routes the judge to the first preferred installed backend', async () => {
        const { adapter, createdWith } = buildAdapter();
        await adapter.startAgentTurn(judgeNode, context);
        // Default judge route prefers codex when installed.
        expect(createdWith).to.deep.equal(['codex']);
    });

    it('routes around a backend whose CLI hard-failed, then heals on success', async () => {
        const { adapter, createdWith } = buildAdapter();
        const first = await adapter.startAgentTurn(judgeNode, context);
        adapter.noteAgentTurnResult(first, 'failed');

        // codex is cooling down → next unpinned judge goes to the next candidate.
        const second = await adapter.startAgentTurn(judgeNode, context);
        expect(createdWith).to.deep.equal(['codex', 'qaiq']);

        // A completed turn on qaiq clears nothing for codex; codex stays cooled…
        adapter.noteAgentTurnResult(second, 'completed');
        await adapter.startAgentTurn(judgeNode, context);
        expect(createdWith[2]).to.equal('qaiq');
    });

    it('does not cool a backend down for a turn that completed with a task-level failure verdict', async () => {
        const { adapter, createdWith } = buildAdapter();
        const first = await adapter.startAgentTurn(judgeNode, context);
        // 'completed' even with a fail verdict proves the CLI itself works.
        adapter.noteAgentTurnResult(first, 'completed');
        await adapter.startAgentTurn(judgeNode, context);
        expect(createdWith).to.deep.equal(['codex', 'codex']);
    });

    it('ignores results for tasks it did not route (pinned or foreign)', () => {
        const { adapter } = buildAdapter();
        expect(() => adapter.noteAgentTurnResult('task-unknown', 'failed')).to.not.throw();
    });
});
