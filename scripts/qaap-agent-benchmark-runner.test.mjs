import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as http from 'http';
import * as path from 'path';
import { spawnSync } from 'node:child_process';
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

/** Derive a one-off suite from the self-test example, with absolute paths, inside `directory`. */
async function writeDerivedSuite(directory, mutate) {
    const { suite } = await loadRunnerSuite(suitePath);
    const [baseTask] = suite.suite.tasks;
    baseTask.fixture.source = path.join(root, baseTask.fixture.source);
    baseTask.oracle.checks[0].args = baseTask.oracle.checks[0].args.map(arg => arg.replace('{suiteDir}', root));
    mutate(suite, baseTask);
    const target = path.join(directory, 'suite.json');
    await fs.promises.writeFile(target, JSON.stringify(suite));
    return target;
}

const inlineAgent = cost => [
    '-e',
    `process.stdout.write(JSON.stringify({type:'result',subtype:'success',result:'ok',costUsd:${cost}})+'\\n')`,
];

test('maxSuiteCostUsd skips the remaining runs without launching the agent', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'qaap-benchmark-cap-'));
    try {
        const suiteFile = await writeDerivedSuite(dir, (suite, baseTask) => {
            suite.maxSuiteCostUsd = 1;
            suite.suite.tasks = ['one', 'two', 'three', 'four'].map(id => ({ ...structuredClone(baseTask), id }));
            suite.systems = [{
                id: 'expensive', name: 'Expensive', adapter: 'command', executable: 'node', args: inlineAgent(0.6),
            }];
        });
        const progress = [];
        const result = await runBenchmarkSuite({
            suitePath: suiteFile,
            outputDir: path.join(dir, 'out'),
            allowHostAgentExecution: true,
            onProgress: event => progress.push(event.type),
        });
        const runs = result.manifest.runs;
        assert.equal(runs.length, 4);
        // 0.6 then 1.2 (> 1): the cap is checked between runs, so the third and fourth are skipped.
        assert.equal(runs[0].execution.skipped, undefined);
        assert.equal(runs[1].execution.skipped, undefined);
        for (const skipped of runs.slice(2)) {
            assert.equal(skipped.execution.skipped, true);
            assert.equal(skipped.execution.skipReason, 'suite-budget-exhausted');
            assert.equal(skipped.oracle.score, 0);
            assert.equal(skipped.safety.passed, false);
            assert.equal(fs.existsSync(path.join(skipped.artifacts.runDir, 'agent')), false, 'agent never launched');
            assert.equal(fs.existsSync(path.join(skipped.artifacts.runDir, 'workspace')), false);
        }
        assert.equal(result.skippedRuns, 2);
        assert.ok(Math.abs(result.suiteCostUsd - 1.2) < 1e-9);
        assert.equal(progress.filter(type => type === 'run-skip').length, 2);
        assert.equal(result.report.systems[0].validCompletions, 0);
    } finally {
        await fs.promises.rm(dir, { recursive: true, force: true });
    }
});

test('maxSuiteCostUsd must be a positive number', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'qaap-benchmark-cap-invalid-'));
    try {
        const suiteFile = await writeDerivedSuite(dir, suite => {
            suite.maxSuiteCostUsd = -1;
        });
        await assert.rejects(loadRunnerSuite(suiteFile), /maxSuiteCostUsd/);
    } finally {
        await fs.promises.rm(dir, { recursive: true, force: true });
    }
});

/** Tiny in-process stand-in for the conversation + task endpoints. */
async function startConversationStub({ settleAfterPolls }) {
    const state = { created: [], cancelled: 0, polls: 0 };
    const server = http.createServer((request, response) => {
        let body = '';
        request.on('data', chunk => { body += chunk; });
        request.on('end', () => {
            const send = (status, value) => {
                response.writeHead(status, { 'content-type': 'application/json' });
                response.end(JSON.stringify(value));
            };
            if (request.method === 'GET' && request.url === '/qaap/api/agent-conversations/all') {
                return send(200, []);
            }
            if (request.method === 'POST' && request.url === '/qaap/api/agent-conversations') {
                const payload = JSON.parse(body);
                state.created.push(payload);
                if (settleAfterPolls !== Infinity) {
                    // The "agent" fixes the workspace as the real one would.
                    fs.writeFileSync(path.join(payload.cwd, 'answer.js'), 'export const answer = 42;\n');
                }
                return send(201, { id: 'conv-1', status: 'streaming', messages: [] });
            }
            if (request.method === 'POST' && request.url === '/qaap/api/agent-conversations/conv-1/cancel') {
                state.cancelled++;
                return send(200, { id: 'conv-1', status: 'cancelled' });
            }
            if (request.method === 'GET' && request.url === '/qaap/api/agent-conversations/conv-1') {
                state.polls++;
                const settled = state.polls > settleAfterPolls;
                return send(200, {
                    id: 'conv-1',
                    status: settled ? 'idle' : 'streaming',
                    pendingUserMessages: [],
                    messages: [
                        { role: 'user', content: 'prompt', taskId: 'task-1' },
                        { role: 'agent', content: 'Fixed answer.js.', taskId: 'task-1' },
                    ],
                });
            }
            if (request.method === 'GET' && request.url === '/qaap/api/agent-tasks/task-1') {
                return send(200, {
                    id: 'task-1',
                    state: 'completed',
                    verification: { status: 'passed', command: 'npm test', attempts: 1 },
                    review: { status: 'passed', reason: 'looks fine' },
                    log: `${JSON.stringify({ type: 'result', subtype: 'success', result: 'x', total_cost_usd: 0.12 })}\n`,
                });
            }
            return send(404, { error: `unexpected ${request.method} ${request.url}` });
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return {
        state,
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise(resolve => server.close(resolve)),
    };
}

test('qaap-conversation adapter drives the conversation API and records verdicts and cost', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'qaap-benchmark-conversation-'));
    const stub = await startConversationStub({ settleAfterPolls: 3 });
    try {
        const suiteFile = await writeDerivedSuite(dir, suite => {
            suite.suite.tasks[0].budgets = { wallTimeMs: 20000, costUsd: 0.5, humanInterventions: 0 };
            suite.systems = [{
                id: 'conversation', name: 'Conversation', adapter: 'qaap-conversation',
                baseUrl: stub.baseUrl, agent: 'claude', pollIntervalMs: 10,
            }];
        });
        const result = await runBenchmarkSuite({
            suitePath: suiteFile,
            outputDir: path.join(dir, 'out'),
            allowHostAgentExecution: true,
        });
        const [run] = result.manifest.runs;
        assert.equal(stub.state.created.length, 1);
        const [payload] = stub.state.created;
        assert.equal(payload.agent, 'claude');
        assert.equal(payload.isolation, 'none');
        assert.equal(payload.cwd, run.artifacts.workspace);
        assert.match(payload.title, /repair-answer/);
        assert.match(payload.message, /answer\.js/);
        assert.ok(stub.state.polls > 3, 'polled until the conversation settled');
        assert.equal(stub.state.cancelled, 0);

        assert.equal(run.oracle.score, 1);
        assert.equal(run.safety.passed, true);
        assert.equal(run.execution.exitCode, 0);
        assert.equal(run.humanInterventions, 0);
        assert.equal(run.usage.costUsd, 0.12);
        assert.equal(run.conversation.id, 'conv-1');
        assert.equal(run.conversation.status, 'idle');
        assert.deepEqual(run.conversation.tasks, [{
            taskId: 'task-1',
            state: 'completed',
            verification: { status: 'passed', command: 'npm test', attempts: 1 },
            review: { status: 'passed', reason: 'looks fine' },
            costUsd: 0.12,
        }]);
        assert.match(fs.readFileSync(run.artifacts.agentOutput, 'utf8'), /Fixed answer\.js\./);
        assert.equal(result.report.systems[0].score, 100);
    } finally {
        await stub.close();
        await fs.promises.rm(dir, { recursive: true, force: true });
    }
});

test('qaap-conversation adapter enforces the wall-time budget by cancelling the conversation', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'qaap-benchmark-conversation-timeout-'));
    const stub = await startConversationStub({ settleAfterPolls: Infinity });
    try {
        const suiteFile = await writeDerivedSuite(dir, suite => {
            suite.suite.tasks[0].budgets = { wallTimeMs: 300, costUsd: 0.5, humanInterventions: 0 };
            suite.systems = [{
                id: 'conversation', name: 'Conversation', adapter: 'qaap-conversation',
                baseUrl: stub.baseUrl, pollIntervalMs: 20,
            }];
        });
        const result = await runBenchmarkSuite({
            suitePath: suiteFile,
            outputDir: path.join(dir, 'out'),
            allowHostAgentExecution: true,
        });
        const [run] = result.manifest.runs;
        assert.equal(stub.state.cancelled, 1);
        assert.equal(run.execution.timedOut, true);
        assert.equal(run.execution.exitCode, 1);
        assert.equal(run.oracle.score, 0);
        assert.equal(stub.state.created[0].agent, 'claude', 'agent defaults to claude');
        assert.equal(result.report.systems[0].validCompletions, 0);
    } finally {
        await stub.close();
        await fs.promises.rm(dir, { recursive: true, force: true });
    }
});

const nightlyDir = path.join(root, 'qaap-agent-benchmark-nightly');
const nightlyTasks = fs.readdirSync(path.join(nightlyDir, 'fixtures')).sort();

test('the nightly suite has 10 tasks with the intended mix, budgets and safety rules', async () => {
    const { suite } = await loadRunnerSuite(path.join(nightlyDir, 'suite.json'));
    const tasks = suite.suite.tasks;
    assert.equal(tasks.length, 10);
    assert.deepEqual(tasks.map(task => task.id).sort(), nightlyTasks);
    const count = category => tasks.filter(task => task.category === category).length;
    assert.deepEqual([count('bug-fix'), count('feature'), count('refactor')], [4, 3, 3]);
    for (const task of tasks) {
        assert.deepEqual(task.budgets, { wallTimeMs: 600000, costUsd: 0.5, humanInterventions: 0 });
        assert.ok(task.safety.forbiddenChanges.includes('.env'), `${task.id} protects secrets`);
        assert.ok(task.safety.forbiddenChanges.some(pattern => pattern.startsWith('test/')), `${task.id} protects public tests`);
        assert.equal(fs.existsSync(path.join(nightlyDir, 'oracles', `${task.id}.mjs`)), true);
        assert.equal(fs.existsSync(path.join(nightlyDir, 'solutions', task.id)), true);
    }
});

function runNightlyOracle(task, workspace) {
    return spawnSync(process.execPath, [path.join(nightlyDir, 'oracles', `${task}.mjs`), workspace], {
        encoding: 'utf8',
        timeout: 120_000,
    });
}

for (const task of nightlyTasks) {
    test(`nightly fixture ${task} fails its oracle as shipped and passes with the reference solution`, async () => {
        const workspace = await fs.promises.mkdtemp(path.join(os.tmpdir(), `qaap-nightly-${task}-`));
        try {
            await fs.promises.cp(path.join(nightlyDir, 'fixtures', task), workspace, { recursive: true });
            // The shipped public tests are green (the fixture is a working project)...
            const publicTests = spawnSync(process.execPath, ['--test'], {
                cwd: workspace, encoding: 'utf8', env: { ...process.env, TZ: 'UTC' },
            });
            assert.equal(publicTests.status, 0, `public tests of ${task}:\n${publicTests.stdout}${publicTests.stderr}`);
            // ...but the task is not solved.
            const shipped = runNightlyOracle(task, workspace);
            assert.notEqual(shipped.status, 0, `${task} must not already satisfy its oracle`);
            await fs.promises.cp(path.join(nightlyDir, 'solutions', task), workspace, { recursive: true, force: true });
            const solved = runNightlyOracle(task, workspace);
            assert.equal(solved.status, 0, `reference solution of ${task} must pass:\n${solved.stderr}`);
        } finally {
            await fs.promises.rm(workspace, { recursive: true, force: true });
        }
    });
}

test('the nightly --self-test smoke passes end to end', async () => {
    const output = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'qaap-nightly-selftest-'));
    try {
        const result = spawnSync(process.execPath, [
            path.join(root, 'qaap-agent-benchmark-nightly.mjs'), '--self-test', '--output', output,
        ], { encoding: 'utf8', timeout: 300_000 });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Nightly benchmark: 10\/10 tasks passed \(100\.0%\)/);
        const report = JSON.parse(fs.readFileSync(path.join(output, 'report.json'), 'utf8'));
        assert.equal(report.nightly.successRate, 1);
        assert.match(fs.readFileSync(path.join(output, 'scorecard.md'), 'utf8'), /10\/10 tasks passed/);
    } finally {
        await fs.promises.rm(output, { recursive: true, force: true });
    }
});
