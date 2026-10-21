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
// Provider keys are BYOK: the turn runs on the smoke user's own provider key. When the runner's
// provider preflight proves the provider rejected that key or it has no credits (`[qaap] provider
// check: … key_rejected|no_credits`), the result is inconclusive: a `::warning::` and exit 0, because
// the account is broken, not the release. Everything else still fails, raw provider 401/429 lines
// included (they may be Qaap no longer injecting the key, or a retried hiccup before a real failure). To decouple the smoke from a person's key, point
// QAAP_SMOKE_SESSION at a dedicated smoke account with its own provider key (and QAAP_SMOKE_AGENT).
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
// Exit codes: 0 pass (or inconclusive: provider rejected the smoke user's credentials), 1 failure,
// 2 usage error.
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

/**
 * Agent for the smoke turn: the requested one, else the user's default when it is signed in, else the
 * first available signed-in agent. A default whose CLI is signed out (Oct 16 2026: Codex answering
 * 401 on every request) is an account state, not a release regression, so it is skipped with a note.
 */
export function pickSmokeAgent(list, requested) {
    if (requested) {
        return { agent: requested };
    }
    const usable = (Array.isArray(list?.agents) ? list.agents : []).filter(agent => agent?.available !== false
        && (agent?.connectionState === 'connected' || agent?.connectionState === 'not-required'));
    const preferred = usable.find(agent => agent.id === list?.defaultAgent) ?? usable[0];
    if (!preferred) {
        return { agent: undefined };
    }
    const note = list?.defaultAgent && preferred.id !== list.defaultAgent
        ? `default agent ${list.defaultAgent} is not signed in; using ${preferred.id}`
        : undefined;
    return { agent: preferred.id, note };
}

/**
 * The runner's own provider preflight note (qaap-cloud-workspace `qaap-provider-key-preflight.ts`,
 * written by `formatProviderPreflightNote` in qaap-shared-core). It is the only proof that the BYOK
 * key reached the agent AND the provider itself refused it. Raw provider lines are not enough: a
 * "No auth credentials found" also means Qaap stopped injecting the key, a 429 may have been retried
 * before a real failure, and a `status 403` may come from a tool. `free_model_refused` is not proof
 * of an account problem either, so only these two verdicts make the smoke inconclusive.
 */
const PROVIDER_CREDENTIAL_NOTE = /^\[qaap\] provider check: [\w .-]+? (?:key_rejected|no_credits)\b.*$/m;

/** Never echo a secret into the job log, even a masked one. */
function redactSecrets(text) {
    return text
        .replace(/\b(?:sk|pk|rk)-[\w-]{4,}/g, '<redacted>')
        .replace(/\b(?:hf_|nvapi-|gsk_|xai-)[\w-]{4,}/g, '<redacted>')
        .replace(/\bAIza[\w-]{8,}/g, '<redacted>')
        .replace(/\bBearer\s+\S+/gi, 'Bearer <redacted>')
        .replace(/\b(?:ghp|gho|ghu|ghs|github_pat)_[\w]{8,}/g, '<redacted>')
        .replace(/\b(token|api[_-]?key)(\s*[:=]\s*)[\w.~+/=-]{12,}/gi, '$1$2<redacted>');
}

/**
 * The runner's preflight note on a failed task proving the model provider refused the smoke user's
 * key, or `undefined` when the failure is Qaap's own (spawn, runner, timeout, crash, missing key).
 */
export function findProviderCredentialRejection(detail) {
    const log = typeof detail?.log === 'string' ? detail.log : '';
    const note = PROVIDER_CREDENTIAL_NOTE.exec(log)?.[0];
    if (!note) {
        return undefined;
    }
    const trimmed = redactSecrets(note.trim());
    return trimmed.length > 200 ? `${trimmed.slice(0, 199)}…` : trimmed;
}

export { redactSecrets };

const FAILURE_REASON_MAX_CHARS = 400;

function errorText(value) {
    if (typeof value === 'string') {
        return value;
    }
    if (value && typeof value === 'object') {
        return errorText(value.message) || errorText(value.error) || errorText(value.data);
    }
    return '';
}

/**
 * Why a task failed, from its stored log, for the deploy log: the CLI's final `is_error` result,
 * else its last error record, else the last plain line (e.g. the runner's own refusal "Add your
 * OpenRouter API key in Settings → BYOK to use QAIQ, …"). Redacted and truncated; undefined
 * when the log is empty. Provider keys are BYOK: the smoke account needs its own key in its Settings.
 */
export function describeTaskFailure(detail) {
    const log = typeof detail?.log === 'string' ? detail.log : '';
    let result;
    let errorRecord;
    let plain;
    for (const raw of log.split('\n')) {
        const line = raw.trim();
        if (!line) {
            continue;
        }
        if (line.startsWith('{')) {
            try {
                const record = JSON.parse(line);
                if (record?.type === 'result' && record.is_error) {
                    result = errorText(record.result) || errorText(record.error)
                        || (Array.isArray(record.errors) ? record.errors.map(errorText).join('; ') : '');
                } else if (record?.type === 'error' || (record?.type === undefined && record?.error)) {
                    errorRecord = errorText(record.error) || errorText(record.message) || errorRecord;
                }
                continue;
            } catch {
                // Not JSON: a plain line.
            }
        }
        plain = line;
    }
    const reason = (result || errorRecord || plain || '').replace(/\s+/g, ' ').trim();
    if (!reason) {
        return undefined;
    }
    const safe = redactSecrets(reason);
    return safe.length > FAILURE_REASON_MAX_CHARS ? `${safe.slice(0, FAILURE_REASON_MAX_CHARS - 1)}…` : safe;
}

/**
 * The model that ran the task, `vendor/modelId`: the runner's resolved pick on the task, else the
 * model the agent CLI reported in its `system`/`init` record. `undefined` when neither is known.
 */
export function taskModel(detail) {
    const model = detail?.agentModel ?? detail?.qaiqModel;
    const modelId = typeof model?.modelId === 'string' ? model.modelId.trim() : '';
    if (modelId) {
        const vendor = typeof model.vendor === 'string' && model.vendor.trim() ? `${model.vendor.trim()}/` : '';
        return redactSecrets(`${vendor}${modelId}`);
    }
    const log = typeof detail?.log === 'string' ? detail.log : '';
    for (const line of log.split('\n')) {
        if (!line.trimStart().startsWith('{')) {
            continue;
        }
        try {
            const record = JSON.parse(line);
            if (record?.type === 'system' && typeof record.model === 'string' && record.model.trim()) {
                return redactSecrets(record.model.trim());
            }
        } catch {
            // Not a JSON record.
        }
    }
    return undefined;
}

/**
 * Provider wording for "this model has no live endpoint / no longer exists": OpenRouter's
 * "No endpoints found for <model>", Nvidia's "Function '…': Not found for account" (Oct 21 2026: the
 * default `nvidia/nemotron-3-super-120b-a12b:free` died this way), "is not a valid model ID". The QAIQ
 * CLI's own "issue with the selected model" is NOT here: it also covers a rejected key.
 */
const MODEL_UNAVAILABLE = /No endpoints found for|Not found for account|is not a valid model ID/i;

/**
 * Whether a failed task died because its model is unavailable on the provider. Standalone tasks
 * (`POST /agent-tasks`, what this smoke creates) get no fallback-model retry — only conversation
 * turns do — so a dead default model fails the smoke here with a pointer to the fix.
 */
export function isModelUnavailableFailure(detail) {
    return detail?.state === 'failed' && typeof detail.log === 'string' && MODEL_UNAVAILABLE.test(detail.log);
}

/**
 * Pass/fail verdict for a finished task detail. A `failed` turn whose provider refused the smoke
 * user's key is `inconclusive`: the release ran the turn, the account's credentials stopped it.
 */
// `completed_with_warnings` = the turn finished but the repository's own checks were red: that is the
// project's state, not the release's, so it passes with a warning.
export function judgeTask(detail, token) {
    const state = detail?.state;
    if (state !== 'completed' && state !== 'completed_with_warnings') {
        const rejection = state === 'failed' ? findProviderCredentialRejection(detail) : undefined;
        if (rejection) {
            return { ok: false, inconclusive: true, reason: `the model provider rejected the smoke user's credentials: ${rejection}` };
        }
        const model = taskModel(detail);
        const reason = `task ended in state ${state ?? '<missing>'}${model ? ` on ${model}` : ''} (exit ${detail?.exitCode ?? '-'})`;
        const why = describeTaskFailure(detail);
        if (isModelUnavailableFailure(detail)) {
            return {
                ok: false,
                reason: `${reason}: the model has no live endpoint on its provider. Replace the default (OPENROUTER_DEFAULT_FREE_MODELS) `
                    + 'or the smoke user\'s model pick; `node scripts/qaap-openrouter-free-model-health.mjs` lists live free models'
                    + `${why ? `. Provider said: ${why}` : ''}`,
            };
        }
        return { ok: false, reason: `${reason}${why ? `: ${why}` : ''}` };
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

    // Right after a deploy the backend's connection probes are cold and every agent reads `unknown`:
    // `?refresh=1` waits for the probes, and a couple of retries cover a slow cold boot.
    let list;
    let picked = { agent: undefined };
    const attempts = Number(env.QAAP_SMOKE_AGENT_LIST_ATTEMPTS ?? 3);
    for (let attempt = 1; attempt <= attempts && !picked.agent; attempt++) {
        if (attempt > 1) {
            await new Promise(resolve => setTimeout(resolve, Number(env.QAAP_SMOKE_AGENT_LIST_RETRY_MS ?? 10_000)));
        }
        list = expectOk(await request('GET', `${TASKS_PATH}?refresh=1`), 'GET agent-tasks');
        if (!list.agentConfigured) {
            throw new SmokeError('no coding agent is configured for the smoke user (agentConfigured=false)');
        }
        picked = pickSmokeAgent(list, env.QAAP_SMOKE_AGENT || undefined);
    }
    const { agent, note } = picked;
    if (!agent) {
        // The smoke account has no signed-in agent: its configuration, not this release. Report the
        // states so the account can be fixed, and do not fail the deploy over it.
        const states = (list.agents ?? []).map(entry => `${entry.id}:${entry.connectionState ?? 'unknown'}`).join(', ');
        console.log(`::warning::Post-deploy agent smoke skipped: none of the smoke user's agents is signed in (${states || 'no agents'}). Sign one in for the smoke account or set vars.QAAP_SMOKE_AGENT.`);
        return 0;
    }
    if (note) {
        console.log(`::warning::Post-deploy agent smoke: ${note}.`);
    }
    console.log(`OK: agent configured (default ${list.defaultAgent ?? '<none>'}, smoke uses ${agent}).`);

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
    if (verdict.inconclusive) {
        writeDiagnostics(artifactDir, detail);
        console.log(`::warning::Post-deploy agent smoke inconclusive: task ${taskId} failed because ${verdict.reason}. `
            + 'Update the smoke account\'s provider key in Settings → BYOK, or use a dedicated smoke account (QAAP_SMOKE_SESSION, QAAP_SMOKE_AGENT).');
        return 0;
    }
    if (!verdict.ok) {
        writeDiagnostics(artifactDir, detail);
        throw new SmokeError(verdict.reason);
    }
    if (verdict.warning) {
        console.log(`::warning::Post-deploy agent smoke: task ${taskId} completed with warnings (repository checks red).`);
    }
    const model = taskModel(detail);
    console.log(`OK: agent turn ${taskId} completed in ${Math.round((Date.now() - started) / 1000)}s${expectToken ? ' with the expected reply' : ''}`
        + `${model ? `; answered by ${model}` : ''}.`);
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
