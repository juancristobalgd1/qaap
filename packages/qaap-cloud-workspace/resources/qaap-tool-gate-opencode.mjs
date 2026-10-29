// Qaap tool gate plugin for OpenCode (loaded through OPENCODE_CONFIG_CONTENT `{"plugin":["file://<this file>"]}`).
// Standalone: Node built-ins only, no repo imports.
// Every tool call is sent to the Qaap gate (QAAP_GATE_URL + QAAP_GATE_TOKEN) before it runs.
// Fail closed: anything other than a well-formed `allow` from the gate stops the call.
// Keep the semantics in step with qaap-tool-gate-pi.mjs and QaapToolGateClient (src/common/qaap-tool-gate-client.ts).

import { appendFileSync } from 'node:fs';

const TOKEN_HEADER = 'x-qaap-gate-token';
const ARM_NONCE_HEADER = 'x-qaap-gate-arm-nonce';
const TIMEOUT_MARGIN_MS = 15000;
const BACKOFF_MS = [200, 800];
const DEFAULT_ASK_TTL_SEC = 600;
/** Gate answers remembered per call id so the matching `permission.ask` does not ask the user twice. */
const MAX_REMEMBERED_CALLS = 512;

class ConnectionError extends Error { }

async function post(url, token, body, timeoutMs, fetchImpl) {
    let response;
    try {
        response = await fetchImpl(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', [TOKEN_HEADER]: token },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs),
        });
    } catch (error) {
        if (error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
            // The gate may still hold the ask: retrying would queue a second approval card.
            throw new Error('timed out waiting for the gate');
        }
        throw new ConnectionError(error instanceof Error ? error.message : String(error));
    }
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    const decision = (await response.json())?.decision;
    if (decision?.kind === 'allow') {
        return decision;
    }
    if (decision?.kind === 'deny' && typeof decision.reason === 'string') {
        return decision;
    }
    throw new Error('malformed decision');
}

/** Ask the gate about one tool call. Never throws; returns a gate decision (deny on any failure). */
export async function askGate(request, env = process.env, fetchImpl = globalThis.fetch, options = {}) {
    const retries = options.retries ?? 2;
    const marginMs = options.marginMs ?? TIMEOUT_MARGIN_MS;
    const base = env.QAAP_GATE_URL;
    const token = env.QAAP_GATE_TOKEN;
    const deny = reason => ({ kind: 'deny', source: 'gate-error', retryable: true, reason });
    if (!base || !token || typeof fetchImpl !== 'function') {
        return deny('The Qaap safety gate is not configured for this task.');
    }
    const ttlSec = Number(env.QAAP_GATE_ASK_TTL_SEC) > 0 ? Number(env.QAAP_GATE_ASK_TTL_SEC) : DEFAULT_ASK_TTL_SEC;
    const url = `${base.replace(/\/+$/, '')}/evaluate`;
    let lastError = 'unreachable';
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await post(url, token, request, ttlSec * 1000 + marginMs, fetchImpl);
        } catch (error) {
            if (!(error instanceof ConnectionError)) {
                return deny(`The Qaap safety gate returned an unusable answer (${error instanceof Error ? error.message : String(error)}).`);
            }
            lastError = error.message;
            if (attempt < retries) {
                await new Promise(resolve => setTimeout(resolve, BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]));
            }
        }
    }
    return deny(`The Qaap safety gate is unreachable (${lastError}).`);
}

/**
 * Tells the gate that this plugin is loaded (`POST <gate>/arm`). Returns true only on a 2xx answer.
 * Connection errors are retried a few times; anything else counts as "not armed".
 */
export async function armGate(env = process.env, fetchImpl = globalThis.fetch, options = {}) {
    const base = env.QAAP_GATE_URL;
    const token = env.QAAP_GATE_TOKEN;
    const nonce = options.armNonce;
    if (!base || !token || !nonce || typeof fetchImpl !== 'function') {
        return false;
    }
    const url = `${base.replace(/\/+$/, '')}/arm`;
    const retries = options.retries ?? 2;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const response = await fetchImpl(url, { method: 'POST', headers: { [TOKEN_HEADER]: token, [ARM_NONCE_HEADER]: nonce }, signal: AbortSignal.timeout(5000) });
            return response.ok;
        } catch {
            if (attempt < retries) {
                await new Promise(resolve => setTimeout(resolve, BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]));
            }
        }
    }
    return false;
}

function gateRequest(rawToolName, input, cwd, callId) {
    return {
        agentId: 'opencode',
        // The server recomputes the kind from the tool name; this is informational only.
        toolKind: 'other',
        rawToolName: String(rawToolName ?? ''),
        input: input && typeof input === 'object' ? input : {},
        cwd: String(cwd || process.cwd()),
        ...(callId ? { harnessCallId: String(callId) } : {}),
    };
}

/**
 * Builds the OpenCode hooks. Exported for tests; the default export wires them to a plugin context.
 * `tool.execute.before` throws on deny (OpenCode reports the message to the model as the tool error)
 * and mutates `output.args` in place on updatedInput. `permission.ask` answers OpenCode's own prompts
 * from the gate, so a headless run never auto-rejects an action the gate approved.
 */
export function createHooks(cwd, env = process.env, fetchImpl = globalThis.fetch, options = {}) {
    // One-time arm nonce: taken out of the environment right away so the tools OpenCode spawns never inherit it.
    const armNonce = env.QAAP_GATE_ARM_NONCE;
    delete env.QAAP_GATE_ARM_NONCE;
    const approved = new Map();
    const remember = callId => {
        if (!callId) {
            return;
        }
        if (approved.size >= MAX_REMEMBERED_CALLS) {
            approved.delete(approved.keys().next().value);
        }
        approved.set(String(callId), true);
    };
    const probeFile = env.QAAP_GATE_PROBE_FILE;
    const probe = line => appendFileSync(probeFile, `${line}\n`);
    return {
        // Fail-closed baseline: Qaap puts its `ask` rules in the inline config, and headless OpenCode
        // rejects every `ask`. Only a plugin that really reached the gate removes them, so a plugin that
        // fails to load (or an OpenCode without this hook) leaves every gated tool refused, never open.
        config: async config => {
            if (probeFile) {
                probe('config');
                return;
            }
            if (!(await armGate(env, fetchImpl, { ...options, armNonce })) || !config || typeof config.permission !== 'object' || config.permission === null) {
                return;
            }
            for (const [key, action] of Object.entries(config.permission)) {
                if (action === 'ask') {
                    delete config.permission[key];
                }
            }
        },
        'tool.execute.before': async (input, output) => {
            if (probeFile) {
                probe(`before:${String(input?.tool ?? '')}`);
                throw new Error('Qaap gate probe: tool blocked on purpose.');
            }
            let decision;
            try {
                decision = await askGate(gateRequest(input?.tool, output?.args, cwd, input?.callID), env, fetchImpl, options);
                if (decision.kind === 'allow' && decision.updatedInput && typeof decision.updatedInput === 'object') {
                    const args = output.args && typeof output.args === 'object' ? output.args : (output.args = {});
                    for (const key of Object.keys(args)) {
                        delete args[key];
                    }
                    Object.assign(args, decision.updatedInput);
                }
            } catch (error) {
                decision = { kind: 'deny', reason: `The Qaap safety gate failed (${error instanceof Error ? error.message : String(error)}).` };
            }
            if (decision.kind !== 'allow') {
                throw new Error(decision.reason);
            }
            remember(input?.callID);
        },
        'permission.ask': async (input, output) => {
            try {
                if (input?.callID && approved.delete(String(input.callID))) {
                    output.status = 'allow';
                    return;
                }
                // A prompt that does not belong to a gated tool call (e.g. a path outside the workspace).
                const decision = await askGate(gateRequest(input?.type ?? input?.permission, {
                    pattern: input?.pattern ?? input?.patterns, title: input?.title, metadata: input?.metadata,
                }, cwd, input?.callID), env, fetchImpl, options);
                output.status = decision.kind === 'allow' ? 'allow' : 'deny';
            } catch {
                output.status = 'deny';
            }
        },
    };
}

export default {
    id: 'qaap-tool-gate',
    server: async ctx => createHooks(ctx?.directory),
};

