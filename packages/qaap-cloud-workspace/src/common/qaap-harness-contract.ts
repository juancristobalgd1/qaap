// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapHarnessEnforcement, QaapHarnessResumeSupport, QaapHarnessTransportKind } from '@theia/qaap-shared-core/lib/common/qaap-harness-capabilities';
import type { QaapToolKind } from '@theia/qaap-shared-core/lib/common/qaap-tool-gate-protocol';

/**
 * Data types of the unified harness contract (`docs/qaap-unified-harness-acp-design.md`, section 2).
 *
 * They are plain data (no behaviour) so the browser can read them as well. The behavioural contract,
 * `QaapHarnessAdapter`, lives in `node/harness/qaap-harness-adapter.ts`. In F0 only the spawn descriptor and the
 * capability shapes are produced; the turn outcome, events and permission request are declared for F1 (ACP) and
 * are not consumed by the runner yet, which still decides the end of a turn by exit code.
 */

/** What the user asked of the harness regarding writes: ask on each one, work unattended, or never write. */
export type QaapHarnessApprovalMode = 'ask' | 'auto' | 'readonly';

/**
 * How a harness process is started, as argv: never a shell string, never a secret in `args`. Credentials travel in
 * `env` or in 0600 files referenced from it. F0 native adapters still launch through the template command line;
 * the descriptor is the shape ACP flavors return in F1 and what `spawnArgvPrepared` / `wrapArgvForTenant` accept.
 */
export interface QaapHarnessSpawnDescriptor {
    readonly file: string;
    readonly args: readonly string[];
    readonly env: Readonly<Record<string, string>>;
}

/** Why a turn ended. The runner derives it from the exit code for one-shot native harnesses. */
export type QaapHarnessStopReason = 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled' | 'error';

export type QaapHarnessErrorCode =
    | 'auth_required' | 'not_installed' | 'version_unsupported' | 'protocol' | 'spawn'
    | 'rate_limited' | 'model_unavailable' | 'cancelled' | 'internal';

export interface QaapHarnessError {
    readonly code: QaapHarnessErrorCode;
    readonly retryable: boolean;
    readonly detail: string;
}

export interface QaapTurnUsage {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cacheReadTokens?: number;
    readonly cacheWriteTokens?: number;
    readonly reasoningTokens?: number;
    readonly costUsd?: number;
    readonly costSource: 'reported' | 'price-table' | 'estimate' | 'none';
    readonly model?: string;
}

/** Definitive result of one turn. */
export interface QaapHarnessTurnOutcome {
    readonly stopReason: QaapHarnessStopReason;
    /** One-shot native harnesses only. */
    readonly exitCode?: number;
    readonly error?: QaapHarnessError;
    readonly usage?: QaapTurnUsage;
}

/** Why a turn is being cancelled. */
export type QaapHarnessCancelReason = 'user' | 'timeout' | 'superseded' | 'shutdown' | 'policy';

/** Tool operation the gate guards need beyond {@link QaapToolKind}: the kind itself is not widened (decision D8). */
export type QaapHarnessToolOperation = 'delete' | 'move' | 'switch_mode' | 'think';

/** Claude-like tool input the gate guards and the UI understand, whichever harness produced it. */
export interface QaapCanonicalToolInput {
    readonly command?: string;
    readonly cwd?: string;
    readonly file_path?: string;
    readonly destination?: string;
    readonly old_string?: string;
    readonly new_string?: string;
    readonly content?: string;
    readonly pattern?: string;
    readonly url?: string;
}

export interface QaapNormalizedToolCall {
    readonly callId: string;
    readonly status: 'pending' | 'in_progress' | 'completed' | 'failed';
    readonly toolKind: QaapToolKind;
    readonly operation?: QaapHarnessToolOperation;
    /** ACP: title or kind. Native: Bash, Edit, and so on. */
    readonly rawToolName: string;
    readonly canonicalInput: QaapCanonicalToolInput;
    /** Absolute paths, already resolved with realpath. */
    readonly locations: readonly string[];
    readonly output?: { readonly text?: string; readonly diff?: string };
}

export type QaapHarnessWarningCode = 'unpermitted-mutation' | 'mode-rejected' | 'mode-escalated' | 'unknown-update';

export interface QaapHarnessAuthMethod {
    readonly id: string;
    readonly label: string;
}

/** What a harness reports while a turn runs. Only the event sink knows how to turn these into AG-UI events. */
export type QaapHarnessEvent =
    | { readonly type: 'message.delta'; readonly messageId: string; readonly text: string }
    | { readonly type: 'thought.delta'; readonly messageId: string; readonly text: string }
    | { readonly type: 'tool.started' | 'tool.updated'; readonly call: QaapNormalizedToolCall }
    | {
        readonly type: 'plan.updated';
        readonly entries: readonly { readonly content: string; readonly status: 'pending' | 'in_progress' | 'completed'; readonly priority?: string }[];
    }
    | { readonly type: 'usage.updated'; readonly usage: QaapTurnUsage }
    | { readonly type: 'mode.changed'; readonly mode: string; readonly trusted: boolean }
    | { readonly type: 'session.info'; readonly title?: string; readonly commands?: readonly string[] }
    | { readonly type: 'auth.required'; readonly methods: readonly QaapHarnessAuthMethod[] }
    | { readonly type: 'warning'; readonly code: QaapHarnessWarningCode; readonly detail: string };

/** A permission request after normalization, ready for the Tool Gate and the ask broker. */
export interface QaapNormalizedPermissionRequest {
    readonly agentId: string;
    readonly callId: string;
    readonly toolKind: QaapToolKind;
    readonly operation?: QaapHarnessToolOperation;
    readonly rawToolName: string;
    readonly canonicalInput: QaapCanonicalToolInput;
    readonly locations: readonly string[];
    readonly cwd: string;
}

/** Answer to a permission request. The harness-side option is chosen by its kind, never by its id or label. */
export type QaapPermissionAnswer =
    | { readonly outcome: 'allow'; readonly remember: 'once' | 'session' }
    | { readonly outcome: 'deny'; readonly reason?: string }
    | { readonly outcome: 'cancelled' };

/** What an adapter can guarantee in a given environment (host, tenant, sandbox, detected version). */
export interface QaapHarnessRuntimeCapabilities {
    readonly modes: readonly QaapHarnessApprovalMode[];
    readonly enforcement: QaapHarnessEnforcement;
    readonly readOnly: 'agent-mode' | 'gate' | 'sandbox-ro' | 'unsupported';
    readonly canAsk: boolean;
    readonly askTtlSec: number;
    readonly mcpTransports: readonly ('stdio' | 'http' | 'mcp-over-acp')[];
    readonly resume: QaapHarnessResumeSupport;
    readonly usage: 'tokens+cost' | 'tokens' | 'none';
    readonly setModel: 'live' | 'new-session' | 'none';
}

/** Persistable reference to a harness session (F3). */
export interface QaapHarnessSessionHandle {
    readonly agentId: string;
    readonly adapter: QaapHarnessTransportKind;
    readonly adapterVersion: string;
    readonly sessionId: string;
    readonly cwd: string;
    readonly model?: string;
    readonly mode?: string;
    readonly createdAt: number;
    readonly lastTurnId?: string;
    readonly transcriptWatermark?: string;
}
