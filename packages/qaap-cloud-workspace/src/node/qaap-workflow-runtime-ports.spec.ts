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
    taskKinds: (string | undefined)[];
    noted: string[];
}

interface HarnessOptions {
    /** Nodes the run's definition declares, so writer turns can be told from read-only ones. */
    readonly nodes?: readonly QaapWorkflowAgentTurnNode[];
    /** Node id → backend already routed in this run. */
    readonly routedAgents?: Readonly<Record<string, string>>;
    /** Installed backends; defaults to codex + qaiq. */
    readonly installed?: readonly string[];
}

/** Real routing policy + registry; runner/store stubbed. codex and qaiq both installed. */
function buildAdapter(options: HarnessOptions = {}): Harness {
    const createdWith: (string | undefined)[] = [];
    const taskKinds: (string | undefined)[] = [];
    const noted: string[] = [];
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
                def: { name: 'Wf', nodes: [...(options.nodes ?? [])] },
                inputs: { task: 'do it' },
                cwd: '/repo',
                artifacts: {},
                routedAgents: { ...(options.routedAgents ?? {}) },
            }),
            noteRoutedAgent: async (_owner: string, _runId: string, nodeId: string, agentRef: string) => {
                noted.push(`${nodeId}:${agentRef}`);
                return undefined;
            },
        },
        runner: {
            listAgents: () => (options.installed ?? ['codex', 'qaiq'])
                .map(id => ({ id, label: id, available: true })),
            create: (request: { agent?: string; taskKind?: string }) => {
                createdWith.push(request.agent);
                taskKinds.push(request.taskKind);
                return { id: `task-${++counter}` };
            },
        },
    });
    return { adapter, createdWith, taskKinds, noted };
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

describe('QaapWorkflowAgentTurnAdapter model routing hand-off', () => {
    it('derives taskKind from the node capability (judge, standard tier -> implementation)', async () => {
        const { adapter, taskKinds } = buildAdapter();
        await adapter.startAgentTurn(judgeNode, context);
        expect(taskKinds).to.deep.equal(['implementation']);
    });

    it('lets an explicit cheap costTier override the capability default', async () => {
        const { adapter, taskKinds } = buildAdapter();
        const cheapJudgeNode: QaapWorkflowAgentTurnNode = { ...judgeNode, costTier: 'cheap' };
        await adapter.startAgentTurn(cheapJudgeNode, context);
        expect(taskKinds).to.deep.equal(['exploration']);
    });

    it('derives exploration for an explore node the caller marked cheap', async () => {
        const { adapter, taskKinds } = buildAdapter();
        const exploreNode: QaapWorkflowAgentTurnNode = {
            kind: 'agent-turn',
            id: 'explore-1',
            capability: 'explore',
            costTier: 'cheap',
            isolation: 'cwd-readonly',
            promptRef: 'explore-structure',
        };
        await adapter.startAgentTurn(exploreNode, context);
        expect(taskKinds).to.deep.equal(['exploration']);
    });
});

describe('QaapWorkflowAgentTurnAdapter judge independence', () => {
    const implementNode: QaapWorkflowAgentTurnNode = {
        kind: 'agent-turn',
        id: 'implement',
        capability: 'implement',
        isolation: 'cwd',
        promptRef: 'user-task',
    };
    const nodes = [implementNode, judgeNode];

    it('keeps the judge off the backend that wrote the code', async () => {
        // "Independent adversarial review" is only true if a different model performs it. With the
        // writer excluded the judge falls to the next installed candidate.
        const { adapter, createdWith } = buildAdapter({ nodes, routedAgents: { implement: 'codex' } });
        await adapter.startAgentTurn(judgeNode, { ...context, nodeId: 'judge' });
        expect(createdWith).to.deep.equal(['qaiq']);
    });

    it('reviews with the same backend rather than not reviewing at all', async () => {
        // Only one backend installed: an unreviewed change is worse than a self-review, and the
        // verdict sentinel still governs the outcome.
        const { adapter, createdWith } = buildAdapter({
            nodes,
            routedAgents: { implement: 'codex' },
            installed: ['codex'],
        });
        await adapter.startAgentTurn(judgeNode, { ...context, nodeId: 'judge' });
        expect(createdWith).to.deep.equal(['codex']);
    });

    it('does not exclude a read-only turn — an explorer wrote nothing to review', async () => {
        const explorer: QaapWorkflowAgentTurnNode = {
            kind: 'agent-turn', id: 'explore', capability: 'explore', isolation: 'cwd-readonly', promptRef: 'explore-structure',
        };
        const { adapter, createdWith } = buildAdapter({
            nodes: [explorer, judgeNode],
            routedAgents: { explore: 'codex' },
        });
        await adapter.startAgentTurn(judgeNode, { ...context, nodeId: 'judge' });
        expect(createdWith).to.deep.equal(['codex']);
    });

    it('remembers the backend durably, so a later judge can avoid it', async () => {
        const { adapter, noted } = buildAdapter({ nodes });
        await adapter.startAgentTurn(implementNode, { ...context, nodeId: 'implement' });
        expect(noted).to.deep.equal(['implement:codex']);
    });
});
