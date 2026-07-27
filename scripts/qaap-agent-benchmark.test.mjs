import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeGraph, evaluateBenchmark, renderBenchmarkMarkdown, wilsonInterval } from './qaap-agent-benchmark-lib.mjs';

const tasks = [
    { id: 'bug-fix', budgets: { wallTimeMs: 1_000, costUsd: 1, humanInterventions: 0 } },
    { id: 'feature', budgets: { wallTimeMs: 2_000, costUsd: 2, humanInterventions: 0 } },
];

function run(overrides = {}) {
    return {
        id: 'run-1',
        taskId: 'bug-fix',
        system: 'Qaap',
        track: 'harness-controlled',
        configuration: 'goal+verify',
        model: 'same-model',
        repetition: 1,
        oracle: { score: 1 },
        safety: { passed: true },
        humanInterventions: 0,
        timing: { wallTimeMs: 900, firstOutputMs: 100 },
        usage: { costUsd: 0.5, totalTokens: 1_000 },
        ...overrides,
    };
}

test('missing tasks score zero and cannot inflate completion', () => {
    const report = evaluateBenchmark({
        schemaVersion: 1,
        suite: { id: 'suite', tasks },
        runs: [run()],
    });
    assert.equal(report.systems[0].score, 50);
    assert.equal(report.systems[0].passAt1, 50);
    assert.equal(report.systems[0].taskCoverage, 0.5);
});

test('unsafe or assisted runs are not valid completions', () => {
    const report = evaluateBenchmark({
        schemaVersion: 1,
        suite: { id: 'suite', tasks: [tasks[0]] },
        runs: [
            run({ id: 'unsafe', safety: { passed: false } }),
            run({ id: 'assisted', repetition: 2, humanInterventions: 1 }),
        ],
    });
    assert.equal(report.systems[0].score, 0);
    assert.equal(report.systems[0].oracleScore, 100);
    assert.equal(report.systems[0].validCompletions, 0);
});

test('time and cost budgets fail closed', () => {
    const report = evaluateBenchmark({
        schemaVersion: 1,
        suite: { id: 'suite', tasks: [tasks[0]] },
        runs: [
            run({ id: 'slow', timing: { wallTimeMs: 1_001 }, usage: { costUsd: 0.5 } }),
            run({ id: 'missing-cost', repetition: 2, usage: {} }),
        ],
    });
    assert.equal(report.systems[0].score, 0);
    assert.equal(report.systems[0].budgetPassRate, 0);
});

test('Qaap workflow API responses produce parallelism and retry diagnostics', () => {
    const graphRun = run({
        timing: { wallTimeMs: 1_000 },
        qaapWorkflow: {
            run: {
                status: 'succeeded',
                nodeRuns: 4,
                visits: { explore: 2, implement: 1, judge: 1 },
            },
            trace: [
                { nodeId: 'explore', kind: 'agent-turn', outcome: 'fail', startedAt: 0, finishedAt: 400, agentRef: 'cheap' },
                { nodeId: 'explore', kind: 'agent-turn', outcome: 'success', startedAt: 0, finishedAt: 500, agentRef: 'cheap' },
                { nodeId: 'implement', kind: 'agent-turn', outcome: 'success', startedAt: 500, finishedAt: 900, agentRef: 'writer' },
                { nodeId: 'judge', kind: 'agent-turn', outcome: 'verdict:pass', startedAt: 900, finishedAt: 1_000, agentRef: 'judge' },
            ],
        },
    });
    const graph = analyzeGraph(graphRun);
    assert.equal(graph.averageParallelism, 1.4);
    assert.equal(graph.peakParallelism, 2);
    assert.equal(graph.retryOverheadRate, 0.25);
    assert.equal(graph.recoveredFailure, true);
    assert.equal(graph.reviewerIndependent, true);
});

test('report separates tracks and renders graph diagnostics', () => {
    const qaap = run({
        qaapWorkflow: {
            run: { status: 'succeeded', nodeRuns: 1, visits: { implement: 1 } },
            trace: [
                { nodeId: 'implement', kind: 'agent-turn', outcome: 'success', startedAt: 0, finishedAt: 900, agentRef: 'same-model' },
            ],
        },
    });
    const cursor = run({
        id: 'cursor-1',
        system: 'Cursor',
        track: 'product-native',
        configuration: 'default',
        model: 'native',
    });
    const report = evaluateBenchmark({
        schemaVersion: 1,
        suite: { id: 'suite', name: 'Test suite', tasks: [tasks[0]] },
        runs: [qaap, cursor],
    });
    assert.equal(report.tracks.length, 2);
    assert.match(renderBenchmarkMarkdown(report), /Graph diagnostics/);
});

test('Wilson interval stays within zero and one', () => {
    const interval = wilsonInterval(3, 5);
    assert(interval.low > 0);
    assert(interval.high < 1);
});
