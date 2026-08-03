// @ts-nocheck
// Extracted from qaap-agent-task-runner.ts

import { Emitter, Event } from '@theia/core/lib/common/event';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { inject, injectable, optional, postConstruct } from '@theia/core/shared/inversify';
import { ChildProcess, spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { writeJsonAtomic, writeJsonAtomicSync } from './qaap-write-json-atomic';
import * as os from 'os';
import * as path from 'path';
import {
    buildImproveComposerPromptRequest,
} from '@theia/qaap-mobile-shell/lib/common/qaap-composer-prompt-improve';
import {
    isQaapAgentTaskFinished,
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
import { isQaapWorkspaceContainerPath, QAAP_CONTAINER_CWD_ERROR } from '@theia/qaap-adapters/lib/common/qaap-workspace-container-path';
import type { QaapTurnLatencyMark } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-stream-metrics';
import {
    QAAP_BUILTIN_AGENT_DEFINITIONS,
    QAAP_BUILTIN_AGENT_IDS,
    isUiHiddenVpsAgent,
    resolveQaapBuiltinAgentMentionId,
    resolveQaapCodexTemplate,
} from '@theia/qaap-mobile-shell/lib/common/qaap-builtin-agents';
import { LEGACY_OPENCLAUDE_AGENT_ID, resolveQaapAgentMentionToken } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-task-client';
import {
    formatQaiqInteractionFlags,
    type QaapQaiqInteractionFlagOptions,
} from '@theia/qaap-mobile-shell/lib/common/qaap-qaiq-interaction-flags';
import type { QaapAgentApprovalPolicyId } from '@theia/qaap-mobile-shell/lib/common/qaap-sticky-composer-approval-policy';
import { agentUsesSettingsModelCatalog } from '../common/qaap-agent-native-model-catalog';
import { QaapTenantSpawnService } from './qaap-tenant-spawn-service';
import { listNativeAgentModels } from './qaap-agent-native-models';
import { listQaiqModelsFromPreferences } from '@theia/qaap-mobile-shell/lib/common/qaap-qaiq-model-catalog';
import {
    applyAgentApprovalPolicyToCommand,
    shouldUseQaiqStdioApprovals,
} from '../common/qaap-agent-approval-flags';
import {
    type QaapAgentReadOnlyEnforcement,
} from '../common/qaap-agent-readonly-workspace';
import {
    QAIQ_STDIO_APPROVAL_FLAGS,
    buildQaiqControlResponseLine,
    buildQaiqStdioPromptLine,
    parseQaiqStdioEvent,
    type QaapQaiqPendingControlRequest,
} from '../common/qaap-qaiq-stdio-approvals';
import { findQaiqDestructiveCommandGuardDenial } from '../common/qaap-agent-destructive-command-guard';
import { findQaiqDevServerGuardDenial } from '../common/qaap-agent-dev-server-guard';
import { detectEmptyAgentTurn, type QaapEmptyAgentTurnResult } from '../common/qaap-agent-empty-turn';
import {
    buildQaiqAutoDeniedToolMessage,
    buildQaiqQueuedApprovalTimeoutMessage,
    resolveQaiqControlRequestAutoAction,
} from '../common/qaap-qaiq-control-auto-response';
import {
    resolveAgentAutoApprove,
} from '../common/qaap-agent-auto-approve';
import { filterAgentProcessLogChunk } from '../common/qaap-agent-log-filter';
import { formatModelFlagsForAgent } from '../common/qaap-agent-model-flags';
import {
    applyQaapQaiqCredentialEnv,
    applyQaapQaiqModelEnv,
    bindingFromQaiqModelSelection,
    formatQaiqProviderFlags,
    normalizeQaiqModelBinding,
    resolveQaapQaiqModelBinding,
    type QaapQaiqModelBinding,
} from '../common/qaap-qaiq-model-binding';
import { resolveRequestAgentModel, resolveTaskAgentModel } from '../common/qaap-agent-task';
import { resolveEffectiveRequestAgentModel } from '../common/qaap-agent-task-model-routing';
import {
    parseQaapNativeModelRoutingTable,
    QAAP_AGENT_TASK_MODELS_ENV,
    type QaapNativeModelRoutingTable,
} from '../common/qaap-agent-native-model-routing';
import { appendAgentDefaultWorkflowToPrompt } from '../common/qaap-agent-default-workflow';
import { prependAgentTaskContextToPrompt, type QaapAgentRepoContext } from '../common/qaap-agent-task-context';
import {
    applyAntigravityModelSetting,
    isAntigravityCliCommand,
} from './qaap-antigravity-settings';
import { QaapWebPushService } from './qaap-web-push-service';
import { QaapWorkflowRoutingPolicy } from '../common/qaap-workflow-routing';
import { QaapAgentHealthTracker } from './qaap-agent-health';
import { hashSensitiveFiles, restoreSensitiveFiles, snapshotSensitiveFiles } from './qaap-sensitive-files';
import { buildQaapAgentRepoProfile } from './qaap-agent-repo-profile';
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
    findPendingControlRequestEntry as findPendingControlRequestEntryHelper,
} from './qaap-agent-task-runner-utils';
import {
    parseCustomAgent as parseCustomAgentHelper,
    maxConcurrentAgents as maxConcurrentAgentsHelper,
    maxConcurrentAgentsPerUser as maxConcurrentAgentsPerUserHelper,
    buildRepoTree as buildRepoTreeHelper,
    buildRecentlyChangedFiles as buildRecentlyChangedFilesHelper,
    readGitStatusSnapshot as readGitStatusSnapshotHelper,
    captureWorktreeStatus as captureWorktreeStatusHelper,
    captureWorktreeFingerprint as captureWorktreeFingerprintHelper,
    resolveVerificationScriptsForCwd as resolveVerificationScriptsForCwdHelper,
    appendBoundedCommandOutput as appendBoundedCommandOutputHelper,
    readUserSettingsFromDisk as readUserSettingsFromDiskHelper,
    stripSharedProviderEnv as stripSharedProviderEnvHelper,
} from './qaap-agent-task-runner-utils2';
import {
    readRelevantFiles as readRelevantFilesHelper,
    reapAgentProcessGroupAfterExit as reapAgentProcessGroupAfterExitHelper,
    resolveProjectName as resolveProjectNameHelper,
    listAgents as listAgentsHelper,
    probeAgentBinOnce as probeAgentBinOnceHelper,
    recordTaskLatencyMark as recordTaskLatencyMarkHelper,
    reviewSuccessfulAgentTask as reviewSuccessfulAgentTaskHelper,
    runOneShotCommand as runOneShotCommandHelper,
    verifySuccessfulAgentTask as verifySuccessfulAgentTaskHelper,
    QAAP_AGENT_VERIFY_MAX_ATTEMPTS,
    QAAP_AGENT_VERIFY_WALL_CLOCK_MS,
} from './qaap-agent-task-runner-utils3';

export function runOneShotCommandExtracted(ctx: any, command: string,
        cwd: string,
        env: NodeJS.ProcessEnv,
        agentId?: string,
        timeoutMs = 45_000,): Promise<string> {
        return runOneShotCommandHelper(command, cwd, env, agentId, timeoutMs, {
            enforceAgentIsolationPolicy: () => ctx.enforceAgentIsolationPolicy(),
            ensureAgentCwdOwnership: c => ctx.ensureAgentCwdOwnership(c),
            spawnAgentCommand: (cmd, opts) => ctx.spawnAgentCommand(cmd, opts),
            killAgentProcessTree: c => ctx.killAgentProcessTree(c),
            reapAgentProcessGroupAfterExit: c => ctx.reapAgentProcessGroupAfterExit(c),
        });
}

