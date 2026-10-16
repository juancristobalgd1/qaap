#!/usr/bin/env node
// Per-task sandbox end to end (roadmap H2.2, doc/qaap-task-sandbox.md).
//
// Starts the built browser backend (examples/browser/lib/backend/main.js) in skip-auth local mode
// with QAAP_TASK_SANDBOX=1, an isolated HOME and a fake `qaiq` (mounted into the sandboxes as the
// toolchain), and starts TWO worktree-isolated chat turns on the SAME repository at once. Each fake
// agent runs inside its own sandbox container and:
//   - binds the same hardcoded port (4545) with a tiny HTTP server that answers its own token,
//   - counts the HTTP servers it can see in /proc (must be exactly its own),
//   - lists the parent directory of its worktree (must contain only its own worktree),
//   - writes a report into its worktree and holds until the script releases it, so both turns are
//     provably running at the same time.
// While both hold, the script checks two sandbox containers are up and reaches each server through
// the sandbox preview bridge. Then it releases both turns and requires: both finish with their
// token, and both sandboxes are destroyed (QAAP_TASK_SANDBOX_LINGER_MS=0). It prints the sandbox
// startup times measured by the backend.
//
// Usage: node scripts/qaap-task-sandbox-e2e.mjs [--port 3467] [--image node:22-bookworm-slim] [--keep]
//        (needs `npm run build:browser` and a Docker daemon)
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const BACKEND = join(ROOT, 'examples/browser/lib/backend/main.js');
const CONVERSATIONS = '/qaap/api/agent-conversations';
const HARDCODED_PORT = 4545;

const FAKE_QAIQ = `#!/usr/bin/env bash
# Fake qaiq for the task-sandbox e2e (stream-json over stdio). Runs INSIDE the sandbox.
if [[ "\${1:-}" == "--version" ]]; then echo "qaiq 0.0.0-sandbox-e2e"; exit 0; fi
IFS= read -r line || true
token="$(printf '%s' "$line" | grep -oE 'QAAP_SANDBOX_[0-9A-F]{12}' | head -1)"
emit() { printf '%s\\n' "$1"; }
emit '{"type":"system","subtype":"init","cwd":"'"$(pwd)"'","session_id":"sandbox-e2e","tools":[],"model":"mock/sandbox-e2e"}'
rm -f .sandbox-listening .sandbox-bind-error
TOKEN="$token" node -e '
const fs = require("fs");
const server = require("http").createServer((req, res) => res.end(process.env.TOKEN));
server.on("error", error => { fs.writeFileSync(".sandbox-bind-error", String(error.code)); process.exit(1); });
server.listen(${HARDCODED_PORT}, "127.0.0.1", () => fs.writeFileSync(".sandbox-listening", "ok"));
' qaap-sandbox-e2e-server >/dev/null 2>&1 &
for _ in $(seq 1 100); do [[ -f .sandbox-listening || -f .sandbox-bind-error ]] && break; sleep 0.1; done
bind="failed"; [[ -f .sandbox-listening ]] && bind="ok"
servers=0
for cmdline in /proc/[0-9]*/cmdline; do
  if tr '\\0' ' ' < "$cmdline" 2>/dev/null | grep -q 'qaap-sandbox-e2e-server'; then servers=$((servers + 1)); fi
done
siblings="$(ls -1 .. | tr '\\n' ',')"
host="$(cat /proc/sys/kernel/hostname)"
printf '{"token":"%s","bind":"%s","servers":%s,"siblings":"%s","hostname":"%s","pwd":"%s"}\\n' \\
  "$token" "$bind" "$servers" "$siblings" "$host" "$(pwd)" > .sandbox-report.json
for _ in $(seq 1 900); do [[ -f .sandbox-release ]] && break; sleep 0.2; done
emit '{"type":"assistant","message":{"content":[{"type":"text","text":"sandboxed: '"\${token:-NO_TOKEN}"' bind='"$bind"'"}]}}'
emit '{"type":"result","subtype":"success","is_error":false,"result":"sandboxed: '"\${token:-NO_TOKEN}"' bind='"$bind"'"}'
`;

function parseArgs(argv) {
    const options = { port: 3467, keep: false, image: 'node:22-bookworm-slim' };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--port') { options.port = Number(argv[++i]); }
        else if (argv[i] === '--image') { options.image = argv[++i]; }
        else if (argv[i] === '--keep') { options.keep = true; }
        else { throw new Error(`Unknown option ${argv[i]}`); }
    }
    return options;
}

const sleep = ms => new Promise(done => setTimeout(done, ms));
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

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

/** HTTP GET through the sandbox's own preview bridge (`docker exec -i <c> /tmp/.qaap-exec/bridge <port>`). */
function getThroughBridge(container, port) {
    return new Promise((done, fail) => {
        const bridge = spawn('docker', ['exec', '-i', container, '/tmp/.qaap-exec/bridge', String(port)]);
        let out = '';
        bridge.stdout.on('data', chunk => { out += chunk; });
        bridge.on('error', fail);
        bridge.on('close', () => done(out.split('\r\n\r\n').slice(1).join('\r\n\r\n')));
        bridge.stdin.end('GET / HTTP/1.0\r\nHost: sandbox\r\n\r\n');
    });
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (!existsSync(BACKEND)) {
        throw new Error(`${BACKEND} not found: run npm run build:browser first`);
    }
    docker('info', '--format', '{{.ServerVersion}}');
    try {
        docker('image', 'inspect', options.image);
    } catch {
        console.log(`pulling ${options.image}`);
        execFileSync('docker', ['pull', '-q', options.image], { stdio: 'inherit' });
    }

    const work = realpathSync(mkdtempSync(join(tmpdir(), 'qaap-sandbox-e2e-')));
    const home = join(work, 'home');
    const toolchain = join(work, 'toolchain');
    const repo = join(work, 'repo');
    for (const dir of [home, join(toolchain, 'bin'), repo]) {
        mkdirSync(dir, { recursive: true });
    }
    writeFileSync(join(toolchain, 'bin', 'qaiq'), FAKE_QAIQ);
    chmodSync(join(toolchain, 'bin', 'qaiq'), 0o755);
    const gitIdentity = ['-c', 'user.email=e2e@qaap.local', '-c', 'user.name=e2e'];
    execFileSync('git', ['init', '-q'], { cwd: repo });
    writeFileSync(join(repo, 'README.md'), 'task sandbox e2e\n');
    writeFileSync(join(repo, '.gitignore'), '.sandbox-*\n');
    execFileSync('git', [...gitIdentity, 'add', '-A'], { cwd: repo });
    execFileSync('git', [...gitIdentity, 'commit', '-qm', 'init'], { cwd: repo });

    const base = `http://127.0.0.1:${options.port}`;
    const env = {
        ...process.env,
        HOME: home,
        PATH: `${join(toolchain, 'bin')}:${process.env.PATH}`,
        QAAP_SKIP_AUTH: 'true',
        QAAP_CLOUD_MODE: 'local',
        OPENROUTER_API_KEY: 'mock-sandbox-e2e',
        QAAP_AGENT_AUTO_CONTINUE: '0',
        QAAP_TASK_SANDBOX: '1',
        QAAP_TASK_SANDBOX_IMAGE: options.image,
        QAAP_TASK_SANDBOX_TOOLCHAIN: toolchain,
        QAAP_TASK_SANDBOX_LINGER_MS: '0',
    };
    const logPath = join(work, 'backend.log');
    const out = openSync(logPath, 'a');
    const backend = spawn(process.execPath, [BACKEND, '--port', String(options.port), '--hostname', '127.0.0.1'], {
        cwd: join(ROOT, 'examples/browser'), env, detached: true, stdio: ['ignore', out, out],
    });
    const api = async (method, path, body) => {
        const response = await fetch(base + path, {
            method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined,
        });
        const text = await response.text();
        return { status: response.status, json: text ? JSON.parse(text) : undefined, text };
    };
    const sandboxContainers = worktrees => docker('ps', '-a', '--filter', 'label=com.qaap.task-sandbox=true',
        '--format', '{{.Names}}\t{{.Label "com.qaap.task-sandbox.worktree"}}')
        .split('\n').filter(Boolean).map(line => line.split('\t'))
        .filter(([, root]) => worktrees.includes(root));

    let ok = false;
    let worktrees = [];
    let ids = [];
    try {
        await waitFor('the backend', 90_000, async () => (await fetch(`${base}/`)).status < 500);
        const tokens = [0, 1].map(() => `QAAP_SANDBOX_${randomBytes(6).toString('hex').toUpperCase()}`);
        const started = Date.now();
        const created = await Promise.all(tokens.map((token, index) => api('POST', CONVERSATIONS, {
            cwd: repo, agent: 'qaiq', isolation: 'worktree', title: `sandbox e2e ${index + 1}`,
            message: `Sandbox e2e. Reply with ${token}`,
        })));
        for (const response of created) {
            if (response.status !== 201 || !response.json?.id) {
                throw new Error(`creating a conversation returned HTTP ${response.status}: ${response.text.slice(0, 300)}`);
            }
        }
        ids = created.map(response => response.json.id);
        console.log(`conversations ${ids.join(', ')} created on ${repo}; waiting for both sandboxed turns to run`);

        worktrees = await waitFor('two thread worktrees', 30_000, async () => {
            const listed = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: repo, encoding: 'utf8' })
                .split('\n').filter(line => line.startsWith('worktree ')).map(line => realpathSync(line.slice(9)))
                .filter(path => path !== realpathSync(repo));
            return listed.length === 2 ? listed : undefined;
        });
        const reports = await waitFor('both sandboxed agents to report', 90_000, async () => {
            const read = worktrees.map(tree => join(tree, '.sandbox-report.json')).filter(existsSync)
                .map(path => JSON.parse(readFileSync(path, 'utf8')));
            return read.length === 2 ? read : undefined;
        });
        const bothRunningMs = Date.now() - started;
        const containers = sandboxContainers(worktrees);
        const viaBridge = await Promise.all(containers.map(([name]) => getThroughBridge(name, HARDCODED_PORT)));
        const statuses = await Promise.all(ids.map(async id => (await api('GET', `${CONVERSATIONS}/${id}`)).json?.status));

        for (const tree of worktrees) {
            writeFileSync(join(tree, '.sandbox-release'), 'go\n');
        }
        const settled = await Promise.all(ids.map(id => waitFor(`turn ${id} to finish`, 60_000, async () => {
            const current = await api('GET', `${CONVERSATIONS}/${id}`);
            return current.json && current.json.status !== 'streaming' ? current.json : undefined;
        })));
        const destroyed = await waitFor('both sandboxes to be destroyed', 30_000, async () => sandboxContainers(worktrees).length === 0)
            .catch(() => false);

        const log = readFileSync(logPath, 'utf8');
        const startups = [...log.matchAll(/\[qaap-task-sandbox\] started (\S+) for (\S+) .* in (\d+) ms/g)]
            .map(match => ({ name: match[1], root: match[2], ms: Number(match[3]) }))
            .filter(entry => worktrees.includes(entry.root));
        const finals = settled.map(conversation => conversation.messages.filter(message => message.role === 'agent').at(-1)?.content ?? '');
        const byToken = token => reports.find(report => report.token === token);
        const ownDir = tree => tree.split('/').at(-1);

        const checks = [
            [statuses.every(status => status === 'streaming'), `both turns streaming at the same time (${statuses.join(', ')})`],
            [tokens.every(token => byToken(token)?.bind === 'ok'), `both agents bound the hardcoded port ${HARDCODED_PORT}: ${reports.map(r => r.bind).join(', ')}`],
            [reports.every(report => report.servers === 1), `each sandbox sees only its own server process: ${reports.map(r => r.servers).join(', ')}`],
            [reports.every(report => report.siblings === `${ownDir(report.pwd)},`), `each sandbox sees only its own worktree: ${reports.map(r => r.siblings).join(' | ')}`],
            [new Set(reports.map(report => report.hostname)).size === 2, `separate containers: ${reports.map(r => r.hostname).join(', ')}`],
            [containers.length === 2, `two sandbox containers up during the run: ${containers.map(([name]) => name).join(', ')}`],
            [tokens.every(token => viaBridge.includes(token)), `preview bridge reaches each sandbox's own :${HARDCODED_PORT}: ${viaBridge.join(', ')}`],
            [settled.every(conversation => conversation.status !== 'failed'), `turns settled: ${settled.map(c => c.status).join(', ')}`],
            [tokens.every((token, index) => finals[index].includes(token) && finals[index].includes('bind=ok')), 'final messages carry each token'],
            [destroyed === true, 'both sandboxes destroyed after the turns ended'],
            [startups.length === 2 && startups.every(entry => entry.ms <= 30_000), `sandbox startup ≤30 s: ${startups.map(entry => `${entry.ms} ms`).join(', ') || 'none logged'}`],
        ];
        console.log(`both sandboxed turns running ${bothRunningMs} ms after creation`);
        for (const entry of startups) {
            console.log(`startup  ${entry.name}  ${entry.ms} ms`);
        }
        for (const [passed, label] of checks) {
            console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}`);
        }
        ok = checks.every(([passed]) => passed);
        if (!ok) {
            console.log(log.split('\n').filter(line => /sandbox|qaiq|spawn|error/i.test(line)).slice(-30).join('\n'));
        }
    } finally {
        // Deleting the conversations removes their thread worktrees and branches.
        await Promise.all(ids.map(id => api('DELETE', `${CONVERSATIONS}/${id}`).catch(() => undefined)));
        await sleep(1000);
        try {
            process.kill(-backend.pid, 'SIGKILL');
        } catch {
            // Already gone.
        }
        for (const [name] of worktrees.length ? sandboxContainers(worktrees) : []) {
            try { docker('rm', '-f', name); } catch { /* best effort */ }
        }
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
