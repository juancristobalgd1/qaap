// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************
import { Emitter, Event } from '@theia/core/lib/common/event';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import {
    inject,
    injectable,
    optional,
    postConstruct,
} from '@theia/core/shared/inversify';
import { ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
    type QaapAgentDescriptor,
    type QaapCreateAgentTaskQaiqModel,
    type QaapQaiqModelOption,
    type QaapAgentTask,
    type QaapAgentTaskCwdGroup,
    type QaapAgentTaskDetail,
    type QaapAgentTaskEvent,
    type QaapAgentTaskReview,
    type QaapAgentTaskState,
    type QaapAgentTaskVerification,
    type QaapCreateAgentTaskRequest,
    type QaapAgentWarmResult,
} from '../common/qaap-agent-task';
import type { QaapTurnLatencyMark } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-stream-metrics';
import { type QaapQaiqInteractionFlagOptions } from '@theia/qaap-mobile-shell/lib/common/qaap-qaiq-interaction-flags';
import type { QaapPreferenceReader } from '@theia/qaap-mobile-shell/lib/common/qaap-qaiq-byok-provider-registry';
import { QaapTenantSpawnService } from './qaap-tenant-spawn-service';
import { type QaapAgentReadOnlyEnforcement, } from '../common/qaap-agent-readonly-workspace';
import { type QaapQaiqPendingControlRequest } from '../common/qaap-qaiq-stdio-approvals';
import { type QaapEmptyAgentTurnResult } from '../common/qaap-agent-empty-turn';
import { type QaapQaiqModelBinding } from '../common/qaap-qaiq-model-binding';
import { type QaapNativeModelRoutingTable } from '../common/qaap-agent-native-model-routing';
import { QaapWebPushService } from './qaap-web-push-service';
import { QaapBillingStore } from './qaap-billing-store';
import { QaapWorkflowRoutingPolicy } from '../common/qaap-workflow-routing';
import { QaapAgentHealthTracker } from './qaap-agent-health';
import {
    readCodexHelp as readCodexHelpHelper,
    isQaiqRunner as isQaiqRunnerHelper,
    isOnPath as isOnPathHelper,
    applyTemplateVars as applyTemplateVarsHelper,
    shellQuote as shellQuoteHelper,
    applyTemplate as applyTemplateHelper,
    applyTemplateWithoutPrompt as applyTemplateWithoutPromptHelper,
    truncateForPrompt as truncateForPromptHelper,
    truncateHead as truncateHeadHelper,
    loadProjectInfoFromDisk as loadProjectInfoFromDiskHelper,
    loadAgentInstructionsFromDisk as loadAgentInstructionsFromDiskHelper,
    readRepoMemory as readRepoMemoryHelper,
    readResearchLedger as readResearchLedgerHelper,
    isDirectory as isDirectoryHelper,
    resolveQaiqProviderFlagsFromEnv as resolveQaiqProviderFlagsFromEnvHelper,
    applyOpenRouterOpenAiCompatEnv as applyOpenRouterOpenAiCompatEnvHelper,
    applyNvidiaOpenAiCompatEnv as applyNvidiaOpenAiCompatEnvHelper,
    applyHuggingfaceOpenAiCompatEnv as applyHuggingfaceOpenAiCompatEnvHelper,
    noteReadOnlyEnforcement as noteReadOnlyEnforcementHelper,
    changedSensitiveFiles as changedSensitiveFilesHelper,
} from './qaap-agent-task-runner-utils';
import { parseCustomAgent as parseCustomAgentHelper, maxConcurrentAgents as maxConcurrentAgentsHelper, maxConcurrentAgentsPerUser as maxConcurrentAgentsPerUserHelper, buildRepoTree as buildRepoTreeHelper, buildRecentlyChangedFiles as buildRecentlyChangedFilesHelper, readGitStatusSnapshot as readGitStatusSnapshotHelper, captureWorktreeStatus as captureWorktreeStatusHelper, captureWorktreeFingerprint as captureWorktreeFingerprintHelper, resolveVerificationScriptsForCwd as resolveVerificationScriptsForCwdHelper, appendBoundedCommandOutput as appendBoundedCommandOutputHelper, readUserSettingsFromDisk as readUserSettingsFromDiskHelper, preferenceReaderForOwner as preferenceReaderForOwnerHelper, stripSharedProviderEnv as stripSharedProviderEnvHelper, } from './qaap-agent-task-runner-utils2';
import {
    readRelevantFiles as readRelevantFilesHelper,
    reapAgentProcessGroupAfterExit as reapAgentProcessGroupAfterExitHelper,
    resolveProjectName as resolveProjectNameHelper,
    listAgents as listAgentsHelper,
    probeAgentBinOnce as probeAgentBinOnceHelper,
    recordTaskLatencyMark as recordTaskLatencyMarkHelper,
} from './qaap-agent-task-runner-utils3';
import { countRunningTasksExtracted, defaultAgentExtracted, detailExtracted, detectAgentsExtracted, detectAntigravityAgentExtracted, detectCodexAgentExtracted, detectQaiqAgentExtracted, drainQueuedTasksExtracted, ensureHelperCliExtracted, helperTokenForOwnerExtracted, initExtracted, listAllGroupedByCwdExtracted, listForCwdExtracted, listModelsForAgentExtracted, listQaiqModelsExtracted, loadHelperTokensExtracted, logDetectedAgentsExtracted, normalizeAgentIdExtracted, ownerAtConcurrencyCapExtracted, persistHelperTokensExtracted, readCustomAgentsExtracted, resolveAntigravityBinExtracted, resolveHelperTokenOwnerExtracted, resolveQaiqBinExtracted, resolveTaskAgentIdExtracted, restoreFromDiskExtracted, restorePersistedIndexExtracted, runningTaskCountForOwnerExtracted, warmForCwdExtracted } from './qaap-agent-task-runner-render2';
import { assertQaiqConfiguredExtracted, buildAgentCommandExtracted, buildRepoMapExtracted, buildTemplateVarsExtracted, cancelExtracted, createExtracted, extractLastAgentMentionExtracted, extractLastAgentMentionTokenExtracted, nativeModelRoutingTableExtracted, normalizeAgentBindingExtracted, previewProviderEnvExtracted, readAgentInstructionsExtracted, readProjectInfoExtracted, readRepoMapExtracted, resolveAgentBindingForTaskExtracted, resolveAgentIdExtracted, resolveAgentModelForRequestExtracted, resolveQaapQaiqBindingExtracted, resolveQaiqProviderFlagsExtracted, stripLeadingAgentMentionExtracted } from './qaap-agent-task-runner-streaming2';
import { acquireVerificationPassExtracted, clearQueuedApprovalTimerExtracted, clearQueuedApprovalTimersExtracted, findPendingControlRequestEntryExtracted, getApprovalChannelExtracted, killAgentProcessTreeExtracted, maxConcurrentVerificationPassesExtracted, respondToApprovalPromptExtracted, scheduleQueuedApprovalTimeoutExtracted, spawnProcessExtracted, spawnProcessWhenReadyExtracted } from './qaap-agent-task-runner-timeline2';
import { injectStdioUserMessageExtracted, type QaapStdioInjectHost } from './qaap-agent-stdio-inject';
import { buildAgentVerificationFixPromptExtracted, captureWorktreeBaselineExtracted, detectEmptyAgentTurnForTaskExtracted, finishSuccessfulTaskAfterVerificationExtracted, hasEditedFilesForVerificationExtracted, releaseVerificationPassExtracted, resolveReviewerCandidatesExtracted, restoreBaselineSensitiveFilesExtracted, reviewSuccessfulAgentTaskExtracted, runAgentVerificationFixTurnExtracted, runVerificationScriptsExtracted, verifySuccessfulAgentTaskExtracted } from './qaap-agent-task-runner-activity2';
import { appendAndFireOutputExtracted, applyHelperEnvExtracted, applyOpenAiVendorCompatEnvExtracted, applyProviderPreferenceEnvExtracted, applyQaiqProviderEnvExtracted, buildChildEnvExtracted, finishTaskExtracted, fireOutputExtracted, improveComposerPromptExtracted, markTaskBlockedExtracted, notifyCompletionExtracted, persistExtracted, readLogExtracted, runGenericCommandExtracted, spawnAgentCommandExtracted, summarizeVerificationFailureExtracted } from './qaap-agent-task-runner-tool-pills2';
import { runOneShotCommandExtracted } from './qaap-agent-task-runner-live-status2';
import {
    isQaapHarnessEnabled,
    QAAP_DISABLED_HARNESSES_PREF,
    readDisabledHarnessIds,
} from '@theia/qaap-mobile-shell/lib/common/qaap-harness-preferences';

/** Built-in coding agents the runner can auto-detect on the server's PATH. */

// Re-export constants for external consumers
export {
    AGENT_CANDIDATES,
    CUSTOM_AGENTS_ENV,
    QAAP_AGENT_VERIFY_ENABLED,
    QAAP_AGENT_VERIFY_OUTPUT_TAIL_CHARS,
    QAAP_AGENT_FIX_PROMPT_OUTPUT_CHARS,
    REPO_MAP_MAX_CHARS,
    REPO_MAP_CACHE_TTL_MS,
    DEFAULT_AGENT_PREFERENCE,
    AGENT_ENV_PREFS,
    SHELL_AGENT_ID,
    ENV_AGENT_ID,
    STORE_DIR,
    INDEX_PATH,
    STORE_DIR_MODE,
    STORE_FILE_MODE,
    MAX_LOG_BYTES,
    EMPTY_TURN_GATE_COMMAND,
    IDLE_TASK_TIMEOUT_MS,
    AGENT_STOP_GRACE_TIMEOUT_MS,
    DEFAULT_AGENT_STOP_GRACE_TIMEOUT_MS,
    MIN_AGENT_STOP_GRACE_TIMEOUT_MS,
    MAX_AGENT_STOP_GRACE_TIMEOUT_MS,
    resolveAgentStopGraceTimeoutMs,
    QUEUED_APPROVAL_GRACE_TIMEOUT_MS,
    TOKEN_PATH,
    TOKENS_PATH,
    HELPER_BIN_DIR,
    HELPER_BIN_PATH,
    HELPER_CLI_SOURCE,
    QAIQ_AGENT_ID,
    type AgentCandidate,
    type QaapGenericCommandResult,
} from './qaap-agent-task-runner-constants';

import {
    AGENT_CANDIDATES,
    CUSTOM_AGENTS_ENV,
    SHELL_AGENT_ID,
    ENV_AGENT_ID,
    STORE_DIR,
    type AgentCandidate,
    type QaapGenericCommandResult,
} from './qaap-agent-task-runner-constants';

/**
 * Runs background tasks on the VPS as detached-from-tab child processes. A task keeps running
 * after the browser tab is closed or the phone is locked, because it lives in the backend
 * process — and on completion the backend itself sends a Web Push, so the user is notified
 * even with no tab open. This is the execution substrate the autonomous agent loop plugs into.
 */
@injectable()
export class QaapAgentTaskRunner {

    @inject(QaapWebPushService)
    protected readonly webPush: QaapWebPushService;

    @inject(QaapBillingStore) @optional()
    protected readonly billingStore: QaapBillingStore | undefined;

    @inject(PreferenceService) @optional()
    protected readonly preferenceService: PreferenceService | undefined;

    /** Judge routing shared with workflow runs; optional so bare test harnesses keep old behavior. */
    @inject(QaapWorkflowRoutingPolicy) @optional()
    protected readonly workflowRouting: QaapWorkflowRoutingPolicy | undefined;

    @inject(QaapAgentHealthTracker) @optional()
    protected readonly agentHealth: QaapAgentHealthTracker | undefined;

    protected cachedNativeModelRoutingTable: QaapNativeModelRoutingTable | undefined;

    protected readonly tasks = new Map<string, QaapAgentTask>();
    protected readonly processes = new Map<string, ChildProcess>();
    /** Cancelled process groups still consuming a concurrency slot during graceful shutdown. */
    protected readonly stoppingTaskIds = new Set<string>();
    /** Tasks spawned with stdin piped for manual approval mode. */
    protected readonly stdinInteractiveTasks = new Set<string>();
    /** Prompts to deliver over stdin for QAIQ stdio-approval runs (`--input-format stream-json`). */
    protected readonly stdinPrompts = new Map<string, string>();
    /** Unanswered `can_use_tool` control requests per task — the pause-and-wait approval queue. */
    protected readonly pendingQaiqControlRequests = new Map<string, QaapQaiqPendingControlRequest[]>();
    /** Grace timers (per task, per requestId) auto-denying queued approvals of auto-approve runs. */
    protected readonly queuedApprovalTimers = new Map<string, Map<string, NodeJS.Timeout>>();
    /** Tasks using QAIQ stream-json stdin — never answer with legacy `y`/`n` lines. */
    protected readonly qaiqStdioTasks = new Set<string>();
    /** Agents whose CLI was found on PATH at startup, keyed by id. */
    protected readonly detectedAgents = new Map<string, AgentCandidate>();
    /**
     * Per-owner helper-CLI tokens so a spawned agent can only call back as its own user.
     * Key is the owner login (`''` for shared/anonymous/skip-auth); value is the secret token.
     */
    protected readonly helperTokens = new Map<string, string>();
    /** URL spawned agents POST sub-tasks to. Bound from the backend's listen port. */
    protected helperApiUrl = '';
    /** Best-effort `package.json#name` per cwd; lazily populated. */
    protected readonly projectNameCache = new Map<string, string>();
    /** Cached `.prompts/project-info.prompttemplate` per cwd — primed by {@link warmForCwd}. */
    protected readonly projectInfoCache = new Map<string, string | undefined>();
    /** Cached workspace agent-instructions (CLAUDE.md / AGENTS.md) per cwd — primed by {@link warmForCwd}. */
    protected readonly agentInstructionsCache = new Map<string, string | undefined>();
    /** Cached shallow repo map per cwd — primed by {@link warmForCwd}, refreshed lazily on expiry. */
    protected readonly repoMapCache = new Map<string, { readonly text: string | undefined; readonly at: number }>();
    /** Original create requests for tasks waiting on the concurrency queue. */
    protected readonly queuedCreateRequests = new Map<string, QaapCreateAgentTaskRequest>();
    /** Serializes whole-index snapshots so an older, slower write can never overwrite a newer one. */
    protected persistChain: Promise<void> = Promise.resolve();
    /** Agent bins probed once per backend process (`qaiq --version`, etc.). */
    protected readonly probedAgentBins = new Set<string>();

    protected readonly onDidChangeTaskEmitter = new Emitter<QaapAgentTaskEvent>();
    /**
     * Fires every time a task is created, transitions state, or is cancelled. SSE endpoints and
     * cross-project UIs subscribe here to update their views without polling.
     */
    readonly onDidChangeTask: Event<QaapAgentTaskEvent> = this.onDidChangeTaskEmitter.event;

    @postConstruct()
    protected init(): void {
        initExtracted(this);
    }

    protected ensureHelperCli(): void {
        ensureHelperCliExtracted(this);
    }

    protected loadHelperTokens(): void {
        loadHelperTokensExtracted(this);
    }

    protected persistHelperTokens(): void {
        persistHelperTokensExtracted(this);
    }

    protected helperTokenForOwner(ownerLogin?: string): string {
        return helperTokenForOwnerExtracted(this, ownerLogin);
    }

    resolveHelperTokenOwner(presented: string | undefined): { ownerLogin: string | undefined } | undefined {
        return resolveHelperTokenOwnerExtracted(this, presented);
    }

    /** True when the presented token matches any provisioned helper token. */
    verifyHelperToken(presented: string | undefined): boolean {
        return !!this.resolveHelperTokenOwner(presented);
    }

    /** Called by the backend application once the HTTP server is listening on `port`. */
    bindHelperApiUrl(port: number): void {
        this.helperApiUrl = `http://127.0.0.1:${port}/qaap/api/agent-tasks`;
    }

    protected detectAgents(): void {
        detectAgentsExtracted(this);
    }

    protected logDetectedAgents(): void {
        logDetectedAgentsExtracted(this);
    }

    protected isCandidateAvailable(candidate: AgentCandidate): boolean {
        return !candidate.bin || this.isOnPath(candidate.bin);
    }

    protected resolveAntigravityBin(): string | undefined {
        return resolveAntigravityBinExtracted(this);
    }

    protected detectAntigravityAgent(): void {
        detectAntigravityAgentExtracted(this);
    }

    protected resolveQaiqBin(): string | undefined {
        return resolveQaiqBinExtracted(this);
    }

    protected detectQaiqAgent(): void {
        detectQaiqAgentExtracted(this);
    }

    protected detectCodexAgent(): void {
        detectCodexAgentExtracted(this);
    }

    protected readCodexHelp(): string {
        return readCodexHelpHelper();
    }

    protected isQaiqRunner(agentId: string | undefined, command: string): boolean {
        return isQaiqRunnerHelper(agentId, command);
    }

    protected resolveTaskAgentId(task: QaapAgentTask): string {
        return resolveTaskAgentIdExtracted(this, task);
    }

    protected readCustomAgents(): AgentCandidate[] {
        return readCustomAgentsExtracted(this);
    }

    protected parseCustomAgent(entry: unknown, index: number): AgentCandidate[] {
        return parseCustomAgentHelper(entry, index, AGENT_CANDIDATES, SHELL_AGENT_ID, ENV_AGENT_ID, CUSTOM_AGENTS_ENV);
    }

    protected isOnPath(bin: string): boolean {
        return isOnPathHelper(bin);
    }

    protected async restoreFromDisk(): Promise<void> {
        return restoreFromDiskExtracted(this);
    }

    protected restorePersistedIndex(stored: unknown): void {
        restorePersistedIndexExtracted(this, stored);
    }

    protected maxConcurrentAgents(): number {
        return maxConcurrentAgentsHelper();
    }

    protected countRunningTasks(): number {
        return countRunningTasksExtracted(this);
    }

    protected maxConcurrentAgentsPerUser(): number {
        return maxConcurrentAgentsPerUserHelper();
    }

    protected runningTaskCountForOwner(ownerLogin: string): number {
        return runningTaskCountForOwnerExtracted(this, ownerLogin);
    }

    protected ownerAtConcurrencyCap(ownerLogin: string | undefined): boolean {
        return ownerAtConcurrencyCapExtracted(this, ownerLogin);
    }

    protected drainQueuedTasks(): void {
        drainQueuedTasksExtracted(this);
    }

    list(): QaapAgentTask[] {
        return [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
    }

    listForCwd(cwd: string | undefined): QaapAgentTask[] {
        return listForCwdExtracted(this, cwd);
    }

    listAllGroupedByCwd(): QaapAgentTaskCwdGroup[] {
        return listAllGroupedByCwdExtracted(this);
    }

    /**
     * Best-effort display name for a cwd. Reads `package.json#name` once and caches it; falls
     * back to the directory basename when no package manifest is present or readable.
     */
    protected resolveProjectName(cwd: string): string {
        return resolveProjectNameHelper(cwd, this.projectNameCache);
    }

    /** True when at least one coding agent is available — autodetected or env-configured. */
    isAgentConfigured(): boolean {
        return this.detectedAgents.size > 0 || !!process.env.QAAP_AGENT_COMMAND?.trim();
    }

    /** Agents the UI can offer in its picker, in priority order. */
    listAgents(ownerLogin?: string): QaapAgentDescriptor[] {
        return listAgentsHelper(this.detectedAgents).filter(agent => this.isAgentEnabled(agent.id, ownerLogin));
    }

    warmForCwd(cwd: string): QaapAgentWarmResult {
        return warmForCwdExtracted(this, cwd);
    }

    protected probeAgentBinOnce(agentId: string, resolveBin: () => string | undefined): boolean {
        return probeAgentBinOnceHelper(agentId, resolveBin, this.probedAgentBins);
    }

    listQaiqModels(ownerLogin?: string): QaapQaiqModelOption[] {
        return listQaiqModelsExtracted(this, ownerLogin);
    }

    listModelsForAgent(agentId: string | undefined, ownerLogin?: string): QaapQaiqModelOption[] {
        return listModelsForAgentExtracted(this, agentId, ownerLogin);
    }

    defaultAgent(ownerLogin?: string): string {
        return defaultAgentExtracted(this, agentId => this.isAgentEnabled(agentId, ownerLogin));
    }

    isAgentEnabled(agentId: string, ownerLogin?: string): boolean {
        const readPref = this.preferenceReaderForOwner(ownerLogin);
        return isQaapHarnessEnabled(agentId, readDisabledHarnessIds(readPref(QAAP_DISABLED_HARNESSES_PREF)));
    }

    normalizeAgentId(token: string | undefined): string | undefined {
        return normalizeAgentIdExtracted(this, token);
    }

    async detail(id: string): Promise<QaapAgentTaskDetail | undefined> {
        return detailExtracted(this, id);
    }

    protected resolveAgentModelForRequest(request: QaapCreateAgentTaskRequest, prompt: string, ownerLogin?: string): QaapCreateAgentTaskQaiqModel | undefined {
        return resolveAgentModelForRequestExtracted(this, request, prompt, ownerLogin);
    }

    protected nativeModelRoutingTable(): QaapNativeModelRoutingTable {
        return nativeModelRoutingTableExtracted(this);
    }

    create(request: QaapCreateAgentTaskRequest, ownerLogin?: string): QaapAgentTask {
        return createExtracted(this, request, ownerLogin);
    }

    protected buildAgentCommand(prompt: string, agentId: string | undefined, autoApprove: boolean, agentModel?: QaapCreateAgentTaskQaiqModel, cwd?: string, contextPreamble?: string, interactionModeId?: string, approvalPolicyId?: string, toolApprovalRules?: QaapCreateAgentTaskRequest['toolApprovalRules'], userQuery?: string, readOnlyWorkspace?: boolean, ownerLogin?: string,): { command: string; stdinPrompt?: string; agentId: string } {
        return buildAgentCommandExtracted(this, prompt, agentId, autoApprove, agentModel, cwd, contextPreamble, interactionModeId, approvalPolicyId, toolApprovalRules, userQuery, readOnlyWorkspace, ownerLogin);
    }

    protected readProjectInfo(cwd: string): string | undefined {
        return readProjectInfoExtracted(this, cwd);
    }

    protected loadProjectInfoFromDisk(cwd: string): string | undefined {
        return loadProjectInfoFromDiskHelper(cwd);
    }

    protected readAgentInstructions(cwd: string): string | undefined {
        return readAgentInstructionsExtracted(this, cwd);
    }

    protected loadAgentInstructionsFromDisk(cwd: string): string | undefined {
        return loadAgentInstructionsFromDiskHelper(cwd);
    }

    protected readRepoMap(cwd: string): string | undefined {
        return readRepoMapExtracted(this, cwd);
    }

    /**
     * Query-specific "likely relevant files" hint: ripgrep the user's message keywords over the repo
     * and return the top matching file paths (repo-relative). Best-effort — returns undefined when
     * disabled, no keywords, ripgrep missing, or nothing matches. Bounded and short-timeout so it
     * never blocks a turn.
     */
    protected readRelevantFiles(cwd: string, userQuery: string | undefined): string | undefined {
        return readRelevantFilesHelper(cwd, userQuery);
    }

    protected buildRepoMap(cwd: string): string | undefined {
        return buildRepoMapExtracted(this, cwd);
    }

    /** Two-level directory listing, source dirs expanded one level, hygiene dirs excluded. */
    protected buildRepoTree(cwd: string): string | undefined {
        return buildRepoTreeHelper(cwd);
    }

    /** Recently-changed files via git, so the agent knows where work is already in flight. */
    protected buildRecentlyChangedFiles(cwd: string): string | undefined {
        return buildRecentlyChangedFilesHelper(cwd);
    }

    /**
     * Fresh branch + working-tree + recent-commits snapshot, so the agent starts every turn knowing
     * where it stands instead of spending its first tool call on `git status`. Never cached — the
     * working tree drifts as the agent edits between turns.
     */
    protected readGitStatusSnapshot(cwd: string): string | undefined {
        return readGitStatusSnapshotHelper(cwd);
    }

    /**
     * Durable repo memory (`.qaap/memory.md`) appended by previous agent turns — user corrections,
     * lasting preferences, non-obvious repo facts. Never cached: the agent updates it between turns.
     */
    protected readRepoMemory(cwd: string): string | undefined {
        return readRepoMemoryHelper(cwd);
    }

    /**
     * Heads-up shown to EVERY agent turn in a repo that has an active auto-researcher ledger
     * (`.qaap/experiments.jsonl`) — not just the researcher's own propose-phase turns, which build
     * their full round prompt separately via `buildResearchRoundPrompt`. A manual chat or another
     * background task running in the same repo needs to know an autonomous loop owns this
     * repository's experiment history so it does not hand-edit the ledger or fight the researcher's
     * commits. Never cached: the runner rewrites the ledger after every phase.
     */
    protected readResearchLedger(cwd: string): string | undefined {
        return readResearchLedgerHelper(cwd);
    }

    protected resolveAgentId(prompt: string, agentId: string | undefined, ownerLogin?: string): string {
        return resolveAgentIdExtracted(this, prompt, agentId, ownerLogin);
    }

    protected extractLastAgentMention(prompt: string): string | undefined {
        return extractLastAgentMentionExtracted(this, prompt);
    }

    protected extractLastAgentMentionToken(prompt: string): string | undefined {
        return extractLastAgentMentionTokenExtracted(this, prompt);
    }

    protected normalizeMentionToken(token: string): string | undefined {
        const normalized = token.toLowerCase();
        return this.normalizeAgentId(normalized);
    }

    protected stripLeadingAgentMention(prompt: string): string {
        return stripLeadingAgentMentionExtracted(this, prompt);
    }

    protected buildTemplateVars(agentId: string, agentModel?: QaapCreateAgentTaskQaiqModel, interaction?: QaapQaiqInteractionFlagOptions,): Record<string, string> {
        return buildTemplateVarsExtracted(this, agentId, agentModel, interaction);
    }

    protected resolveQaiqProviderFlags(): string {
        return resolveQaiqProviderFlagsExtracted(this);
    }

    protected resolveQaapQaiqBinding(ownerLogin?: string): QaapQaiqModelBinding | undefined {
        return resolveQaapQaiqBindingExtracted(this, ownerLogin);
    }

    protected resolveAgentBindingForTask(task: QaapAgentTask): QaapQaiqModelBinding | undefined {
        return resolveAgentBindingForTaskExtracted(this, task);
    }

    protected normalizeAgentBinding(binding: QaapQaiqModelBinding, ownerLogin?: string): QaapQaiqModelBinding {
        return normalizeAgentBindingExtracted(this, binding, ownerLogin);
    }

    protected previewProviderEnv(): NodeJS.ProcessEnv {
        return previewProviderEnvExtracted(this);
    }

    /** Env-only fallback when no model alias or provider list is configured yet. */
    protected resolveQaiqProviderFlagsFromEnv(env: NodeJS.ProcessEnv): string {
        return resolveQaiqProviderFlagsFromEnvHelper(env);
    }

    protected assertQaiqConfigured(agentId: string): void {
        assertQaiqConfiguredExtracted(this, agentId);
    }

    protected applyTemplate(template: string, prompt: string, vars: Record<string, string> = {}): string {
        return applyTemplateHelper(template, prompt, vars);
    }

    /** Template expansion for stdio-approval runs: the prompt is delivered over stdin, not argv. */
    protected applyTemplateWithoutPrompt(template: string, vars: Record<string, string> = {}): string {
        return applyTemplateWithoutPromptHelper(template, vars);
    }

    protected applyTemplateVars(template: string, vars: Record<string, string>): string {
        return applyTemplateVarsHelper(template, vars);
    }

    /** POSIX single-quote escaping so the prompt is passed as one safe argument. */
    protected shellQuote(value: string): string {
        return shellQuoteHelper(value);
    }

    cancel(id: string): QaapAgentTask | undefined {
        return cancelExtracted(this, id);
    }

    protected killAgentProcessTree(child: ChildProcess,
        options?: { readonly escalateAfterMs?: number; readonly onGracePeriodElapsed?: () => void },): NodeJS.Timeout | undefined {
        return killAgentProcessTreeExtracted(this, child, options);
    }

    /**
     * Remove descendants that outlive an agent which exited normally.
     *
     * A coding agent or its independent reviewer can run a shell tool that backgrounds a watcher
     * or dev server. The agent process-group leader may then exit with code 0 while that descendant
     * is re-parented to the backend init process. It is no longer attributable through the task map,
     * can occupy a project-independent port, and previously survived project switches and reloads.
     *
     * Normal exit is already the graceful shutdown boundary for the group leader, so any process
     * still in its detached group is residual task work and is killed immediately. Qaap-managed
     * Preview terminals are spawned by the terminal service in their own process groups and are not
     * descendants of the agent, so they continue running across navigation and reloads.
     */
    protected reapAgentProcessGroupAfterExit(child: ChildProcess): void {
        reapAgentProcessGroupAfterExitHelper(child);
    }

    /** Pending QAIQ stdio `can_use_tool` requests for a running task. */
    listPendingQaiqControlRequests(taskId: string): readonly QaapQaiqPendingControlRequest[] {
        return this.pendingQaiqControlRequests.get(taskId) ?? [];
    }

    getApprovalChannel(taskId: string): 'qaiq-stdio' | 'stdin' | 'none' {
        return getApprovalChannelExtracted(this, taskId);
    }

    /**
     * Queue a follow-up user message on a live stream-json agent (tool-round drain).
     * No-op / false when the CLI is not reading NDJSON from stdin.
     */
    injectStdioUserMessage(taskId: string, content: string): boolean {
        return injectStdioUserMessageExtracted(this as unknown as QaapStdioInjectHost, taskId, content);
    }

    respondToApprovalPrompt(taskId: string, action: 'approve' | 'reject', toolUseId?: string): boolean {
        return respondToApprovalPromptExtracted(this, taskId, action, toolUseId);
    }

    protected findPendingControlRequestEntry(pending: QaapQaiqPendingControlRequest[], idFromApproval?: string,): QaapQaiqPendingControlRequest | undefined {
        return findPendingControlRequestEntryExtracted(this, pending, idFromApproval);
    }

    protected scheduleQueuedApprovalTimeout(taskId: string, request: QaapQaiqPendingControlRequest, logStream: fs.WriteStream,): void {
        scheduleQueuedApprovalTimeoutExtracted(this, taskId, request, logStream);
    }

    protected clearQueuedApprovalTimer(taskId: string, requestId: string): void {
        clearQueuedApprovalTimerExtracted(this, taskId, requestId);
    }

    protected clearQueuedApprovalTimers(taskId: string): void {
        clearQueuedApprovalTimersExtracted(this, taskId);
    }

    protected async spawnProcessWhenReady(task: QaapAgentTask, request: QaapCreateAgentTaskRequest): Promise<void> {
        return spawnProcessWhenReadyExtracted(this, task, request);
    }

    /**
     * Record — and, when it is not a real guarantee, say out loud — what read-only means for the
     * backend this turn actually landed on. A `'none'` backend is not refused here: refusing would
     * fail runs that work today on an installation without a restrictable CLI. It is reported instead,
     * so nobody reads "cwd-readonly" off a node and assumes the workspace was protected.
     */
    protected noteReadOnlyEnforcement(taskId: string, agentId: string): QaapAgentReadOnlyEnforcement {
        return noteReadOnlyEnforcementHelper(taskId, agentId);
    }

    protected spawnProcess(task: QaapAgentTask): void {
        spawnProcessExtracted(this, task);
    }

    /** In-flight self-verification passes. Each may spawn an extra (fix-turn) qaiq — bounded below. */
    protected activeVerificationPasses = 0;
    /** FIFO waiters for a verification slot. A released slot is transferred directly to one waiter. */
    protected verificationPassWaiters: Array<() => void> = [];

    protected maxConcurrentVerificationPasses(): number {
        return maxConcurrentVerificationPassesExtracted(this);
    }

    protected acquireVerificationPass(): Promise<void> {
        return acquireVerificationPassExtracted(this);
    }

    protected releaseVerificationPass(): void {
        releaseVerificationPassExtracted(this);
    }

    protected async finishSuccessfulTaskAfterVerification(task: QaapAgentTask, exitCode: number | undefined): Promise<void> {
        return finishSuccessfulTaskAfterVerificationExtracted(this, task, exitCode);
    }

    protected async detectEmptyAgentTurnForTask(task: QaapAgentTask): Promise<QaapEmptyAgentTurnResult> {
        return detectEmptyAgentTurnForTaskExtracted(this, task);
    }

    protected async verifySuccessfulAgentTask(task: QaapAgentTask): Promise<QaapAgentTaskVerification | undefined> {
        return verifySuccessfulAgentTaskExtracted(this, task);
    }

    protected async reviewSuccessfulAgentTask(task: QaapAgentTask, verification: QaapAgentTaskVerification | undefined,): Promise<QaapAgentTaskReview | undefined> {
        return reviewSuccessfulAgentTaskExtracted(this, task, verification);
    }

    protected resolveReviewerCandidates(task: QaapAgentTask): string[] {
        return resolveReviewerCandidatesExtracted(this, task);
    }

    protected async hasEditedFilesForVerification(task: QaapAgentTask, env: NodeJS.ProcessEnv): Promise<boolean> {
        return hasEditedFilesForVerificationExtracted(this, task, env);
    }

    protected captureWorktreeBaseline(cwd: string): Pick<QaapAgentTask, 'worktreeBaselineFingerprint' | 'worktreeBaselineStatus' | 'sensitiveBaselineHashes'> {
        return captureWorktreeBaselineExtracted(this, cwd);
    }

    /** Sensitive (gitignored) files this task changed, or `[]` when none / no baseline. */
    protected changedSensitiveFiles(task: QaapAgentTask): string[] {
        return changedSensitiveFilesHelper(task);
    }

    protected restoreBaselineSensitiveFiles(task: QaapAgentTask): string[] {
        return restoreBaselineSensitiveFilesExtracted(this, task);
    }

    /**
     * Normalized porcelain status used as a path-level baseline. Line order is sorted so two
     * equivalent dirty trees compare equal even when git emits paths in different orders.
     */
    protected captureWorktreeStatus(cwd: string): string | undefined {
        return captureWorktreeStatusHelper(cwd);
    }

    /**
     * Hash the complete tracked diff plus the identity and contents of untracked files without
     * changing the index. Git streams untracked contents in bounded path batches; repositories
     * above the explicit byte budget return undefined so callers can use the porcelain baseline
     * instead of a bare "any dirty path" probe.
     */
    protected captureWorktreeFingerprint(cwd: string): string | undefined {
        return captureWorktreeFingerprintHelper(cwd);
    }

    protected async resolveVerificationScriptsForCwd(cwd: string): Promise<string[]> {
        return resolveVerificationScriptsForCwdHelper(cwd);
    }

    protected async runVerificationScripts(task: QaapAgentTask, env: NodeJS.ProcessEnv, scripts: readonly string[], startedAt: number,): Promise<{ command: string; result: QaapGenericCommandResult } | undefined> {
        return runVerificationScriptsExtracted(this, task, env, scripts, startedAt);
    }

    protected async runAgentVerificationFixTurn(task: QaapAgentTask, env: NodeJS.ProcessEnv, failedCommand: string, failure: QaapGenericCommandResult, attempt: number, startedAt: number,): Promise<QaapGenericCommandResult | undefined> {
        return runAgentVerificationFixTurnExtracted(this, task, env, failedCommand, failure, attempt, startedAt);
    }

    protected buildAgentVerificationFixPrompt(failedCommand: string, failure: QaapGenericCommandResult, attempt: number,): string {
        return buildAgentVerificationFixPromptExtracted(this, failedCommand, failure, attempt);
    }

    runGenericCommand(command: string, cwd: string, env: NodeJS.ProcessEnv, taskId: string, timeoutMs: number, options: { readonly header?: string; readonly streamOutput?: boolean; readonly tailOutput?: boolean; readonly maxCaptureChars?: number; } = {},): Promise<QaapGenericCommandResult> {
        return runGenericCommandExtracted(this, command, cwd, env, taskId, timeoutMs, options);
    }

    protected appendBoundedCommandOutput(current: string, chunk: string, maxChars: number | undefined): string {
        return appendBoundedCommandOutputHelper(current, chunk, maxChars);
    }

    protected appendAndFireOutput(taskId: string, chunk: string): void {
        appendAndFireOutputExtracted(this, taskId, chunk);
    }

    protected isTaskStillRunning(taskId: string): boolean {
        return this.tasks.get(taskId)?.state === 'running';
    }

    protected summarizeVerificationFailure(command: string, result: QaapGenericCommandResult): string {
        return summarizeVerificationFailureExtracted(this, command, result);
    }

    protected truncateForPrompt(value: string, maxChars: number): string {
        return truncateForPromptHelper(value, maxChars);
    }

    protected truncateHead(value: string, maxChars: number): string {
        return truncateHeadHelper(value, maxChars);
    }

    protected fireOutput(taskId: string, chunk: unknown): void {
        fireOutputExtracted(this, taskId, chunk);
    }

    protected recordTaskLatencyMark(taskId: string, mark: QaapTurnLatencyMark, at = Date.now()): void {
        recordTaskLatencyMarkHelper(taskId, mark, this.tasks, at);
    }

    /**
     * All multi-tenant isolation (identity resolution, fail-closed policy, tenant provisioning, and the
     * `setpriv --clear-groups` privilege drop) lives in {@link QaapTenantSpawnService} so it is shared
     * verbatim with the preview dev server and the terminal shell — one uid registry, one drop. The
     * methods below are thin delegators kept for readable call sites and test override points.
     */
    @inject(QaapTenantSpawnService)
    protected readonly tenantSpawn: QaapTenantSpawnService;

    /** @see QaapTenantSpawnService.enforceIsolationPolicy — throws to fail the spawn when refused. */
    protected enforceAgentIsolationPolicy(): void {
        this.tenantSpawn.enforceIsolationPolicy();
    }

    /** @see QaapTenantSpawnService.resolveSpawnIdentity */
    protected resolveAgentSpawnIdentity(cwd: string): { uid?: number; gid?: number } {
        return this.tenantSpawn.resolveSpawnIdentity(cwd);
    }

    protected spawnAgentCommand(command: string, options: { cwd: string; env: NodeJS.ProcessEnv; stdio: ('pipe' | 'ignore')[]; }): ChildProcess {
        return spawnAgentCommandExtracted(this, command, options);
    }

    /** @see QaapTenantSpawnService.resolveTenantHome */
    protected resolveAgentHome(cwd: string): string {
        return this.tenantSpawn.resolveTenantHome(cwd);
    }

    /** @see QaapTenantSpawnService.prepareTenantIsolation */
    protected ensureAgentCwdOwnership(cwd: string): void {
        this.tenantSpawn.prepareTenantIsolation(cwd);
    }

    protected buildChildEnv(task: QaapAgentTask): NodeJS.ProcessEnv {
        return buildChildEnvExtracted(this, task);
    }

    protected applyOpenAiVendorCompatEnv(env: NodeJS.ProcessEnv, binding: QaapQaiqModelBinding): void {
        applyOpenAiVendorCompatEnvExtracted(this, env, binding);
    }

    protected applyQaiqProviderEnv(env: NodeJS.ProcessEnv, command: string, binding?: QaapQaiqModelBinding): void {
        applyQaiqProviderEnvExtracted(this, env, command, binding);
    }

    protected applyProviderPreferenceEnv(env: NodeJS.ProcessEnv, ownerLogin?: string): void {
        applyProviderPreferenceEnvExtracted(this, env, ownerLogin);
    }

    /** Remove provider API keys inherited from the shared process.env so they
     *  don't leak across users. Operator-level keys are intentionally stripped;
     *  each user must configure their own keys via per-user settings. */
    protected stripSharedProviderEnv(env: NodeJS.ProcessEnv): void {
        stripSharedProviderEnvHelper(env);
    }

    /** Fallback when the backend PreferenceService has no User provider (common in VPS containers).
     *  Authenticated ownerLogin reads only the per-user settings file. */
    protected readUserSettingsFromDisk(ownerLogin?: string): Record<string, unknown> {
        return readUserSettingsFromDiskHelper(ownerLogin);
    }

    protected preferenceReaderForOwner(ownerLogin?: string): QaapPreferenceReader {
        return preferenceReaderForOwnerHelper(this, ownerLogin);
    }

    /** QAIQ's OpenAI provider reads OPENAI_*; map OpenRouter prefs when needed. */
    protected applyOpenRouterOpenAiCompatEnv(env: NodeJS.ProcessEnv): void {
        applyOpenRouterOpenAiCompatEnvHelper(env);
    }

    /** QAIQ's OpenAI provider reads OPENAI_*; map NVIDIA NIM prefs when needed. */
    protected applyNvidiaOpenAiCompatEnv(env: NodeJS.ProcessEnv): void {
        applyNvidiaOpenAiCompatEnvHelper(env);
    }

    /** QAIQ's OpenAI provider reads OPENAI_*; map Hugging Face Inference Router prefs when needed. */
    protected applyHuggingfaceOpenAiCompatEnv(env: NodeJS.ProcessEnv): void {
        applyHuggingfaceOpenAiCompatEnvHelper(env);
    }

    applyHelperEnv(env: NodeJS.ProcessEnv, ownerLogin?: string, parentTaskId?: string, autoApprove?: boolean): boolean {
        return applyHelperEnvExtracted(this, env, ownerLogin, parentTaskId, autoApprove);
    }

    markTaskBlocked(id: string): QaapAgentTask | undefined {
        return markTaskBlockedExtracted(this, id);
    }

    protected finishTask(id: string, state: QaapAgentTaskState, exitCode: number | undefined): QaapAgentTask | undefined {
        return finishTaskExtracted(this, id, state, exitCode);
    }

    /**
     * Optional resolver wired by the conversation store: maps a finished task back to the
     * conversation turn that spawned it, so completion pushes can deep-link into that session.
     */
    conversationIdForTask?: (taskId: string) => string | undefined;

    protected async notifyCompletion(task: QaapAgentTask): Promise<void> {
        return notifyCompletionExtracted(this, task);
    }

    protected async readLog(id: string): Promise<string> {
        return readLogExtracted(this, id);
    }

    protected persist(): Promise<void> {
        return persistExtracted(this);
    }

    protected logPath(id: string): string {
        return path.join(STORE_DIR, `${id}.log`);
    }

    protected isDirectory(target: string): boolean {
        return isDirectoryHelper(target);
    }

    async improveComposerPrompt(options: { readonly prompt: string; readonly agentId: string; readonly agentModel?: QaapCreateAgentTaskQaiqModel; readonly cwd?: string; }): Promise<string> {
        return improveComposerPromptExtracted(this, options);
    }

    protected runOneShotCommand(command: string, cwd: string, env: NodeJS.ProcessEnv, agentId?: string, timeoutMs = 45_000,): Promise<string> {
        return runOneShotCommandExtracted(this, command, cwd, env, agentId, timeoutMs = 45_000);
    }
}
