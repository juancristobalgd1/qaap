#!/usr/bin/env node
/**
 * Development entry point for the Electron app (`examples/electron`, script `start`).
 * Mirrors `qaap-start-browser.mjs`: a local desktop run skips the sign-in gate by default
 * (QAAP_SKIP_AUTH=1, the same as `npm run start:browser`). The Electron backend listens on
 * loopback only and accepts requests from the app window's token cookie, so no GitHub
 * OAuth callback (which would need a fixed port) is involved. Arguments are passed to `theia start`.
 */
import { spawn } from 'node:child_process';

const isWindows = process.platform === 'win32';
const env = {
    ...process.env,
    QAAP_SKIP_AUTH: process.env.QAAP_SKIP_AUTH || '1',
};

const child = spawn('theia', ['start', ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
    // npm puts the package's `node_modules/.bin` on PATH; on Windows `theia` is a `.cmd` shim.
    shell: isWindows,
});

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
}

child.once('error', error => {
    console.error(`[qaap] Could not start the Electron app: ${error.message}`);
    process.exitCode = 1;
});

child.once('exit', (code, signal) => {
    if (signal) {
        console.error(`[qaap] Electron app exited after ${signal}`);
        process.exitCode = 1;
    } else {
        process.exitCode = code ?? 1;
    }
});
