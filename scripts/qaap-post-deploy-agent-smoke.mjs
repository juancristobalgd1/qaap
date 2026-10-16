#!/usr/bin/env node
// Post-deploy agent smoke: as the signed-in smoke user, run one real agent turn on the freshly
// deployed release and fail unless it finishes. The HTTP and auth probes of
// qaap-vps-post-deploy-user-smoke.sh passed while agents hung in production (a 403 from the cwd
// ownership guard, turns lost to a backend restart); only a turn that runs end to end catches those.
//
// The turn is read-only (`readOnlyWorkspace: true`) on a project the smoke user already has cloned,
// and asks the agent to answer with a random token: nothing is written to the repository, and the
// token proves the reply came from this turn. One short turn per deploy.
//
// Usage: node scripts/qaap-post-deploy-agent-smoke.mjs <public-base-url>
// Env:
//   QAAP_SMOKE_SESSION / QAAP_SMOKE_COOKIE  signed-in session (same as the user smoke)
//   QAAP_SMOKE_AGENT_REPO       repoKey of the project to use (e.g. github:owner/name); default: the
//                               first cloned project of the smoke user
//   QAAP_SMOKE_AGENT_CWD        run in this repository path instead (skips the project lookup)
//   QAAP_SMOKE_AGENT            agent id (default: the user's default agent)
//   QAAP_SMOKE_AGENT_TIMEOUT_SECONDS  hard limit for the turn (default 300)
//   QAAP_SMOKE_AGENT_DRY_RUN=1  only the read-only checks (agent configured, project resolved)
//   QAAP_SMOKE_AGENT_EXPECT_TOKEN=0  accept any completed turn (mock agents that ignore the prompt)
//   QAAP_SMOKE_ARTIFACT_DIR     where the task detail is written on failure
// Exit codes: 0 pass, 1 failure, 2 usage error.
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TASKS_PATH = '/qaap/api/agent-tasks';
const SESSIONS_PATH = '/qaap/api/github/project-sessions';
const TERMINAL_STATES = new Set(['completed', 'completed_with_warnings', 'blocked', 'failed', 'interrupted', 'cancelled']);

/** Cookie header from QAAP_SMOKE_SESSION (bare sid or `name=value`) or QAAP_SMOKE_COOKIE. */
export function smokeCookie(env) {
    const session = env.QAAP_SMOKE_SESSION ?? '';
    if (session) {
        return session.includes('=') ? session : `qaap_sid=${session}`;
    }
    return env.QAAP_SMOKE_COOKIE ?? '';
}

/** Absolute repository path of the project to run in, from the project-sessions payload. */
export function pickProjectCwd(payload, wantedRepoKey) {
    const sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
    const cloned = sessions.filter(session => typeof session?.workspaceUri === 'string'
        && session.workspaceUri.startsWith('file://'));
    const match = wantedRepoKey ? cloned.find(session => session.repoKey === wantedRepoKey) : cloned[0];
    if (!match) {
        return undefined;
    }
    return { repoKey: match.repoKey, cwd: fileURLToPath(match.workspaceUri) };
}

/** Pass/fail verdict for a finished task detail. */
// `completed_with_warnings` = the turn finished but the repository's own checks were red: that is the
// project's state, not the release's, so it passes with a warning.
export function judgeTask(detail, token) {
    const state = detail?.state;
    if (state !== 'completed' && state !== 'completed_with_warnings') {
        return { ok: false, reason: `task ended in state ${state ?? '<missing>'} (exit ${detail?.exitCode ?? '-'})` };
    }
    if (token && !(typeof detail.log === 'string' && detail.log.includes(token))) {
        return { ok: false, reason: `task ${state} but its log does not contain the token ${token}` };
    }
    return { ok: true, reason: state, warning: state === 'completed_with_warnings' };
}

class SmokeError extends Error { }

async function main(argv, env) {
    const baseUrl = (argv[0] ?? env.QAAP_VPS_PUBLIC_URL ?? '').replace(/\/+$/, '');
    if (!/^https?:\/\//.test(baseUrl)) {
        console.error('Usage: qaap-post-deploy-agent-smoke.mjs <public-base-url>');
        return 2;
    }
    const cookie = smokeCookie(env);
    if (!cookie) {
        console.error('::error::QAAP_SMOKE_SESSION or QAAP_SMOKE_COOKIE is required for the agent smoke.');
        return 1;
    }
    const dryRun = env.QAAP_SMOKE_AGENT_DRY_RUN === '1';
    const expectToken = env.QAAP_SMOKE_AGENT_EXPECT_TOKEN !== '0';
    const timeoutMs = Number(env.QAAP_SMOKE_AGENT_TIMEOUT_SECONDS ?? 300) * 1000;
    const pollMs = Number(env.QAAP_SMOKE_AGENT_POLL_MS ?? 3000);
    const artifactDir = env.QAAP_SMOKE_ARTIFACT_DIR;

    const request = async (method, path, body, timeout = 180_000) => {
        const response = await fetch(baseUrl + path, {
            method,
            headers: { cookie, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
            redirect: 'manual',
            // The first signed-in request may cold-boot the smoke user's tenant backend.
            signal: AbortSignal.timeout(timeout),
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
    const expectOk = (result, what) => {
        if (result.status < 200 || result.status >= 300 || result.json === undefined) {
            throw new SmokeError(`${what} returned HTTP ${result.status}: ${result.text.slice(0, 300)}`);
        }
        return result.json;
    };

    const list = expectOk(await request('GET', TASKS_PATH), 'GET agent-tasks');
    if (!list.agentConfigured) {
        throw new SmokeError('no coding agent is configured for the smoke user (agentConfigured=false)');
    }
    const agent = env.QAAP_SMOKE_AGENT || list.defaultAgent;
    console.log(`OK: agent configured (default ${list.defaultAgent ?? '<none>'}, smoke uses ${agent ?? '<default>'}).`);

    const project = env.QAAP_SMOKE_AGENT_CWD
        ? { repoKey: '(QAAP_SMOKE_AGENT_CWD)', cwd: env.QAAP_SMOKE_AGENT_CWD }
        : pickProjectCwd(expectOk(await request('GET', SESSIONS_PATH), 'GET project-sessions'),
            env.QAAP_SMOKE_AGENT_REPO || undefined);
    if (!project) {
        throw new SmokeError(env.QAAP_SMOKE_AGENT_REPO
            ? `the smoke user has no cloned project ${env.QAAP_SMOKE_AGENT_REPO}`
            : 'the smoke user has no cloned project to run the turn in (open one in Qaap once)');
    }
    console.log(`OK: project ${project.repoKey} at ${project.cwd}.`);
    if (dryRun) {
        console.log('Dry run: no agent turn started.');
        return 0;
    }

    const token = `QAAP_SMOKE_${randomBytes(6).toString('hex').toUpperCase()}`;
    const created = await request('POST', TASKS_PATH, {
        cwd: project.cwd,
        prompt: `Post-deploy smoke test. Do not read, run or change anything. Reply with exactly this text and nothing else: ${token}`,
        title: 'Post-deploy smoke',
        agent,
        readOnlyWorkspace: true,
        clientRequestId: `post-deploy-smoke-${token.toLowerCase()}`,
    });
    if (created.status !== 201 || typeof created.json?.id !== 'string') {
        throw new SmokeError(`creating the agent task returned HTTP ${created.status}: ${created.text.slice(0, 300)}`);
    }
    const taskId = created.json.id;
    console.log(`OK: task ${taskId} created (${created.json.state}).`);

    const started = Date.now();
    let detail;
    let lastState = '';
    for (;;) {
        const polled = await request('GET', `${TASKS_PATH}/${encodeURIComponent(taskId)}`, undefined, 30_000)
            .catch(error => ({ status: 0, json: undefined, text: String(error) }));
        if (polled.status === 200 && polled.json) {
            detail = polled.json;
            if (detail.state !== lastState) {
                lastState = detail.state;
                console.log(`   ${Math.round((Date.now() - started) / 1000)}s: ${lastState}`);
            }
            if (TERMINAL_STATES.has(detail.state)) {
                break;
            }
        }
        if (Date.now() - started > timeoutMs) {
            await request('POST', `${TASKS_PATH}/${encodeURIComponent(taskId)}/cancel`, {}, 30_000).catch(() => undefined);
            writeDiagnostics(artifactDir, detail);
            throw new SmokeError(`task ${taskId} did not finish within ${timeoutMs / 1000}s (last state ${lastState || '<unknown>'}); cancelled`);
        }
        await new Promise(resolve => setTimeout(resolve, pollMs));
    }

    const verdict = judgeTask(detail, expectToken ? token : undefined);
    if (!verdict.ok) {
        writeDiagnostics(artifactDir, detail);
        throw new SmokeError(verdict.reason);
    }
    if (verdict.warning) {
        console.log(`::warning::Post-deploy agent smoke: task ${taskId} completed with warnings (repository checks red).`);
    }
    console.log(`OK: agent turn ${taskId} completed in ${Math.round((Date.now() - started) / 1000)}s${expectToken ? ' with the expected reply' : ''}.`);
    return 0;
}

function writeDiagnostics(dir, detail) {
    if (!dir || !detail) {
        return;
    }
    try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'agent-task.json'), JSON.stringify(detail, undefined, 2));
    } catch {
        // Diagnostics are best effort.
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main(process.argv.slice(2), process.env).then(code => {
        process.exitCode = code;
    }, error => {
        console.error(`::error::Post-deploy agent smoke failed: ${error instanceof SmokeError ? error.message : error?.stack ?? error}`);
        process.exitCode = 1;
    });
}

export { main };
