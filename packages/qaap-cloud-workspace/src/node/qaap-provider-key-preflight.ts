// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    detectAgentFailureKind,
    formatProviderPreflightNote,
    QaapProviderKeyVerdict,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-failure-message';

/**
 * The only endpoint probed. A custom `OPENROUTER_BASE_URL` (user preference) is never called: the
 * probe sends the user's key, and a user-chosen URL from the backend would be an SSRF vector.
 */
const OPENROUTER_KEY_URL = 'https://openrouter.ai/api/v1/key';
const OPENROUTER_HOST = 'openrouter.ai';
const PREFLIGHT_TIMEOUT_MS = 4_000;
/** Enough of the log tail for the CLI's final envelope; the failure is at the end. */
const PREFLIGHT_LOG_TAIL_CHARS = 16_000;

export type QaapProviderKeyFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{
    readonly status: number;
    json(): Promise<unknown>;
}>;

export interface QaapProviderKeyPreflightInput {
    /** The failed run's log tail (CLI output). */
    readonly log: string;
    /** The child environment the CLI ran with (BYOK keys are injected there). */
    readonly env: NodeJS.ProcessEnv;
    /** Model id the task ran with, e.g. `nvidia/nemotron-3-super-120b-a12b:free`. */
    readonly modelId?: string;
    readonly fetchImpl?: QaapProviderKeyFetch;
    readonly timeoutMs?: number;
}

function usesOfficialOpenRouterEndpoint(env: NodeJS.ProcessEnv): boolean {
    const baseUrl = env.OPENROUTER_BASE_URL?.trim();
    if (!baseUrl) {
        return true;
    }
    try {
        const url = new URL(baseUrl);
        return url.protocol === 'https:' && url.hostname === OPENROUTER_HOST;
    } catch {
        return false;
    }
}

/** The run had an OpenRouter BYOK key on the official endpoint and an OpenRouter route (`vendor/model`). */
export function canProbeProviderKey(env: NodeJS.ProcessEnv, modelId: string | undefined): boolean {
    return !!env.OPENROUTER_API_KEY?.trim() && usesOfficialOpenRouterEndpoint(env) && !!modelId?.includes('/');
}

/**
 * True when a failed run should be explained by asking OpenRouter about the user's key: on top of
 * {@link canProbeProviderKey}, the CLI blamed the model or printed a bare auth error.
 */
export function shouldProbeProviderKey(input: Pick<QaapProviderKeyPreflightInput, 'log' | 'env' | 'modelId'>): boolean {
    if (!canProbeProviderKey(input.env, input.modelId)) {
        return false;
    }
    const kind = detectAgentFailureKind(input.log.slice(-PREFLIGHT_LOG_TAIL_CHARS));
    return kind === 'model_unavailable' || kind === 'auth';
}

function readLimitRemaining(body: unknown): number | undefined {
    const data = (body as { data?: { limit_remaining?: unknown } } | undefined)?.data;
    return typeof data?.limit_remaining === 'number' ? data.limit_remaining : undefined;
}

/**
 * Ask OpenRouter (`GET /api/v1/key`, free and side-effect-free) what it thinks of the key, and
 * return the runner note that names the real cause, or `undefined` when the key looks fine for
 * this model or the probe could not tell. Never throws; the key and response body are not logged.
 */
export async function runProviderKeyPreflight(input: QaapProviderKeyPreflightInput): Promise<string | undefined> {
    if (!shouldProbeProviderKey(input)) {
        return undefined;
    }
    const fetchImpl: QaapProviderKeyFetch = input.fetchImpl ?? (globalThis.fetch as unknown as QaapProviderKeyFetch);
    if (!fetchImpl) {
        return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? PREFLIGHT_TIMEOUT_MS);
    try {
        const response = await fetchImpl(OPENROUTER_KEY_URL, {
            headers: { Authorization: `Bearer ${input.env.OPENROUTER_API_KEY!.trim()}` },
            signal: controller.signal,
        });
        let verdict: QaapProviderKeyVerdict | undefined;
        if (response.status === 401 || response.status === 403) {
            verdict = 'key_rejected';
        } else if (response.status === 402) {
            verdict = 'no_credits';
        } else if (response.status === 200) {
            const remaining = readLimitRemaining(await response.json().catch(() => undefined));
            if (remaining !== undefined && remaining <= 0) {
                verdict = 'no_credits';
            } else if (input.modelId!.endsWith(':free')) {
                // A valid key refused a free route: OpenRouter's privacy settings exclude every
                // endpoint of that model (404 "No endpoints found matching your data policy").
                verdict = 'free_model_refused';
            }
        }
        return verdict ? formatProviderPreflightNote('OpenRouter', verdict, response.status) : undefined;
    } catch {
        return undefined;
    } finally {
        clearTimeout(timer);
    }
}
