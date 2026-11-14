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
// A Qaap preview of this repo hands over a port it verified free (QAAP_PREVIEW_PORT); :3000 is
// usually the IDE that runs the preview. QAAP_DEV_PORT is the manual override.
const port = [process.env.QAAP_PREVIEW_PORT, process.env.QAAP_DEV_PORT].find(value => /^\d{2,5}$/.test(value ?? '')) ?? '3000';
// A preview of this repo inside another Qaap (QAAP_NESTED_PREVIEW=1) runs without auth, so it
// listens on loopback only: the outer IDE's owner-gated preview proxy is its single way in.
const nested = process.env.QAAP_NESTED_PREVIEW === '1';
const hostname = nested ? '127.0.0.1' : '::';
const args = isWindows
    ? ['/d', '/s', '/c', `${npm} run start -- --hostname=${hostname} --port ${port}`]
    : ['run', 'start', '--', `--hostname=${hostname}`, '--port', port];
const nodeOptions = process.env.NODE_OPTIONS ?? '';
const env = {
    ...process.env,
    QAAP_SKIP_AUTH: process.env.QAAP_SKIP_AUTH || '1',
    // Bound the nested backend's heap so a heavy preview cannot push a memory-limited tenant
    // container (and the outer backend with it) into the OOM killer.
    ...(nested && !/--max-old-space-size\b/.test(nodeOptions)
        ? { NODE_OPTIONS: `${nodeOptions} --max-old-space-size=2048`.trim() }
        : {}),
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
