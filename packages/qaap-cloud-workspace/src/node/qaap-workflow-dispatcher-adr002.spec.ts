// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * ADR-002 dispatcher additions: the `governs` ownership predicate (chat-turn runs must never be
 * touched by the template-workflow dispatcher) and the boot-window fix (a dispatchable node left
 * active with no dispatched entry is interrupted instead of hanging until the run wall clock).
 */

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapAgentTaskState } from '../common/qaap-agent-task';
import { QAAP_CHAT_TURN_WORKFLOW_ID, buildChatTurnWorkflow } from '../common/qaap-chat-turn-workflow';
import { QaapJobState } from '../common/qaap-job';
import { QaapWorkflowDef, buildImplementThenReviewWorkflow } from '../common/qaap-workflow-ir';
import {
    QaapWorkflowAgentTurnPort,
    QaapWorkflowDeterministicPort,
    QaapWorkflowDispatcher,
} from './qaap-workflow-dispatcher';
import { QaapWorkflowRunStore } from './qaap-workflow-run-store';

class TestStore extends QaapWorkflowRunStore {
    constructor(protected readonly testDirectory: string) { super(); }
    initialize(): void { this.init(); }
    protected override storeDirectory(): string { return this.testDirectory; }
}

class FakeAgentPort implements QaapWorkflowAgentTurnPort {
    readonly started: string[] = [];
    readonly lookedUp: string[] = [];
    readonly tasks = new Map<string, { state: QaapAgentTaskState; log?: string }>();
    private counter = 0;

    async startAgentTurn(): Promise<string> {
        const id = `task-${++this.counter}`;
        this.started.push(id);
        this.tasks.set(id, { state: 'running' });
        return id;
    }

    async lookupAgentTurn(externalId: string): Promise<{ state: QaapAgentTaskState; log?: string } | undefined> {
        this.lookedUp.push(externalId);
        return this.tasks.get(externalId);
    }
}

class FakeJobPort implements QaapWorkflowDeterministicPort {
    async startDeterministic(): Promise<string> {
        throw new Error('no deterministic node in these specs');
    }
    async lookupDeterministic(): Promise<{ state: QaapJobState } | undefined> {
        return undefined;
    }
}

describe('QaapWorkflowDispatcher (ADR-002)', () => {
    let directory: string;
    let store: TestStore;
    let agent: FakeAgentPort;

    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-workflow-adr002-'));
        store = new TestStore(directory);
        store.initialize();
        agent = new FakeAgentPort();
    });

    afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

    function templateDispatcher(): QaapWorkflowDispatcher {
        return new QaapWorkflowDispatcher(
            store,
            { agent, deterministic: new FakeJobPort() },
            record => record.def.id !== QAAP_CHAT_TURN_WORKFLOW_ID,
        );
    }

    describe('governs predicate', () => {
        it('boot reconciliation leaves a chat-turn run for its own governor', async () => {
            const started = await store.start(buildChatTurnWorkflow(), { cwd: '/repo', ownerLogin: 'ada' });
            await store.attachDispatch('ada', started.record.run.id, 'turn', 'agent', 'dead-task');

            await templateDispatcher().reconcileOnBoot();

            const record = store.get('ada', started.record.run.id);
            expect(agent.lookedUp).to.deep.equal([]);
            expect(record?.run.status).to.equal('running');
            expect(record?.dispatched.turn?.externalId).to.equal('dead-task');
        });

        it('an owning dispatcher still interrupts the same dead chat-turn node', async () => {
            const started = await store.start(buildChatTurnWorkflow(), { cwd: '/repo', ownerLogin: 'ada' });
            await store.attachDispatch('ada', started.record.run.id, 'turn', 'agent', 'dead-task');

            const owning = new QaapWorkflowDispatcher(store, { agent, deterministic: new FakeJobPort() });
            await owning.reconcileOnBoot();

            const record = store.get('ada', started.record.run.id);
            // interrupt() routes 'fail' and the chat-turn def settles it on turn.failed.
            expect(record?.run.status).to.equal('failed');
            expect(record?.run.bindings).to.have.property('turn.failed');
        });

        it('ignores terminal events of tasks that belong to a run it does not govern', async () => {
            const started = await store.start(buildChatTurnWorkflow(), { cwd: '/repo', ownerLogin: 'ada' });
            await store.attachDispatch('ada', started.record.run.id, 'turn', 'agent', 'chat-task');

            await templateDispatcher().onAgentTaskFinished('chat-task', 'completed');

            expect(store.get('ada', started.record.run.id)?.run.status).to.equal('running');
        });
    });

    describe('boot-window fix', () => {
        it('interrupts a dispatchable node that is active with no dispatched entry', async () => {
            // Simulates a crash between startAgentTurn() and attachDispatch(): the run knows the
            // node is active but not where it went. Before the fix this run hung until maxRunMs.
            const started = await store.start(buildImplementThenReviewWorkflow(), {
                cwd: '/repo', ownerLogin: 'ada', inputs: { task: 'fix' },
            });
            expect(started.dispatch).to.deep.equal(['implement']);

            const owning = new QaapWorkflowDispatcher(store, { agent, deterministic: new FakeJobPort() });
            await owning.reconcileOnBoot();

            const record = store.get('ada', started.record.run.id);
            expect(record?.run.status).to.equal('failed');
            expect(record?.run.bindings).to.have.property('review.skipped');
        });

        it('releases a creator claim left by a crash and redispatches the same visit once', async () => {
            const started = await store.start(buildImplementThenReviewWorkflow(), {
                cwd: '/repo', ownerLogin: 'ada', inputs: { task: 'fix' },
            });
            await store.claimDispatch('ada', started.record.run.id, 'implement', 1, 'agent', 'dead-creator');

            // A real restart reconstructs both store and port. The old claim has no external id,
            // so reconciliation owns clearing it before exactly one replay of visit one.
            store = new TestStore(directory);
            store.initialize();
            agent = new FakeAgentPort();
            const owning = new QaapWorkflowDispatcher(store, { agent, deterministic: new FakeJobPort() });

            await owning.reconcileOnBoot();

            const record = store.get('ada', started.record.run.id);
            expect(agent.started).to.deep.equal(['task-1']);
            expect(record?.run.visits.implement).to.equal(1);
            expect(record?.dispatchClaims).to.deep.equal({});
            expect(record?.dispatched.implement.externalId).to.equal('task-1');
        });

        it('leaves an active node alone when its process is still known to the runtime', async () => {
            const started = await store.start(buildImplementThenReviewWorkflow(), {
                cwd: '/repo', ownerLogin: 'ada', inputs: { task: 'fix' },
            });
            const owning = new QaapWorkflowDispatcher(store, { agent, deterministic: new FakeJobPort() });
            await owning.dispatch(started.record, started.dispatch);
            expect(agent.started).to.have.length(1);

            await owning.reconcileOnBoot();

            expect(store.get('ada', started.record.run.id)?.run.status).to.equal('running');
        });

        it('keeps waiting on an active human gate instead of interrupting it', async () => {
            const gated: QaapWorkflowDef = {
                id: 'gated.def',
                version: 1,
                name: 'Gated',
                entry: 'approve',
                nodes: [
                    { kind: 'human-gate', id: 'approve', reasonRef: 'approval' },
                    { kind: 'emit', id: 'done', bindingKey: 'done' },
                ],
                edges: [{ from: 'approve', to: 'done', when: 'human:continue' }],
            };
            const started = await store.start(gated, { cwd: '/repo', ownerLogin: 'ada' });
            expect(started.record.run.status).to.equal('awaiting-human');

            const owning = new QaapWorkflowDispatcher(store, { agent, deterministic: new FakeJobPort() });
            await owning.reconcileOnBoot();

            expect(store.get('ada', started.record.run.id)?.run.status).to.equal('awaiting-human');
        });
    });
});
