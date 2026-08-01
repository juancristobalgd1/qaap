// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildChatTurnWorkflow } from '../common/qaap-chat-turn-workflow';
import { QaapWorkflowRunRequestError, QaapWorkflowRunStore } from './qaap-workflow-run-store';

class TestStore extends QaapWorkflowRunStore {
    constructor(protected readonly testDirectory: string) { super(); }
    initialize(): void { this.init(); }
    protected override storeDirectory(): string { return this.testDirectory; }
}

/** Cap tests churn hundreds of mutations; skip the disk to keep them instant. */
class MemoryStore extends QaapWorkflowRunStore {
    protected override async persist(): Promise<void> { /* in-memory */ }
}

describe('QaapWorkflowRunStore.adoptRun (ADR-002)', () => {
    let directory: string;
    let store: TestStore;

    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-workflow-adopt-'));
        store = new TestStore(directory);
        store.initialize();
    });

    afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

    it('adopts a mid-life run parked on its seed node and survives a restart', async () => {
        const adopted = await store.adoptRun(buildChatTurnWorkflow(), {
            cwd: '/repo',
            ownerLogin: 'ada',
            inputs: { conversationId: 'conv-1', rootUserMessageId: 'msg-1' },
            seedNodeId: 'turn',
            seedVisits: 2,
            deadExternalId: 'dead-task',
        });

        expect(adopted.run.status).to.equal('running');
        expect(adopted.run.active).to.deep.equal(['turn']);
        expect(adopted.run.visits.turn).to.equal(2);
        expect(adopted.run.nodeRuns).to.equal(2);
        expect(adopted.dispatched.turn?.externalId).to.equal('dead-task');

        const restarted = new TestStore(directory);
        restarted.initialize();
        const restored = restarted.listAllUnfinished().find(record => record.run.id === adopted.run.id);
        expect(restored?.run.visits.turn).to.equal(2);
        expect(restored?.inputs.rootUserMessageId).to.equal('msg-1');

        // The adopted node is reportable like any dispatched node: a resume re-visits it.
        const advanced = await restarted.report('ada', adopted.run.id, 'turn', 'resume:restart');
        expect(advanced.dispatch).to.deep.equal(['turn']);
        expect(advanced.record.run.visits.turn).to.equal(3);
    });

    it('rejects a seed node the definition does not declare', async () => {
        try {
            await store.adoptRun(buildChatTurnWorkflow(), {
                cwd: '/repo', seedNodeId: 'nope', seedVisits: 1,
            });
            expect.fail('expected adoptRun to reject an unknown seed node');
        } catch (error) {
            expect(error).to.be.instanceOf(QaapWorkflowRunRequestError);
        }
    });

    it('reaps the oldest finished run of the same definition instead of failing at the cap', async () => {
        const memory = new MemoryStore();
        const first = await memory.adoptRun(buildChatTurnWorkflow(), {
            cwd: '/repo', ownerLogin: 'ada', seedNodeId: 'turn', seedVisits: 1,
        });
        await memory.report('ada', first.run.id, 'turn', 'fail');
        for (let i = 0; i < 199; i++) {
            await memory.adoptRun(buildChatTurnWorkflow(), {
                cwd: '/repo', ownerLogin: 'ada', seedNodeId: 'turn', seedVisits: 1,
            });
        }
        expect(memory.list('ada')).to.have.length(200);

        // At the cap with one finished run: adoption reaps it and succeeds.
        await memory.adoptRun(buildChatTurnWorkflow(), {
            cwd: '/repo', ownerLogin: 'ada', seedNodeId: 'turn', seedVisits: 1,
        });
        expect(memory.list('ada')).to.have.length(200);
        expect(memory.list('ada').some(record => record.run.id === first.run.id)).to.be.false;

        // At the cap with nothing finished: adoption fails like start() does.
        try {
            await memory.adoptRun(buildChatTurnWorkflow(), {
                cwd: '/repo', ownerLogin: 'ada', seedNodeId: 'turn', seedVisits: 1,
            });
            expect.fail('expected adoptRun to enforce the per-owner cap');
        } catch (error) {
            expect(error).to.be.instanceOf(QaapWorkflowRunRequestError);
        }
    });
});
