// Qaap tool gate extension for Pi (`pi -e <this file>`). Standalone: Node built-ins only, no repo imports.
// Every tool call is sent to the Qaap gate (QAAP_GATE_URL + QAAP_GATE_TOKEN) before it runs.
// Fail closed: anything other than a well-formed `allow` from the gate blocks the call.
// Keep the semantics in step with QaapToolGateClient (src/common/qaap-tool-gate-client.ts).

const TOKEN_HEADER = 'x-qaap-gate-token';
const TIMEOUT_MARGIN_MS = 15000;
const BACKOFF_MS = [200, 800];
const DEFAULT_ASK_TTL_SEC = 600;

class ConnectionError extends Error { }

function blocked(reason) {
    return { block: true, reason };
}

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

/** The `tool_call` handler. Exported for tests; `pi` calls it through the default export. */
export async function handleToolCall(event, ctx, env = process.env, fetchImpl = globalThis.fetch, options = {}) {
    try {
        const input = event && typeof event.input === 'object' && event.input !== null ? event.input : {};
        const decision = await askGate({
            agentId: 'pi',
            // The server recomputes the kind from the tool name; this is informational only.
            toolKind: 'other',
            rawToolName: String(event?.toolName ?? ''),
            input,
            cwd: String(ctx?.cwd ?? process.cwd()),
            ...(event?.toolCallId ? { harnessCallId: String(event.toolCallId) } : {}),
        }, env, fetchImpl, options);
        if (decision.kind !== 'allow') {
            return blocked(decision.reason);
        }
        if (decision.updatedInput && typeof decision.updatedInput === 'object') {
            // Pi's documented way to change arguments: mutate event.input in place.
            for (const key of Object.keys(event.input)) {
                delete event.input[key];
            }
            Object.assign(event.input, decision.updatedInput);
        }
        return undefined;
    } catch (error) {
        return blocked(`The Qaap safety gate failed (${error instanceof Error ? error.message : String(error)}).`);
    }
}

export default function qaapToolGate(pi) {
    pi.on('tool_call', (event, ctx) => handleToolCall(event, ctx));
}
