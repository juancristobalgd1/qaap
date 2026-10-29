// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    QAAP_TOOL_GATE_TOKEN_HEADER,
    type QaapToolGateDecision,
    type QaapToolGateRequest,
} from '@theia/qaap-shared-core/lib/common/qaap-tool-gate-protocol';

export interface QaapToolGateClientOptions {
    /** Gate base URL (`QAAP_GATE_URL`), e.g. `http://127.0.0.1:3000/qaap/api/tool-gate`. */
    readonly url: string | undefined;
    /** Per-task gate token (`QAAP_GATE_TOKEN`). */
    readonly token: string | undefined;
    /** Longest an ask may block, in seconds; the HTTP timeout is this plus a margin. */
    readonly askTtlSec: number;
    /** Extra connection attempts after the first, on connection errors only. Default 2. */
    readonly retries?: number;
    readonly fetchImpl?: typeof fetch;
}

const TIMEOUT_MARGIN_MS = 15_000;
const BACKOFF_MS = [200, 800];

/**
 * Client harness adapters use to reach the tool gate. It fails closed: anything other than a
 * well-formed decision from the gate (unreachable, timeout, 4xx/5xx, bad JSON, missing config) is a
 * `deny`, never an implicit allow. Only connection errors are retried.
 */
export class QaapToolGateClient {

    constructor(protected readonly options: QaapToolGateClientOptions) { }

    async evaluate(request: QaapToolGateRequest): Promise<QaapToolGateDecision> {
        const { url, token } = this.options;
        if (!url || !token) {
            return this.deny('The Qaap safety gate is not configured for this task.');
        }
        const attempts = 1 + Math.max(0, this.options.retries ?? 2);
        let lastError = 'unreachable';
        for (let attempt = 0; attempt < attempts; attempt++) {
            try {
                return await this.post(`${url.replace(/\/+$/, '')}/evaluate`, token, request);
            } catch (error) {
                if (!(error instanceof QaapToolGateConnectionError)) {
                    return this.deny(`The Qaap safety gate returned an unusable answer (${error instanceof Error ? error.message : String(error)}).`);
                }
                lastError = error.message;
                if (attempt + 1 < attempts) {
                    await new Promise(resolve => setTimeout(resolve, BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]));
                }
            }
        }
        return this.deny(`The Qaap safety gate is unreachable (${lastError}).`);
    }

    protected async post(url: string, token: string, request: QaapToolGateRequest): Promise<QaapToolGateDecision> {
        const doFetch = this.options.fetchImpl ?? fetch;
        let response: Response;
        try {
            response = await doFetch(url, {
                method: 'POST',
                headers: { 'content-type': 'application/json', [QAAP_TOOL_GATE_TOKEN_HEADER]: token },
                body: JSON.stringify(request),
                signal: AbortSignal.timeout(this.options.askTtlSec * 1000 + TIMEOUT_MARGIN_MS),
            });
        } catch (error) {
            if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
                // The gate may still be holding the ask: retrying would queue a second card.
                throw new Error('timed out waiting for the gate');
            }
            throw new QaapToolGateConnectionError(error instanceof Error ? error.message : String(error));
        }
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const body = await response.json() as { decision?: QaapToolGateDecision };
        const decision = body?.decision;
        if (decision?.kind === 'allow') {
            return decision;
        }
        if (decision?.kind === 'deny' && typeof decision.reason === 'string') {
            return decision;
        }
        throw new Error('malformed decision');
    }

    protected deny(reason: string): QaapToolGateDecision {
        return { kind: 'deny', source: 'gate-error', retryable: true, reason };
    }
}

class QaapToolGateConnectionError extends Error { }
