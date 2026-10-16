#!/usr/bin/env node
// Restart-resume end to end (roadmap H1.1): a chat turn must survive the backend being killed under it.
//
// Starts the built browser backend (examples/browser/lib/backend/main.js) in skip-auth local mode with
// an isolated HOME and a fake `qaiq` on PATH, starts a chat turn over HTTP, SIGKILLs the whole backend
// process group while the turn is running, starts the backend again, and requires the boot-time
// auto-resume to re-run the turn to completion: the conversation settles (not `failed`), the user
// message records one restart resume, and the final agent message carries the token from the prompt.
//
// The fake qaiq reads the prompt from stdin (qaiq-stdio mode). Its first run prints a partial reply
// and hangs until killed; every later run echoes the prompt's token and exits 0.
//
// Usage: node scripts/qaap-restart-resume-e2e.mjs [--port 3466] [--keep]   (needs `npm run build:browser`)
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..');
const BACKEND = join(ROOT, 'examples/browser/lib/backend/main.js');
const CONVERSATIONS = '/qaap/api/agent-conversations';

const FAKE_QAIQ = `#!/usr/bin/env bash
# Fake qaiq for the restart-resume e2e (stream-json over stdio).
if [[ "\${1:-}" == "--version" ]]; then echo "qaiq 0.0.0-restart-e2e"; exit 0; fi
STATE="\${QAAP_E2E_STATE:?}"
IFS= read -r line || true
token="$(printf '%s' "$line" | grep -oE 'QAAP_RESUME_[0-9A-F]{12}' | head -1)"
echo "run" >> "$STATE/runs"
runs="$(wc -l < "$STATE/runs" | tr -d ' ')"
emit() { printf '%s\\n' "$1"; }
emit '{"type":"system","subtype":"init","cwd":"'"$(pwd)"'","session_id":"restart-e2e","tools":[],"model":"mock/restart-e2e"}'
if [[ "$runs" == 1 ]]; then
    emit '{"type":"assistant","message":{"content":[{"type":"text","text":"partial answer before the crash"}]}}'
    echo "$$" > "$STATE/first.pid"
    touch "$STATE/first-started"
    # Hang like a long turn; leave as soon as the backend that spawned us is gone.
    parent="$PPID"
    for _ in $(seq 1 600); do kill -0 "$parent" 2>/dev/null || exit 0; sleep 0.2; done
    exit 0
fi
emit '{"type":"assistant","message":{"content":[{"type":"text","text":"resumed: '"\${token:-NO_TOKEN}"'"}]}}'
emit '{"type":"result","subtype":"success","is_error":false,"result":"resumed: '"\${token:-NO_TOKEN}"'"}'
`;

function parseArgs(argv) {
    const options = { port: 3466, keep: false };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--port') { options.port = Number(argv[++i]); }
        else if (argv[i] === '--keep') { options.keep = true; }
        else { throw new Error(`Unknown option ${argv[i]}`); }
    }
    return options;
}

const sleep = ms => new Promise(done => setTimeout(done, ms));

async function waitFor(what, timeoutMs, probe) {
    const started = Date.now();
    for (;;) {
        const value = await probe().catch(() => undefined);
        if (value) {
            return value;
        }
        if (Date.now() - started > timeoutMs) {
            throw new Error(`timed out after ${timeoutMs / 1000}s waiting for ${what}`);
        }
        await sleep(300);
    }
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (!existsSync(BACKEND)) {
        throw new Error(`${BACKEND} not found: run npm run build:browser first`);
    }
    const work = mkdtempSync(join(tmpdir(), 'qaap-restart-e2e-'));
    const home = join(work, 'home');
    const bin = join(work, 'bin');
    const state = join(work, 'state');
    const repo = join(work, 'repo');
    for (const dir of [home, bin, state, repo]) {
        mkdirSync(dir, { recursive: true });
    }
    writeFileSync(join(bin, 'qaiq'), FAKE_QAIQ);
    chmodSync(join(bin, 'qaiq'), 0o755);
    execFileSync('git', ['init', '-q'], { cwd: repo });
    writeFileSync(join(repo, 'README.md'), 'restart e2e\n');
    execFileSync('git', ['-c', 'user.email=e2e@qaap.local', '-c', 'user.name=e2e', 'add', '-A'], { cwd: repo });
    execFileSync('git', ['-c', 'user.email=e2e@qaap.local', '-c', 'user.name=e2e', 'commit', '-qm', 'init'], { cwd: repo });

    const base = `http://127.0.0.1:${options.port}`;
    const env = {
        ...process.env,
        HOME: home,
        PATH: `${bin}:${process.env.PATH}`,
        QAAP_SKIP_AUTH: 'true',
        QAAP_CLOUD_MODE: 'local',
        OPENROUTER_API_KEY: 'mock-restart-e2e',
        QAAP_E2E_STATE: state,
        QAAP_AUTO_RESUME_TURNS: '1',
        QAAP_MAX_RESTART_RESUMES: '2',
        QAAP_AGENT_AUTO_CONTINUE: '0',
    };
    const logPath = join(work, 'backend.log');
    let backend;
    const startBackend = async label => {
        writeFileSync(logPath, `--- ${label}\n`, { flag: 'a' });
        const { openSync } = await import('node:fs');
        const out = openSync(logPath, 'a');
        backend = spawn(process.execPath, [BACKEND, '--port', String(options.port), '--hostname', '127.0.0.1'], {
            cwd: join(ROOT, 'examples/browser'), env, detached: true, stdio: ['ignore', out, out],
        });
        await waitFor(`the backend (${label})`, 90_000, async () => (await fetch(`${base}/`)).status < 500);
    };
    const killBackend = () => {
        try {
            process.kill(-backend.pid, 'SIGKILL');
        } catch {
            // Already gone.
        }
    };
    const api = async (method, path, body) => {
        const response = await fetch(base + path, {
            method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined,
        });
        const text = await response.text();
        return { status: response.status, json: text ? JSON.parse(text) : undefined, text };
    };

    let ok = false;
    try {
        await startBackend('first boot');
        const token = `QAAP_RESUME_${randomBytes(6).toString('hex').toUpperCase()}`;
        const created = await api('POST', CONVERSATIONS, {
            cwd: repo, agent: 'qaiq', isolation: 'none', title: 'restart e2e',
            message: `Restart e2e. Reply with ${token}`,
        });
        if (created.status !== 201 || !created.json?.id) {
            throw new Error(`creating the conversation returned HTTP ${created.status}: ${created.text.slice(0, 300)}`);
        }
        const id = created.json.id;
        console.log(`conversation ${id} created; waiting for the turn to run`);
        await waitFor('the first agent run', 60_000, async () => existsSync(join(state, 'first-started')));
        const before = await api('GET', `${CONVERSATIONS}/${id}`);
        if (before.json?.status !== 'streaming') {
            throw new Error(`expected the turn to be streaming before the kill, got ${before.json?.status}`);
        }
        await sleep(500); // let the streaming state reach SQLite (WAL, synchronous=FULL)
        console.log('turn is streaming: SIGKILL the backend process group');
        killBackend();
        await waitFor('the first agent run to exit', 15_000, async () => {
            const pid = Number(readFileSync(join(state, 'first.pid'), 'utf8'));
            try { process.kill(pid, 0); return false; } catch { return true; }
        });

        await startBackend('restart');
        console.log('backend restarted; waiting for the turn to resume and finish');
        const settled = await waitFor('the resumed turn to finish', 90_000, async () => {
            const current = await api('GET', `${CONVERSATIONS}/${id}`);
            return current.json && current.json.status !== 'streaming' ? current.json : undefined;
        });

        const user = settled.messages.find(message => message.role === 'user');
        const agentMessages = settled.messages.filter(message => message.role === 'agent');
        const last = agentMessages.at(-1);
        const runs = readFileSync(join(state, 'runs'), 'utf8').trim().split('\n').length;
        const checks = [
            [settled.status !== 'failed', `conversation status ${settled.status}`],
            [user?.restartResumeCount === 1, `restartResumeCount ${user?.restartResumeCount}`],
            [typeof last?.content === 'string' && last.content.includes(token), `final agent message ${JSON.stringify(last?.content?.slice(0, 120))}`],
            [!agentMessages.some(message => message.content.includes('partial answer before the crash')), 'partial pre-crash message replaced'],
            [runs >= 2, `qaiq runs ${runs}`],
        ];
        for (const [passed, label] of checks) {
            console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}`);
        }
        ok = checks.every(([passed]) => passed);
        if (!ok) {
            console.log(readFileSync(logPath, 'utf8').split('\n').filter(line => /resume|interrupt|restart/i.test(line)).slice(-20).join('\n'));
        }
    } finally {
        killBackend();
        if (options.keep || !ok) {
            console.log(`work dir kept: ${work}`);
        } else {
            rmSync(work, { recursive: true, force: true });
        }
    }
    return ok ? 0 : 1;
}

main().then(code => { process.exitCode = code; }, error => {
    console.error(`FAIL  ${error?.message ?? error}`);
    process.exitCode = 1;
});
