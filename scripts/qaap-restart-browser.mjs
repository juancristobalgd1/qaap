#!/usr/bin/env node
/**
 * Rebuild browser bundle (if requested) and restart npm run start:browser on port 3000.
 * Usage:
 *   node scripts/qaap-restart-browser.mjs          # restart only
 *   node scripts/qaap-restart-browser.mjs --build  # compile + bundle + restart
 */
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const withBuild = process.argv.includes('--build');
const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';
let startError;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function listeningPids(port) {
    if (process.platform === 'win32') {
        const result = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' });
        if (result.status !== 0 || !result.stdout) {
            return [];
        }
        return [...new Set(result.stdout.split(/\r?\n/).flatMap(line => {
            const parts = line.trim().split(/\s+/);
            if (parts[0] !== 'TCP' || parts[3] !== 'LISTENING') {
                return [];
            }
            const localAddress = parts[1] ?? '';
            return localAddress.endsWith(`:${port}`) ? [parts[4]] : [];
        }).filter(pid => /^\d+$/.test(pid)))];
    }

    const lsof = spawnSync('lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN', '-n', '-P'], { encoding: 'utf8' });
    if (lsof.status === 0 && lsof.stdout) {
        return [...new Set(lsof.stdout.split(/\r?\n/).map(line => line.trim()).filter(pid => /^\d+$/.test(pid)))];
    }

    const fuser = spawnSync('fuser', ['-n', 'tcp', port.toString()], { encoding: 'utf8' });
    return fuser.stdout ? [...new Set(fuser.stdout.match(/\d+/g) ?? [])] : [];
}

function run(cmd, args, cwd = root) {
    if (isWindows && cmd === 'npm.cmd') {
        cmd = process.env.ComSpec || 'cmd.exe';
        args = ['/d', '/s', '/c', `npm.cmd ${args.join(' ')}`];
    }
    const result = spawnSync(cmd, args, { cwd, stdio: 'inherit', env: process.env });
    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

async function killPort3000() {
    const pids = listeningPids(3000);
    for (const pid of pids) {
        if (process.platform === 'win32') {
            spawnSync('taskkill', ['/PID', pid, '/T', '/F'], { stdio: 'ignore' });
        } else {
            try {
                process.kill(Number(pid), 'SIGTERM');
            } catch {
                // The process may have exited between discovery and termination.
            }
        }
    }
    if (pids.length > 0) {
        console.log(`[qaap] stopped previous server on :3000 (${pids.join(', ')})`);
        const deadline = Date.now() + 5000;
        while (listeningPids(3000).length > 0 && Date.now() < deadline) {
            await sleep(250);
        }
    }
}

async function httpReady() {
    try {
        const response = await fetch('http://localhost:3000/', { signal: AbortSignal.timeout(5000) });
        return response.ok;
    } catch {
        return false;
    }
}

async function waitForHttp(maxMs = 120000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
        if (startError) {
            return false;
        }
        if (await httpReady()) {
            return true;
        }
        await sleep(1000);
    }
    return false;
}

await killPort3000();

if (withBuild) {
    console.log('[qaap] building browser bundle…');
    run(npm, ['run', 'build:browser']);
}

console.log('[qaap] starting npm run start:browser…');
const startCommand = isWindows ? (process.env.ComSpec || 'cmd.exe') : npm;
const startArgs = isWindows
    ? ['/d', '/s', '/c', 'npm.cmd run start:browser']
    : ['run', 'start:browser'];
const child = spawn(startCommand, startArgs, {
    cwd: root,
    stdio: 'ignore',
    detached: true,
    env: process.env,
    windowsHide: true,
});
child.once('error', error => {
    startError = error;
});
child.once('exit', code => {
    if (code !== 0 && !startError) {
        startError = new Error(`npm run start:browser exited with code ${code ?? 'unknown'}`);
    }
});
child.unref();

const ready = await waitForHttp();
if (!ready) {
    if (startError) {
        console.error(startError);
    }
    console.error('[qaap] server did not become ready on http://localhost:3000');
    process.exit(1);
}

const sample = `${root}/examples/playwright/src/tests/resources/sample-files1`;
console.log('');
console.log('[qaap] App ready: http://localhost:3000');
console.log(`[qaap] Sample WS: http://localhost:3000/#${sample}`);
console.log('');
