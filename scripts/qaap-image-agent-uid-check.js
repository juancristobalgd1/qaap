// Copyright (C) 2026 Qaap contributors.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
'use strict';
// Agent-uid boundary smoke. Runs with `node -` inside a throwaway copy of the candidate image, started by
// scripts/qaap-image-smoke.sh as root with ONLY CAP_SETUID and CAP_SETGID (the backend shape: CapDrop ALL
// plus SETUID/SETGID, see packages/qaap-cloud-workspace/src/node/qaap-docker-orchestrator.ts and the commit
// message of 6716ef803). The backend cannot chown, cannot read another uid's 0600 files and cannot signal
// another uid, so every agent-owned operation must be done by a child that switches to the agent uid.
//
// Assumptions (all come from the smoke script; nothing here reads production secrets):
// - the candidate code is compiled under /app/packages/*/lib (the Dockerfile layout used by qaap-image-runtime-check.js);
// - `node` is on PATH and the agent uid 20000 / other uid 20001 are free numeric ids (no passwd entry needed);
// - /tmp is a writable tmpfs (os.tmpdir()), and the process may fork children.
//
// Which regression each check detects:
// - 6716ef803 (overlay as agent uid): with the revert, root creates the codex home and root-owned 0600 files,
//   so the agent cannot read them (check A) and root cannot read the owner's 0600 auth.json (check A).
// - 0aed8adc9 (prompt file as agent uid): with the revert, root writes the prompt into a root-owned 0700 dir,
//   so the agent cannot read the prompt (check B).
// - b636c2f8e (signal relay): with the revert, EPERM from root is treated as "gone" and the agent process keeps
//   running, so the kill -0 probe still succeeds (check C), or the module that the relay lives in is missing.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const CODE = '/app/packages/qaap-cloud-workspace/lib/node';
const AGENT = { uid: 20000, gid: 20000 };
const OTHER = { uid: 20001, gid: 20001 };
const CAP = { CHOWN: 0n, DAC_OVERRIDE: 1n, FOWNER: 3n, KILL: 5n, SETGID: 6n, SETUID: 7n };
const SMOKE_TIMEOUT_MS = 120000;

// Fail the whole smoke after a bound, so a hung child can never block the CI job.
setTimeout(() => {
    console.error('Agent uid smoke timed out');
    process.exit(1);
}, SMOKE_TIMEOUT_MS).unref();

assert.equal(process.env.QAAP_IMAGE_SMOKE, '1');
assert.equal(process.platform, 'linux');
assert.equal(process.getuid(), 0, 'The smoke must start as root, like the backend');

// The caps must be exactly the prod shape: otherwise the checks prove nothing about CapDrop ALL.
const effective = BigInt('0x' + /CapEff:\s*([0-9a-f]+)/.exec(fs.readFileSync('/proc/self/status', 'utf8'))[1]);
const has = (bit) => (effective & (1n << bit)) !== 0n;
assert.ok(has(CAP.SETUID) && has(CAP.SETGID), 'The smoke container must keep CAP_SETUID and CAP_SETGID');
for (const name of ['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'KILL']) {
    assert.ok(!has(CAP[name]), `The smoke container must not have CAP_${name} (prod drops it)`);
}

const PATH_ENV = { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin' };

/**
 * Runs a small job as `identity` (a child process that really switches uid) and returns its report.
 * Job: { mkdir?: [{path, mode}], write?: [{path, text, mode}], read?: [path], exists?: [path] }.
 * Failures are reported as `ERR:<code>` so a boundary check can assert on the exact errno.
 */
function asAgent(identity, job) {
    const script = [
        "const fs=require('fs');",
        "const j=JSON.parse(fs.readFileSync(0,'utf8'));",
        "const out={uid:process.getuid(),read:{},exists:{},write:{},mkdir:{}};",
        "const code=(e)=>'ERR:'+(e&&e.code||'unknown');",
        "for(const d of j.mkdir||[]){try{fs.mkdirSync(d.path,{mode:d.mode});out.mkdir[d.path]='ok';}catch(e){out.mkdir[d.path]=code(e);}}",
        "for(const w of j.write||[]){try{fs.writeFileSync(w.path,w.text,{mode:w.mode,flag:'wx'});out.write[w.path]='ok';}catch(e){out.write[w.path]=code(e);}}",
        "for(const p of j.read||[]){try{out.read[p]=fs.readFileSync(p,'utf8');}catch(e){out.read[p]=code(e);}}",
        "for(const p of j.exists||[]){out.exists[p]=fs.existsSync(p);}",
        'process.stdout.write(JSON.stringify(out));',
    ].join('');
    const result = spawnSync(process.execPath, ['-e', script], {
        uid: identity.uid, gid: identity.gid, cwd: '/', env: PATH_ENV,
        input: JSON.stringify(job), encoding: 'utf8', timeout: 20000, stdio: ['pipe', 'pipe', 'pipe'],
    });
    assert.equal(result.status, 0, `Job as uid ${identity.uid} failed: ${result.stderr || result.error}`);
    return JSON.parse(result.stdout);
}

function isAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        // EPERM: the process exists but belongs to another uid (this root process has no CAP_KILL).
        return error.code === 'EPERM';
    }
}

async function checkOverlay(workRoot) {
    const sourceHome = path.join(workRoot, 'owner-codex-home');
    // The owner's home is created by the agent, so its 0700/0600 files are owned by the agent, as in production.
    const seeded = asAgent(AGENT, {
        mkdir: [{ path: sourceHome, mode: 0o700 }],
        write: [
            { path: path.join(sourceHome, 'auth.json'), text: '{"tokens":{"access_token":"smoke-token"}}', mode: 0o600 },
            { path: path.join(sourceHome, 'config.toml'), text: 'model = "smoke"\n', mode: 0o600 },
        ],
    });
    assert.equal(seeded.write[path.join(sourceHome, 'auth.json')], 'ok', 'Seeding the owner home as the agent failed');

    const { QaapCodexGateOverlayBuilder } = require(`${CODE}/qaap-codex-gate-overlay.js`);
    // Only the Codex trust probe is stubbed (it needs a Codex login); the file creation and uid handling are real.
    const builder = new QaapCodexGateOverlayBuilder(async () => 'trusted');
    const overlay = await builder.create({
        taskId: 'smoke-task', cwd: workRoot, folderTrusted: false, sourceCodexHome: sourceHome,
        askTtlSec: 60, agentIdentity: AGENT,
    }, PATH_ENV);
    const codexHome = overlay.codexHome;
    const files = ['auth.json', 'config.toml', 'hooks.json'].map((name) => path.join(codexHome, name));
    const readAsAgent = asAgent(AGENT, { read: files });
    for (const file of files) {
        assert.ok(!String(readAsAgent.read[file]).startsWith('ERR:'), `The agent cannot read the Codex overlay ${file}: ${readAsAgent.read[file]}`);
    }
    assert.equal(asAgent(AGENT, { read: [files[0]] }).uid, AGENT.uid);
    // The overlay holds the owner's token: no other uid may read it.
    const readAsOther = asAgent(OTHER, { read: [files[0]] });
    assert.equal(readAsOther.read[files[0]], 'ERR:EACCES', 'Another uid could read the overlay auth.json');

    overlay.dispose();
    const afterDispose = asAgent(AGENT, { exists: [codexHome] });
    assert.equal(afterDispose.exists[codexHome], false, 'Dispose left the overlay behind');
    console.log('PASS: A. Codex overlay built for the agent uid is readable by the agent and not by another uid');
}

async function checkPromptFile() {
    const { writeAgentPromptFile, removeAgentPromptTempDir } = require(`${CODE}/qaap-agent-task-runner-utils.js`);
    const text = 'smoke prompt for the agent';
    const written = writeAgentPromptFile(text, { uid: AGENT.uid, gid: AGENT.gid });
    const readAsAgent = asAgent(AGENT, { read: [written.file] });
    assert.equal(readAsAgent.read[written.file], text, 'The agent cannot read its prompt file');
    const readAsOther = asAgent(OTHER, { read: [written.file] });
    assert.equal(readAsOther.read[written.file], 'ERR:EACCES', 'Another uid could read the agent prompt file');
    removeAgentPromptTempDir(written.dir);
    assert.equal(asAgent(AGENT, { exists: [written.dir] }).exists[written.dir], false, 'The prompt dir was not removed');
    console.log('PASS: B. prompt file written for the agent uid is readable by the agent and not by another uid');
}

async function checkSignal() {
    const { rememberAgentProcessIdentity, signalAgentProcessTree } = require(`${CODE}/qaap-agent-process-signal.js`);
    // A detached agent process: its own process group, like the agent and preview children.
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        uid: AGENT.uid, gid: AGENT.gid, cwd: '/', env: PATH_ENV, detached: true, stdio: 'ignore',
    });
    rememberAgentProcessIdentity(child, { uid: AGENT.uid, gid: AGENT.gid });
    await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
    });
    const pid = child.pid;
    assert.ok(isAlive(pid), 'The agent process did not start');
    const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));

    // Root without CAP_KILL gets EPERM here; the relay runs as the agent uid and must deliver the signal.
    const outcome = signalAgentProcessTree(child, 'SIGKILL');
    assert.equal(outcome, 'sent', `Stop could not signal the agent process (outcome ${outcome})`);
    const { signal } = await exited;
    assert.equal(signal, 'SIGKILL', 'The agent process did not die of the signal');
    let code;
    try {
        process.kill(pid, 0);
        code = 'alive';
    } catch (error) {
        code = error.code;
    }
    assert.equal(code, 'ESRCH', `The agent process is still alive after Stop (kill -0 gave ${code})`);
    console.log('PASS: C. signalAgentProcessTree stops an agent-uid process (kill -0 -> ESRCH)');
}

async function main() {
    const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-agent-uid-smoke-'));
    fs.chmodSync(workRoot, 0o1777);
    try {
        await checkOverlay(workRoot);
        await checkPromptFile();
        await checkSignal();
        console.log('PASS: agent uid boundary (overlay, prompt file, process stop) under CapDrop ALL with SETUID/SETGID only');
    } finally {
        fs.rmSync(workRoot, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.error('Agent uid smoke failed:', error && error.message ? error.message : error);
    process.exitCode = 1;
});
