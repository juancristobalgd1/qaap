#!/usr/bin/env node

// Nightly benchmark: 10 small real tasks driven through the default product path (agent conversations).
// Builds nothing: point it at a running backend. See the "Nightly" section of qaap-agent-benchmark.md.

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { runBenchmarkSuite } from './qaap-agent-benchmark-runner-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const nightlyDir = path.join(here, 'qaap-agent-benchmark-nightly');
const DEFAULT_BASE_URL = 'http://127.0.0.1:3100';
const DEFAULT_MAX_COST_USD = 5;

function usage() {
    return [
        'Usage:',
        '  npm run qaap:agent-benchmark:nightly -- [options]',
        '',
        'Options:',
        '  --base-url <url>   Running backend (default: $QAAP_BENCHMARK_BASE_URL or ' + DEFAULT_BASE_URL + ').',
        '  --output <dir>     Output directory (default: test-results/qaap-agent-benchmark/nightly).',
        '  --self-test        Run the suite with a deterministic mock solver instead of a backend (CI smoke).',
        '  --help             Show this help.',
        '',
        'Environment:',
        '  QAAP_BENCHMARK_AGENT           Agent id sent to the conversation API (default: claude).',
        '  QAAP_BENCHMARK_MAX_COST_USD    Suite cost cap; remaining tasks are skipped past it (default: ' + DEFAULT_MAX_COST_USD + ').',
        '  QAAP_BENCHMARK_BASE_URL        Backend URL when --base-url is not given.',
    ].join('\n');
}

function parseArgs(argv) {
    const args = {};
    for (let index = 0; index < argv.length; index++) {
        const value = argv[index];
        if (value === '--self-test' || value === '--help') {
            args[value.slice(2)] = true;
        } else if (value === '--base-url' || value === '--output') {
            const next = argv[++index];
            if (!next) {
                throw new Error(`${value} requires a value`);
            }
            args[value.slice(2)] = next;
        } else {
            throw new Error(`Unknown argument: ${value}`);
        }
    }
    return args;
}

function parseMaxCost(raw) {
    if (raw === undefined || raw === '') {
        return DEFAULT_MAX_COST_USD;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('QAAP_BENCHMARK_MAX_COST_USD must be a positive number');
    }
    return parsed;
}

/**
 * Resolve the checked-in suite for this run: absolute fixture/oracle paths (the resolved file lives in the
 * output directory), the live backend URL and agent, and the cost cap.
 */
export async function buildNightlySuite({ baseUrl, agent, maxSuiteCostUsd, selfTest }) {
    const suite = JSON.parse(await fsp.readFile(path.join(nightlyDir, 'suite.json'), 'utf8'));
    suite.maxSuiteCostUsd = maxSuiteCostUsd;
    for (const task of suite.suite.tasks) {
        task.fixture.source = path.join(nightlyDir, task.fixture.source);
        for (const check of task.oracle.checks) {
            check.args = check.args.map(arg => arg.replace('{suiteDir}', nightlyDir));
        }
    }
    suite.systems = selfTest
        ? [{
            id: 'nightly-self-test',
            name: 'Nightly self-test (mock solver)',
            track: 'nightly',
            configuration: 'mock',
            model: 'none',
            adapter: 'command',
            executable: 'node',
            args: [path.join(nightlyDir, 'mock-solver.mjs'), '{workspace}', '{taskId}'],
        }]
        : suite.systems.map(system => ({ ...system, baseUrl, agent }));
    return suite;
}

export function summarize(result, maxSuiteCostUsd) {
    const system = result.report.systems[0];
    const total = result.manifest.runs.length;
    const passed = system?.validCompletions ?? 0;
    const successRate = total > 0 ? passed / total : 0;
    return {
        suite: result.manifest.suite.id,
        system: system?.system,
        passed,
        total,
        successRate,
        suiteCostUsd: result.suiteCostUsd,
        maxSuiteCostUsd,
        skippedRuns: result.skippedRuns,
        line: `Nightly benchmark: ${passed}/${total} tasks passed (${(successRate * 100).toFixed(1)}%)`
            + ` cost=$${result.suiteCostUsd.toFixed(4)}/${maxSuiteCostUsd} skipped=${result.skippedRuns}`,
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        process.stdout.write(`${usage()}\n`);
        return 0;
    }
    const maxSuiteCostUsd = parseMaxCost(process.env.QAAP_BENCHMARK_MAX_COST_USD);
    const outputDir = path.resolve(args.output ?? 'test-results/qaap-agent-benchmark/nightly');
    const selfTest = args['self-test'] === true;
    const suite = await buildNightlySuite({
        baseUrl: args['base-url'] ?? process.env.QAAP_BENCHMARK_BASE_URL ?? DEFAULT_BASE_URL,
        agent: process.env.QAAP_BENCHMARK_AGENT || 'claude',
        maxSuiteCostUsd,
        selfTest,
    });
    await fsp.mkdir(outputDir, { recursive: true });
    const suitePath = path.join(outputDir, 'suite.resolved.json');
    await fsp.writeFile(suitePath, `${JSON.stringify(suite, null, 2)}\n`);

    const result = await runBenchmarkSuite({
        suitePath,
        outputDir,
        allowHostAgentExecution: true,
        onProgress: event => {
            if (event.type === 'run-start') {
                process.stderr.write(`[${event.index}/${event.total}] ${event.taskId}\n`);
            } else if (event.type === 'run-skip') {
                process.stderr.write(`  skipped: ${event.result.execution.skipReason}\n`);
            } else {
                process.stderr.write(`  oracle=${event.result.oracle.score} safety=${event.result.safety.passed ? 'pass' : 'fail'}`
                    + ` time=${event.result.timing.wallTimeMs}ms\n`);
            }
        },
    });
    const summary = summarize(result, maxSuiteCostUsd);
    // The success rate travels with the report (and the job summary) so trends need no recomputation.
    const report = { ...result.report, nightly: summary };
    await fsp.writeFile(result.paths.reportPath, `${JSON.stringify(report, null, 2)}\n`);
    await fsp.writeFile(result.paths.scorecardPath, `${result.scorecard}\n\n**${summary.line}**\n`);
    process.stdout.write(`${summary.line}\n`);

    if (selfTest && (summary.passed !== summary.total || summary.skippedRuns !== 0)) {
        process.stderr.write('Self-test expected every task to pass with the reference solutions.\n');
        return 1;
    }
    return 0;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
    try {
        process.exitCode = await main();
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${usage()}\n`);
        process.exitCode = 2;
    }
}
