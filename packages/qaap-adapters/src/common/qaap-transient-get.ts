// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { resolveQaapRetryBackoffDelayMs } from './qaap-retry-backoff';

/** Bounded retry budget for idempotent API reads while a tenant backend is starting or recovering. */
export const QAAP_TRANSIENT_GET_MAX_RETRIES = 4;

export interface QaapTransientGetRetryOptions {
    readonly maxRetries?: number;
    readonly onRetry?: () => void;
    readonly wait?: (delayMs: number) => Promise<void>;
    readonly random?: () => number;
}

/**
 * Retry only idempotent GET requests that receive a transient gateway response or lose their
 * connection. The caller owns its overall timeout and response-body parsing; mutations are never
 * retried here.
 */
export async function fetchQaapGetWithTransientRetry(
    input: RequestInfo | URL,
    init: RequestInit = {},
    options: QaapTransientGetRetryOptions = {},
): Promise<Response> {
    if ((init.method ?? 'GET').toUpperCase() !== 'GET') {
        return fetch(input, init);
    }

    const maxRetries = Math.max(0, options.maxRetries ?? QAAP_TRANSIENT_GET_MAX_RETRIES);
    const wait = options.wait ?? (delayMs => waitForRetryDelay(delayMs, init.signal ?? undefined));
    for (let attempt = 0; ; attempt++) {
        let response: Response;
        try {
            response = await fetch(input, init);
        } catch (error) {
            if (init.signal?.aborted || isAbortError(error) || attempt >= maxRetries) {
                throw error;
            }
            options.onRetry?.();
            await wait(resolveQaapRetryBackoffDelayMs(attempt, { random: options.random }));
            continue;
        }
        const transientGatewayError = response.status === 502 || response.status === 503 || response.status === 504;
        if (!transientGatewayError || attempt >= maxRetries) {
            return response;
        }
        options.onRetry?.();
        await response.body?.cancel().catch(() => undefined);
        await wait(resolveQaapRetryBackoffDelayMs(attempt, { random: options.random }));
    }
}

function isAbortError(error: unknown): boolean {
    return typeof error === 'object' && error !== undefined && error !== null
        && (error as { readonly name?: unknown }).name === 'AbortError';
}

function waitForRetryDelay(delayMs: number, signal: AbortSignal | undefined): Promise<void> {
    if (!signal) {
        return new Promise(resolve => setTimeout(resolve, delayMs));
    }
    if (signal.aborted) {
        return Promise.reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
    }
    return new Promise((resolve, reject) => {
        const finish = (): void => {
            signal.removeEventListener('abort', abort);
            resolve();
        };
        const timer = setTimeout(finish, delayMs);
        const abort = (): void => {
            clearTimeout(timer);
            signal.removeEventListener('abort', abort);
            reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
        };
        signal.addEventListener('abort', abort, { once: true });
    });
}
