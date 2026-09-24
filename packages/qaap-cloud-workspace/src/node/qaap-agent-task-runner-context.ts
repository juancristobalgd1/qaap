// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// The shared contract between `QaapAgentTaskRunner` and the `*Extracted` free functions in the
// `qaap-agent-task-runner-{activity2,live-status2,render2,streaming2,timeline2,tool-pills2}.ts`
// cluster. Each extracted function receives `this` (the runner) typed as
// `QaapAgentTaskRunnerContext` instead of `any`. Only members actually referenced through `ctx.`
// across that cluster are listed here — see `qaap-agent-task-runner.ts`, which `implements` this
// interface, for the real implementation and documentation of each member.
//
// `import type` throughout to avoid a runtime import cycle with the extracted modules (all of which
// are imported back into `qaap-agent-task-runner.ts`).

import type { Emitter } from '@theia/core/lib/common/event';
import type { PreferenceService } from '@theia/core/lib/common/preferences';
import type { ChildProcess } from 'child_process';
import type * as fs from 'fs';
import type {
    QaapAgentDescriptor,
    QaapAgentTask,
    QaapAgentTaskEvent,
    QaapAgentTaskReview,
    QaapAgentTaskState,
    QaapAgentTaskVerification,
    QaapCreateAgentTaskQaiqModel,
    QaapCreateAgentTaskRequest,
} from '../common/qaap-agent-task';
import type { QaapTurnLatencyMark } from '@theia/qaap-shared-core/lib/common/qaap-agent-stream-metrics';
import type { QaapQaiqInteractionFlagOptions } from '@theia/qaap-shared-core/lib/common/qaap-qaiq-interaction-flags';
import type { QaapPreferenceReader } from '@theia/qaap-shared-core/lib/common/qaap-qaiq-byok-provider-registry';
import type { QaapAgentReadOnlyEnforcement } from '../common/qaap-agent-readonly-workspace';
import type { QaapQaiqPendingControlRequest } from '../common/qaap-qaiq-stdio-approvals';
import type { QaapEmptyAgentTurnResult } from '../common/qaap-agent-empty-turn';
import type { QaapQaiqModelBinding } from '../common/qaap-qaiq-model-binding';
import type { QaapNativeModelRoutingTable } from '../common/qaap-agent-native-model-routing';
import type { QaapWorkflowRoutingPolicy } from '../common/qaap-workflow-routing';
import type { QaapTenantSpawnService } from './qaap-tenant-spawn-service';
import type { QaapWebPushService } from './qaap-web-push-service';
import type { QaapBillingStore } from './qaap-billing-store';
import type { QaapAgentHealthTracker } from './qaap-agent-health';
import type { QaapObservability } from './qaap-observability';
import type { QaapAgentStdinPrompt } from './qaap-agent-task-runner-utils';
import type { AgentCandidate, QaapGenericCommandResult } from './qaap-agent-task-runner-constants';

/** Result of {@link QaapAgentTaskRunnerContext.buildAgentCommand}. */
export interface QaapAgentCommandBuildResult {
    command: string;
    stdinPrompt?: string;
    stdinPromptMode?: 'qaiq-stdio' | 'plain';
    agentId: string;
    promptTempDir?: string;
}

/** Options of {@link QaapAgentTaskRunnerContext.runGenericCommand}. */
export interface QaapGenericCommandOptions {
    readonly header?: string;
    readonly streamOutput?: boolean;
    readonly tailOutput?: boolean;
    readonly maxCaptureChars?: number;
    readonly stdinPrompt?: string;
    readonly ownerLogin?: string;
}

/** Options of {@link QaapAgentTaskRunnerContext.spawnAgentCommand}. */
export interface QaapSpawnAgentCommandOptions {
    cwd: string;
    env: NodeJS.ProcessEnv;
    stdio: ('pipe' | 'ignore')[];
    detached?: boolean;
}

/**
 * Members of {@link QaapAgentTaskRunner} that the `*Extracted` helper functions access via `ctx.`.
 * This interface is the seam between the class and the free functions it delegates to.
 */
export interface QaapAgentTaskRunnerContext {

    // ─── Injected services ──────────────────────────────────────────────────
    readonly webPush: QaapWebPushService;
    readonly billingStore: QaapBillingStore | undefined;
    readonly preferenceService: PreferenceService | undefined;
    readonly workflowRouting: QaapWorkflowRoutingPolicy | undefined;
    readonly agentHealth: QaapAgentHealthTracker | undefined;
    readonly observability: QaapObservability | undefined;
    readonly tenantSpawn: QaapTenantSpawnService;

    // ─── State maps / sets / scalars ────────────────────────────────────────
    readonly tasks: Map<string, QaapAgentTask>;
    readonly processes: Map<string, ChildProcess>;
    readonly deletedTaskIds: Set<string>;
    readonly stoppingTaskIds: Set<string>;
    readonly stdinInteractiveTasks: Set<string>;
    readonly stdinPrompts: Map<string, QaapAgentStdinPrompt>;
    readonly promptTempDirs: Map<string, string>;
    readonly pendingQaiqControlRequests: Map<string, QaapQaiqPendingControlRequest[]>;
    readonly queuedApprovalTimers: Map<string, Map<string, NodeJS.Timeout>>;
    readonly qaiqStdioTasks: Set<string>;
    readonly detectedAgents: Map<string, AgentCandidate>;
    readonly helperTokens: Map<string, string>;
    readonly projectNameCache: Map<string, string>;
    readonly projectInfoCache: Map<string, string | undefined>;
    readonly agentInstructionsCache: Map<string, string | undefined>;
    readonly repoMapCache: Map<string, { readonly text: string | undefined; readonly at: number }>;
    readonly queuedCreateRequests: Map<string, QaapCreateAgentTaskRequest>;
    /** Mutable (not `readonly`) because the extracted modules lazily `??=`-initialize it for bare test hosts. */
    clientRequestTaskIds: Map<string, string>;
    /** Mutable for the same lazy `??=` initialization as {@link clientRequestTaskIds}. */
    resumingTaskIds: Map<string, string>;
    readonly onDidChangeTaskEmitter: Emitter<QaapAgentTaskEvent>;

    helperApiUrl: string;
    cachedNativeModelRoutingTable: QaapNativeModelRoutingTable | undefined;
    persistChain: Promise<void>;
    recoveryState: 'loading' | 'ready' | 'failed';
    storageWriteFailed: boolean;
    activeVerificationPasses: number;
    verificationPassWaiters: Array<() => void>;
    conversationIdForTask?: (taskId: string) => string | undefined;

    // ─── Lifecycle / persistence / helper CLI ───────────────────────────────
    ensureHelperCli(): void;
    loadHelperTokens(): void;
    persistHelperTokens(): void;
    helperTokenForOwner(ownerLogin?: string): string;
    restoreFromDisk(): Promise<void>;
    restorePersistedIndex(stored: unknown): void;
    persist(): Promise<void>;
    readLog(id: string): Promise<string>;
    logPath(id: string, ownerLogin?: string): string;
    isDirectory(target: string): boolean;

    // ─── Agent detection / catalog ──────────────────────────────────────────
    detectAgents(): void;
    logDetectedAgents(): void;
    isCandidateAvailable(candidate: AgentCandidate): boolean;
    resolveAntigravityBin(): string | undefined;
    detectAntigravityAgent(): void;
    resolveCursorAgentBin(): string | undefined;
    detectCursorAgent(): void;
    resolveQaiqBin(): string | undefined;
    detectQaiqAgent(): void;
    detectCodexAgent(): void;
    readCodexHelp(): string;
    isQaiqRunner(agentId: string | undefined, command: string): boolean;
    resolveTaskAgentId(task: QaapAgentTask): string;
    readCustomAgents(): AgentCandidate[];
    parseCustomAgent(entry: unknown, index: number): AgentCandidate[];
    isOnPath(bin: string): boolean;
    isAgentConfigured(): boolean;
    isAgentConnected(agentId: string, ownerLogin?: string): boolean;
    isAgentEnabled(agentId: string, ownerLogin?: string): boolean;
    listAgents(ownerLogin?: string): QaapAgentDescriptor[];
    defaultAgent(ownerLogin?: string): string;
    normalizeAgentId(token: string | undefined): string | undefined;
    normalizeMentionToken(token: string): string | undefined;
    probeAgentBinOnce(agentId: string, resolveBin: () => string | undefined): boolean;
    resolveProjectName(cwd: string): string;

    // ─── Concurrency / queue ────────────────────────────────────────────────
    maxConcurrentAgents(): number;
    countRunningTasks(): number;
    maxConcurrentAgentsPerUser(): number;
    runningTaskCountForOwner(ownerLogin: string): number;
    ownerAtConcurrencyCap(ownerLogin: string | undefined): boolean;
    drainQueuedTasks(): void;
    list(): QaapAgentTask[];
    create(request: QaapCreateAgentTaskRequest, ownerLogin?: string): QaapAgentTask;
    cancel(id: string): QaapAgentTask | undefined;

    // ─── Prompt / command construction ──────────────────────────────────────
    resolveAgentModelForRequest(request: QaapCreateAgentTaskRequest, prompt: string, ownerLogin?: string): QaapCreateAgentTaskQaiqModel | undefined;
    nativeModelRoutingTable(): QaapNativeModelRoutingTable;
    buildAgentCommand(
        prompt: string,
        agentId: string | undefined,
        autoApprove: boolean,
        agentModel?: QaapCreateAgentTaskQaiqModel,
        cwd?: string,
        contextPreamble?: string,
        interactionModeId?: string,
        approvalPolicyId?: string,
        toolApprovalRules?: QaapCreateAgentTaskRequest['toolApprovalRules'],
        userQuery?: string,
        readOnlyWorkspace?: boolean,
        ownerLogin?: string,
    ): QaapAgentCommandBuildResult;
    readProjectInfo(cwd: string): string | undefined;
    loadProjectInfoFromDisk(cwd: string): string | undefined;
    readAgentInstructions(cwd: string): string | undefined;
    loadAgentInstructionsFromDisk(cwd: string): string | undefined;
    readRepoMap(cwd: string): string | undefined;
    readRelevantFiles(cwd: string, userQuery: string | undefined): string | undefined;
    buildRepoMap(cwd: string): string | undefined;
    buildRepoTree(cwd: string): string | undefined;
    buildRecentlyChangedFiles(cwd: string): string | undefined;
    readGitStatusSnapshot(cwd: string): string | undefined;
    readRepoMemory(cwd: string): string | undefined;
    readResearchLedger(cwd: string): string | undefined;
    resolveAgentId(prompt: string, agentId: string | undefined, ownerLogin?: string): string;
    extractLastAgentMention(prompt: string): string | undefined;
    extractLastAgentMentionToken(prompt: string): string | undefined;
    stripLeadingAgentMention(prompt: string): string;
    buildTemplateVars(agentId: string, agentModel?: QaapCreateAgentTaskQaiqModel, interaction?: QaapQaiqInteractionFlagOptions): Record<string, string>;
    resolveQaiqProviderFlags(): string;
    resolveQaapQaiqBinding(ownerLogin?: string): QaapQaiqModelBinding | undefined;
    resolveAgentBindingForTask(task: QaapAgentTask): QaapQaiqModelBinding | undefined;
    normalizeAgentBinding(binding: QaapQaiqModelBinding, ownerLogin?: string): QaapQaiqModelBinding;
    previewProviderEnv(): NodeJS.ProcessEnv;
    resolveQaiqProviderFlagsFromEnv(env: NodeJS.ProcessEnv): string;
    assertQaiqConfigured(agentId: string): void;
    applyTemplate(template: string, prompt: string, vars?: Record<string, string>): string;
    applyTemplateWithoutPrompt(template: string, vars?: Record<string, string>): string;
    shellQuote(value: string): string;
    truncateForPrompt(value: string, maxChars: number): string;
    truncateHead(value: string, maxChars: number): string;

    // ─── Process lifecycle / approvals ──────────────────────────────────────
    killAgentProcessTree(
        child: ChildProcess,
        options?: { readonly escalateAfterMs?: number; readonly onGracePeriodElapsed?: () => void },
    ): NodeJS.Timeout | undefined;
    reapAgentProcessGroupAfterExit(child: ChildProcess): void;
    findPendingControlRequestEntry(pending: QaapQaiqPendingControlRequest[], idFromApproval?: string): QaapQaiqPendingControlRequest | undefined;
    scheduleQueuedApprovalTimeout(taskId: string, request: QaapQaiqPendingControlRequest, logStream: fs.WriteStream): void;
    clearQueuedApprovalTimer(taskId: string, requestId: string): void;
    clearQueuedApprovalTimers(taskId: string): void;
    spawnProcessWhenReady(task: QaapAgentTask, request: QaapCreateAgentTaskRequest): Promise<void>;
    noteReadOnlyEnforcement(taskId: string, agentId: string): QaapAgentReadOnlyEnforcement;
    spawnProcess(task: QaapAgentTask): Promise<void>;
    finishTask(id: string, state: QaapAgentTaskState, exitCode: number | undefined): QaapAgentTask | undefined;
    notifyCompletion(task: QaapAgentTask): Promise<void>;
    isTaskStillRunning(taskId: string): boolean;
    recordTaskLatencyMark(taskId: string, mark: QaapTurnLatencyMark, at?: number): void;

    // ─── Verification / review ──────────────────────────────────────────────
    maxConcurrentVerificationPasses(): number;
    acquireVerificationPass(): Promise<void>;
    releaseVerificationPass(): void;
    finishSuccessfulTaskAfterVerification(task: QaapAgentTask, exitCode: number | undefined): Promise<void>;
    detectEmptyAgentTurnForTask(task: QaapAgentTask): Promise<QaapEmptyAgentTurnResult>;
    verifySuccessfulAgentTask(task: QaapAgentTask): Promise<QaapAgentTaskVerification | undefined>;
    reviewSuccessfulAgentTask(task: QaapAgentTask, verification: QaapAgentTaskVerification | undefined): Promise<QaapAgentTaskReview | undefined>;
    resolveReviewerCandidates(task: QaapAgentTask): string[];
    hasEditedFilesForVerification(task: QaapAgentTask, env: NodeJS.ProcessEnv): Promise<boolean>;
    captureWorktreeBaseline(cwd: string): Pick<QaapAgentTask, 'worktreeBaselineFingerprint' | 'worktreeBaselineStatus' | 'sensitiveBaselineHashes'>;
    changedSensitiveFiles(task: QaapAgentTask): string[];
    restoreBaselineSensitiveFiles(task: QaapAgentTask): string[];
    captureWorktreeStatus(cwd: string): string | undefined;
    captureWorktreeFingerprint(cwd: string): string | undefined;
    resolveVerificationScriptsForCwd(cwd: string): Promise<string[]>;
    runVerificationScripts(
        task: QaapAgentTask,
        env: NodeJS.ProcessEnv,
        scripts: readonly string[],
        startedAt: number,
    ): Promise<{ command: string; result: QaapGenericCommandResult } | undefined>;
    runAgentVerificationFixTurn(
        task: QaapAgentTask,
        env: NodeJS.ProcessEnv,
        failedCommand: string,
        failure: QaapGenericCommandResult,
        attempt: number,
        startedAt: number,
    ): Promise<QaapGenericCommandResult | undefined>;
    buildAgentVerificationFixPrompt(failedCommand: string, failure: QaapGenericCommandResult, attempt: number): string;
    summarizeVerificationFailure(command: string, result: QaapGenericCommandResult): string;

    // ─── Command execution / output ─────────────────────────────────────────
    runGenericCommand(
        command: string,
        cwd: string,
        env: NodeJS.ProcessEnv,
        taskId: string,
        timeoutMs: number,
        options?: QaapGenericCommandOptions,
    ): Promise<QaapGenericCommandResult>;
    runOneShotCommand(
        command: string,
        cwd: string,
        env: NodeJS.ProcessEnv,
        agentId?: string,
        timeoutMs?: number,
        stdinPrompt?: string,
        promptTempDir?: string,
    ): Promise<string>;
    appendBoundedCommandOutput(current: string, chunk: string, maxChars: number | undefined): string;
    appendAndFireOutput(taskId: string, chunk: string, ownerLogin?: string): void;
    fireOutput(taskId: string, chunk: unknown): void;

    // ─── Tenant isolation / environment ─────────────────────────────────────
    enforceAgentIsolationPolicy(): void;
    resolveAgentSpawnIdentity(cwd: string): { uid?: number; gid?: number };
    spawnAgentCommand(command: string, options: QaapSpawnAgentCommandOptions): ChildProcess;
    resolveAgentHome(cwd: string): string;
    tenantHomeEnvOverlay(cwd: string): { HOME?: string; USER?: string; LOGNAME?: string };
    ensureAgentCwdOwnership(cwd: string): void;
    ensureAgentCwdOwnershipAsync(cwd: string): Promise<void>;
    buildChildEnv(task: QaapAgentTask): NodeJS.ProcessEnv;
    applyOpenAiVendorCompatEnv(env: NodeJS.ProcessEnv, binding: QaapQaiqModelBinding): void;
    applyQaiqProviderEnv(env: NodeJS.ProcessEnv, command: string, binding?: QaapQaiqModelBinding): void;
    applyProviderPreferenceEnv(env: NodeJS.ProcessEnv, ownerLogin?: string): void;
    stripSharedProviderEnv(env: NodeJS.ProcessEnv): void;
    preferenceReaderForOwner(ownerLogin?: string): QaapPreferenceReader;
    applyOpenRouterOpenAiCompatEnv(env: NodeJS.ProcessEnv): void;
    applyNvidiaOpenAiCompatEnv(env: NodeJS.ProcessEnv): void;
    applyHuggingfaceOpenAiCompatEnv(env: NodeJS.ProcessEnv): void;
    applyHelperEnv(env: NodeJS.ProcessEnv, ownerLogin?: string, parentTaskId?: string, autoApprove?: boolean): boolean;
}
