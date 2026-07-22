// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { qaapAuthenticatedFetchInit } from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';
import { Disposable } from '@theia/core/lib/common/disposable';
import {
    QAAP_JOB_LOOP_API_PATH,
    QaapJobLoop,
    QaapJobLoopEvent,
    QaapJobLoopEventType,
    QaapJobLoopListResponse,
    QaapJobLoopMetrics,
    QaapJobLoopRoundDetail,
    QaapJobLoopStreamSnapshot,
    QaapCreateJobLoopRequest,
    QaapCreateJobLoopResult,
} from '../common/qaap-job-loop';
import { QaapJobFunctionDescriptor, QaapJobFunctionListResponse, QAAP_JOB_API_PATH } from '../common/qaap-job';

export async function fetchQaapJobFunctions(): Promise<QaapJobFunctionDescriptor[]> {
    const response = await fetch(`${QAAP_JOB_API_PATH}/functions`, qaapAuthenticatedFetchInit());
    if (!response.ok) {
        throw new Error(`Failed to load job functions (${response.status}).`);
    }
    const body = await response.json() as Partial<QaapJobFunctionListResponse>;
    return Array.isArray(body.functions) ? [...body.functions] : [];
}

export async function createQaapJobLoop(request: QaapCreateJobLoopRequest): Promise<QaapCreateJobLoopResult> {
    const response = await fetch(QAAP_JOB_LOOP_API_PATH, qaapAuthenticatedFetchInit({
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': request.idempotencyKey ?? '' },
        body: JSON.stringify(request),
    }));
    if (!response.ok) {
        const body = await response.json().catch(() => undefined) as { error?: unknown } | undefined;
        throw new Error(typeof body?.error === 'string' ? body.error : `Failed to create job loop (${response.status}).`);
    }
    return response.json() as Promise<QaapCreateJobLoopResult>;
}

export async function fetchQaapJobLoops(): Promise<QaapJobLoop[]> {
    const response = await fetch(QAAP_JOB_LOOP_API_PATH, qaapAuthenticatedFetchInit());
    if (!response.ok) {
        throw new Error(`Failed to load job loops (${response.status}).`);
    }
    const body = await response.json() as Partial<QaapJobLoopListResponse>;
    return Array.isArray(body.loops) ? [...body.loops] : [];
}

export async function fetchQaapJobLoopMetrics(): Promise<QaapJobLoopMetrics> {
    const response = await fetch(`${QAAP_JOB_LOOP_API_PATH}/metrics`, qaapAuthenticatedFetchInit());
    if (!response.ok) {
        throw new Error(`Failed to load job loop metrics (${response.status}).`);
    }
    return response.json() as Promise<QaapJobLoopMetrics>;
}

export async function fetchQaapJobLoopRound(loopId: string, iteration: number): Promise<QaapJobLoopRoundDetail | undefined> {
    const response = await fetch(
        `${QAAP_JOB_LOOP_API_PATH}/${encodeURIComponent(loopId)}/rounds/${iteration}`,
        qaapAuthenticatedFetchInit(),
    );
    return response.ok ? response.json() as Promise<QaapJobLoopRoundDetail> : undefined;
}

export async function cancelQaapJobLoop(loopId: string): Promise<QaapJobLoop | undefined> {
    const response = await fetch(
        `${QAAP_JOB_LOOP_API_PATH}/${encodeURIComponent(loopId)}/cancel`,
        qaapAuthenticatedFetchInit({ method: 'POST' }),
    );
    return response.ok ? response.json() as Promise<QaapJobLoop> : undefined;
}

export type QaapJobLoopClientEvent =
    | { readonly type: 'snapshot'; readonly payload: QaapJobLoopStreamSnapshot }
    | { readonly type: QaapJobLoopEventType; readonly payload: QaapJobLoopEvent };

/** One same-origin SSE connection, disposed with its owning widget. */
export function connectQaapJobLoopEvents(listener: (event: QaapJobLoopClientEvent) => void): Disposable {
    const source = new EventSource(`${QAAP_JOB_LOOP_API_PATH}/events`, { withCredentials: true });
    const eventTypes: Array<'snapshot' | QaapJobLoopEventType> = [
        'snapshot',
        'created',
        'changed',
        'round_started',
        'round_finished',
    ];
    const handlers = eventTypes.map(type => {
        const handler = (event: Event): void => {
            try {
                listener({ type, payload: JSON.parse((event as MessageEvent<string>).data) } as QaapJobLoopClientEvent);
            } catch {
                /* malformed frames are ignored; EventSource will continue with the next event */
            }
        };
        source.addEventListener(type, handler);
        return { type, handler };
    });
    return Disposable.create(() => {
        for (const { type, handler } of handlers) {
            source.removeEventListener(type, handler);
        }
        source.close();
    });
}
