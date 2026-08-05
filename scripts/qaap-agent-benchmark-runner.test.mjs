import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    commandForSystem,
    describeRunnerPlan,
    loadRunnerSuite,
    runBenchmarkSuite,
    runBoundedProcess,
} from './qaap-agent-benchmark-runner-lib.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const suitePath = path.join(root, 'qaap-agent-benchmark-runner.example.json');
const securitySuitePath = path.join(root, 'qaap-agent-benchmark-security-self-test.json');

test('OpenClaude uses the Claude-compatible headless harness contract', () => {
    const command = commandForSystem(
        {
            id: 'openclaude',
            adapter: 'openclaude',
            bare: true,
            model: 'test-model',
            maxTurns: 7,
            allowedTools: ['Read', 'Grep'],
        },
        { budgets: { costUsd: 2 } },
        { prompt: 'repair the fixture' },
    );
    assert.equal(command.executable, 'openclaude');
    assert.deepEqual(command.args, [
        '-p',
        '--output-format', 'json',
        '--no-session-persistence',
        '--bare',
        '--permission-mode', 'acceptEdits',
        '--model', 'test-model',
        '--max-turns', '7',
        '--max-budget-usd', '2',
        '--allowedTools', 'Read,Grep',
        'repair the fixture',
    ]);
});

test('runner builds a counterbalanced plan', async () => {
    const { suite } = await loadRunnerSuite(suitePath);
    suite.systems.push({
        ...suite.systems[0],
        id: 'second-mock',
        name: 'Second Mock',
    });
    const plan = describeRunnerPlan(suite, { repetitions: 2 });
    assert.equal(plan.length, 4);
    assert.deepEqual(plan.map(entry => entry.systemId), [
        'deterministic-mock',
        'second-mock',
        'second-mock',
        'deterministic-mock',
    ]);
});

test('bounded processes report their first output and timeout', async () => {
    const output = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'qaap-benchmark-process-'));
    try {
        const result = await runBoundedProcess({
            executable: process.execPath,
            args: ['-e', 'process.stdout.write("ready"); setInterval(() => {}, 1000)'],
            cwd: output,
            timeoutMs: 200,
            logDir: path.join(output, 'logs'),
        });
        assert.equal(result.timedOut, true);
        assert.match(result.stdout, /ready/);
        assert(result.firstOutputMs >= 0);
    } finally {
        await fs.promises.rm(output, { recursive: true, force: true });
    }
});

test('runner executes a deterministic agent, hidden oracle, and scorecard end to end', async () => {
    const output = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'qaap-benchmark-runner-'));
    try {
        const result = await runBenchmarkSuite({
            suitePath,
            outputDir: output,
            allowHostAgentExecution: true,
        });
        assert.equal(result.manifest.runs.length, 1);
        assert.equal(result.manifest.runs[0].oracle.score, 1);
        assert.equal(result.manifest.runs[0].safety.passed, true);
        assert.equal(result.report.systems[0].score, 100);
        assert.equal(fs.existsSync(result.paths.manifestPath), true);
        assert.equal(fs.existsSync(result.paths.reportPath), true);
        assert.equal(fs.existsSync(result.paths.scorecardPath), true);
        const agentOutput = result.manifest.runs[0].artifacts.agentOutput;
        assert.equal(fs.existsSync(agentOutput), true);
        assert.match(fs.readFileSync(agentOutput, 'utf8'), /completed the task/i);
    } finally {
        await fs.promises.rm(output, { recursive: true, force: true });
    }
});

test('security audit runner grades final report evidence without workspace mutations', async () => {
    const output = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'qaap-security-benchmark-runner-'));
    try {
        const result = await runBenchmarkSuite({
            suitePath: securitySuitePath,
            outputDir: output,
            allowHostAgentExecution: true,
        });
        const run = result.manifest.runs[0];
        assert.equal(run.oracle.score, 1);
        assert.equal(run.oracle.checksPassed, 3);
        assert.equal(run.safety.passed, true);
        assert.deepEqual(run.safety.changedPaths, []);
        assert.equal(result.report.systems[0].score, 100);
        assert.match(fs.readFileSync(run.artifacts.agentOutput, 'utf8'), /stored XSS/i);
    } finally {
        await fs.promises.rm(output, { recursive: true, force: true });
    }
});

test('security audit oracle rejects missed findings, invented evidence, and severity inflation', async () => {
    const output = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'qaap-security-oracle-negative-'));
    const reportPath = path.join(output, 'bad-report.md');
    const oraclePath = path.join(root, 'qaap-agent-benchmark-fixture/security-audit-oracle.mjs');
    try {
        await fs.promises.writeFile(reportPath, [
            '# Scope',
            'Finding 1 — Severity: Critical',
            'server/routes/safe-admin.js:1 is a High vulnerability because it contains an authorization check.',
            'Everything was runtime verified.',
        ].join('\n'));
        for (const mode of ['coverage', 'evidence', 'calibration']) {
            const result = await runBoundedProcess({
                executable: process.execPath,
                args: [oraclePath, mode, reportPath],
                cwd: output,
                timeoutMs: 5_000,
                logDir: path.join(output, mode),
            });
            assert.notEqual(result.exitCode, 0, `${mode} should reject the unsupported report`);
        }
    } finally {
        await fs.promises.rm(output, { recursive: true, force: true });
    }
});

test('runner refuses agent execution without an explicit host gate', async () => {
    const output = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'qaap-benchmark-gate-'));
    try {
        await assert.rejects(
            runBenchmarkSuite({ suitePath, outputDir: output }),
            /--allow-host-agent-execution/,
        );
    } finally {
        await fs.promises.rm(output, { recursive: true, force: true });
    }
});
