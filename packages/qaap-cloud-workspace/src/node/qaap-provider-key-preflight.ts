// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    detectAgentFailureKind,
    formatProviderPreflightNote,
    QaapProviderKeyVerdict,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-failure-message';

export type { QaapProviderKeyVerdict };

/**
 * The only endpoint probed. A custom `OPENROUTER_BASE_URL` (user preference) is never called: the
 * probe sends the user's key, and a user-chosen URL from the backend would be an SSRF vector.
 */
const OPENROUTER_KEY_URL = 'https://openrouter.ai/api/v1/key';
/** Public model catalogue on the same fixed host; called without the key. */
const OPENROUTER_MODEL_ENDPOINTS_URL = 'https://openrouter.ai/api/v1/models';
const OPENROUTER_MODEL_ID = /^[\w.-]+\/[\w.:-]+$/;
const OPENROUTER_HOST = 'openrouter.ai';
const PREFLIGHT_TIMEOUT_MS = 4_000;
/** Enough of the log tail for the CLI's final envelope; the failure is at the end. */
const PREFLIGHT_LOG_TAIL_CHARS = 16_000;

export type QaapProviderKeyFetch = (url: string, init: {
    headers: Record<string, string>;
    signal: AbortSignal;
    redirect: 'error';
}) => Promise<{
    readonly status: number;
    json(): Promise<unknown>;
}>;

export interface QaapProviderKeyPreflightResult {
    readonly verdict: QaapProviderKeyVerdict;
    /** The runner note for the log, see `formatProviderPreflightNote`. */
    readonly note: string;
}

export interface QaapProviderKeyPreflightInput {
    /** The failed run's log tail (CLI output). */
    readonly log: string;
    /** The child environment the CLI ran with (BYOK keys are injected there). */
    readonly env: NodeJS.ProcessEnv;
    /** Model id the task ran with, e.g. `nvidia/nemotron-3-super-120b-a12b:free`. */
    readonly modelId?: string;
    /** Vendor of the task's model binding; only `openrouter` turns are probed. */
    readonly vendor?: string;
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

/**
 * The turn really went through OpenRouter (its model binding's vendor, not merely an OpenRouter key
 * in the environment: a NVIDIA-routed turn must never blame an unrelated OpenRouter key), on the
 * official endpoint, with an OpenRouter route (`author/model`).
 */
export function canProbeProviderKey(env: NodeJS.ProcessEnv, vendor: string | undefined, modelId: string | undefined): boolean {
    return vendor === 'openrouter' && !!env.OPENROUTER_API_KEY?.trim() && usesOfficialOpenRouterEndpoint(env) && !!modelId?.includes('/');
}

/**
 * True when a failed run should be explained by asking OpenRouter about the user's key: on top of
 * {@link canProbeProviderKey}, the CLI blamed the model or printed a bare auth error.
 */
export function shouldProbeProviderKey(input: Pick<QaapProviderKeyPreflightInput, 'log' | 'env' | 'modelId' | 'vendor'>): boolean {
    if (!canProbeProviderKey(input.env, input.vendor, input.modelId)) {
        return false;
    }
    const kind = detectAgentFailureKind(input.log.slice(-PREFLIGHT_LOG_TAIL_CHARS));
    return kind === 'model_unavailable' || kind === 'auth';
}

/**
 * True only when OpenRouter lists `modelId` with at least one endpoint. Without that proof a
 * refused `:free` model may be Qaap routing a bad id or a retired model, not the user's settings.
 */
async function openRouterModelHasEndpoints(modelId: string, fetchImpl: QaapProviderKeyFetch, signal: AbortSignal): Promise<boolean> {
    if (!OPENROUTER_MODEL_ID.test(modelId)) {
        return false;
    }
    const [author, slug] = modelId.split('/');
    const response = await fetchImpl(
        `${OPENROUTER_MODEL_ENDPOINTS_URL}/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/endpoints`,
        { headers: {}, signal, redirect: 'error' },
    );
    if (response.status !== 200) {
        return false;
    }
    const endpoints = (await response.json().catch(() => undefined) as { data?: { endpoints?: unknown } } | undefined)?.data?.endpoints;
    return Array.isArray(endpoints) && endpoints.length > 0;
}

function readLimitRemaining(body: unknown): number | undefined {
    const data = (body as { data?: { limit_remaining?: unknown } } | undefined)?.data;
    return typeof data?.limit_remaining === 'number' ? data.limit_remaining : undefined;
}

/**
 * Ask OpenRouter (`GET /api/v1/key`, free and side-effect-free) what it thinks of the key, and
 * return the verdict and runner note that name the real cause, or `undefined` when the key looks
 * fine for this model or the probe could not tell. Never throws; the key and bodies are not logged.
 */
export async function runProviderKeyPreflight(input: QaapProviderKeyPreflightInput): Promise<QaapProviderKeyPreflightResult | undefined> {
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
            redirect: 'error',
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
            } else if (input.modelId!.endsWith(':free') && await openRouterModelHasEndpoints(input.modelId!, fetchImpl, controller.signal)) {
                // A valid key was refused a free model that exists and is served: the account's
                // privacy settings exclude its endpoints (404 "No endpoints found matching your data policy").
                verdict = 'free_model_refused';
            }
        }
        return verdict ? { verdict, note: formatProviderPreflightNote('OpenRouter', verdict, response.status) } : undefined;
    } catch {
        return undefined;
    } finally {
        clearTimeout(timer);
    }
}
