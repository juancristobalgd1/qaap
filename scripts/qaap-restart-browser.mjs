#!/usr/bin/env node
/**
 * Rebuild browser bundle (if requested) and restart npm run start:browser on port 3000.
 * Usage:
 *   node scripts/qaap-restart-browser.mjs          # restart only
 *   node scripts/qaap-restart-browser.mjs --build  # compile + bundle + restart
 */
import { spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const withBuild = process.argv.includes('--build');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function portInUse(port) {
    return new Promise(resolve => {
        const socket = createConnection({ port, host: '127.0.0.1' });
        socket.once('connect', () => {
            socket.destroy();
            resolve(true);
        });
        socket.once('error', () => resolve(false));
    });
}

function run(cmd, args, cwd = root) {
    const result = spawnSync(cmd, args, { cwd, stdio: 'inherit', env: process.env });
    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

async function killPort3000() {
    const pids = spawnSync('fuser', ['-k', '3000/tcp'], { encoding: 'utf8' });
    if (pids.status === 0) {
        console.log('[qaap] stopped previous server on :3000');
        await sleep(1500);
    }
}

async function waitForHttp(maxMs = 120000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
        if (await portInUse(3000)) {
            const probe = spawnSync('curl', ['-sf', '-o', '/dev/null', 'http://localhost:3000/'], { encoding: 'utf8' });
            if (probe.status === 0) {
                return true;
            }
        }
        await sleep(1000);
    }
    return false;
}

if (withBuild) {
    console.log('[qaap] building browser bundle…');
    run('npm', ['run', 'build:browser']);
}

await killPort3000();

console.log('[qaap] starting npm run start:browser…');
const child = spawnSync('npm', ['run', 'start:browser'], {
    cwd: root,
    stdio: 'ignore',
    detached: true,
    env: process.env,
});
if (child.error) {
    console.error(child.error);
    process.exit(1);
}

const ready = await waitForHttp();
if (!ready) {
    console.error('[qaap] server did not become ready on http://localhost:3000');
    process.exit(1);
}

const sample = `${root}/examples/playwright/src/tests/resources/sample-files1`;
console.log('');
console.log('[qaap] App ready: http://localhost:3000');
console.log(`[qaap] Sample WS: http://localhost:3000/#${sample}`);
console.log('');
