// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapWorkflowAgentTurnNode, QaapWorkflowEdge, QaapWorkflowNode } from '../common/qaap-workflow-ir';
import { QaapWorkflowPromptRegistry } from '../common/qaap-workflow-prompt-registry';
import { QaapWorkflowRoutingPolicy } from '../common/qaap-workflow-routing';
import { QaapAgentHealthTracker } from './qaap-agent-health';
import { QaapWorkflowDispatchContext } from './qaap-workflow-dispatcher';
import { QAAP_WORKFLOW_STRICT_READONLY_ENV, QaapWorkflowAgentTurnAdapter } from './qaap-workflow-runtime-ports';
import { QAAP_WORKFLOW_DISPATCH_CLAIM_LEASE_MS } from './qaap-workflow-run-store';

/** Judge turn: unpinned, so routing decides the backend. */
const judgeNode: QaapWorkflowAgentTurnNode = {
    kind: 'agent-turn',
    id: 'judge',
    capability: 'judge',
    isolation: 'cwd-readonly',
    promptRef: 'user-task',
    requireSentinel: true,
};

const context: QaapWorkflowDispatchContext = { runId: 'r1', nodeId: 'judge', visit: 1, ownerLogin: 'ada' };

interface CapturedRequest {
    readonly agent?: string;
    readonly taskKind?: string;
    readonly readOnlyWorkspace?: boolean;
}

interface Harness {
    adapter: QaapWorkflowAgentTurnAdapter;
    createdWith: (string | undefined)[];
    taskKinds: (string | undefined)[];
    requests: CapturedRequest[];
    noted: string[];
    cancelled: string[];
}

interface HarnessOptions {
    /** Nodes the run's definition declares, so writer turns can be told from read-only ones. */
    readonly nodes?: readonly QaapWorkflowNode[];
    /** Edges of the run's definition, so "who produced what I am judging" can be walked. */
    readonly edges?: readonly QaapWorkflowEdge[];
    /** Node id → backend already routed in this run. */
    readonly routedAgents?: Readonly<Record<string, string>>;
    /** Installed backends; defaults to codex + qaiq. */
    readonly installed?: readonly string[];
    /** Routing table override, to exercise backends the default table never reaches. */
    readonly routing?: QaapWorkflowRoutingPolicy;
    /** Simulate persistence failing after the runner returned a task id. */
    readonly failCompleteClaim?: boolean;
    /** Begin with a claim left behind by a dead creator. */
    readonly staleClaim?: boolean;
}

/** Real routing policy + registry; runner/store stubbed. codex and qaiq both installed. */
function buildAdapter(options: HarnessOptions = {}): Harness {
    const createdWith: (string | undefined)[] = [];
    const taskKinds: (string | undefined)[] = [];
    const requests: CapturedRequest[] = [];
    const noted: string[] = [];
    const cancelled: string[] = [];
    // Mutated by noteRoutedAgent exactly as the real store does, so dispatching several judge nodes
    // in a row through one adapter reproduces what the dispatcher's serial loop actually sees.
    const routedAgents: Record<string, string> = { ...(options.routedAgents ?? {}) };
    const dispatchClaims: Record<string, { claimId: string; visit: number; kind: 'agent'; claimedAt: number }> = {};
    const dispatched: Record<string, { nodeId: string; externalId: string; kind: 'agent'; dispatchedAt: number }> = {};
    const visits: Record<string, number> = {};
    if (options.staleClaim) {
        visits[context.nodeId] = context.visit;
        dispatchClaims[context.nodeId] = {
            claimId: 'dead-creator', visit: context.visit, kind: 'agent',
            claimedAt: Date.now() - QAAP_WORKFLOW_DISPATCH_CLAIM_LEASE_MS - 1,
        };
    }
    let counter = 0;
    const adapter = Object.create(QaapWorkflowAgentTurnAdapter.prototype) as QaapWorkflowAgentTurnAdapter;
    Object.assign(adapter, {
        routedAgentByTask: new Map(),
        agentHealth: new QaapAgentHealthTracker(),
        routing: options.routing ?? new QaapWorkflowRoutingPolicy(),
        prompts: new QaapWorkflowPromptRegistry(),
        store: {
            get: () => ({
                run: { id: 'r1', bindings: {}, active: Object.keys(visits), visits: { ...visits } },
                def: { name: 'Wf', nodes: [...(options.nodes ?? [])], edges: [...(options.edges ?? [])] },
                inputs: { task: 'do it' },
                cwd: '/repo',
                artifacts: {},
                routedAgents: { ...routedAgents },
                dispatchClaims: { ...dispatchClaims },
                dispatched: { ...dispatched },
            }),
            claimDispatch: async (
                _owner: string, _runId: string, nodeId: string, visit: number, _kind: 'agent', claimId: string,
            ) => {
                if (visits[nodeId] !== visit) {
                    visits[nodeId] = visit;
                    delete dispatchClaims[nodeId];
                    delete dispatched[nodeId];
                }
                if (dispatched[nodeId]) {
                    return { status: 'attached' as const, externalId: dispatched[nodeId].externalId };
                }
                if (dispatchClaims[nodeId]) {
                    if (Date.now() - dispatchClaims[nodeId].claimedAt >= QAAP_WORKFLOW_DISPATCH_CLAIM_LEASE_MS) {
                        dispatchClaims[nodeId] = { claimId, visit, kind: 'agent', claimedAt: Date.now() };
                        return { status: 'claimed' as const };
                    }
                    return { status: 'pending' as const, claimId: dispatchClaims[nodeId].claimId };
                }
                dispatchClaims[nodeId] = { claimId, visit, kind: 'agent', claimedAt: Date.now() };
                return { status: 'claimed' as const };
            },
            completeDispatchClaim: async (
                _owner: string, _runId: string, nodeId: string, visit: number, _kind: 'agent', claimId: string, externalId: string,
            ) => {
                if (options.failCompleteClaim) {
                    throw new Error('claim persistence failed');
                }
                expect(dispatchClaims[nodeId]).to.deep.include({ claimId, visit });
                dispatched[nodeId] = { nodeId, externalId, kind: 'agent', dispatchedAt: Date.now() };
                delete dispatchClaims[nodeId];
                return undefined;
            },
            releaseDispatchClaim: async (_owner: string, _runId: string, nodeId: string, claimId: string) => {
                if (dispatchClaims[nodeId]?.claimId === claimId) {
                    delete dispatchClaims[nodeId];
                }
            },
            noteRoutedAgent: async (_owner: string, _runId: string, nodeId: string, agentRef: string) => {
                noted.push(`${nodeId}:${agentRef}`);
                routedAgents[nodeId] = agentRef;
                return undefined;
            },
        },
        runner: {
            listAgents: () => (options.installed ?? ['codex', 'qaiq'])
                .map(id => ({ id, label: id, available: true })),
            create: (request: CapturedRequest) => {
                createdWith.push(request.agent);
                taskKinds.push(request.taskKind);
                requests.push(request);
                return { id: `task-${++counter}` };
            },
            cancel: (taskId: string) => cancelled.push(taskId),
        },
    });
    return { adapter, createdWith, taskKinds, requests, noted, cancelled };
}

describe('QaapWorkflowAgentTurnAdapter durable visit claims', () => {
    it('creates one task for concurrent replays of the same visit', async () => {
        const { adapter, requests } = buildAdapter();

        const [first, replay] = await Promise.all([
            adapter.startAgentTurn(judgeNode, context),
            adapter.startAgentTurn(judgeNode, context),
        ]);

        expect(replay).to.equal(first);
        expect(requests).to.have.length(1);
    });

    it('creates a fresh task only when the durable visit increments', async () => {
        const { adapter, requests } = buildAdapter();
        const first = await adapter.startAgentTurn(judgeNode, context);
        const second = await adapter.startAgentTurn(judgeNode, { ...context, visit: 2 });

        expect(second).to.not.equal(first);
        expect(requests).to.have.length(2);
    });

    it('cancels the created task and releases ownership when claim attachment fails', async () => {
        const { adapter, cancelled } = buildAdapter({ failCompleteClaim: true });

        await adapter.startAgentTurn(judgeNode, context).then(
            () => expect.fail('expected claim completion to fail'),
            error => expect(error).to.have.property('message', 'claim persistence failed'),
        );

        expect(cancelled).to.deep.equal(['task-1']);
    });

    it('steals a stale durable claim and creates exactly one replacement task', async () => {
        const { adapter, requests } = buildAdapter({ staleClaim: true });

        const taskId = await adapter.startAgentTurn(judgeNode, context);

        expect(taskId).to.equal('task-1');
        expect(requests).to.have.length(1);
    });
});

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
        const second = await adapter.startAgentTurn(judgeNode, { ...context, visit: 2 });
        expect(createdWith).to.deep.equal(['codex', 'qaiq']);

        // A completed turn on qaiq clears nothing for codex; codex stays cooled…
        adapter.noteAgentTurnResult(second, 'completed');
        await adapter.startAgentTurn(judgeNode, { ...context, visit: 3 });
        expect(createdWith[2]).to.equal('qaiq');
    });

    it('does not cool a backend down for a turn that completed with a task-level failure verdict', async () => {
        const { adapter, createdWith } = buildAdapter();
        const first = await adapter.startAgentTurn(judgeNode, context);
        // 'completed' even with a fail verdict proves the CLI itself works.
        adapter.noteAgentTurnResult(first, 'completed');
        await adapter.startAgentTurn(judgeNode, { ...context, visit: 2 });
        expect(createdWith).to.deep.equal(['codex', 'codex']);
    });

    it('ignores results for tasks it did not route (pinned or foreign)', () => {
        const { adapter } = buildAdapter();
        expect(() => adapter.noteAgentTurnResult('task-unknown', 'failed')).to.not.throw();
    });
});

describe('QaapWorkflowAgentTurnAdapter model routing hand-off', () => {
    it('keeps a judge off the writer\'s slot (judge, standard tier -> review)', async () => {
        const { adapter, taskKinds } = buildAdapter();
        await adapter.startAgentTurn(judgeNode, context);
        expect(taskKinds).to.deep.equal(['review']);
    });

    it('derives implementation for an implement node', async () => {
        const { adapter, taskKinds } = buildAdapter();
        const implementNode: QaapWorkflowAgentTurnNode = { ...judgeNode, id: 'implement-1', capability: 'implement', isolation: 'cwd' };
        await adapter.startAgentTurn(implementNode, context);
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

describe('QaapWorkflowAgentTurnAdapter read-only isolation', () => {

    const writerNode: QaapWorkflowAgentTurnNode = {
        kind: 'agent-turn',
        id: 'implement',
        capability: 'implement',
        isolation: 'cwd',
        promptRef: 'user-task',
    };

    it('dispatches a cwd-readonly node as a restricted turn', async () => {
        const { adapter, requests } = buildAdapter();
        await adapter.startAgentTurn(judgeNode, context);
        expect(requests[0].readOnlyWorkspace).to.equal(true);
    });

    it('does not restrict a node whose isolation lets it write', async () => {
        const { adapter, requests } = buildAdapter();
        await adapter.startAgentTurn(writerNode, { ...context, nodeId: 'implement' });
        expect(requests[0].readOnlyWorkspace).to.equal(false);
    });

    it('routes a read-only node away from a backend that cannot enforce read-only', async () => {
        // grok is first in this table and installed, but has no read-only mechanism: a judge sent
        // there would run with edit tools in hand, which is the failure this guards.
        const routing = new QaapWorkflowRoutingPolicy({
            judge: { any: ['grok', 'codex'] },
            implement: { any: ['grok', 'codex'] },
        });
        const { adapter, createdWith } = buildAdapter({ routing, installed: ['grok', 'codex'] });
        await adapter.startAgentTurn(judgeNode, context);
        expect(createdWith).to.deep.equal(['codex']);
    });

    it('still prefers the cheapest route for a writer node — the constraint is read-only-only', async () => {
        const routing = new QaapWorkflowRoutingPolicy({ implement: { any: ['grok', 'codex'] } });
        const { adapter, createdWith } = buildAdapter({ routing, installed: ['grok', 'codex'] });
        await adapter.startAgentTurn(writerNode, { ...context, nodeId: 'implement' });
        expect(createdWith).to.deep.equal(['grok']);
    });

    it('runs unrestricted rather than not at all when no enforcing backend is installed', async () => {
        // Preferred, never required: failing the node here would break installations whose only
        // agent CLI has no restriction mechanism. The shortfall is warned about and recorded instead.
        const routing = new QaapWorkflowRoutingPolicy({ judge: { any: ['grok'] } });
        const { adapter, createdWith, requests } = buildAdapter({ routing, installed: ['grok'] });
        await adapter.startAgentTurn(judgeNode, context);
        expect(createdWith).to.deep.equal(['grok']);
        // The request still asks for the restriction; the runner records what the backend gave.
        expect(requests[0].readOnlyWorkspace).to.equal(true);
    });

    it('enforceability outranks judge independence', async () => {
        // codex both wrote the code and is the only backend that can be held read-only. A judge that
        // shares the writer's model is a weaker verdict; a judge that can edit the code is no verdict.
        const routing = new QaapWorkflowRoutingPolicy({ judge: { any: ['codex', 'grok'] } });
        const { adapter, createdWith } = buildAdapter({
            routing,
            installed: ['codex', 'grok'],
            nodes: [writerNode, judgeNode],
            routedAgents: { implement: 'codex' },
        });
        await adapter.startAgentTurn(judgeNode, context);
        expect(createdWith).to.deep.equal(['codex']);
    });

    it('refuses an unenforceable read-only node under the opt-in strict switch', async () => {
        const routing = new QaapWorkflowRoutingPolicy({ judge: { any: ['grok'] } });
        const { adapter } = buildAdapter({ routing, installed: ['grok'] });
        process.env[QAAP_WORKFLOW_STRICT_READONLY_ENV] = '1';
        try {
            await adapter.startAgentTurn(judgeNode, context).then(
                () => expect.fail('expected the dispatch to be refused'),
                (error: Error) => expect(error.message).to.include('cannot enforce it'),
            );
        } finally {
            delete process.env[QAAP_WORKFLOW_STRICT_READONLY_ENV];
        }
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
        // The real shape: the explorer's findings reach the judge only THROUGH the implement turn,
        // so the author of the change under review is `implement`, not the explorer. The upstream
        // walk has to stop at the first agent-turn for this to hold.
        const explorer: QaapWorkflowAgentTurnNode = {
            kind: 'agent-turn', id: 'explore', capability: 'explore', isolation: 'cwd-readonly', promptRef: 'explore-structure',
        };
        const { adapter, createdWith } = buildAdapter({
            nodes: [explorer, implementNode, judgeNode],
            edges: [
                { from: 'explore', to: 'implement', when: 'success' },
                { from: 'implement', to: 'judge', when: 'success' },
            ],
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

describe('QaapWorkflowAgentTurnAdapter independence beyond the writer', () => {

    const implementNode: QaapWorkflowAgentTurnNode = {
        kind: 'agent-turn', id: 'implement', capability: 'implement', isolation: 'cwd', promptRef: 'user-task',
    };
    const gitDiff: QaapWorkflowNode = { kind: 'deterministic', id: 'git-diff', op: 'git-diff', artifactKey: 'review.diff' };
    const lens = (id: string): QaapWorkflowAgentTurnNode => ({
        kind: 'agent-turn', id, capability: 'judge', isolation: 'cwd-readonly', promptRef: 'review-lens-correctness', artifactKey: `review.lens.${id}`,
    });
    const lenses = [lens('judge-correctness'), lens('judge-safety'), lens('judge-intent')];
    /** git-diff fans out to all three lenses, exactly as the multi-lens template wires them. */
    const lensEdges: QaapWorkflowEdge[] = [
        { from: 'implement', to: 'git-diff', when: 'success' },
        ...lenses.map((node): QaapWorkflowEdge => ({ from: 'git-diff', to: node.id, when: 'success' })),
    ];
    const synthesisNode: QaapWorkflowAgentTurnNode = {
        kind: 'agent-turn', id: 'review-synthesis', capability: 'judge', isolation: 'cwd-readonly', promptRef: 'synthesize-review', requireSentinel: true,
    };
    const planNode: QaapWorkflowAgentTurnNode = {
        kind: 'agent-turn', id: 'plan', capability: 'explore', isolation: 'cwd-readonly', promptRef: 'plan-under-review', artifactKey: 'plan.proposal',
    };
    const judgePlanNode: QaapWorkflowAgentTurnNode = {
        kind: 'agent-turn', id: 'judge-plan', capability: 'judge', isolation: 'cwd-readonly', promptRef: 'plan-review', requireSentinel: true,
    };
    const planGateEdges: QaapWorkflowEdge[] = [
        { from: 'plan', to: 'judge-plan', when: 'success' },
        // The rejection edge closes a cycle in the graph; walking upstream must still terminate.
        { from: 'judge-plan', to: 'plan', when: 'verdict:fail' },
    ];

    it('gives each lens of a multi-lens review its own backend, then reuses a lens before the writer', async () => {
        // The three lenses are released together and started serially, each after the previous one's
        // backend is recorded. Before this, all three resolved against an identical blocked set over
        // an identical preference order: one opinion, reported three times.
        const { adapter, createdWith } = buildAdapter({
            nodes: [implementNode, gitDiff, ...lenses],
            edges: lensEdges,
            routedAgents: { implement: 'claude' },
            installed: ['claude', 'codex', 'qaiq'],
        });
        for (const node of lenses) {
            await adapter.startAgentTurn(node, { ...context, nodeId: node.id });
        }
        // Two independent lenses, and a third that has run out of backends: it falls back to another
        // lens's model rather than to the writer's — a weaker third eye still beats a rubber stamp.
        expect(createdWith).to.deep.equal(['codex', 'qaiq', 'codex']);
    });

    it('keeps the synthesis turn off the lenses it is summarizing', async () => {
        const { adapter, createdWith } = buildAdapter({
            nodes: [
                implementNode,
                gitDiff,
                lenses[0],
                lenses[1],
                { kind: 'join', id: 'reviewed', wait: 'all' },
                synthesisNode,
            ],
            edges: [
                ...lensEdges.slice(0, 3),
                { from: 'judge-correctness', to: 'reviewed', when: 'always' },
                { from: 'judge-safety', to: 'reviewed', when: 'always' },
                { from: 'reviewed', to: 'review-synthesis', when: 'always' },
            ],
            routedAgents: { implement: 'claude', 'judge-correctness': 'codex', 'judge-safety': 'codex' },
            installed: ['claude', 'codex', 'qaiq'],
        });
        await adapter.startAgentTurn(synthesisNode, { ...context, nodeId: 'review-synthesis' });
        expect(createdWith).to.deep.equal(['qaiq']);
    });

    it('keeps the plan gate off the backend that wrote the plan', async () => {
        // Nobody wrote anything yet — the plan turn is read-only — so the writer rule saw nothing to
        // exclude and the gate was handed straight back to the plan's own author.
        const { adapter, createdWith } = buildAdapter({
            nodes: [planNode, judgePlanNode],
            edges: planGateEdges,
            routedAgents: { plan: 'codex' },
        });
        await adapter.startAgentTurn(judgePlanNode, { ...context, nodeId: 'judge-plan' });
        expect(createdWith).to.deep.equal(['qaiq']);
    });

    it('still lets the plan author judge the plan when nothing else can be held read-only', async () => {
        // The ordering this pins: enforceability first, independence second. grok is independent of
        // the plan's author but cannot be stopped from editing the tree, and a judge that can edit
        // the code is no verdict at all.
        const routing = new QaapWorkflowRoutingPolicy({ judge: { any: ['codex', 'grok'] } });
        const { adapter, createdWith } = buildAdapter({
            routing,
            installed: ['codex', 'grok'],
            nodes: [planNode, judgePlanNode],
            edges: planGateEdges,
            routedAgents: { plan: 'codex' },
        });
        await adapter.startAgentTurn(judgePlanNode, { ...context, nodeId: 'judge-plan' });
        expect(createdWith).to.deep.equal(['codex']);
    });

    it('routes a lone judge exactly as it did before independence was generalized', async () => {
        // Byte-identity fixation for the one-judge shapes. The explorers authored the findings the
        // implement turn built on, not the change under review, so the upstream walk must stop at
        // `implement` and leave claude free to judge. Revisiting the same judge (the fix loop) must
        // not treat its own earlier turn as a peer either.
        const explorer: QaapWorkflowAgentTurnNode = {
            kind: 'agent-turn', id: 'explore', capability: 'explore', isolation: 'cwd-readonly', promptRef: 'explore-structure', artifactKey: 'explore.structure',
        };
        const { adapter, createdWith } = buildAdapter({
            nodes: [explorer, implementNode, gitDiff, judgeNode],
            edges: [
                { from: 'explore', to: 'implement', when: 'success' },
                { from: 'implement', to: 'git-diff', when: 'success' },
                { from: 'git-diff', to: 'judge', when: 'success' },
            ],
            // codex is the judge table's second choice: if the walk failed to stop at `implement`
            // the explorer's backend would be excluded too and the judge would slide on to qaiq.
            routedAgents: { explore: 'codex' },
            installed: ['claude', 'codex', 'qaiq'],
        });
        await adapter.startAgentTurn(implementNode, { ...context, nodeId: 'implement' });
        await adapter.startAgentTurn(judgeNode, context);
        await adapter.startAgentTurn(judgeNode, { ...context, visit: 2 });
        expect(createdWith).to.deep.equal(['claude', 'codex', 'codex']);
    });
});
