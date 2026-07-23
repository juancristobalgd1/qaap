// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Emitter } from '@theia/core/lib/common/event';
import { QaapResearchStore } from './qaap-research-store';
import type { ResearchGoal, ResearchMetricSpec } from '@theia/qaap-mobile-shell/lib/common/qaap-research-goal';
import type { ResearchExperimentRecord } from '@theia/qaap-mobile-shell/lib/common/qaap-research-ledger';

/** Bypasses the constructor/@postConstruct (which would touch `~/.qaap/research-goals.json`) —
 *  same trick `qaap-agent-task-runner.verification.spec.ts` uses for the sibling task runner. */
function makeStore(): QaapResearchStore {
    const store = Object.create(QaapResearchStore.prototype) as QaapResearchStore;
    return Object.assign(store, {
        ledgerChains: new Map<string, Promise<void>>(),
        ledgerTempCounter: 0,
    });
}

/** {@link makeStore} plus the goal-metadata fields the bypassed constructor never initialized, and
 *  a stubbed-out `persistGoals` — needed for tests that call `store.create()`, which otherwise
 *  writes to the developer's real `~/.qaap/research-goals.json` (a fixed path, not `tmpDir`). */
function makeStoreForGoalCreation(): QaapResearchStore {
    const store = makeStore();
    return Object.assign(store, {
        goals: new Map<string, ResearchGoal>(),
        ownerByGoalId: new Map<string, string>(),
        onDidChangeEmitter: new Emitter<void>(),
        persistGoals: () => { /* no-op: never touch the real goal store file in tests */ },
    });
}

function record(overrides: Partial<ResearchExperimentRecord> = {}): ResearchExperimentRecord {
    return {
        id: overrides.id ?? 'r1',
        goalId: 'g1',
        round: 1,
        startedAt: 0,
        hypothesis: 'h',
        declaredConfig: {},
        declaredConfigFingerprint: 'fp',
        realChangeFingerprint: 'rfp',
        phase: 'propose',
        metrics: [],
        ...overrides,
    };
}

const METRIC: ResearchMetricSpec = { name: 'accuracy', direction: 'max', metricCommand: 'echo 1', primary: true };

describe('QaapResearchStore ledger', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-research-store-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns an empty ledger when the file does not exist yet', async () => {
        const store = makeStore();
        expect(store.readLedger(tmpDir)).to.deep.equal([]);
    });

    it('appends a new record (new id) as a new line', async () => {
        const store = makeStore();
        await store.upsertRecord(tmpDir, record({ id: 'r1', round: 1 }));
        await store.upsertRecord(tmpDir, record({ id: 'r2', round: 2 }));
        const records = store.readLedger(tmpDir);
        expect(records.map(r => r.id)).to.deep.equal(['r1', 'r2']);
    });

    it('rewrites a record in place when the id already exists (phase progression within a round)', async () => {
        const store = makeStore();
        await store.upsertRecord(tmpDir, record({ id: 'r1', phase: 'propose' }));
        await store.upsertRecord(tmpDir, record({ id: 'r1', phase: 'run', sha: 'abc123' }));
        const records = store.readLedger(tmpDir);
        expect(records).to.have.lengthOf(1);
        expect(records[0]).to.deep.include({ phase: 'run', sha: 'abc123' });
    });

    it('persists across a fresh store instance pointed at the same cwd (the file IS the state)', async () => {
        const store = makeStore();
        await store.upsertRecord(tmpDir, record({ id: 'r1' }));
        const reopened = makeStore();
        expect(reopened.readLedger(tmpDir)).to.have.lengthOf(1);
    });

    it('skips a corrupt line instead of throwing, so one bad write cannot lose the whole ledger', async () => {
        const store = makeStore();
        await store.upsertRecord(tmpDir, record({ id: 'r1' }));
        fs.appendFileSync(path.join(tmpDir, '.qaap', 'experiments.jsonl'), 'not-json\n', 'utf8');
        await store.upsertRecord(tmpDir, record({ id: 'r2' }));
        const records = store.readLedger(tmpDir);
        expect(records.map(r => r.id)).to.deep.equal(['r1', 'r2']);
    });

    it('scopes readLedgerForGoal to the given goal id (two goals can share a cwd)', async () => {
        const store = makeStore();
        await store.upsertRecord(tmpDir, record({ id: 'r1', goalId: 'g1' }));
        await store.upsertRecord(tmpDir, record({ id: 'r2', goalId: 'g2' }));
        const goal = { id: 'g1', cwd: tmpDir } as ResearchGoal;
        expect(store.readLedgerForGoal(goal).map(r => r.id)).to.deep.equal(['r1']);
    });

    it('bestSoFar picks the max for a max-direction metric', async () => {
        const store = makeStore();
        await store.upsertRecord(tmpDir, record({ id: 'r1', goalId: 'g1', metrics: [{ name: 'accuracy', value: 0.5, direction: 'max' }] }));
        await store.upsertRecord(tmpDir, record({ id: 'r2', goalId: 'g1', metrics: [{ name: 'accuracy', value: 0.8, direction: 'max' }] }));
        await store.upsertRecord(tmpDir, record({ id: 'r3', goalId: 'g1', metrics: [{ name: 'accuracy', value: 0.6, direction: 'max' }] }));
        const goal = { id: 'g1', cwd: tmpDir } as ResearchGoal;
        expect(store.bestSoFar(goal, METRIC)).to.equal(0.8);
    });

    it('bestSoFar picks the min for a min-direction metric', async () => {
        const store = makeStore();
        const minMetric: ResearchMetricSpec = { ...METRIC, direction: 'min' };
        await store.upsertRecord(tmpDir, record({ id: 'r1', goalId: 'g1', metrics: [{ name: 'accuracy', value: 0.5, direction: 'min' }] }));
        await store.upsertRecord(tmpDir, record({ id: 'r2', goalId: 'g1', metrics: [{ name: 'accuracy', value: 0.2, direction: 'min' }] }));
        const goal = { id: 'g1', cwd: tmpDir } as ResearchGoal;
        expect(store.bestSoFar(goal, minMetric)).to.equal(0.2);
    });

    it('bestSoFar returns undefined when no record has that metric yet', async () => {
        const store = makeStore();
        await store.upsertRecord(tmpDir, record({ id: 'r1', goalId: 'g1', metrics: [] }));
        const goal = { id: 'g1', cwd: tmpDir } as ResearchGoal;
        expect(store.bestSoFar(goal, METRIC)).to.equal(undefined);
    });

    it('round-trips an explicit agentModel from the create() body onto the resulting goal', async () => {
        const store = makeStoreForGoalCreation();
        const goal = store.create({
            cwd: tmpDir,
            description: 'Improve accuracy',
            metrics: [METRIC],
            agentModel: { provider: 'anthropic', vendor: 'anthropic', modelId: 'claude-sonnet-4-5' },
        });
        expect(goal.agentModel).to.deep.equal({ provider: 'anthropic', vendor: 'anthropic', modelId: 'claude-sonnet-4-5' });
    });

    it('leaves agentModel undefined when the create() body omits it (today\'s alias-routing behaviour)', () => {
        const store = makeStoreForGoalCreation();
        const goal = store.create({ cwd: tmpDir, description: 'Improve accuracy', metrics: [METRIC] });
        expect(goal.agentModel).to.equal(undefined);
    });

    it('replayFrom clones a stopped goal with a new id and running status', async () => {
        const store = makeStoreForGoalCreation();
        const source = store.create({
            cwd: tmpDir,
            description: 'Tune hyperparameters',
            metrics: [METRIC],
            runCommand: 'npm test',
        }, 'alice');
        store.updateGoal(source.id, { status: 'completed', terminationReason: 'reached-target' });
        const replayed = store.replayFrom(source.id);
        expect(replayed.id).to.not.equal(source.id);
        expect(replayed.status).to.equal('running');
        expect(replayed.startedAt).to.be.a('number');
        expect(replayed.startedAt).to.equal(replayed.createdAt);
        expect(replayed.description).to.equal(source.description);
        expect(replayed.runCommand).to.equal('npm test');
        expect(store.ownerOf(replayed.id)).to.equal('alice');
    });

    it('updateGoal stamps finishedAt when a running goal stops', async () => {
        const store = makeStoreForGoalCreation();
        const goal = store.create({ cwd: tmpDir, description: 'Improve accuracy', metrics: [METRIC] });
        const before = Date.now();
        const stopped = store.updateGoal(goal.id, { status: 'completed', terminationReason: 'reached-target' });
        expect(stopped?.finishedAt).to.be.at.least(before);
        expect(stopped?.finishedAt).to.be.at.most(Date.now());
    });

    it('create sets startedAt for a new running goal', async () => {
        const store = makeStoreForGoalCreation();
        const goal = store.create({ cwd: tmpDir, description: 'Improve accuracy', metrics: [METRIC] });
        expect(goal.startedAt).to.equal(goal.createdAt);
    });

    it('replayFrom rejects a running goal', async () => {
        const store = makeStoreForGoalCreation();
        const source = store.create({ cwd: tmpDir, description: 'Improve accuracy', metrics: [METRIC] });
        expect(() => store.replayFrom(source.id)).to.throw(/already running/);
    });
});
