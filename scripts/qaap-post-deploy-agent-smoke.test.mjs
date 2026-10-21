// Tests for scripts/qaap-post-deploy-agent-smoke.mjs against a fake Qaap API (node --test).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { main, findProviderCredentialRejection, judgeTask, redactSecrets, pickProjectCwd, pickSmokeAgent, smokeCookie } from './qaap-post-deploy-agent-smoke.mjs';

const SESSIONS = {
    sessions: [
        { repoKey: 'github:o/not-cloned' },
        { repoKey: 'github:o/first', workspaceUri: 'file:///workspace/repos/users/smoke/o/first' },
        { repoKey: 'github:o/second', workspaceUri: 'file:///workspace/repos/users/smoke/o/second' },
    ],
};

/**
 * Fake API. `finish(prompt)` returns the task detail once the task is done (undefined = keeps
 * running). Records every request in `calls`.
 */
async function withServer(options, run) {
    const calls = [];
    let created;
    let polls = 0;
    const server = createServer((req, res) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            calls.push({ method: req.method, url: req.url, cookie: req.headers.cookie, body: body ? JSON.parse(body) : undefined });
            const send = (status, json) => {
                res.writeHead(status, { 'content-type': 'application/json' });
                res.end(JSON.stringify(json));
            };
            if (req.headers.cookie !== 'qaap_sid=abc') {
                return send(401, { error: 'Not signed in' });
            }
            if (req.method === 'GET' && req.url.split('?')[0] === '/qaap/api/agent-tasks') {
                options.listCalls = (options.listCalls ?? 0) + 1;
                if (options.agentsByCall) {
                    const agents = options.agentsByCall[Math.min(options.listCalls, options.agentsByCall.length) - 1];
                    return send(200, { tasks: [], agentConfigured: true, defaultAgent: 'qaiq', agents });
                }
                return send(200, {
                    tasks: [], agentConfigured: options.agentConfigured ?? true, defaultAgent: 'qaiq',
                    agents: options.agents ?? [{ id: 'qaiq', available: true, connectionState: 'connected' }],
                });
            }
            if (req.method === 'GET' && req.url === '/qaap/api/github/project-sessions') {
                return send(200, options.sessions ?? SESSIONS);
            }
            if (req.method === 'POST' && req.url === '/qaap/api/agent-tasks') {
                created = JSON.parse(body);
                return send(201, { id: 't1', state: 'queued' });
            }
            if (req.method === 'GET' && req.url === '/qaap/api/agent-tasks/t1') {
                polls++;
                const done = polls >= 2 ? options.finish?.(created.prompt) : undefined;
                return send(200, done ?? { id: 't1', state: 'running', log: '' });
            }
            if (req.method === 'POST' && req.url === '/qaap/api/agent-tasks/t1/cancel') {
                return send(200, { ok: true });
            }
            send(404, { error: 'nope' });
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        return await run(base, calls);
    } finally {
        server.close();
    }
}

const ENV = { QAAP_SMOKE_SESSION: 'abc', QAAP_SMOKE_AGENT_POLL_MS: '10', QAAP_SMOKE_AGENT_LIST_RETRY_MS: '10' };
const echoToken = prompt => ({ id: 't1', state: 'completed', exitCode: 0, log: `assistant: ${prompt.split(': ').pop()}` });
const quiet = async fn => {
    const log = console.log;
    console.log = () => undefined;
    try {
        return await fn();
    } finally {
        console.log = log;
    }
};

test('cookie: bare sid, name=value, or QAAP_SMOKE_COOKIE', () => {
    assert.equal(smokeCookie({ QAAP_SMOKE_SESSION: 'abc' }), 'qaap_sid=abc');
    assert.equal(smokeCookie({ QAAP_SMOKE_SESSION: 'other=1' }), 'other=1');
    assert.equal(smokeCookie({ QAAP_SMOKE_COOKIE: 'x=y' }), 'x=y');
    assert.equal(smokeCookie({}), '');
});

test('project: first cloned project, or the requested repoKey', () => {
    assert.deepEqual(pickProjectCwd(SESSIONS), { repoKey: 'github:o/first', cwd: '/workspace/repos/users/smoke/o/first' });
    assert.equal(pickProjectCwd(SESSIONS, 'github:o/second').cwd, '/workspace/repos/users/smoke/o/second');
    assert.equal(pickProjectCwd(SESSIONS, 'github:o/not-cloned'), undefined);
    assert.equal(pickProjectCwd({ sessions: [] }), undefined);
});

test('verdict: completed (+ token), warnings pass, anything else fails', () => {
    assert.equal(judgeTask({ state: 'completed', log: 'x TOKEN y' }, 'TOKEN').ok, true);
    assert.equal(judgeTask({ state: 'completed', log: 'no' }, 'TOKEN').ok, false);
    assert.equal(judgeTask({ state: 'completed' }, undefined).ok, true);
    assert.deepEqual(judgeTask({ state: 'completed_with_warnings', log: 'TOKEN' }, 'TOKEN'), { ok: true, reason: 'completed_with_warnings', warning: true });
    for (const state of ['failed', 'blocked', 'interrupted', 'cancelled']) {
        assert.equal(judgeTask({ state, log: 'TOKEN' }, 'TOKEN').ok, false, state);
    }
});

test('happy path: read-only turn in the first cloned project, token echoed', async () => {
    await withServer({ finish: echoToken }, async (base, calls) => {
        assert.equal(await quiet(() => main([base], ENV)), 0);
        const create = calls.find(call => call.method === 'POST' && call.url === '/qaap/api/agent-tasks');
        assert.equal(create.body.cwd, '/workspace/repos/users/smoke/o/first');
        assert.equal(create.body.readOnlyWorkspace, true);
        assert.equal(create.body.agent, 'qaiq');
        assert.match(create.body.prompt, /QAAP_SMOKE_[0-9A-F]{12}$/);
        assert.ok(calls.every(call => call.cookie === 'qaap_sid=abc'));
        assert.ok(!calls.some(call => call.url.endsWith('/cancel')));
    });
});

test('failed turn fails the smoke and writes diagnostics', async () => {
    const { mkdtempSync, readFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(`${tmpdir()}/qaap-agent-smoke-`);
    await withServer({ finish: () => ({ id: 't1', state: 'failed', exitCode: 1, log: 'boom' }) }, async base => {
        await assert.rejects(quiet(() => main([base], { ...ENV, QAAP_SMOKE_ARTIFACT_DIR: dir })), /state failed/);
        assert.equal(JSON.parse(readFileSync(`${dir}/agent-task.json`, 'utf8')).log, 'boom');
    });
});

test('a reply without the token fails unless QAAP_SMOKE_AGENT_EXPECT_TOKEN=0', async () => {
    const mockReply = () => ({ id: 't1', state: 'completed', exitCode: 0, log: 'scaffolded a Vite app' });
    await withServer({ finish: mockReply }, async base => {
        await assert.rejects(quiet(() => main([base], ENV)), /does not contain the token/);
    });
    await withServer({ finish: mockReply }, async base => {
        assert.equal(await quiet(() => main([base], { ...ENV, QAAP_SMOKE_AGENT_EXPECT_TOKEN: '0' })), 0);
    });
});

test('a turn that never finishes is cancelled at the timeout', async () => {
    await withServer({ finish: () => undefined }, async (base, calls) => {
        await assert.rejects(quiet(() => main([base], { ...ENV, QAAP_SMOKE_AGENT_TIMEOUT_SECONDS: '0.2' })), /did not finish/);
        assert.ok(calls.some(call => call.method === 'POST' && call.url === '/qaap/api/agent-tasks/t1/cancel'));
    });
});

test('dry run checks agent and project but starts no turn', async () => {
    await withServer({ finish: echoToken }, async (base, calls) => {
        assert.equal(await quiet(() => main([base], { ...ENV, QAAP_SMOKE_AGENT_DRY_RUN: '1' })), 0);
        assert.ok(!calls.some(call => call.method === 'POST'));
    });
});

test('no agent configured, no cloned project, bad session: clear failures', async () => {
    await withServer({ agentConfigured: false }, async base => {
        await assert.rejects(quiet(() => main([base], ENV)), /no coding agent is configured/);
    });
    await withServer({ sessions: { sessions: [] } }, async base => {
        await assert.rejects(quiet(() => main([base], ENV)), /no cloned project/);
    });
    await withServer({}, async base => {
        await assert.rejects(quiet(() => main([base], { QAAP_SMOKE_SESSION: 'wrong' })), /HTTP 401/);
    });
    assert.equal(await main(['not-a-url'], ENV).catch(() => 'threw'), 2);
});

test('agent: requested, else a signed-in default, else the first signed-in agent', () => {
    const list = {
        defaultAgent: 'codex',
        agents: [
            { id: 'codex', available: true, connectionState: 'disconnected' },
            { id: 'claude', available: false, connectionState: 'connected' },
            { id: 'qaiq', available: true, connectionState: 'connected' },
        ],
    };
    assert.deepEqual(pickSmokeAgent(list, 'codex'), { agent: 'codex' });
    assert.deepEqual(pickSmokeAgent(list, undefined), { agent: 'qaiq', note: 'default agent codex is not signed in; using qaiq' });
    assert.deepEqual(pickSmokeAgent({ ...list, defaultAgent: 'qaiq' }, undefined), { agent: 'qaiq', note: undefined });
    assert.equal(pickSmokeAgent({ agents: [{ id: 'x', available: true, connectionState: 'not-required' }] }).agent, 'x');
    assert.equal(pickSmokeAgent({ defaultAgent: 'codex', agents: [{ id: 'codex', available: true, connectionState: 'disconnected' }] }).agent, undefined);
});

test('no signed-in agent skips the turn with a warning instead of failing the deploy', async () => {
    const options = { agents: [{ id: 'codex', available: true, connectionState: 'disconnected' }] };
    await withServer(options, async (base, calls) => {
        assert.equal(await quiet(() => main([base], ENV)), 0);
        assert.ok(!calls.some(call => call.method === 'POST'));
        assert.equal(options.listCalls, 3, 'retries the cold probe before giving up');
        assert.ok(calls.every(call => call.method !== 'GET' || !call.url.startsWith('/qaap/api/agent-tasks') || call.url.endsWith('?refresh=1')));
    });
});

test('a cold probe that resolves on a retry runs the turn', async () => {
    const options = {
        finish: echoToken,
        agentsByCall: [
            [{ id: 'qaiq', available: true, connectionState: 'unknown' }],
            [{ id: 'qaiq', available: true, connectionState: 'connected' }],
        ],
    };
    await withServer(options, async (base, calls) => {
        assert.equal(await quiet(() => main([base], ENV)), 0);
        assert.equal(options.listCalls, 2);
        assert.ok(calls.some(call => call.method === 'POST' && call.url === '/qaap/api/agent-tasks'));
    });
});

// Production, Oct 20 2026: QAIQ on an OpenRouter `:free` model died in 0.9 s with the ambiguous model
// error; the runner's provider preflight then names the rejected key.
const QAIQ_MODEL_ISSUE = JSON.stringify({
    type: 'result', is_error: true, duration_api_ms: 0, error: 'invalid_request',
    result: 'There\'s an issue with the selected model (nvidia/nemotron-3-super-120b-a12b:free). It may not exist or you may not have access to it. Run --model to pick a different model.',
});

test('only the runner preflight note proves rejected provider credentials', () => {
    assert.match(findProviderCredentialRejection({ log: `${QAIQ_MODEL_ISSUE}\n[qaap] provider check: OpenRouter key_rejected (HTTP 401).` }), /key_rejected/);
    assert.match(findProviderCredentialRejection({ log: '[qaap] provider check: OpenRouter no_credits (HTTP 402).' }), /no_credits/);
    // A valid key refused a free model: could still be Qaap routing; not proof.
    assert.equal(findProviderCredentialRejection({ log: '[qaap] provider check: OpenRouter free_model_refused (HTTP 200).' }), undefined);
    // The persisted copy alone, or raw provider lines, are not proof either.
    for (const log of [
        'Your OpenRouter key was rejected. Update it in Settings → BYOK, then retry.',
        'API Error: 402 Insufficient credits',
        'API Error: 404 No endpoints found matching your data policy (Free model publication)',
        'unexpected status 401 Unauthorized: Incorrect API key provided: sk-proj-abcdef123',
        QAIQ_MODEL_ISSUE,
        'Error: spawn qaiq ENOENT',
        '[qaap] task timed out after 300s without output.',
        'curl: (22) The requested URL returned error: 403 HTTP 403',
    ]) {
        assert.equal(findProviderCredentialRejection({ log }), undefined, log);
    }
});

test('secrets of every BYOK provider are redacted', () => {
    for (const secret of ['sk-or-v1-abcdef', 'hf_abcdefgh', 'nvapi-abcdefgh', 'AIzaSyAbcdefgh123', 'gsk_abcdefgh', 'xai-abcdefgh']) {
        assert.equal(redactSecrets(`key ${secret} end`), 'key <redacted> end', secret);
    }
    assert.equal(redactSecrets('Authorization: Bearer abc.def'), 'Authorization: Bearer <redacted>');
});

test('Qaap no longer injecting the key (401 No auth credentials found) fails the smoke', async () => {
    const log = `${QAIQ_MODEL_ISSUE}\nAPI Error: 401 {"error":{"message":"No auth credentials found","code":401}}`;
    assert.equal(judgeTask({ state: 'failed', exitCode: 1, log }, 'TOKEN').inconclusive, undefined);
    await withServer({ finish: () => ({ id: 't1', state: 'failed', exitCode: 1, log }) }, async base => {
        await assert.rejects(quiet(() => main([base], ENV)), /state failed/);
    });
});

test('a NVIDIA-routed turn that fails gets no preflight note and fails the smoke, whatever OpenRouter key exists', async () => {
    // The runner only probes OpenRouter for vendor=openrouter turns, so a Qaap regression on another
    // vendor never carries `key_rejected` and must stay red.
    const log = JSON.stringify({ type: 'result', is_error: true, result: 'API Error: 500 upstream error from integrate.api.nvidia.com' });
    assert.equal(findProviderCredentialRejection({ log }), undefined);
    await withServer({ finish: () => ({ id: 't1', state: 'failed', exitCode: 1, log }) }, async base => {
        await assert.rejects(quiet(() => main([base], ENV)), /state failed/);
    });
});

test('a retried provider 429 followed by a real Qaap failure fails the smoke', async () => {
    const log = [
        '{"type":"system","subtype":"api_retry","error":"rate_limit","status":429}',
        'API Error: 429 Rate limit exceeded: free-models-per-day',
        '[qaap] process error: spawn EACCES',
    ].join('\n');
    assert.equal(judgeTask({ state: 'failed', exitCode: 1, log }, 'TOKEN').inconclusive, undefined);
    await withServer({ finish: () => ({ id: 't1', state: 'failed', exitCode: 1, log }) }, async base => {
        await assert.rejects(quiet(() => main([base], ENV)), /state failed/);
    });
});

test('verdict: a failed turn on rejected provider credentials is inconclusive, other failures are not', () => {
    const rejected = judgeTask({ state: 'failed', exitCode: 1, log: '[qaap] provider check: OpenRouter no_credits (HTTP 402).' }, 'TOKEN');
    assert.equal(rejected.ok, false);
    assert.equal(rejected.inconclusive, true);
    assert.equal(judgeTask({ state: 'failed', exitCode: 1, log: 'Error: spawn qaiq ENOENT' }, 'TOKEN').inconclusive, undefined);
    // A turn cut short is the release's problem even if a 429 scrolled by.
    assert.equal(judgeTask({ state: 'interrupted', log: '[qaap] provider check: OpenRouter key_rejected (HTTP 401).' }, 'TOKEN').inconclusive, undefined);
});

test('rejected provider credentials warn without failing the deploy; a product failure still fails', async () => {
    const lines = [];
    const log = console.log;
    console.log = line => lines.push(line);
    try {
        await withServer({
            finish: () => ({ id: 't1', state: 'failed', exitCode: 1, log: `${QAIQ_MODEL_ISSUE}\n[qaap] provider check: OpenRouter key_rejected (HTTP 401).` }),
        }, async base => {
            assert.equal(await main([base], ENV), 0);
        });
    } finally {
        console.log = log;
    }
    assert.ok(lines.some(line => /^::warning::Post-deploy agent smoke inconclusive: .*rejected the smoke user's credentials.*key_rejected/.test(line)), lines.join('\n'));
    await withServer({ finish: () => ({ id: 't1', state: 'failed', exitCode: 1, log: QAIQ_MODEL_ISSUE }) }, async base => {
        await assert.rejects(quiet(() => main([base], ENV)), /state failed/);
    });
});
