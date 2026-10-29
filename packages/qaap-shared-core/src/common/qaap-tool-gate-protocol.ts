// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Normalized kind of a tool call made by a coding-agent harness. Harness adapters map their own
 * tool names onto this set so the tool gate and the capability registry can reason about them.
 */
export type QaapToolKind = 'shell' | 'edit' | 'write' | 'read' | 'web' | 'mcp' | 'other';

/** One tool call a harness adapter asks the Qaap tool gate about. */
export interface QaapToolGateRequest {
    /** Ignored when sent over HTTP: the server derives the task from the gate token. */
    taskId?: string;
    agentId: string;
    toolKind: QaapToolKind;
    /** The harness's own tool name, e.g. `Bash`, `bash`, `apply_patch`. */
    rawToolName: string;
    input: Record<string, unknown>;
    cwd: string;
    /** Harness call id, used to dedupe retries while one request is pending. */
    harnessCallId?: string;
}

export type QaapToolGateSource =
    'read-only' | 'destructive-guard' | 'dev-server-guard' | 'hook' | 'policy' | 'user' | 'ttl' | 'gate-error';

export type QaapToolGateDecision =
    | { kind: 'allow'; updatedInput?: Record<string, unknown>; source: QaapToolGateSource }
    | { kind: 'deny'; reason: string; source: QaapToolGateSource; retryable?: boolean };

/** Route prefix of the harness-facing gate; served next to the `qaap-task` helper route. */
export const QAAP_TOOL_GATE_API_PATH = '/qaap/api/tool-gate';
/** The only credential the gate accepts. It authenticates no other route. */
export const QAAP_TOOL_GATE_TOKEN_HEADER = 'x-qaap-gate-token';

/** Header carrying the one-time nonce that `/arm` requires (held only by a harness plugin, never by its tools). */
export const QAAP_TOOL_GATE_ARM_NONCE_HEADER = 'x-qaap-gate-arm-nonce';
/** Longest a single ask may wait for a human before it is denied. */
export const QAAP_TOOL_GATE_MAX_ASK_TTL_SEC = 600;
