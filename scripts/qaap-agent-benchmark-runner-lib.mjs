import { spawn } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { minimatch } from 'minimatch';
import { evaluateBenchmark, renderBenchmarkMarkdown } from './qaap-agent-benchmark-lib.mjs';

const TERMINAL_WORKFLOW_STATUSES = new Set(['succeeded', 'failed', 'budget-exhausted']);
const DEFAULT_PROCESS_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;
const SNAPSHOT_IGNORES = new Set(['.git', 'node_modules', 'dist', 'build', '.next']);
const DEFAULT_FORBIDDEN_CHANGES = ['.env', '.env.*', '**/.env', '**/.env.*', '**/*.pem', '**/*.key'];

function assert(condition, message) {
    if (!condition) {
        throw new Error(`Invalid benchmark runner suite: ${message}`);
    }
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function sanitizeSegment(value) {
    return String(value).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'run';
}

function sessionId() {
    return `${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}-${randomUUID().slice(0, 8)}`;
}

function resolvePath(base, target) {
    return path.isAbsolute(target) ? path.normalize(target) : path.resolve(base, target);
}

function expand(value, context) {
    if (typeof value !== 'string') {
        return value;
    }
    return value.replace(
        /\{(workspace|suiteDir|promptFile|taskId|runId|runDir|agentOutput)\}/g,
        (_match, key) => context[key],
    );
}

function expandArgs(values, context) {
    return values.map(value => expand(value, context));
}

async function pathExists(target) {
    try {
        await fsp.access(target);
        return true;
    } catch {
        return false;
    }
}

function findExecutable(executable, environment = process.env) {
    if (executable.includes(path.sep)) {
        return fs.existsSync(executable) ? executable : undefined;
    }
    const pathValue = environment.PATH ?? '';
    for (const entry of pathValue.split(path.delimiter)) {
        const candidate = path.join(entry, executable);
        try {
            fs.accessSync(candidate, fs.constants.X_OK);
            return candidate;
        } catch {
            // Continue through PATH.
        }
    }
    return undefined;
}

function validateSuite(suite, suiteDir) {
    assert(suite?.schemaVersion === 1, 'schemaVersion must be 1');
    assert(suite.suite && typeof suite.suite.id === 'string', 'suite.id is required');
    assert(Array.isArray(suite.suite.tasks) && suite.suite.tasks.length, 'suite.tasks must not be empty');
    assert(Array.isArray(suite.systems) && suite.systems.length, 'systems must not be empty');
    assert(Number.isInteger(suite.repetitions ?? 1) && (suite.repetitions ?? 1) >= 1,
        'repetitions must be a positive integer');

    const taskIds = new Set();
    for (const task of suite.suite.tasks) {
        assert(typeof task.id === 'string' && task.id.trim(), 'every task needs an id');
        assert(!taskIds.has(task.id), `duplicate task id "${task.id}"`);
        taskIds.add(task.id);
        assert(typeof task.prompt === 'string' && task.prompt.trim(), `task "${task.id}" needs a prompt`);
        assert(task.fixture && typeof task.fixture.source === 'string', `task "${task.id}" needs fixture.source`);
        assert(['copy', 'git'].includes(task.fixture.type ?? 'copy'),
            `task "${task.id}" fixture.type must be "copy" or "git"`);
        const source = resolvePath(suiteDir, task.fixture.source);
        assert(fs.existsSync(source), `task "${task.id}" fixture source does not exist: ${source}`);
        assert(Array.isArray(task.oracle?.checks) && task.oracle.checks.length,
            `task "${task.id}" needs at least one oracle check`);
        for (const check of task.oracle.checks) {
            assert(typeof check.id === 'string' && check.id.trim(), `task "${task.id}" has an oracle check without id`);
            assert(typeof check.executable === 'string' && check.executable.trim(),
                `task "${task.id}" oracle "${check.id}" needs executable`);
            assert(Array.isArray(check.args ?? []), `task "${task.id}" oracle "${check.id}" args must be an array`);
        }
    }

    const systemIds = new Set();
    for (const system of suite.systems) {
        assert(typeof system.id === 'string' && system.id.trim(), 'every system needs an id');
        assert(!systemIds.has(system.id), `duplicate system id "${system.id}"`);
        systemIds.add(system.id);
        assert(['command', 'cursor-cli', 'claude-code', 'qaap-workflow'].includes(system.adapter),
            `system "${system.id}" has an unsupported adapter`);
        if (system.adapter === 'command') {
            assert(typeof system.executable === 'string' && system.executable.trim(),
                `command system "${system.id}" needs executable`);
            assert(Array.isArray(system.args), `command system "${system.id}" args must be an array`);
        }
        if (system.adapter === 'qaap-workflow') {
            assert(typeof system.baseUrl === 'string' && /^https?:\/\//.test(system.baseUrl),
                `Qaap system "${system.id}" needs an HTTP baseUrl`);
            assert(typeof system.templateId === 'string' && system.templateId.trim(),
                `Qaap system "${system.id}" needs templateId`);
            assert(system.maxNodeMinutes === undefined
                || (isFiniteNumber(system.maxNodeMinutes) && system.maxNodeMinutes > 0),
            `Qaap system "${system.id}" maxNodeMinutes must be a positive number`);
        }
    }
}

export async function loadRunnerSuite(suitePath) {
    const resolvedPath = path.resolve(suitePath);
    const suiteDir = path.dirname(resolvedPath);
    const suite = JSON.parse(await fsp.readFile(resolvedPath, 'utf8'));
    validateSuite(suite, suiteDir);
    return { suite, suitePath: resolvedPath, suiteDir };
}

function buildExecutionPlan(suite, selectedSystems, repetitions) {
    const plan = [];
    for (let repetition = 1; repetition <= repetitions; repetition++) {
        for (let taskIndex = 0; taskIndex < suite.suite.tasks.length; taskIndex++) {
            const task = suite.suite.tasks[taskIndex];
            const offset = (taskIndex + repetition - 1) % selectedSystems.length;
            const orderedSystems = [
                ...selectedSystems.slice(offset),
                ...selectedSystems.slice(0, offset),
            ];
            for (const system of orderedSystems) {
                plan.push({ task, system, repetition });
            }
        }
    }
    return plan;
}

export function describeRunnerPlan(suite, options = {}) {
    const selected = selectSystems(suite, options.systemIds);
    const repetitions = options.repetitions ?? suite.repetitions ?? 1;
    return buildExecutionPlan(suite, selected, repetitions).map((entry, index) => ({
        order: index + 1,
        taskId: entry.task.id,
        systemId: entry.system.id,
        adapter: entry.system.adapter,
        repetition: entry.repetition,
    }));
}

function selectSystems(suite, systemIds) {
    if (!systemIds?.length) {
        return suite.systems;
    }
    const wanted = new Set(systemIds);
    const selected = suite.systems.filter(system => wanted.has(system.id));
    const missing = [...wanted].filter(id => !selected.some(system => system.id === id));
    assert(!missing.length, `unknown selected systems: ${missing.join(', ')}`);
    assert(selected.length, 'at least one system must be selected');
    return selected;
}

async function finishLogStream(stream) {
    await new Promise(resolve => stream.end(resolve));
}

/**
 * Spawn one bounded process without a shell. Output is streamed to files and only a capped tail is
 * retained in memory for structured-result parsing.
 */
export async function runBoundedProcess({
    executable,
    args = [],
    cwd,
    env = {},
    timeoutMs = DEFAULT_PROCESS_TIMEOUT_MS,
    logDir,
}) {
    await fsp.mkdir(logDir, { recursive: true });
    const stdoutPath = path.join(logDir, 'stdout.log');
    const stderrPath = path.join(logDir, 'stderr.log');
    const stdoutStream = fs.createWriteStream(stdoutPath, { flags: 'w' });
    const stderrStream = fs.createWriteStream(stderrPath, { flags: 'w' });
    const startedAt = Date.now();
    let firstOutputAt;
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let spawnError;

    const child = spawn(executable, args, {
        cwd,
        env: {
            ...process.env,
            ...env,
            QAAP_BENCHMARK: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
    });
    const append = (chunk, stream, current, bytes) => {
        firstOutputAt ??= Date.now();
        stream.write(chunk);
        const combined = current.length === 0 ? chunk : Buffer.concat([current, chunk]);
        const retained = combined.length > MAX_CAPTURE_BYTES
            ? combined.subarray(combined.length - MAX_CAPTURE_BYTES)
            : combined;
        return {
            buffer: Buffer.from(retained),
            bytes: bytes + chunk.length,
        };
    };
    child.stdout.on('data', chunk => {
        const next = append(chunk, stdoutStream, stdout, stdoutBytes);
        stdout = next.buffer;
        stdoutBytes = next.bytes;
    });
    child.stderr.on('data', chunk => {
        const next = append(chunk, stderrStream, stderr, stderrBytes);
        stderr = next.buffer;
        stderrBytes = next.bytes;
    });

    const stopChild = signal => {
        try {
            if (process.platform !== 'win32' && child.pid) {
                process.kill(-child.pid, signal);
            } else {
                child.kill(signal);
            }
        } catch {
            // It already exited.
        }
    };
    const timeout = setTimeout(() => {
        timedOut = true;
        stopChild('SIGTERM');
        setTimeout(() => stopChild('SIGKILL'), 5_000).unref();
    }, timeoutMs);

    const terminal = await new Promise(resolve => {
        let settled = false;
        const finish = value => {
            if (!settled) {
                settled = true;
                resolve(value);
            }
        };
        child.once('error', error => {
            spawnError = error;
            finish({ exitCode: undefined, signal: undefined });
        });
        child.once('close', (exitCode, signal) => finish({ exitCode, signal }));
    });
    clearTimeout(timeout);
    await Promise.all([finishLogStream(stdoutStream), finishLogStream(stderrStream)]);
    const finishedAt = Date.now();
    return {
        executable,
        args,
        cwd,
        exitCode: terminal.exitCode,
        signal: terminal.signal,
        timedOut,
        spawnError: spawnError instanceof Error ? spawnError.message : undefined,
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
        firstOutputMs: firstOutputAt ? firstOutputAt - startedAt : undefined,
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
        stdoutPath,
        stderrPath,
        outputTruncated: stdoutBytes > MAX_CAPTURE_BYTES || stderrBytes > MAX_CAPTURE_BYTES,
    };
}

async function runGit(args, cwd, logDir) {
    const result = await runBoundedProcess({
        executable: 'git',
        args,
        cwd,
        timeoutMs: 60_000,
        logDir,
    });
    if (result.exitCode !== 0) {
        throw new Error(`git ${args[0]} failed: ${result.stderr.trim() || result.stdout.trim()}`);
    }
    return result;
}

async function ensureGitRepository(workspace, logDir) {
    if (await pathExists(path.join(workspace, '.git'))) {
        return;
    }
    await runGit(['init'], workspace, path.join(logDir, 'git-init'));
    await runGit(['config', 'user.email', 'benchmark@qaap.local'], workspace, path.join(logDir, 'git-config-email'));
    await runGit(['config', 'user.name', 'Qaap Benchmark'], workspace, path.join(logDir, 'git-config-name'));
    await runGit(['add', '-A'], workspace, path.join(logDir, 'git-add'));
    await runGit(
        ['-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'benchmark base'],
        workspace,
        path.join(logDir, 'git-commit'),
    );
}

async function prepareWorkspace(task, suiteDir, runDir) {
    const workspace = path.join(runDir, 'workspace');
    const source = resolvePath(suiteDir, task.fixture.source);
    await fsp.mkdir(runDir, { recursive: true });
    if ((task.fixture.type ?? 'copy') === 'git') {
        await runGit(['clone', '--local', '--no-hardlinks', source, workspace], suiteDir, path.join(runDir, 'fixture-clone'));
        if (task.fixture.ref) {
            await runGit(['checkout', '--detach', task.fixture.ref], workspace, path.join(runDir, 'fixture-checkout'));
        }
    } else {
        await fsp.cp(source, workspace, { recursive: true, errorOnExist: true });
    }
    if (task.fixture.initializeGit !== false) {
        await ensureGitRepository(workspace, path.join(runDir, 'fixture-git'));
    }
    return workspace;
}

async function runConfiguredCommands(commands, context, logRoot, defaultTimeoutMs) {
    const results = [];
    for (let index = 0; index < (commands ?? []).length; index++) {
        const command = commands[index];
        const executable = expand(command.executable, context);
        const args = expandArgs(command.args ?? [], context);
        const cwd = expand(command.cwd ?? '{workspace}', context);
        const result = await runBoundedProcess({
            executable,
            args,
            cwd,
            env: command.env ?? {},
            timeoutMs: command.timeoutMs ?? defaultTimeoutMs,
            logDir: path.join(logRoot, `${index + 1}-${sanitizeSegment(command.id ?? executable)}`),
        });
        results.push(result);
        if (result.exitCode !== 0 || result.timedOut) {
            throw new Error(`${command.id ?? executable} failed with exit code ${result.exitCode ?? 'none'}`);
        }
    }
    return results;
}

async function snapshotWorkspace(root, ignores = SNAPSHOT_IGNORES) {
    const files = new Map();
    const visit = async (directory, relative = '') => {
        const entries = await fsp.readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
            if (ignores.has(entry.name)) {
                continue;
            }
            const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
            const absolutePath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                await visit(absolutePath, relativePath);
            } else if (entry.isSymbolicLink()) {
                files.set(relativePath, `link:${await fsp.readlink(absolutePath)}`);
            } else if (entry.isFile()) {
                const content = await fsp.readFile(absolutePath);
                files.set(relativePath, createHash('sha256').update(content).digest('hex'));
            }
        }
    };
    await visit(root);
    return files;
}

function changedPaths(before, after) {
    const paths = new Set([...before.keys(), ...after.keys()]);
    return [...paths].filter(file => before.get(file) !== after.get(file)).sort();
}

function evaluateSafety(task, changed) {
    const forbidden = task.safety?.forbiddenChanges ?? DEFAULT_FORBIDDEN_CHANGES;
    const violations = changed.filter(file => forbidden.some(pattern => minimatch(file, pattern, { dot: true })));
    return {
        passed: violations.length === 0,
        violations,
        changedPaths: changed,
    };
}

function parseLastJson(text) {
    const trimmed = text.trim();
    if (!trimmed) {
        return undefined;
    }
    try {
        return JSON.parse(trimmed);
    } catch {
        const lines = trimmed.split('\n').reverse();
        for (const line of lines) {
            try {
                return JSON.parse(line);
            } catch {
                // Keep looking for the terminal structured event.
            }
        }
    }
    return undefined;
}

function resultTextFromObject(value) {
    if (!value || typeof value !== 'object') {
        return undefined;
    }
    for (const key of ['result', 'finalOutput', 'final_output', 'output', 'text', 'message']) {
        if (typeof value[key] === 'string' && value[key].trim()) {
            return value[key].trim();
        }
    }
    return undefined;
}

function resultTextFromLog(log) {
    const lines = String(log ?? '').split('\n').reverse();
    for (const line of lines) {
        try {
            const parsed = JSON.parse(line);
            const result = resultTextFromObject(parsed);
            if (result && (parsed.type === 'result' || parsed.subtype === 'success')) {
                return result;
            }
        } catch {
            // Structured agent logs also contain human-readable command output.
        }
    }
    return undefined;
}

/**
 * Normalize the user-facing answer into one artifact that hidden oracles can grade. Scoring only
 * workspace mutations made read-only audits impossible to evaluate and rewarded agents that
 * explored forever without ever delivering a report.
 */
function extractAgentOutput(agent) {
    if (Array.isArray(agent.taskDetails) && agent.taskDetails.length) {
        const nodeByTask = new Map((agent.qaapWorkflow?.trace ?? [])
            .filter(entry => entry.externalId)
            .map(entry => [entry.externalId, entry.nodeId]));
        const outputs = agent.taskDetails
            .map(detail => ({
                nodeId: nodeByTask.get(detail.id),
                text: resultTextFromLog(detail.log),
            }))
            .filter(entry => entry.text);
        const report = [...outputs].reverse().find(entry =>
            entry.nodeId === 'audit-revise' || entry.nodeId === 'audit-synthesis');
        return report?.text ?? outputs[outputs.length - 1]?.text ?? '';
    }
    return resultTextFromObject(agent.agentResult)
        ?? resultTextFromLog(agent.execution.stdout)
        ?? '';
}

function numericField(object, names) {
    for (const name of names) {
        if (isFiniteNumber(object?.[name])) {
            return object[name];
        }
    }
    return undefined;
}

function usageFromObject(object) {
    if (!object || typeof object !== 'object') {
        return {};
    }
    const directCost = numericField(object, ['total_cost_usd', 'cost_usd', 'costUsd']);
    const directTokens = numericField(object, ['total_tokens', 'totalTokens']);
    const usage = object.usage && typeof object.usage === 'object' ? object.usage : {};
    const inputTokens = numericField(usage, ['input_tokens', 'inputTokens']) ?? 0;
    const outputTokens = numericField(usage, ['output_tokens', 'outputTokens']) ?? 0;
    const cacheCreationTokens = numericField(usage, ['cache_creation_input_tokens', 'cacheCreationInputTokens']) ?? 0;
    const cacheReadTokens = numericField(usage, ['cache_read_input_tokens', 'cacheReadInputTokens']) ?? 0;
    let modelCost = 0;
    let modelTokens = 0;
    if (object.modelUsage && typeof object.modelUsage === 'object') {
        for (const model of Object.values(object.modelUsage)) {
            modelCost += numericField(model, ['costUSD', 'costUsd', 'cost_usd']) ?? 0;
            modelTokens += numericField(model, ['inputTokens', 'input_tokens']) ?? 0;
            modelTokens += numericField(model, ['outputTokens', 'output_tokens']) ?? 0;
            modelTokens += numericField(model, ['cacheReadInputTokens', 'cache_read_input_tokens']) ?? 0;
            modelTokens += numericField(model, ['cacheCreationInputTokens', 'cache_creation_input_tokens']) ?? 0;
        }
    }
    const totalTokens = directTokens
        ?? (inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens || undefined)
        ?? (modelTokens || undefined);
    return {
        ...(directCost !== undefined || modelCost > 0 ? { costUsd: directCost ?? modelCost } : {}),
        ...(totalTokens !== undefined ? { totalTokens } : {}),
    };
}

function usageFromLog(log) {
    const objects = [];
    for (const line of log.split('\n')) {
        try {
            const parsed = JSON.parse(line);
            if (parsed && typeof parsed === 'object') {
                objects.push(parsed);
            }
        } catch {
            // Plain-text agent log.
        }
    }
    const terminal = [...objects].reverse().find(entry =>
        entry.type === 'result' || entry.total_cost_usd !== undefined || entry.costUsd !== undefined);
    return usageFromObject(terminal);
}

function commandForSystem(system, task, context) {
    if (system.adapter === 'command') {
        return {
            executable: expand(system.executable, context),
            args: expandArgs(system.args, context),
            env: system.env ?? {},
        };
    }
    if (system.adapter === 'cursor-cli') {
        const args = [
            '-p',
            '--force',
            '--trust',
            '--sandbox',
            system.sandbox ?? 'enabled',
            '--output-format',
            'json',
        ];
        if (system.model) {
            args.push('--model', system.model);
        }
        args.push(context.prompt);
        return { executable: system.executable ?? 'cursor-agent', args, env: system.env ?? {} };
    }
    if (system.adapter === 'claude-code') {
        const args = ['-p', '--output-format', 'json', '--no-session-persistence'];
        if (system.dangerouslySkipPermissions === true) {
            args.push('--dangerously-skip-permissions');
        } else {
            args.push('--permission-mode', system.permissionMode ?? 'acceptEdits');
        }
        if (system.model) {
            args.push('--model', system.model);
        }
        if (Number.isInteger(system.maxTurns) && system.maxTurns > 0) {
            args.push('--max-turns', String(system.maxTurns));
        }
        if (system.enforceCostBudget !== false && isFiniteNumber(task.budgets?.costUsd)) {
            args.push('--max-budget-usd', String(task.budgets.costUsd));
        }
        if (Array.isArray(system.allowedTools) && system.allowedTools.length) {
            args.push('--allowedTools', system.allowedTools.join(','));
        }
        args.push(context.prompt);
        return { executable: system.executable ?? 'claude', args, env: system.env ?? {} };
    }
    throw new Error(`System "${system.id}" is not a command adapter`);
}

async function runCommandSystem(system, task, context, runDir) {
    const command = commandForSystem(system, task, context);
    const execution = await runBoundedProcess({
        ...command,
        cwd: context.workspace,
        timeoutMs: task.budgets?.wallTimeMs ?? DEFAULT_PROCESS_TIMEOUT_MS,
        logDir: path.join(runDir, 'agent'),
    });
    const structured = parseLastJson(execution.stdout);
    return {
        execution,
        usage: usageFromObject(structured),
        agentResult: structured,
        humanInterventions: 0,
    };
}

async function fetchJson(url, options = {}, timeoutMs = 15_000) {
    const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers ?? {}),
        },
    });
    const text = await response.text();
    let body;
    try {
        body = text ? JSON.parse(text) : {};
    } catch {
        body = { error: text };
    }
    if (!response.ok) {
        throw new Error(`${options.method ?? 'GET'} ${url} returned ${response.status}: ${body.error ?? text}`);
    }
    return body;
}

function joinUrl(baseUrl, pathname) {
    return `${baseUrl.replace(/\/+$/, '')}${pathname}`;
}

function mergeUsage(values) {
    const costs = values.map(value => value.costUsd).filter(isFiniteNumber);
    const tokens = values.map(value => value.totalTokens).filter(isFiniteNumber);
    return {
        ...(costs.length ? { costUsd: costs.reduce((sum, value) => sum + value, 0) } : {}),
        ...(tokens.length ? { totalTokens: tokens.reduce((sum, value) => sum + value, 0) } : {}),
    };
}

async function runQaapWorkflowSystem(system, task, context, runDir) {
    const baseUrl = system.baseUrl.replace(/\/+$/, '');
    const startedAt = Date.now();
    let humanInterventions = 0;
    const cwd = expand(system.cwd ?? '{workspace}', context);
    const startBody = {
        templateId: system.templateId,
        cwd,
        inputs: { task: context.prompt },
        verify: system.verify === true,
        reviewFix: system.reviewFix === true,
        ...(system.checkScript ? { checkScript: system.checkScript } : {}),
        ...(isFiniteNumber(system.maxNodeMinutes) && system.maxNodeMinutes > 0
            ? { maxNodeMinutes: system.maxNodeMinutes }
            : {}),
        ...(isFiniteNumber(task.budgets?.wallTimeMs)
            ? { maxRunMinutes: Math.max(1, Math.ceil(task.budgets.wallTimeMs / 60_000)) }
            : {}),
    };
    let workflow = await fetchJson(joinUrl(baseUrl, '/qaap/api/workflows'), {
        method: 'POST',
        body: JSON.stringify(startBody),
        headers: system.headers ?? {},
    });
    const runId = workflow.run?.id;
    if (!runId) {
        throw new Error('Qaap workflow start returned no run id');
    }
    const deadline = startedAt + (task.budgets?.wallTimeMs ?? DEFAULT_PROCESS_TIMEOUT_MS);
    const continuedGates = new Set();
    let timedOut = false;
    while (!TERMINAL_WORKFLOW_STATUSES.has(workflow.run?.status)) {
        if (Date.now() >= deadline) {
            timedOut = true;
            break;
        }
        if (workflow.run?.status === 'awaiting-human') {
            const nodeId = workflow.pendingDecision?.nodeId;
            if (system.humanGatePolicy !== 'auto-continue' || !nodeId) {
                break;
            }
            if (!continuedGates.has(nodeId)) {
                await fetchJson(joinUrl(baseUrl, `/qaap/api/workflows/${encodeURIComponent(runId)}/continue`), {
                    method: 'POST',
                    body: JSON.stringify({ nodeId }),
                    headers: system.headers ?? {},
                });
                continuedGates.add(nodeId);
                humanInterventions++;
            }
        }
        await new Promise(resolve => setTimeout(resolve, system.pollIntervalMs ?? 1_000));
        workflow = await fetchJson(joinUrl(baseUrl, `/qaap/api/workflows/${encodeURIComponent(runId)}`), {
            headers: system.headers ?? {},
        });
    }

    // The POST response intentionally omits trace details, and a very short workflow can finish
    // before the polling loop performs its first GET. Always refresh once before harvesting agent
    // task ids and usage.
    workflow = await fetchJson(joinUrl(baseUrl, `/qaap/api/workflows/${encodeURIComponent(runId)}`), {
        headers: system.headers ?? {},
    });

    const taskDetails = [];
    const externalIds = [...new Set((workflow.trace ?? [])
        .filter(entry => entry.kind === 'agent-turn' && entry.externalId)
        .map(entry => entry.externalId))];
    for (const externalId of externalIds) {
        try {
            taskDetails.push(await fetchJson(
                joinUrl(baseUrl, `/qaap/api/agent-tasks/${encodeURIComponent(externalId)}`),
                { headers: system.headers ?? {} },
            ));
        } catch (error) {
            taskDetails.push({ id: externalId, detailError: error instanceof Error ? error.message : String(error) });
        }
    }
    await fsp.mkdir(path.join(runDir, 'agent'), { recursive: true });
    await fsp.writeFile(path.join(runDir, 'agent', 'workflow.json'), `${JSON.stringify(workflow, null, 2)}\n`);
    await fsp.writeFile(path.join(runDir, 'agent', 'tasks.json'), `${JSON.stringify(taskDetails, null, 2)}\n`);
    const finishedAt = Date.now();
    return {
        execution: {
            startedAt,
            finishedAt,
            durationMs: finishedAt - startedAt,
            timedOut,
            exitCode: workflow.run?.status === 'succeeded' ? 0 : 1,
            workflowStatus: workflow.run?.status,
        },
        usage: mergeUsage(taskDetails.map(detail => usageFromLog(detail.log ?? ''))),
        qaapWorkflow: workflow,
        taskDetails,
        humanInterventions,
    };
}

async function runOracle(task, context, runDir) {
    const checks = [];
    let earnedWeight = 0;
    let totalWeight = 0;
    for (const check of task.oracle.checks) {
        const weight = check.weight ?? 1;
        totalWeight += weight;
        const result = await runBoundedProcess({
            executable: expand(check.executable, context),
            args: expandArgs(check.args ?? [], context),
            cwd: expand(check.cwd ?? '{workspace}', context),
            env: check.env ?? {},
            timeoutMs: check.timeoutMs ?? task.oracle.timeoutMs ?? 10 * 60 * 1000,
            logDir: path.join(runDir, 'oracle', sanitizeSegment(check.id)),
        });
        const passed = result.exitCode === 0 && !result.timedOut;
        if (passed) {
            earnedWeight += weight;
        }
        checks.push({
            id: check.id,
            passed,
            weight,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            durationMs: result.durationMs,
            stdoutPath: result.stdoutPath,
            stderrPath: result.stderrPath,
        });
    }
    return {
        score: totalWeight > 0 ? earnedWeight / totalWeight : 0,
        checksPassed: checks.filter(check => check.passed).length,
        checksTotal: checks.length,
        checks,
    };
}

function benchmarkTask(task) {
    return {
        id: task.id,
        ...(task.weight !== undefined ? { weight: task.weight } : {}),
        ...(task.completionThreshold !== undefined ? { completionThreshold: task.completionThreshold } : {}),
        ...(task.category ? { category: task.category } : {}),
        ...(task.difficulty ? { difficulty: task.difficulty } : {}),
        ...(task.budgets ? { budgets: task.budgets } : {}),
    };
}

async function failedRun(entry, runId, startedAt, error, runDir) {
    const finishedAt = Date.now();
    const result = {
        id: runId,
        taskId: entry.task.id,
        system: entry.system.name ?? entry.system.id,
        track: entry.system.track ?? 'unspecified',
        configuration: entry.system.configuration ?? entry.system.adapter,
        model: entry.system.model ?? 'unspecified',
        repetition: entry.repetition,
        oracle: { score: 0, checksPassed: 0, checksTotal: entry.task.oracle.checks.length },
        safety: { passed: false, violations: ['runner-error'] },
        humanInterventions: 0,
        timing: { wallTimeMs: finishedAt - startedAt },
        execution: { error: error instanceof Error ? error.message : String(error) },
        artifacts: { runDir },
    };
    await fsp.mkdir(runDir, { recursive: true });
    await fsp.writeFile(path.join(runDir, 'run.json'), `${JSON.stringify(result, null, 2)}\n`);
    return result;
}

async function runEntry(entry, suiteDir, sessionDir, options) {
    const runId = [
        sanitizeSegment(entry.system.id),
        sanitizeSegment(entry.task.id),
        `r${entry.repetition}`,
    ].join('-');
    const runDir = path.join(sessionDir, 'artifacts', runId);
    const startedAt = Date.now();
    try {
        const workspace = await prepareWorkspace(entry.task, suiteDir, runDir);
        const promptFile = path.join(runDir, 'prompt.txt');
        const context = {
            workspace,
            suiteDir,
            promptFile,
            taskId: entry.task.id,
            runId,
            prompt: entry.task.prompt,
        };
        await fsp.writeFile(promptFile, `${entry.task.prompt}\n`);
        await runConfiguredCommands(
            entry.task.setup,
            context,
            path.join(runDir, 'setup'),
            entry.task.setupTimeoutMs ?? 15 * 60 * 1000,
        );
        const snapshotIgnores = entry.task.safety?.strictWorkspaceSnapshot === true
            ? new Set(['.git'])
            : SNAPSHOT_IGNORES;
        const before = await snapshotWorkspace(workspace, snapshotIgnores);
        const agent = entry.system.adapter === 'qaap-workflow'
            ? await runQaapWorkflowSystem(entry.system, entry.task, context, runDir)
            : await runCommandSystem(entry.system, entry.task, context, runDir);
        const agentOutput = path.join(runDir, 'agent', 'final-output.txt');
        await fsp.mkdir(path.dirname(agentOutput), { recursive: true });
        await fsp.writeFile(agentOutput, `${extractAgentOutput(agent).trim()}\n`);
        context.runDir = runDir;
        context.agentOutput = agentOutput;
        const after = await snapshotWorkspace(workspace, snapshotIgnores);
        const safety = evaluateSafety(entry.task, changedPaths(before, after));
        const oracle = await runOracle(entry.task, context, runDir);
        const finishedAt = Date.now();
        const result = {
            id: runId,
            taskId: entry.task.id,
            system: entry.system.name ?? entry.system.id,
            track: entry.system.track ?? 'unspecified',
            configuration: entry.system.configuration ?? entry.system.adapter,
            model: entry.system.model ?? 'unspecified',
            repetition: entry.repetition,
            oracle,
            safety,
            humanInterventions: agent.humanInterventions,
            timing: {
                wallTimeMs: agent.execution.durationMs,
                ...(agent.execution.firstOutputMs !== undefined
                    ? { firstOutputMs: agent.execution.firstOutputMs }
                    : {}),
            },
            ...(Object.keys(agent.usage).length ? { usage: agent.usage } : {}),
            ...(agent.qaapWorkflow ? { qaapWorkflow: agent.qaapWorkflow } : {}),
            execution: {
                exitCode: agent.execution.exitCode,
                timedOut: agent.execution.timedOut,
                ...(agent.execution.signal ? { signal: agent.execution.signal } : {}),
                ...(agent.execution.spawnError ? { error: agent.execution.spawnError } : {}),
                totalHarnessMs: finishedAt - startedAt,
            },
            artifacts: {
                runDir,
                workspace,
                agentOutput,
                agentStdout: agent.execution.stdoutPath,
                agentStderr: agent.execution.stderrPath,
            },
        };
        await fsp.writeFile(path.join(runDir, 'run.json'), `${JSON.stringify(result, null, 2)}\n`);
        if (options.discardWorkspaces) {
            await fsp.rm(workspace, { recursive: true, force: true });
        }
        return result;
    } catch (error) {
        return failedRun(entry, runId, startedAt, error, runDir);
    }
}

async function preflightSystems(systems, allowHostAgentExecution) {
    if (!allowHostAgentExecution) {
        throw new Error(
            'Real agent execution is disabled. Re-run with --allow-host-agent-execution only in a disposable, trusted benchmark environment.',
        );
    }
    for (const system of systems) {
        if (system.adapter === 'qaap-workflow') {
            const templates = await fetchJson(joinUrl(system.baseUrl, '/qaap/api/workflows/templates'), {
                headers: system.headers ?? {},
            });
            if (!(templates.templates ?? []).some(template => template.id === system.templateId)) {
                throw new Error(`Qaap template "${system.templateId}" is not available at ${system.baseUrl}`);
            }
            continue;
        }
        const executable = system.adapter === 'cursor-cli'
            ? system.executable ?? 'cursor-agent'
            : system.adapter === 'claude-code'
                ? system.executable ?? 'claude'
                : system.executable;
        if (!findExecutable(executable, { ...process.env, ...(system.env ?? {}) })) {
            throw new Error(`Executable for system "${system.id}" was not found: ${executable}`);
        }
    }
}

/**
 * Execute a complete, counterbalanced suite and produce runs.json, report.json, and scorecard.md.
 */
export async function runBenchmarkSuite(options) {
    const loaded = await loadRunnerSuite(options.suitePath);
    const { suite, suiteDir } = loaded;
    const systems = selectSystems(suite, options.systemIds);
    const repetitions = options.repetitions ?? suite.repetitions ?? 1;
    const plan = buildExecutionPlan(suite, systems, repetitions);
    if (options.dryRun) {
        return { dryRun: true, plan: describeRunnerPlan(suite, { systemIds: options.systemIds, repetitions }) };
    }
    await preflightSystems(systems, options.allowHostAgentExecution === true);
    const outputDir = path.resolve(options.outputDir);
    const currentSessionId = sessionId();
    const sessionDir = path.join(outputDir, 'sessions', currentSessionId);
    await fsp.mkdir(sessionDir, { recursive: true });
    const runs = [];
    for (let index = 0; index < plan.length; index++) {
        const entry = plan[index];
        options.onProgress?.({
            type: 'run-start',
            index: index + 1,
            total: plan.length,
            taskId: entry.task.id,
            systemId: entry.system.id,
            repetition: entry.repetition,
        });
        const result = await runEntry(entry, suiteDir, sessionDir, options);
        runs.push(result);
        options.onProgress?.({ type: 'run-finish', index: index + 1, total: plan.length, result });
    }
    const manifest = {
        schemaVersion: 1,
        suite: {
            id: suite.suite.id,
            name: suite.suite.name ?? suite.suite.id,
            completionThreshold: suite.suite.completionThreshold ?? 1,
            tasks: suite.suite.tasks.map(benchmarkTask),
        },
        runs,
    };
    const report = evaluateBenchmark(manifest);
    const scorecard = renderBenchmarkMarkdown(report);
    await fsp.mkdir(outputDir, { recursive: true });
    const manifestPath = path.join(outputDir, 'runs.json');
    const reportPath = path.join(outputDir, 'report.json');
    const scorecardPath = path.join(outputDir, 'scorecard.md');
    await Promise.all([
        fsp.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`),
        fsp.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`),
        fsp.writeFile(scorecardPath, scorecard),
        fsp.writeFile(path.join(sessionDir, 'plan.json'), `${JSON.stringify(plan.map(entry => ({
            taskId: entry.task.id,
            systemId: entry.system.id,
            repetition: entry.repetition,
        })), null, 2)}\n`),
    ]);
    return {
        dryRun: false,
        manifest,
        report,
        scorecard,
        paths: { outputDir, sessionDir, manifestPath, reportPath, scorecardPath },
    };
}
