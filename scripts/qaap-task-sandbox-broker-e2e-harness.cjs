// Harness for scripts/qaap-task-sandbox-broker-e2e.mjs: runs INSIDE the "tenant backend" container
// (no Docker socket) and drives the compiled sandbox service, broker client and spawn service.
'use strict';
// Resolve @theia/* from the bind-mounted checkout, not from this file's location.
const requireFromLib = require('module').createRequire(process.env.E2E_LIB + '/index.js');
requireFromLib('@theia/core/shared/reflect-metadata');
const fs = require('fs');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
const express = requireFromLib('@theia/core/shared/express');
const { QaapTaskSandboxService } = require(process.env.E2E_LIB + '/qaap-task-sandbox.js');
const { QaapTaskSandboxBrokerClient } = require(process.env.E2E_LIB + '/qaap-task-sandbox-broker-client.js');
const { QaapTenantSpawnService } = require(process.env.E2E_LIB + '/qaap-tenant-spawn-service.js');

const results = {};
const check = (name, ok, detail) => { results[name] = { ok: !!ok, detail }; console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(probe, ms = 15000) { const end = Date.now() + ms; for (;;) { const v = await probe(); if (v) return v; if (Date.now() > end) return undefined; await wait(100); } }
const get = port => new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 3000 }, res => { let t = ''; res.on('data', c => t += c); res.on('end', () => resolve(t)); });
    req.on('error', () => resolve(undefined)); req.on('timeout', () => req.destroy());
});
const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const collect = child => new Promise(resolve => { let out = ''; child.stdout && child.stdout.on('data', c => out += c); child.stderr && child.stderr.on('data', c => out += c); child.on('exit', (code, signal) => resolve({ code, signal, out })); });

(async () => {
    const client = new QaapTaskSandboxBrokerClient();
    const app = express();
    app.use(express.json());
    client.configure(app);
    await new Promise(r => http.createServer(app).listen(4873, '0.0.0.0', r));
    const sandboxes = new QaapTaskSandboxService();
    sandboxes.broker = client;
    const spawner = new QaapTenantSpawnService();
    spawner.taskSandbox = sandboxes;
    console.log('HARNESS_LISTENING');
    await until(() => client.isLinked(), 30000);
    check('control plane linked to the tenant backend', client.isLinked());

    // Persistent agent sign-in state, linked from the volatile HOME like the real tenant backend.
    fs.mkdirSync('/tmp/qaap-home', { recursive: true });
    fs.symlinkSync('/home/theia/.qaap/agent-home/.claude', '/tmp/qaap-home/.claude');

    const trees = ['wt-a', 'wt-b'].map(name => '/tmp/qaap-worktrees/e2e-alice/' + name);
    for (const tree of trees) fs.mkdirSync(tree, { recursive: true });
    const started = Date.now();
    const acquired = await Promise.all(trees.map((cwd, i) => sandboxes.acquire({ taskId: 'task-' + i, cwd, env: { HOME: '/tmp/qaap-home' } })));
    const startupMs = Date.now() - started;
    check('two sandboxes acquired in parallel', acquired.length === 2 && acquired[0].name !== acquired[1].name, { startupMs, names: acquired.map(s => s.name) });
    check('startup within 30 s', startupMs <= 30000, startupMs);

    // Dev servers that ignore PORT and bind the same hardcoded port.
    const previewPorts = [await freePort(), await freePort()];
    const server = token => 'node -e ' + JSON.stringify("require('http').createServer((q,s)=>s.end('" + token + ":'+process.pid)).listen(4545,'127.0.0.1'); setInterval(()=>{},1e6); /* http-token */");
    const devs = trees.map((cwd, i) => spawner.spawn(server('APP_' + i), {
        cwd, env: { PORT: String(previewPorts[i]), QAAP_PREVIEW_PORT: String(previewPorts[i]), QAAP_TENANT_BACKEND_SECRET: 'must-not-leak' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    }));
    const bodies = await Promise.all(previewPorts.map(port => until(async () => { const b = await get(port); return b && b.startsWith('APP_') ? b : undefined; }, 20000)));
    check('both apps bind the same hardcoded port without conflict', bodies[0] && bodies[1], bodies);
    check('each preview port reaches its own sandbox (port detection retargets PORT → 4545)',
        bodies[0] && bodies[0].startsWith('APP_0:') && bodies[1] && bodies[1].startsWith('APP_1:'), bodies);

    const inSandbox = async (cwd, script) => collect(spawner.spawn(script, { cwd, env: {}, stdio: ['ignore', 'pipe', 'pipe'] }));
    const procs = await inSandbox(trees[0], `n=0; for f in /proc/[0-9]*/cmdline; do tr '\\000' ' ' < $f 2>/dev/null | grep -q "^node .*http-[t]oken" && n=$((n+1)); done; echo "servers=$n"`);
    check('a sandbox sees only its own dev server', /servers=1\b/.test(procs.out), procs.out.trim());
    const identity = await inSandbox(trees[0], 'echo "uid=$(id -u) cap=$(awk \'/CapEff/{print $2}\' /proc/self/status) sock=$(test -e /var/run/docker.sock && echo yes || echo no) token=[${QAAP_SANDBOX_EXEC_TOKEN:-}] secret=[${QAAP_TENANT_BACKEND_SECRET:-}] home=$HOME cred=$(cat $HOME/.claude/credentials.json)"');
    check('runs as the tenant agent uid without capabilities, socket or secrets',
        /uid=1001 cap=0000000000000000 sock=no token=\[\] secret=\[\]/.test(identity.out), identity.out.trim());
    check('agent sign-in state reaches the sandbox HOME', identity.out.includes('cred={"signed-in":true}'), identity.out.trim());
    const environ = await inSandbox(trees[0], `n=0; for f in /proc/[0-9]*/environ; do tr '\\000' '\\n' < $f 2>/dev/null | grep -q '^QAAP_SANDBOX_EXEC_TOKEN=' && n=$((n+1)); done; echo "environ_with_token=$n"`);
    check('no process environment in the sandbox (init and exec server included) holds the exec token', /environ_with_token=0\b/.test(environ.out), environ.out.trim());
    const view = await inSandbox(trees[0], 'test -e /e2e-harness.cjs && echo harness-visible || echo harness-hidden');
    check('the tenant backend filesystem is not visible in the sandbox', view.out.includes('harness-hidden'), view.out.trim());

    // Terminal under a real pty (the role node-pty plays in Theia).
    const wrapped = spawner.wrapShellForTenant(trees[1], '/bin/sh', ['-c', 'echo tty-ok; tty; echo cols=$(stty size)'], { TERM: 'xterm' });
    const quote = s => "'" + s.replace(/'/g, "'\\''") + "'";
    const terminal = await collect(spawn('script', ['-qfec', [wrapped.file, ...wrapped.args].map(quote).join(' '), '/dev/null'], { stdio: ['pipe', 'pipe', 'pipe'] }));
    check('a terminal runs inside the sandbox on a pseudo-terminal', terminal.out.includes('tty-ok') && /\/dev\/pts\/\d+/.test(terminal.out), terminal.out.replace(/\r/g, '').trim());

    // Killing the dev server (group SIGTERM, as the preview supervisor does) frees its port in the sandbox.
    process.kill(-devs[0].pid, 'SIGTERM');
    const freed = await until(async () => !(await sandboxes.listPorts(acquired[0])).includes(4545), 10000);
    check('killing the local client ends the remote dev server', freed);
    const stillUp = await get(previewPorts[1]);
    check('the other task keeps running', stillUp && stillUp.startsWith('APP_1:'), stillUp);
    process.kill(-devs[1].pid, 'SIGTERM');

    sandboxes.release('task-0');
    sandboxes.release('task-1');
    await wait(1500);
    console.log('E2E_RESULT ' + JSON.stringify({ results, startupMs, names: acquired.map(s => s.name) }));
    process.exit(0);
})().catch(error => { console.log('E2E_RESULT ' + JSON.stringify({ error: String(error && error.stack || error) })); process.exit(1); });
