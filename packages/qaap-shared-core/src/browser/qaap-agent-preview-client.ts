// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    QAAP_AGENT_PREVIEW_ROUTES,
    QAAP_USER_PREVIEW_API_PATH,
    QAAP_USER_PREVIEW_CONFIG_ROUTE,
    type QaapAgentPreviewLogsResult,
    type QaapAgentPreviewState,
    type QaapPreviewConfigResponse,
    type QaapPreviewLogStream,
} from '../common/qaap-agent-preview-protocol';

const DEFAULT_CONFIG: QaapPreviewConfigResponse = {
    previewService: false,
    agentPreviewTools: false,
    agentDriven: false,
};

let cachedConfig: QaapPreviewConfigResponse | undefined;
let configPromise: Promise<QaapPreviewConfigResponse> | undefined;

/**
 * Fetches `/qaap/api/preview/config` once per session and caches the result so synchronous frontend
 * gates (`isQaapAgentDrivenPreviewCached`) can read it without blocking renders.
 */
export function fetchQaapPreviewConfig(): Promise<QaapPreviewConfigResponse> {
    if (cachedConfig) {
        return Promise.resolve(cachedConfig);
    }
    if (configPromise) {
        return configPromise;
    }
    if (typeof fetch !== 'function') {
        return Promise.resolve(DEFAULT_CONFIG);
    }
    configPromise = fetch(`${QAAP_USER_PREVIEW_API_PATH}${QAAP_USER_PREVIEW_CONFIG_ROUTE}`, { credentials: 'include' })
        .then(async response => {
            if (!response.ok) {
                return DEFAULT_CONFIG;
            }
            const parsed = await response.json() as Partial<QaapPreviewConfigResponse>;
            cachedConfig = {
                previewService: parsed.previewService === true,
                agentPreviewTools: parsed.agentPreviewTools === true,
                agentDriven: parsed.agentDriven === true,
            };
            return cachedConfig;
        })
        .catch(() => DEFAULT_CONFIG)
        .finally(() => {
            configPromise = undefined;
        });
    return configPromise;
}

/** Synchronous snapshot of `QAAP_PREVIEW_AGENT_DRIVEN`: false until fetched (fail-safe rollback default). */
export function isQaapAgentDrivenPreviewCached(): boolean {
    return cachedConfig?.agentDriven === true;
}

/** Synchronous snapshot of whether the backend user preview service is enabled. */
export function isQaapPreviewServiceCached(): boolean {
    return cachedConfig?.previewService === true;
}

/** Test seam: pin or reset the cached preview config. */
export function setQaapPreviewConfigForTests(config: Partial<QaapPreviewConfigResponse> | undefined): void {
    configPromise = undefined;
    cachedConfig = config
        ? {
            previewService: config.previewService === true,
            agentPreviewTools: config.agentPreviewTools === true,
            agentDriven: config.agentDriven === true,
        }
        : undefined;
}

async function postUserPreview<T>(route: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${QAAP_USER_PREVIEW_API_PATH}${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
    });
    const text = await response.text();
    let payload: unknown;
    try {
        payload = text ? JSON.parse(text) : undefined;
    } catch {
        payload = undefined;
    }
    if (!response.ok) {
        const message = payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string'
            ? (payload as { error: string }).error
            : `Preview request failed (HTTP ${response.status}).`;
        throw new Error(message);
    }
    return payload as T;
}

/** Starts (or reuses) a supervised preview through `POST /qaap/api/preview/start` (Phase 3 Run button). */
export function startQaapUserPreview(
    cwd: string,
    options: {
        readonly conversationId?: string;
        readonly script?: string;
        readonly restart?: boolean;
        readonly timeoutSec?: number;
    } = {},
): Promise<QaapAgentPreviewState> {
    return postUserPreview<QaapAgentPreviewState>(QAAP_AGENT_PREVIEW_ROUTES.start, {
        cwd,
        ...(options.conversationId ? { conversationId: options.conversationId } : {}),
        ...(options.script ? { script: options.script } : {}),
        ...(options.restart ? { restart: true } : {}),
        ...(options.timeoutSec !== undefined ? { timeoutSec: options.timeoutSec } : {}),
    });
}

/** Stops a supervised preview through `POST /qaap/api/preview/stop`. */
export function stopQaapUserPreview(cwd: string, conversationId?: string): Promise<QaapAgentPreviewState> {
    return postUserPreview<QaapAgentPreviewState>(QAAP_AGENT_PREVIEW_ROUTES.stop, {
        cwd,
        ...(conversationId ? { conversationId } : {}),
    });
}

/** Reads supervised preview status through `POST /qaap/api/preview/status`. */
export function fetchQaapUserPreviewStatus(cwd: string, conversationId?: string): Promise<QaapAgentPreviewState> {
    return postUserPreview<QaapAgentPreviewState>(QAAP_AGENT_PREVIEW_ROUTES.status, {
        cwd,
        ...(conversationId ? { conversationId } : {}),
    });
}

/** Reads supervised preview logs through `POST /qaap/api/preview/logs`. */
export function fetchQaapUserPreviewLogs(
    cwd: string,
    options: {
        readonly conversationId?: string;
        readonly lines?: number;
        readonly stream?: QaapPreviewLogStream;
    } = {},
): Promise<QaapAgentPreviewLogsResult> {
    return postUserPreview<QaapAgentPreviewLogsResult>(QAAP_AGENT_PREVIEW_ROUTES.logs, {
        cwd,
        ...(options.conversationId ? { conversationId: options.conversationId } : {}),
        ...(options.lines !== undefined ? { lines: options.lines } : {}),
        ...(options.stream ? { stream: options.stream } : {}),
    });
}
