#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { evaluateBenchmark, renderBenchmarkMarkdown } from './qaap-agent-benchmark-lib.mjs';

function usage() {
    return [
        'Usage:',
        '  npm run qaap:agent-benchmark -- --input manifest.json [options]',
        '',
        'Options:',
        '  --json-out <path>      Write the machine-readable report.',
        '  --markdown-out <path>  Write the event/CI scorecard.',
        '  --fail-below <0-100>   Exit 1 when the gated system scores below this value.',
        '  --gate-system <name>   Apply --fail-below to this system (default: Qaap when present).',
        '  --help                 Show this help.',
    ].join('\n');
}

function parseArgs(argv) {
    const args = {};
    for (let index = 0; index < argv.length; index++) {
        const value = argv[index];
        if (value === '--help') {
            args.help = true;
            continue;
        }
        if (['--input', '--json-out', '--markdown-out', '--fail-below', '--gate-system'].includes(value)) {
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

function writeFile(target, content) {
    const resolved = path.resolve(target);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content);
    process.stderr.write(`Wrote ${resolved}\n`);
}

try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        process.stdout.write(`${usage()}\n`);
        process.exit(0);
    }
    if (!args.input) {
        throw new Error('--input is required');
    }
    const manifest = JSON.parse(fs.readFileSync(path.resolve(args.input), 'utf8'));
    const report = evaluateBenchmark(manifest);
    const markdown = renderBenchmarkMarkdown(report);
    process.stdout.write(markdown);
    if (args['json-out']) {
        writeFile(args['json-out'], `${JSON.stringify(report, null, 2)}\n`);
    }
    if (args['markdown-out']) {
        writeFile(args['markdown-out'], markdown);
    }
    if (args['fail-below'] !== undefined) {
        const threshold = Number(args['fail-below']);
        if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
            throw new Error('--fail-below must be between 0 and 100');
        }
        const defaultGate = report.systems.some(system => system.system.toLowerCase() === 'qaap') ? 'Qaap' : undefined;
        const gateSystem = args['gate-system'] ?? defaultGate;
        const gated = gateSystem
            ? report.systems.filter(system => system.system.toLowerCase() === gateSystem.toLowerCase())
            : report.systems;
        if (!gated.length) {
            throw new Error(`--gate-system did not match a system: ${gateSystem}`);
        }
        if (!gated.some(system => system.score >= threshold)) {
            process.exitCode = 1;
        }
    }
} catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${usage()}\n`);
    process.exitCode = 2;
}
