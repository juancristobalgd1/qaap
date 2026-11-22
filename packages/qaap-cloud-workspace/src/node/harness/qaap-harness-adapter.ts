// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapHarnessCapabilities, QaapHarnessTransportKind } from '@theia/qaap-shared-core/lib/common/qaap-harness-capabilities';
import type { QaapAntigravityCliBin } from '@theia/qaap-shared-core/lib/common/qaap-antigravity-cli';
import type { QaapAgentStreamAccumulator } from '@theia/qaap-shared-core/lib/common/qaap-cli-transcript-stream';
import type { QaapCliAgUiStreamEmitter } from '@theia/qaap-shared-core/lib/common/qaap-cli-ag-ui-stream';
import type { QaapAgentMessageSegment } from '@theia/qaap-shared-core/lib/common/qaap-qaiq-stream';
import type { QaapTranscriptTraceEventDTO } from '@theia/qaap-shared-core/lib/common/qaap-transcript-trace-model';
import type { QaapQaiqModelBinding } from '../../common/qaap-qaiq-model-binding';
import type { QaapAgentApprovalFlagOptions } from '../../common/qaap-agent-approval-flags';
import type { QaapAgentTask } from '../../common/qaap-agent-task';
import type {
    QaapHarnessApprovalMode,
    QaapHarnessCancelReason,
    QaapHarnessEvent,
    QaapHarnessRuntimeCapabilities,
    QaapHarnessSessionHandle,
    QaapHarnessTurnOutcome,
} from '../../common/qaap-harness-contract';
import type { QaapAgentPromptTransport } from '../qaap-agent-task-runner-utils';

/**
 * How a harness's tool calls reach the Tool Gate. Replaces the per-agent-id predicates the runner used to evaluate
 * (`usesToolGateExtension`, `usesCodexToolGateHook`, `usesOpencodeGatePlugin`, the stdio control protocol).
 * It describes wiring that exists today and is asserted against the capability registry by the adapter spec.
 */
export type QaapHarnessGateWiring = 'stdio-control' | 'pi-extension' | 'codex-hook' | 'opencode-plugin' | 'none';

/** Per-harness behaviour of the spawn and stream handling that is not part of the command line or the env. */
export interface QaapHarnessSpawnQuirks {
    /** A run killed mid-snapshot leaves `index.lock` in the tenant's data dir; remove it before the next spawn (OpenCode). */
    readonly removesStaleSnapshotLocks: boolean;
    /** agy waits 60 s for a pasted sign-in code: the first sign-in wait line on its output stops the run (Antigravity). */
    readonly watchesSignInWait: boolean;
    /** OpenCode keeps running after a quota error and prints nothing on stdout: a fatal stderr line stops the run. */
    readonly watchesFatalStderr: boolean;
    /** Pi reports a provider error (quota, auth) on stderr and keeps waiting: the provider-error watcher ends the run (Pi). */
    readonly watchesProviderErrors: boolean;
    /** The harness may use the Agent tool (Claude Code only; the gate still restricts which subagent types). */
    readonly allowsSubagentTools: boolean;
    /** Stdout is stream-json ending in a `result` event: the process is ended after a short grace once it arrives. */
    readonly emitsStreamJsonFinalResult: boolean;
}

/** What the prompt transport rules get to look at: the agent id plus what was detected for its CLI. */
export interface QaapHarnessPromptTransportProbe {
    /** Agent id, trimmed and lower-cased; empty when unknown. */
    readonly agentId: string;
    /** Detected binary name, trimmed and lower-cased. */
    readonly bin?: string;
    /** Detected or configured command template. */
    readonly template?: string;
}

/** Result of parsing a whole agent log for transcript replay. */
export interface QaapHarnessParsedLog {
    readonly content: string;
    readonly segments: QaapAgentMessageSegment[];
    readonly traceEvents: QaapTranscriptTraceEventDTO[];
}

/**
 * What the task runner asks of a one-shot native harness (a CLI started per turn from a command template). Each
 * method is the former per-agent-id branch of the runner. The delegating defaults live in
 * `legacy/qaap-native-harness-adapter.ts`; an adapter overrides only what is specific to its harness.
 *
 * `agentId` parameters carry the id the runner resolved (which can be a custom id served by the generic adapter);
 * a registered adapter receives its own id.
 */
export interface QaapHarnessLaunchHooks {
    /** Prompt transport this adapter claims for the probe, or undefined to let the next adapter in the chain decide. */
    matchPromptTransport(probe: QaapHarnessPromptTransportProbe): QaapAgentPromptTransport | undefined;
    /** Prompt text with any harness-specific instruction added (Pi plan mode). */
    preparePrompt(agentId: string, prompt: string, interactionModeId: string | undefined): string;
    /** Template variables with the harness extras added (Pi: default model flags and the gate extension path). */
    extendTemplateVars(agentId: string, vars: Record<string, string>): Record<string, string>;
    /** Rewrites the command's approval / sandbox / read-only flags for the chosen policy. */
    applyApprovalPolicy(command: string, options: QaapAgentApprovalFlagOptions): string;
    formatModelFlags(agentId: string, binding: QaapQaiqModelBinding, antigravityBin?: QaapAntigravityCliBin): string;
    formatEffortFlags(agentId: string, modelId: string | undefined, effort: string | undefined): string;
    /** Env of the harness child that depends on the harness itself (never credentials). */
    applyChildEnv(env: NodeJS.ProcessEnv, task: Pick<QaapAgentTask, 'agentId' | 'command' | 'autoApprove' | 'readOnlyWorkspace'>): void;
    /** Env that carries the permission policy of a harness whose own default would allow everything (OpenCode). */
    applyPermissionEnv(env: NodeJS.ProcessEnv, task: Pick<QaapAgentTask, 'agentId' | 'command' | 'autoApprove' | 'readOnlyWorkspace'>): void;
    /** Live stdout parser for the transcript, or undefined for a harness whose output is plain text. */
    createStreamAccumulator(agentId: string): QaapAgentStreamAccumulator | undefined;
    /** Live stdout to AG-UI event emitter, or undefined when the harness has none. */
    createAgUiEmitter(agentId: string): QaapCliAgUiStreamEmitter | undefined;
    /** Parses a full log for transcript replay (SSE settle, history rows). */
    parseLogForTranscript(agentId: string, log: string): QaapHarnessParsedLog;
    readonly gateWiring: QaapHarnessGateWiring;
    readonly spawnQuirks: QaapHarnessSpawnQuirks;
}

/** Where the harness runs: this decides what an adapter can promise (see `probe`). */
export interface QaapHarnessEnvironment {
    readonly runtime: 'host' | 'tenant' | 'sandbox';
    readonly ownerLogin?: string;
    readonly cwd: string;
}

export interface QaapHarnessLaunchContext {
    readonly runtime: QaapHarnessEnvironment['runtime'];
    /** Sanitized env; credentials are added by the adapter at spawn time, never logged. */
    readonly env: Readonly<Record<string, string>>;
    readonly ownerUid?: number;
}

export interface QaapHarnessStartRequest {
    readonly taskId: string;
    readonly cwd: string;
    readonly writableRoots: readonly string[];
    readonly approvalMode: QaapHarnessApprovalMode;
    readonly model?: string;
    readonly effort?: string;
    /** F3: the adapter may refuse it and the caller falls back to the transcript. */
    readonly resume?: QaapHarnessSessionHandle;
    readonly launch: QaapHarnessLaunchContext;
}

export interface QaapHarnessTurnInput {
    readonly prompt: string;
}

/** The only way an adapter reports what happens in a turn; the sink turns events into AG-UI, trace and usage. */
export interface QaapHarnessEventSink {
    emit(event: QaapHarnessEvent): void;
}

export interface QaapHarnessSession {
    readonly handle: QaapHarnessSessionHandle;
    prompt(turn: QaapHarnessTurnInput, signal: AbortSignal): Promise<QaapHarnessTurnOutcome>;
    setMode?(mode: QaapHarnessApprovalMode): Promise<void>;
    setModel?(model: string, effort?: string): Promise<'applied' | 'needs-new-session'>;
    /** Cooperative first, then a timeout and a kill of the process tree. */
    cancel(reason: QaapHarnessCancelReason): Promise<void>;
    /** Releases the process, tokens and 0600 files. */
    close(): Promise<void>;
}

/**
 * One contract for every harness, native or ACP (design section 2). Native one-shot adapters are driven through
 * {@link QaapHarnessLaunchHooks} by the runner in F0; session-based adapters (ACP, F1) implement `probe` and
 * `startSession` and give the launch hooks their trivial defaults.
 */
export interface QaapHarnessAdapter extends QaapHarnessLaunchHooks {
    readonly agentId: string;
    readonly transport: QaapHarnessTransportKind;
    /** Static capabilities (UI, docs, coverage spec): the capability registry entry of {@link agentId}. */
    readonly capabilities: QaapHarnessCapabilities;
    /** What this adapter can guarantee in this environment. F1. */
    probe?(env: QaapHarnessEnvironment): Promise<QaapHarnessRuntimeCapabilities>;
    /** Starts a session. F1; native one-shot adapters have no sessions yet. */
    startSession?(request: QaapHarnessStartRequest, sink: QaapHarnessEventSink): Promise<QaapHarnessSession>;
}
