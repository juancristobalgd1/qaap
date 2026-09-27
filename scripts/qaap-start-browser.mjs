#!/usr/bin/env node
/**
 * Cross-platform entry point for the browser development server.
 * Keeps environment setup out of the shell so npm behaves the same on Windows,
 * macOS, and Linux.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';
const command = isWindows ? (process.env.ComSpec || 'cmd.exe') : npm;
const args = isWindows
    ? ['/d', '/s', '/c', `${npm} run start -- --hostname=:: --port 3000`]
    : ['run', 'start', '--', '--hostname=::', '--port', '3000'];
const env = {
    ...process.env,
    QAAP_SKIP_AUTH: process.env.QAAP_SKIP_AUTH || '1',
};

const child = spawn(command, args, {
    cwd: `${root}/examples/browser`,
    env,
    stdio: 'inherit',
    windowsHide: false,
});

child.once('error', error => {
    console.error(`[qaap] Could not start the browser server: ${error.message}`);
    process.exitCode = 1;
});

child.once('exit', (code, signal) => {
    if (signal) {
        console.error(`[qaap] Browser server exited after ${signal}`);
        process.exitCode = 1;
    } else {
        process.exitCode = code ?? 1;
    }
});
