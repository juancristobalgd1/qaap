#!/usr/bin/env node

import { describeRunnerPlan, loadRunnerSuite, runBenchmarkSuite } from './qaap-agent-benchmark-runner-lib.mjs';

function usage() {
    return [
        'Usage:',
        '  npm run qaap:agent-benchmark:run -- --suite suite.json [options]',
        '',
        'Options:',
        '  --output <directory>             Report and run-artifact directory.',
        '  --systems <id,id>                Run only these configured systems.',
        '  --repetitions <n>                Override suite repetitions.',
        '  --dry-run                        Validate and print the execution plan.',
        '  --allow-host-agent-execution     Required before any agent is launched.',
        '  --discard-workspaces             Remove disposable workspaces after grading.',
        '  --fail-below <0-100>             Fail when the gated system misses the score.',
        '  --gate-system <name>             System name used by --fail-below (default: Qaap).',
        '  --help                           Show this help.',
    ].join('\n');
}

function parseArgs(argv) {
    const args = {};
    const flags = new Set(['--dry-run', '--allow-host-agent-execution', '--discard-workspaces', '--help']);
    const valued = new Set(['--suite', '--output', '--systems', '--repetitions', '--fail-below', '--gate-system']);
    for (let index = 0; index < argv.length; index++) {
        const value = argv[index];
        if (flags.has(value)) {
            args[value.slice(2)] = true;
            continue;
        }
        if (valued.has(value)) {
            const next = argv[++index];
            if (!next) {
                throw new Error(`${value} requires a value`);
            }
            args[value.slice(2)] = next;
            continue;
        }
        throw new Error(`Unknown argument: ${value}`);
    }
    return args;
}

function parsePositiveInteger(value, flag) {
    if (value === undefined) {
        return undefined;
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`${flag} must be a positive integer`);
    }
    return parsed;
}

function printPlan(plan) {
    process.stdout.write('Order  Task  System  Adapter  Repetition\n');
    for (const entry of plan) {
        process.stdout.write(
            `${entry.order}  ${entry.taskId}  ${entry.systemId}  ${entry.adapter}  ${entry.repetition}\n`,
        );
    }
}

try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        process.stdout.write(`${usage()}\n`);
        process.exit(0);
    }
    if (!args.suite) {
        throw new Error('--suite is required');
    }
    const systemIds = args.systems?.split(',').map(value => value.trim()).filter(Boolean);
    const repetitions = parsePositiveInteger(args.repetitions, '--repetitions');
    if (args['dry-run']) {
        const { suite } = await loadRunnerSuite(args.suite);
        printPlan(describeRunnerPlan(suite, { systemIds, repetitions }));
        process.exit(0);
    }
    const result = await runBenchmarkSuite({
        suitePath: args.suite,
        outputDir: args.output ?? 'test-results/qaap-agent-benchmark/live',
        systemIds,
        repetitions,
        allowHostAgentExecution: args['allow-host-agent-execution'] === true,
        discardWorkspaces: args['discard-workspaces'] === true,
        onProgress: event => {
            if (event.type === 'run-start') {
                process.stderr.write(
                    `[${event.index}/${event.total}] ${event.systemId} → ${event.taskId} (r${event.repetition})\n`,
                );
            } else {
                process.stderr.write(
                    `  oracle=${event.result.oracle.score} safety=${event.result.safety.passed ? 'pass' : 'fail'}`
                    + ` time=${event.result.timing.wallTimeMs}ms\n`,
                );
            }
        },
    });
    process.stdout.write(result.scorecard);
    process.stderr.write(`Runs: ${result.paths.manifestPath}\n`);
    process.stderr.write(`Report: ${result.paths.reportPath}\n`);
    process.stderr.write(`Scorecard: ${result.paths.scorecardPath}\n`);

    if (args['fail-below'] !== undefined) {
        const threshold = Number(args['fail-below']);
        if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
            throw new Error('--fail-below must be between 0 and 100');
        }
        const gateName = args['gate-system'] ?? 'Qaap';
        const systems = result.report.systems.filter(
            system => system.system.toLowerCase() === gateName.toLowerCase(),
        );
        if (!systems.length) {
            throw new Error(`--gate-system did not match a system: ${gateName}`);
        }
        if (!systems.some(system => system.score >= threshold)) {
            process.exitCode = 1;
        }
    }
} catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${usage()}\n`);
    process.exitCode = 2;
}
