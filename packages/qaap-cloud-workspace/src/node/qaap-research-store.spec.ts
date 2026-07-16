// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapResearchStore } from './qaap-research-store';
import type { ResearchGoal, ResearchMetricSpec } from '@theia/qaap-mobile-shell/lib/common/qaap-research-goal';
import type { ResearchExperimentRecord } from '@theia/qaap-mobile-shell/lib/common/qaap-research-ledger';

/** Bypasses the constructor/@postConstruct (which would touch `~/.qaap/research-goals.json`) —
 *  same trick `qaap-agent-task-runner.verification.spec.ts` uses for the sibling task runner. */
function makeStore(): QaapResearchStore {
    return Object.create(QaapResearchStore.prototype) as QaapResearchStore;
}

function record(overrides: Partial<ResearchExperimentRecord> = {}): ResearchExperimentRecord {
    return {
        id: overrides.id ?? 'r1',
        goalId: 'g1',
        round: 1,
        startedAt: 0,
        hypothesis: 'h',
        config: {},
        configFingerprint: 'fp',
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

    it('returns an empty ledger when the file does not exist yet', () => {
        const store = makeStore();
        expect(store.readLedger(tmpDir)).to.deep.equal([]);
    });

    it('appends a new record (new id) as a new line', () => {
        const store = makeStore();
        store.upsertRecord(tmpDir, record({ id: 'r1', round: 1 }));
        store.upsertRecord(tmpDir, record({ id: 'r2', round: 2 }));
        const records = store.readLedger(tmpDir);
        expect(records.map(r => r.id)).to.deep.equal(['r1', 'r2']);
    });

    it('rewrites a record in place when the id already exists (phase progression within a round)', () => {
        const store = makeStore();
        store.upsertRecord(tmpDir, record({ id: 'r1', phase: 'propose' }));
        store.upsertRecord(tmpDir, record({ id: 'r1', phase: 'run', sha: 'abc123' }));
        const records = store.readLedger(tmpDir);
        expect(records).to.have.lengthOf(1);
        expect(records[0]).to.deep.include({ phase: 'run', sha: 'abc123' });
    });

    it('persists across a fresh store instance pointed at the same cwd (the file IS the state)', () => {
        const store = makeStore();
        store.upsertRecord(tmpDir, record({ id: 'r1' }));
        const reopened = makeStore();
        expect(reopened.readLedger(tmpDir)).to.have.lengthOf(1);
    });

    it('skips a corrupt line instead of throwing, so one bad write cannot lose the whole ledger', () => {
        const store = makeStore();
        store.upsertRecord(tmpDir, record({ id: 'r1' }));
        fs.appendFileSync(path.join(tmpDir, '.qaap', 'experiments.jsonl'), 'not-json\n', 'utf8');
        store.upsertRecord(tmpDir, record({ id: 'r2' }));
        const records = store.readLedger(tmpDir);
        expect(records.map(r => r.id)).to.deep.equal(['r1', 'r2']);
    });

    it('scopes readLedgerForGoal to the given goal id (two goals can share a cwd)', () => {
        const store = makeStore();
        store.upsertRecord(tmpDir, record({ id: 'r1', goalId: 'g1' }));
        store.upsertRecord(tmpDir, record({ id: 'r2', goalId: 'g2' }));
        const goal = { id: 'g1', cwd: tmpDir } as ResearchGoal;
        expect(store.readLedgerForGoal(goal).map(r => r.id)).to.deep.equal(['r1']);
    });

    it('bestSoFar picks the max for a max-direction metric', () => {
        const store = makeStore();
        store.upsertRecord(tmpDir, record({ id: 'r1', goalId: 'g1', metrics: [{ name: 'accuracy', value: 0.5, direction: 'max' }] }));
        store.upsertRecord(tmpDir, record({ id: 'r2', goalId: 'g1', metrics: [{ name: 'accuracy', value: 0.8, direction: 'max' }] }));
        store.upsertRecord(tmpDir, record({ id: 'r3', goalId: 'g1', metrics: [{ name: 'accuracy', value: 0.6, direction: 'max' }] }));
        const goal = { id: 'g1', cwd: tmpDir } as ResearchGoal;
        expect(store.bestSoFar(goal, METRIC)).to.equal(0.8);
    });

    it('bestSoFar picks the min for a min-direction metric', () => {
        const store = makeStore();
        const minMetric: ResearchMetricSpec = { ...METRIC, direction: 'min' };
        store.upsertRecord(tmpDir, record({ id: 'r1', goalId: 'g1', metrics: [{ name: 'accuracy', value: 0.5, direction: 'min' }] }));
        store.upsertRecord(tmpDir, record({ id: 'r2', goalId: 'g1', metrics: [{ name: 'accuracy', value: 0.2, direction: 'min' }] }));
        const goal = { id: 'g1', cwd: tmpDir } as ResearchGoal;
        expect(store.bestSoFar(goal, minMetric)).to.equal(0.2);
    });

    it('bestSoFar returns undefined when no record has that metric yet', () => {
        const store = makeStore();
        store.upsertRecord(tmpDir, record({ id: 'r1', goalId: 'g1', metrics: [] }));
        const goal = { id: 'g1', cwd: tmpDir } as ResearchGoal;
        expect(store.bestSoFar(goal, METRIC)).to.equal(undefined);
    });
});
