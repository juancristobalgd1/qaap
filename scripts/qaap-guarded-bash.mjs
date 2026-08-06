#!/usr/bin/env node

/**
 * Shell boundary for hosted QAIQ/OpenClaude processes.
 *
 * QAIQ's interactive stdio approval channel is intentionally bypassed by its
 * full-access mode. This executable remains between QAIQ and /bin/bash, so the
 * Qaap destructive-command policy still applies to headless and bypass runs.
 * The compiled guard is loaded fail-closed: a missing build is safer than
 * silently falling back to an unguarded shell.
 */

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const guardModulePath = resolve(
    scriptDirectory,
    '../packages/qaap-cloud-workspace/lib/common/qaap-agent-destructive-command-guard.js',
);

if (!existsSync(guardModulePath)) {
    process.stderr.write('[qaap] guarded QAIQ shell is unavailable because the compiled guard is missing.\n');
    process.exit(126);
}

let isDestructiveShellCommand;
try {
    ({ isDestructiveShellCommand } = createRequire(import.meta.url)(guardModulePath));
} catch (error) {
    process.stderr.write(`[qaap] failed to load the guarded QAIQ shell: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(126);
}

const command = args[0] === '-c' && typeof args[1] === 'string' ? args[1] : undefined;
if (command && isDestructiveShellCommand(command)) {
    process.stderr.write('[qaap] blocked destructive shell command at the QAIQ CLI boundary.\n');
    process.exit(126);
}

const result = spawnSync('/bin/bash', args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
});
if (result.error) {
    process.stderr.write(`[qaap] failed to start bash: ${result.error.message}\n`);
    process.exit(126);
}
if (result.signal) {
    process.kill(process.pid, result.signal);
    process.exit(128);
}
process.exit(result.status ?? 1);
