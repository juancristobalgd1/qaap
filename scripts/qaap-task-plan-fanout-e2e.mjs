#!/usr/bin/env node
// Editable plan → N parallel subtasks → one PR with evidence, end to end (roadmap H3.1,
// doc/qaap-task-plan-fanout.md).
//
// Same recipe as scripts/qaap-task-to-pr-e2e.mjs: the built browser backend in skip-auth local mode with an
// isolated HOME, a fake `qaiq` on PATH, a local bare `origin` and a GitHub REST stub. The fake agent plays
// three roles, told apart by the prompt: the planning turn answers with a `qaap-plan` block of three
// subtasks, each subtask writes `part-<k>.ts` (slowly, so they overlap), and the integration turn writes
// `integration.txt` listing the parts it found in the working tree. The script requires:
// - the plan is shown (`awaiting-approval`) with three subtasks, then edited over PATCH (one renamed, one
//   removed), which turns auto-run off;
// - Run starts one child conversation per subtask, each in its own worktree, with at least two
//   streaming at the same time;
// - the parent's integration turn sees both parts and the plan ends `done`;
// - one PR on `qaap/task/<parent>` whose tree has part-1.ts, part-2.ts and integration.txt (not part-3.ts),
//   with the evidence markers; the children open no PR of their own.
//
// Usage: node scripts/qaap-task-plan-fanout-e2e.mjs [--port 3468] [--keep]   (needs `npm run build:browser`)
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const BACKEND = join(ROOT, 'examples/browser/lib/backend/main.js');
const CONVERSATIONS = '/qaap/api/agent-conversations';

const FAKE_QAIQ = `#!/usr/bin/env bash
# Fake qaiq for the plan fan-out e2e (stream-json over stdio).
if [[ "\${1:-}" == "--version" ]]; then echo "qaiq 0.0.0-plan-fanout-e2e"; exit 0; fi
# The prompt can span several lines (Plan mode puts its instruction before the message) and stdin may
# stay open, so read until it is quiet for a second.
line=""
while IFS= read -r -t 1 part; do line+="$part "; done
line+="\${part:-}"
emit() { printf '%s\\n' "$1"; }
emit '{"type":"system","subtype":"init","cwd":"'"$(pwd)"'","session_id":"plan-fanout-e2e","tools":[],"model":"mock/plan-fanout-e2e"}'
if [[ "$line" == *"This is subtask "* ]]; then
  k="$(printf '%s' "$line" | sed -E 's/.*This is subtask ([0-9]+) of.*/\\1/')"
  sleep 4
  printf 'export const part%s = %s;\\n' "$k" "$k" > "part-$k.ts"
  text="Wrote part-$k.ts."
elif [[ "$line" == *"Integrate the results"* ]]; then
  ls part-*.ts 2>/dev/null | sort > integration.txt
  text="Integrated: $(tr '\\n' ' ' < integration.txt)"
elif [[ "$line" == *"qaap-plan"* ]]; then
  text='Plan ready.\\n\\n\`\`\`qaap-plan\\n{\\"summary\\": \\"Three parts\\", \\"subtasks\\": [{\\"title\\": \\"Part one\\", \\"prompt\\": \\"Create part one.\\"}, {\\"title\\": \\"Part two\\", \\"prompt\\": \\"Create part two.\\"}, {\\"title\\": \\"Part three\\", \\"prompt\\": \\"Create part three.\\"}]}\\n\`\`\`'
else
  printf 'unexpected\\n' > unexpected.txt
  text="Unexpected prompt."
fi
emit '{"type":"assistant","message":{"content":[{"type":"text","text":"'"$text"'"}]}}'
emit '{"type":"result","subtype":"success","is_error":false,"result":"'"$text"'"}'
`;

function parseArgs(argv) {
    const options = { port: 3468, keep: false };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--port') { options.port = Number(argv[++i]); }
        else if (argv[i] === '--keep') { options.keep = true; }
        else { throw new Error(`Unknown option ${argv[i]}`); }
    }
    return options;
}

const sleep = ms => new Promise(done => setTimeout(done, ms));

async function waitFor(what, timeoutMs, probe, onTick) {
    const started = Date.now();
    for (;;) {
        const value = await probe().catch(() => undefined);
        if (value) {
            return value;
        }
        if (Date.now() - started > timeoutMs) {
            throw new Error(`timed out after ${timeoutMs / 1000}s waiting for ${what}`);
        }
        await onTick?.();
        await sleep(250);
    }
}

/** Minimal GitHub REST stub (same routes as the task-to-pr e2e). */
function startGithubStub() {
    const requests = [];
    const pulls = new Map();
    const server = createServer((req, res) => {
        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => {
            const body = raw ? JSON.parse(raw) : undefined;
            requests.push({ method: req.method, url: req.url, body });
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
    const work = mkdtempSync(join(tmpdir(), 'qaap-plan-fanout-e2e-'));
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
    writeFileSync(join(seed, 'README.md'), 'plan fan-out e2e\n');
    execFileSync('git', [...gitId, 'add', '-A'], { cwd: seed });
    execFileSync('git', [...gitId, 'commit', '-qm', 'init'], { cwd: seed });
    execFileSync('git', ['push', '-q', remote, 'main'], { cwd: seed });
    execFileSync('git', ['clone', '-q', remote, repo]);

    const stub = await startGithubStub();
    const base = `http://127.0.0.1:${options.port}`;
    const env = {
        ...process.env,
        HOME: home,
        PATH: `${bin}:${process.env.PATH}`,
        QAAP_SKIP_AUTH: 'true',
        QAAP_CLOUD_MODE: 'local',
        NODE_ENV: 'development',
        OPENROUTER_API_KEY: 'mock-plan-fanout-e2e',
        QAAP_AGENT_AUTO_CONTINUE: '0',
        QAAP_AGENT_REVIEW: 'off',
        QAAP_TASK_FANOUT: 'auto',
        QAAP_TASK_FANOUT_AUTORUN_MS: '600000',
        QAAP_TASK_PR: '1',
        QAAP_TASK_PR_DEBOUNCE_MS: '1500',
        QAAP_TASK_PR_TEST_TOKEN: 'gho_plan_fanout_e2e',
        QAAP_GITHUB_API_BASE_URL: `http://127.0.0.1:${stub.port}`,
        QAAP_TASK_PR_RETRY_DELAYS_MS: '200,400,800',
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
        let json;
        try {
            json = text ? JSON.parse(text) : undefined;
        } catch {
            json = undefined;
        }
        return { status: response.status, json, text };
    };
    const getConv = async id => (await api('GET', `${CONVERSATIONS}/${id}`)).json;

    let ok = false;
    try {
        await waitFor('the backend', 90_000, async () => (await fetch(`${base}/`)).status < 500);
        const created = await api('POST', CONVERSATIONS, {
            cwd: repo, agent: 'qaiq', isolation: 'none', fanOut: true, title: 'Build the three parts',
            message: 'Build the three parts of the demo.',
        });
        if (created.status !== 201 || !created.json?.id) {
            throw new Error(`creating the conversation returned HTTP ${created.status}: ${created.text.slice(0, 300)}`);
        }
        const id = created.json.id;
        console.log(`conversation ${id} created; waiting for the plan`);
        const shown = await waitFor('the plan to be shown', 90_000, async () => {
            const conv = await getConv(id);
            if (conv?.taskPlan?.state === 'failed') {
                throw new Error(`plan failed: ${conv.taskPlan.error}`);
            }
            return conv?.taskPlan?.state === 'awaiting-approval' ? conv : undefined;
        });
        const [one, two] = shown.taskPlan.subtasks;
        const edited = await api('PATCH', `${CONVERSATIONS}/${id}/task-plan`, {
            subtasks: [
                { id: one.id, title: one.title, prompt: one.prompt },
                { id: two.id, title: 'Part two (edited)', prompt: two.prompt },
            ],
        });
        const ran = await api('POST', `${CONVERSATIONS}/${id}/task-plan/run`);

        let maxConcurrent = 0;
        const childCwds = new Set();
        const children = new Map();
        const sample = async () => {
            const conv = await getConv(id);
            let streaming = 0;
            for (const subtask of conv?.taskPlan?.subtasks ?? []) {
                if (!subtask.conversationId) {
                    continue;
                }
                const child = await getConv(subtask.conversationId);
                if (child) {
                    children.set(child.id, child);
                    childCwds.add(child.cwd);
                    if (child.status === 'streaming') {
                        streaming++;
                    }
                }
            }
            maxConcurrent = Math.max(maxConcurrent, streaming);
        };
        const integrated = await waitFor('the plan to finish', 180_000, async () => {
            const conv = await getConv(id);
            if (conv?.taskPlan?.state === 'failed' || conv?.taskPlan?.state === 'cancelled') {
                throw new Error(`plan ${conv.taskPlan.state}: ${conv.taskPlan.error ?? ''}`);
            }
            return conv?.taskPlan?.state === 'done' && conv.status !== 'streaming' ? conv : undefined;
        }, sample);

        const asked = await waitFor('the consent question', 60_000, async () => {
            const conv = await getConv(id);
            return conv?.taskPullRequest?.state === 'awaiting-consent' ? conv : undefined;
        });
        const allowed = await api('POST', `${CONVERSATIONS}/${id}/task-pull-request/consent`, { allow: true });
        const withPr = await waitFor('the task pull request', 60_000, async () => {
            const conv = await getConv(id);
            return conv?.taskPullRequest?.number || conv?.taskPullRequest?.lastError ? conv : undefined;
        });
        const ref = `refs/heads/qaap/task/${id}`;
        let files = [];
        try {
            files = execFileSync('git', ['--git-dir', remote, 'ls-tree', '-r', '--name-only', ref], { encoding: 'utf8' }).trim().split('\n');
        } catch {
            files = [];
        }
        let integration = '';
        try {
            integration = execFileSync('git', ['--git-dir', remote, 'show', `${ref}:integration.txt`], { encoding: 'utf8' });
        } catch {
            integration = '';
        }
        const creates = stub.requests.filter(request => request.method === 'POST' && /\/repos\/acme\/demo\/pulls$/.test(request.url));
        const prBody = creates[0]?.body?.body ?? '';
        const childList = [...children.values()];

        const checks = [
            [shown.taskPlan.subtasks.length === 3, `plan shown with ${shown.taskPlan.subtasks.length} subtasks`],
            [shown.interactionModeId !== 'plan', 'the parent left Plan mode once the plan was ready'],
            [edited.status === 200 && edited.json?.taskPlan?.subtasks?.length === 2 && edited.json.taskPlan.autoRun === false,
                `PATCH edited the plan (HTTP ${edited.status}, ${edited.json?.taskPlan?.subtasks?.length} subtasks, autoRun ${edited.json?.taskPlan?.autoRun})`],
            [ran.status === 200 && ran.json?.taskPlan?.state === 'running', `Run returned HTTP ${ran.status} (${ran.json?.taskPlan?.state ?? ran.text.slice(0, 120)})`],
            [childList.length === 2, `${childList.length} child conversations`],
            [childList.every(child => child.parentConversationId === id && child.taskPullRequestEnabled === false && child.worktreeBranch),
                'children are linked to the parent, in worktrees, with "Create PR" off'],
            [childCwds.size === 2 && !childCwds.has(repo), `each child has its own worktree (${[...childCwds].join(', ')})`],
            [maxConcurrent >= 2, `${maxConcurrent} subtasks streamed at the same time`],
            [integrated.taskPlan.subtasks[1]?.title === 'Part two (edited)' && childList.some(child => child.title.startsWith('2/2')),
                `the edited plan drove the children (${childList.map(child => JSON.stringify(child.title)).join(', ')})`],
            [integrated.taskPlan.subtasks.every(subtask => subtask.state === 'done' && subtask.headSha), 'every subtask done with a committed head'],
            [integration.trim() === 'part-1.ts\npart-2.ts', `integration turn saw both parts (${JSON.stringify(integration)})`],
            [asked.taskPullRequest?.state === 'awaiting-consent' && allowed.status === 200, 'consent asked and allowed'],
            [!withPr.taskPullRequest?.lastError && withPr.taskPullRequest?.number === 1, `PR ${withPr.taskPullRequest?.number} ${JSON.stringify(withPr.taskPullRequest?.lastError ?? '')}`],
            [files.includes('part-1.ts') && files.includes('part-2.ts') && files.includes('integration.txt') && !files.includes('part-3.ts'),
                `PR branch tree: ${files.join(', ')}`],
            [creates.length === 1, `${creates.length} PR create(s): one PR for the whole task`],
            [prBody.includes('<!-- qaap:evidence -->') && prBody.includes('### Checks'), 'PR body carries the evidence'],
            [!existsSync(join(repo, 'unexpected.txt')), 'the fake agent never got an unexpected prompt'],
        ];
        for (const [passed, label] of checks) {
            console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}`);
        }
        ok = checks.every(([passed]) => passed);
        if (!ok) {
            console.log(readFileSync(logPath, 'utf8').split('\n').filter(line => /task-plan|task-pr|error/i.test(line)).slice(-40).join('\n'));
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
