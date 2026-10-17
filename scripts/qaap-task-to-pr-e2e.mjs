#!/usr/bin/env node
// Task → PR with evidence end to end (roadmap H3.1/H3.2, doc/qaap-task-to-pr.md).
//
// Starts the built browser backend (examples/browser/lib/backend/main.js) in skip-auth local mode with
// an isolated HOME, a fake `qaiq` on PATH that edits a file, a local bare repository as the project's
// `origin` and a tiny local GitHub REST stub (QAAP_GITHUB_API_BASE_URL). QAAP_TASK_PR_TEST_TOKEN is the
// token the task pull request service uses in that mode only. Runs one chat turn and requires:
// - the bare remote got `refs/heads/qaap/task/<conversationId>` with the agent's file and without the
//   user's pre-existing dirty file;
// - the stub received one `POST /repos/acme/demo/pulls` whose body has the evidence markers, the
//   checks and the reviewer sections;
// - the conversation records the task pull request.
//
// Usage: node scripts/qaap-task-to-pr-e2e.mjs [--port 3467] [--keep]   (needs `npm run build:browser`)
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const BACKEND = join(ROOT, 'examples/browser/lib/backend/main.js');
const CONVERSATIONS = '/qaap/api/agent-conversations';

const FAKE_QAIQ = `#!/usr/bin/env bash
# Fake qaiq for the task-to-pr e2e (stream-json over stdio): writes one file and reports success.
if [[ "\${1:-}" == "--version" ]]; then echo "qaiq 0.0.0-task-pr-e2e"; exit 0; fi
IFS= read -r line || true
printf 'export const answer = 42;\\n' > feature.ts
emit() { printf '%s\\n' "$1"; }
emit '{"type":"system","subtype":"init","cwd":"'"$(pwd)"'","session_id":"task-pr-e2e","tools":[],"model":"mock/task-pr-e2e"}'
emit '{"type":"assistant","message":{"content":[{"type":"text","text":"Added feature.ts exporting the answer."}]}}'
emit '{"type":"result","subtype":"success","is_error":false,"result":"Added feature.ts exporting the answer."}'
`;

function parseArgs(argv) {
    const options = { port: 3467, keep: false };
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

/** Minimal GitHub REST stub: repository metadata, pulls create/read/update, labels, GraphQL draft flips. */
function startGithubStub() {
    const requests = [];
    const pulls = new Map();
    const server = createServer((req, res) => {
        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => {
            const body = raw ? JSON.parse(raw) : undefined;
            requests.push({ method: req.method, url: req.url, body, authorization: req.headers.authorization });
            const send = (status, json) => {
                res.writeHead(status, { 'content-type': 'application/json' });
                res.end(json === undefined ? '' : JSON.stringify(json));
            };
            const url = new URL(req.url, 'http://stub');
            let match;
            if (req.method === 'POST' && url.pathname === '/graphql') {
                return send(200, { data: {} });
            }
            if ((match = /^\/repos\/([^/]+)\/([^/]+)$/.exec(url.pathname)) && req.method === 'GET') {
                return send(200, {
                    id: 1, full_name: `${match[1]}/${match[2]}`, owner: { login: match[1] }, name: match[2],
                    clone_url: `https://github.com/${match[1]}/${match[2]}.git`, html_url: `https://github.com/${match[1]}/${match[2]}`,
                    default_branch: 'main', private: true, updated_at: new Date().toISOString(),
                });
            }
            if ((match = /^\/repos\/([^/]+)\/([^/]+)\/pulls$/.exec(url.pathname)) && req.method === 'POST') {
                const number = pulls.size + 1;
                const pull = {
                    number, html_url: `https://github.com/${match[1]}/${match[2]}/pull/${number}`, node_id: `PR_${number}`,
                    body: body.body, title: body.title, draft: !!body.draft, state: 'open', head: body.head, base: body.base,
                };
                pulls.set(number, pull);
                return send(201, pull);
            }
            if ((match = /^\/repos\/[^/]+\/[^/]+\/pulls\/(\d+)$/.exec(url.pathname))) {
                const pull = pulls.get(Number(match[1]));
                if (!pull) {
                    return send(404, { message: 'Not Found' });
                }
                if (req.method === 'PATCH') {
                    Object.assign(pull, body);
                }
                return send(200, pull);
            }
            if (/^\/repos\/[^/]+\/[^/]+\/issues\/\d+\/labels/.test(url.pathname)) {
                return send(200, []);
            }
            return send(404, { message: `stub: no route for ${req.method} ${url.pathname}` });
        });
    });
    return new Promise(done => server.listen(0, '127.0.0.1', () => done({ server, requests, pulls, port: server.address().port })));
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (!existsSync(BACKEND)) {
        throw new Error(`${BACKEND} not found: run npm run build:browser first`);
    }
    const work = mkdtempSync(join(tmpdir(), 'qaap-task-pr-e2e-'));
    const home = join(work, 'home');
    const bin = join(work, 'bin');
    const remote = join(work, 'remote', 'acme', 'demo.git');
    const seed = join(work, 'seed');
    const repo = join(work, 'repo');
    for (const dir of [home, bin, remote, seed]) {
        mkdirSync(dir, { recursive: true });
    }
    writeFileSync(join(bin, 'qaiq'), FAKE_QAIQ);
    chmodSync(join(bin, 'qaiq'), 0o755);
    const gitId = ['-c', 'user.email=e2e@qaap.local', '-c', 'user.name=e2e'];
    execFileSync('git', ['init', '--bare', '-q', '-b', 'main', remote]);
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: seed });
    writeFileSync(join(seed, 'README.md'), 'task to pr e2e\n');
    execFileSync('git', [...gitId, 'add', '-A'], { cwd: seed });
    execFileSync('git', [...gitId, 'commit', '-qm', 'init'], { cwd: seed });
    execFileSync('git', ['push', '-q', remote, 'main'], { cwd: seed });
    execFileSync('git', ['clone', '-q', remote, repo]);
    // The user's own uncommitted work: must not reach the pull request.
    writeFileSync(join(repo, 'notes-by-user.txt'), 'private scratch\n');

    const stub = await startGithubStub();
    const base = `http://127.0.0.1:${options.port}`;
    const env = {
        ...process.env,
        HOME: home,
        PATH: `${bin}:${process.env.PATH}`,
        QAAP_SKIP_AUTH: 'true',
        QAAP_CLOUD_MODE: 'local',
        NODE_ENV: 'development',
        OPENROUTER_API_KEY: 'mock-task-pr-e2e',
        QAAP_AGENT_AUTO_CONTINUE: '0',
        QAAP_AGENT_REVIEW: 'off',
        QAAP_TASK_PR: '1',
        QAAP_TASK_PR_DEBOUNCE_MS: '1500',
        QAAP_TASK_PR_TEST_TOKEN: 'gho_task_pr_e2e',
        QAAP_GITHUB_API_BASE_URL: `http://127.0.0.1:${stub.port}`,
    };
    const logPath = join(work, 'backend.log');
    const out = openSync(logPath, 'a');
    const backend = spawn(process.execPath, [BACKEND, '--port', String(options.port), '--hostname', '127.0.0.1'], {
        cwd: join(ROOT, 'examples/browser'), env, detached: true, stdio: ['ignore', out, out],
    });
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
        await waitFor('the backend', 90_000, async () => (await fetch(`${base}/`)).status < 500);
        const created = await api('POST', CONVERSATIONS, {
            cwd: repo, agent: 'qaiq', isolation: 'none', title: 'Add the answer module',
            message: 'Add feature.ts exporting the answer.',
        });
        if (created.status !== 201 || !created.json?.id) {
            throw new Error(`creating the conversation returned HTTP ${created.status}: ${created.text.slice(0, 300)}`);
        }
        const id = created.json.id;
        console.log(`conversation ${id} created; waiting for the turn and the task pull request`);
        await waitFor('the turn to finish', 90_000, async () => {
            const current = await api('GET', `${CONVERSATIONS}/${id}`);
            return current.json && current.json.status !== 'streaming' ? current.json : undefined;
        });
        const conv = await waitFor('the task pull request', 60_000, async () => {
            const current = await api('GET', `${CONVERSATIONS}/${id}`);
            return current.json?.taskPullRequest?.number || current.json?.taskPullRequest?.lastError ? current.json : undefined;
        });

        const ref = `refs/heads/qaap/task/${id}`;
        let branchFiles = [];
        try {
            branchFiles = execFileSync('git', ['--git-dir', remote, 'ls-tree', '-r', '--name-only', ref], { encoding: 'utf8' }).trim().split('\n');
        } catch {
            branchFiles = [];
        }
        const creates = stub.requests.filter(request => request.method === 'POST' && /\/repos\/acme\/demo\/pulls$/.test(request.url));
        const prBody = creates[0]?.body?.body ?? '';
        const checks = [
            [!conv.taskPullRequest?.lastError, `task pull request error ${JSON.stringify(conv.taskPullRequest?.lastError)}`],
            [conv.taskPullRequest?.number === 1, `task pull request number ${conv.taskPullRequest?.number}`],
            [branchFiles.includes('feature.ts'), `bare remote ${ref} has feature.ts (${branchFiles.join(', ')})`],
            [!branchFiles.includes('notes-by-user.txt'), 'pre-existing dirty file kept out of the branch'],
            [creates.length === 1, `stub received ${creates.length} PR create(s)`],
            [creates[0]?.authorization === 'Bearer gho_task_pr_e2e', 'PR create used the owner token'],
            [creates[0]?.body?.head === `qaap/task/${id}` && creates[0]?.body?.base === 'main', `PR head/base ${creates[0]?.body?.head} → ${creates[0]?.body?.base}`],
            [prBody.includes('<!-- qaap:evidence -->') && prBody.includes('<!-- /qaap:evidence -->'), 'PR body has the evidence markers'],
            [prBody.includes('### Checks'), 'PR body has the checks section'],
            [prBody.includes('### Reviewer verdict'), 'PR body has the reviewer section'],
            [prBody.includes('feature.ts'), 'PR body diffstat lists feature.ts'],
        ];
        for (const [passed, label] of checks) {
            console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}`);
        }
        ok = checks.every(([passed]) => passed);
        if (!ok) {
            console.log(readFileSync(logPath, 'utf8').split('\n').filter(line => /task-pr|error/i.test(line)).slice(-30).join('\n'));
            console.log(JSON.stringify(stub.requests.map(request => `${request.method} ${request.url}`)));
        }
    } finally {
        killBackend();
        stub.server.close();
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
