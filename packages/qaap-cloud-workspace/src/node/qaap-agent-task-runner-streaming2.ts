import { AGENT_STOP_GRACE_TIMEOUT_MS, SHELL_AGENT_ID, QAIQ_AGENT_ID, REPO_MAP_CACHE_TTL_MS, REPO_MAP_MAX_CHARS } from './qaap-agent-task-runner-constants';
import type { QaapAgentCommandBuildResult, QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';
import { QaapAgentQueuePolicy } from './qaap-agent-queue-policy';
import { QaapAgentStorageUnavailableError } from './qaap-agent-storage-unavailable-error';
// Extracted from qaap-agent-task-runner.ts

import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import {
    isQaapAgentTaskFinished,
    type QaapCreateAgentTaskQaiqModel,
    type QaapAgentTask,
    type QaapCreateAgentTaskRequest,
} from '../common/qaap-agent-task';
import { isQaapWorkspaceContainerPath, QAAP_CONTAINER_CWD_ERROR } from '@theia/qaap-adapters/lib/common/qaap-workspace-container-path';
import {
    QAAP_BUILTIN_AGENT_IDS,
    resolveQaapBuiltinAgentMentionId,
} from '@theia/qaap-mobile-shell/lib/common/qaap-builtin-agents';
import { isQaiqAgent, resolveQaapAgentMentionToken } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-task-client';
import { localizeMissingCodingAgentMessage } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-failure-message';
import { assertAgentAllowedOnHostedRuntime } from '@theia/qaap-mobile-shell/lib/common/qaap-hosted-agent-auth-policy';
import {
    formatQaiqInteractionFlags,
    type QaapQaiqInteractionFlagOptions,
} from '@theia/qaap-mobile-shell/lib/common/qaap-qaiq-interaction-flags';
import type { QaapAgentApprovalPolicyId } from '@theia/qaap-mobile-shell/lib/common/qaap-sticky-composer-approval-policy';
import { agentUsesSettingsModelCatalog } from '../common/qaap-agent-native-model-catalog';
import { listNativeAgentModels } from './qaap-agent-native-models';
import { vendorHasByokCredential } from '@theia/qaap-mobile-shell/lib/common/qaap-qaiq-byok-provider-registry';
import {
    applyAgentApprovalPolicyToCommand,
    shouldUseQaiqStdioApprovals,
} from '../common/qaap-agent-approval-flags';
import {
    QAIQ_STDIO_APPROVAL_FLAGS,
} from '../common/qaap-qaiq-stdio-approvals';
import {
    resolveAgentAutoApprove,
} from '../common/qaap-agent-auto-approve';
import { formatModelFlagsForAgent } from '../common/qaap-agent-model-flags';
import {
    bindingFromQaiqModelSelection,
    formatQaiqProviderFlags,
    normalizeQaiqModelBinding,
    resolveQaapQaiqModelBinding,
    type QaapQaiqModelBinding,
} from '../common/qaap-qaiq-model-binding';
import { resolveTaskAgentModel } from '../common/qaap-agent-task';
import { coerceRunnableAgentModel, resolveEffectiveRequestAgentModel } from '../common/qaap-agent-task-model-routing';
import {
    parseQaapNativeModelRoutingTable,
    QAAP_AGENT_TASK_MODELS_ENV,
    type QaapNativeModelRoutingTable,
} from '../common/qaap-agent-native-model-routing';
import { appendAgentDefaultWorkflowToPrompt } from '../common/qaap-agent-default-workflow';
import { prependAgentTaskContextToPrompt, type QaapAgentRepoContext } from '../common/qaap-agent-task-context';
import { buildQaapAgentRepoProfile } from './qaap-agent-repo-profile';
import {
    applyTemplateForPromptTransport as applyTemplateForPromptTransportHelper,
    resolveAgentPromptTransport as resolveAgentPromptTransportHelper,
    writeAgentPromptFile as writeAgentPromptFileHelper,
    quoteShellArg as quoteShellArgHelper,
    resolveQaiqEnvFallbackModel as resolveQaiqEnvFallbackModelHelper,
} from './qaap-agent-task-runner-utils';

export function resolveAgentModelForRequestExtracted(ctx: QaapAgentTaskRunnerContext, request: QaapCreateAgentTaskRequest,
        prompt: string, ownerLogin?: string,): QaapCreateAgentTaskQaiqModel | undefined {
        const agentId = ctx.resolveAgentId(prompt, request.agent, ownerLogin);
        const readPref = (key: string): unknown => ctx.preferenceService?.get(key);
        // No preference guard here: only QAIQ's alias routing needs preferences, and the native-CLI
        // branch (claude & co.) must still route when none is available — the reader simply yields
        // undefined and the QAIQ path resolves to no binding, as before.
        const resolved = resolveEffectiveRequestAgentModel(
            request,
            readPref,
            agentId,
            {
                listNativeModels: id => listNativeAgentModels(id),
                nativeTable: ctx.nativeModelRoutingTable(),
            },
        );
        if (!agentUsesSettingsModelCatalog(agentId)) {
            return resolved;
        }
        const env = ctx.previewProviderEnv();
        return coerceRunnableAgentModel(
            resolved,
            readPref,
            key => env[key],
            resolveQaiqEnvFallbackModelHelper(env),
        );
}

export function nativeModelRoutingTableExtracted(ctx: QaapAgentTaskRunnerContext): QaapNativeModelRoutingTable {
        if (!ctx.cachedNativeModelRoutingTable) {
            ctx.cachedNativeModelRoutingTable = parseQaapNativeModelRoutingTable(
                process.env[QAAP_AGENT_TASK_MODELS_ENV],
            );
        }
        return ctx.cachedNativeModelRoutingTable;
}

export function createExtracted(ctx: QaapAgentTaskRunnerContext, request: QaapCreateAgentTaskRequest, ownerLogin?: string): QaapAgentTask {
        if (ctx.recoveryState === 'loading' || ctx.recoveryState === 'failed' || ctx.storageWriteFailed) {
            throw new QaapAgentStorageUnavailableError();
        }
        const prompt = (request.prompt ?? '').trim();
        const rawCommand = (request.command ?? '').trim();
        if (!prompt && !rawCommand) {
            throw new Error('A non-empty "command" or "prompt" is required.');
        }
        const cwd = path.resolve(request.cwd ?? '');
        if (!path.isAbsolute(cwd) || !ctx.isDirectory(cwd)) {
            throw new Error('A valid absolute "cwd" directory is required.');
        }
        // Last line of defence, shared by every caller (endpoints, routine runner, retries): a
        // container cwd would spawn the agent over EVERY repository the user owns at once — wrong
        // scope, and an enormous LLM context billed to them. Endpoints normally reject it earlier.
        if (isQaapWorkspaceContainerPath(cwd)) {
            throw new Error(QAAP_CONTAINER_CWD_ERROR);
        }
        const clientRequestId = typeof request.clientRequestId === 'string'
            ? request.clientRequestId.trim()
            : '';
        if (clientRequestId) {
            const dedupKey = `${ownerLogin?.trim() || '_'}:${clientRequestId}`;
            const priorId = ctx.clientRequestTaskIds?.get(dedupKey);
            const prior = priorId ? ctx.tasks.get(priorId) : undefined;
            if (prior) {
                return prior;
            }
            if (priorId) {
                ctx.clientRequestTaskIds.delete(dedupKey);
            }
        }
        const resolvedAgentId = prompt ? ctx.resolveAgentId(prompt, request.agent, ownerLogin) : SHELL_AGENT_ID;
        if (
            resolvedAgentId === SHELL_AGENT_ID
            && prompt
            && ctx.normalizeAgentId(request.agent) !== SHELL_AGENT_ID
            && ctx.extractLastAgentMention(prompt) !== SHELL_AGENT_ID
        ) {
            throw new Error(localizeMissingCodingAgentMessage());
        }
        assertAgentAllowedOnHostedRuntime(resolvedAgentId);
        const id = randomUUID();
        const parentId = request.parentId && ctx.tasks.has(request.parentId) ? request.parentId : undefined;
        const parentTask = parentId ? ctx.tasks.get(parentId) : undefined;
        const autoApprove = resolveAgentAutoApprove(
            request.autoApprove ?? (parentTask?.autoApprove !== false ? undefined : false),
        );
        const atCapacity = ctx.countRunningTasks() >= ctx.maxConcurrentAgents()
            || ctx.ownerAtConcurrencyCap(ownerLogin);
        if (atCapacity) {
            new QaapAgentQueuePolicy().assertCapacity(ctx.tasks.values(), ownerLogin);
        }
        const nextQueuePosition = atCapacity
            ? Math.max(0, ...[...ctx.tasks.values()]
                .filter((task: QaapAgentTask) => task.state === 'queued')
                .map((task: QaapAgentTask) => task.queuePosition)
                .filter((position: unknown): position is number => typeof position === 'number' && Number.isFinite(position))) + 1
            : undefined;
        if (ownerLogin && ctx.billingStore) {
            void ctx.billingStore.getOrCreateAccount(ownerLogin).catch(() => undefined);
        }
        const createdAt = Date.now();
        const task: QaapAgentTask = {
            id,
            agentId: resolvedAgentId,
            title: (request.title ?? '').trim() || prompt || rawCommand,
            command: rawCommand || prompt,
            cwd,
            state: atCapacity ? 'queued' : 'running',
            createdAt,
            ...(atCapacity ? {} : { startedAt: createdAt }),
            ...(nextQueuePosition !== undefined ? { queuePosition: nextQueuePosition } : {}),
            parentId,
            autoApprove,
            ...(request.readOnlyWorkspace ? { readOnlyWorkspace: true } : {}),
            ...(request.externalReview ? { externalReview: true } : {}),
            ...(ownerLogin ? { ownerLogin: ownerLogin.trim() } : {}),
            ...(clientRequestId ? { clientRequestId } : {}),
            ...(request.resumedFromTaskId ? { resumedFromTaskId: request.resumedFromTaskId } : {}),
            ...(request.latencyMarks ? { latencyMarks: request.latencyMarks } : {}),
            ...(() => {
                const agentModel = ctx.resolveAgentModelForRequest(request, prompt || rawCommand, ownerLogin);
                return agentModel ? { agentModel, qaiqModel: agentModel } : {};
            })(),
        };
        ctx.tasks.set(id, task);
        if (clientRequestId) {
            const dedupKey = `${ownerLogin?.trim() || '_'}:${clientRequestId}`;
            ctx.clientRequestTaskIds ??= new Map();
            ctx.clientRequestTaskIds.set(dedupKey, id);
            while (ctx.clientRequestTaskIds.size > 512) {
                const oldest = ctx.clientRequestTaskIds.keys().next().value;
                if (oldest === undefined) {
                    break;
                }
                ctx.clientRequestTaskIds.delete(oldest);
            }
        }
        if (atCapacity) {
            ctx.queuedCreateRequests.set(id, request);
        } else {
            void ctx.spawnProcessWhenReady(task, request);
        }
        void ctx.persist();
        ctx.onDidChangeTaskEmitter.fire({ type: 'created', task });
        return task;
}

/**
 * Rebuild a standalone task from its durable, already-authorized task record. The persisted
 * command is the original prompt for coding agents and the original shell command for `shell`;
 * retrying from the browser must never depend on a truncated WebSocket payload.
 */
export function retryExtracted(ctx: QaapAgentTaskRunnerContext, id: string, ownerLogin?: string): QaapAgentTask | undefined {
        const task = ctx.tasks.get(id) as QaapAgentTask | undefined;
        if (!task || (task.state !== 'failed' && task.state !== 'interrupted')) {
            return undefined;
        }
        const agentId = ctx.resolveTaskAgentId(task);
        const request: QaapCreateAgentTaskRequest = agentId === SHELL_AGENT_ID
            ? {
                title: task.title,
                command: task.command,
                cwd: task.cwd,
                parentId: task.parentId,
                autoApprove: task.autoApprove,
                readOnlyWorkspace: task.readOnlyWorkspace,
                externalReview: task.externalReview,
            }
            : {
                title: task.title,
                prompt: task.command,
                agent: agentId,
                cwd: task.cwd,
                agentModel: resolveTaskAgentModel(task),
                qaiqModel: resolveTaskAgentModel(task),
                parentId: task.parentId,
                autoApprove: task.autoApprove,
                readOnlyWorkspace: task.readOnlyWorkspace,
                externalReview: task.externalReview,
            };
        return ctx.create(request, task.ownerLogin ?? ownerLogin);
}

/** Continue an interrupted task once, rebuilding it from the durable original request. */
export function resumeExtracted(ctx: QaapAgentTaskRunnerContext, id: string, ownerLogin?: string): QaapAgentTask | undefined {
        const task = ctx.tasks.get(id) as QaapAgentTask | undefined;
        if (!task || task.state !== 'interrupted') {
            return undefined;
        }
        const persistedReplacement = [...ctx.tasks.values()].find((candidate: QaapAgentTask) =>
            candidate.resumedFromTaskId === id && !isQaapAgentTaskFinished(candidate.state));
        if (persistedReplacement) {
            return persistedReplacement;
        }
        const priorId = ctx.resumingTaskIds?.get(id);
        const prior = priorId ? ctx.tasks.get(priorId) : undefined;
        if (prior && !isQaapAgentTaskFinished(prior.state)) {
            return prior;
        }
        if (priorId) {
            ctx.resumingTaskIds.delete(id);
        }
        const agentId = ctx.resolveTaskAgentId(task);
        const request: QaapCreateAgentTaskRequest = agentId === SHELL_AGENT_ID
            ? {
                title: task.title,
                command: task.command,
                cwd: task.cwd,
                parentId: task.parentId,
                autoApprove: task.autoApprove,
                readOnlyWorkspace: task.readOnlyWorkspace,
                externalReview: task.externalReview,
                resumedFromTaskId: id,
            }
            : {
                title: task.title,
                prompt: task.command,
                agent: agentId,
                cwd: task.cwd,
                agentModel: resolveTaskAgentModel(task),
                qaiqModel: resolveTaskAgentModel(task),
                parentId: task.parentId,
                autoApprove: task.autoApprove,
                readOnlyWorkspace: task.readOnlyWorkspace,
                externalReview: task.externalReview,
                resumedFromTaskId: id,
            };
        const resumed = ctx.create(request, task.ownerLogin ?? ownerLogin);
        ctx.resumingTaskIds ??= new Map();
        ctx.resumingTaskIds.set(id, resumed.id);
        return resumed;
}

export function buildAgentCommandExtracted(ctx: QaapAgentTaskRunnerContext, prompt: string,
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
        ownerLogin?: string,): QaapAgentCommandBuildResult {
        const id = ctx.resolveAgentId(prompt, agentId, ownerLogin);
        const runnerPrompt = ctx.stripLeadingAgentMention(prompt);
        if (id === SHELL_AGENT_ID) {
            return { command: runnerPrompt, agentId: id };
        }
        const workflowPrompt = appendAgentDefaultWorkflowToPrompt(
            runnerPrompt,
            id,
            {
                gitAvailable: cwd ? fs.existsSync(path.join(path.resolve(cwd), '.git')) : true,
                userQuery,
            },
        );
        // Inject important project context for every agent: cross-project context from the request
        // body, the per-project info artifact, the repo's own agent instructions (CLAUDE.md /
        // AGENTS.md), and a shallow repo map — so a stateless CLI starts warm instead of cold.
        const resolvedCwd = cwd ? path.resolve(cwd) : undefined;
        const repoContext: QaapAgentRepoContext | undefined = resolvedCwd
            ? {
                agentInstructions: ctx.readAgentInstructions(resolvedCwd),
                repoMap: ctx.readRepoMap(resolvedCwd),
                relevantFiles: ctx.readRelevantFiles(resolvedCwd, userQuery),
                gitStatus: ctx.readGitStatusSnapshot(resolvedCwd),
                repoMemory: ctx.readRepoMemory(resolvedCwd),
                researchLedger: ctx.readResearchLedger(resolvedCwd),
            }
            : undefined;
        const agentPrompt = prependAgentTaskContextToPrompt(
            workflowPrompt,
            contextPreamble,
            resolvedCwd ? ctx.readProjectInfo(resolvedCwd) : undefined,
            repoContext,
        );
        ctx.assertQaiqConfigured(id);
        const detected = ctx.detectedAgents.get(id);
        let command: string;
        const interaction: QaapQaiqInteractionFlagOptions = {
            interactionModeId,
            approvalPolicyId: approvalPolicyId === 'approve-for-me'
                ? undefined
                : approvalPolicyId as QaapAgentApprovalPolicyId | undefined,
            autoApprove: autoApprove ? true : false,
        };
        const approvalOptions = {
            agentId: id,
            approvalPolicyId: approvalPolicyId as QaapAgentApprovalPolicyId | undefined,
            autoApprove,
            interactionModeId,
            toolApprovalRules,
            readOnlyWorkspace,
            codexSupportsApproveForMe: detected?.codexSupportsApproveForMe,
        };
        // A read-only turn is never routed through the interactive stdio approval flow: that flow
        // exists so a human can say yes to a write, and on a read-only turn there is no write to say
        // yes to. Letting it through would also append QAIQ_STDIO_APPROVAL_FLAGS after the read-only
        // flags and hand the permission decision back to the model's own prompt.
        const envTemplate = detected ? undefined : process.env.QAAP_AGENT_COMMAND?.trim();
        const usesQaiqProtocol = !!detected
            ? id === QAIQ_AGENT_ID || detected.bin === 'qaiq' || detected.bin === 'openclaude'
            : !!envTemplate && ctx.isQaiqRunner(id, envTemplate);
        const useStdioApprovals = usesQaiqProtocol
            && !readOnlyWorkspace
            && shouldUseQaiqStdioApprovals(approvalOptions);
        const promptTransport = resolveAgentPromptTransportHelper(id, detected ?? (envTemplate
            ? { id, template: envTemplate }
            : undefined));
        const usesOffArgvPrompt = promptTransport.kind !== 'argv';
        if (detected) {
            const vars = ctx.buildTemplateVars(id, agentModel, interaction);
            command = useStdioApprovals
                ? ctx.applyTemplateWithoutPrompt(detected.template, vars)
                : usesOffArgvPrompt
                    ? applyTemplateForPromptTransportHelper(detected.template, promptTransport, vars)
                    : ctx.applyTemplate(detected.template, agentPrompt, vars);
        } else if (envTemplate) {
            const vars = ctx.buildTemplateVars(id, agentModel, interaction);
            command = useStdioApprovals || usesOffArgvPrompt
                ? applyTemplateForPromptTransportHelper(envTemplate, useStdioApprovals
                    ? { kind: 'plain-stdin', placeholder: 'omit' }
                    : promptTransport, vars)
                : ctx.applyTemplate(envTemplate, agentPrompt, vars);
        } else {
            command = agentPrompt;
        }
        let promptTempDir: string | undefined;
        if (promptTransport.kind === 'prompt-file' && !useStdioApprovals) {
            const written = writeAgentPromptFileHelper(agentPrompt);
            promptTempDir = written.dir;
            command = `${command} ${promptTransport.flag} ${quoteShellArgHelper(written.file)}`;
        }
        command = applyAgentApprovalPolicyToCommand(command, approvalOptions);
        if (useStdioApprovals) {
            return {
                command: `${command} ${QAIQ_STDIO_APPROVAL_FLAGS}`,
                stdinPrompt: agentPrompt,
                stdinPromptMode: 'qaiq-stdio',
                agentId: id,
                promptTempDir,
            };
        }
        if (promptTransport.kind === 'plain-stdin') {
            return { command, stdinPrompt: agentPrompt, stdinPromptMode: 'plain', agentId: id, promptTempDir };
        }
        return { command, agentId: id, promptTempDir };
}

export function readProjectInfoExtracted(ctx: QaapAgentTaskRunnerContext, cwd: string): string | undefined {
        const resolved = path.resolve(cwd);
        if (ctx.projectInfoCache.has(resolved)) {
            return ctx.projectInfoCache.get(resolved);
        }
        const info = ctx.loadProjectInfoFromDisk(resolved);
        ctx.projectInfoCache.set(resolved, info);
        return info;
}

export function readAgentInstructionsExtracted(ctx: QaapAgentTaskRunnerContext, cwd: string): string | undefined {
        const resolved = path.resolve(cwd);
        if (ctx.agentInstructionsCache.has(resolved)) {
            return ctx.agentInstructionsCache.get(resolved);
        }
        const info = ctx.loadAgentInstructionsFromDisk(resolved);
        ctx.agentInstructionsCache.set(resolved, info);
        return info;
}

export function readRepoMapExtracted(ctx: QaapAgentTaskRunnerContext, cwd: string): string | undefined {
        const resolved = path.resolve(cwd);
        const cached = ctx.repoMapCache.get(resolved);
        if (cached && Date.now() - cached.at < REPO_MAP_CACHE_TTL_MS) {
            return cached.text;
        }
        const text = ctx.buildRepoMap(resolved);
        ctx.repoMapCache.set(resolved, { text, at: Date.now() });
        return text;
}

export function buildRepoMapExtracted(ctx: QaapAgentTaskRunnerContext, cwd: string): string | undefined {
        const sections: string[] = [];
        const profile = buildQaapAgentRepoProfile(cwd);
        if (profile) {
            sections.push(profile);
        }
        const tree = ctx.buildRepoTree(cwd);
        if (tree) {
            sections.push(tree);
        }
        const changed = ctx.buildRecentlyChangedFiles(cwd);
        if (changed) {
            sections.push(changed);
        }
        if (sections.length === 0) {
            return undefined;
        }
        const text = sections.join('\n\n');
        return text.length > REPO_MAP_MAX_CHARS
            ? `${text.slice(0, REPO_MAP_MAX_CHARS - 1).trimEnd()}…`
            : text;
}

export function resolveAgentIdExtracted(ctx: QaapAgentTaskRunnerContext, prompt: string, agentId: string | undefined, ownerLogin?: string): string {
        const ensureEnabled = (resolved: string): string => {
            assertAgentAllowedOnHostedRuntime(resolved);
            if (ctx.isAgentEnabled && !ctx.isAgentEnabled(resolved, ownerLogin)) {
                throw new Error(`Agent "${resolved}" is disabled in Harness configuration.`);
            }
            return resolved;
        };
        const explicit = ctx.normalizeAgentId(agentId);
        if (explicit) {
            return ensureEnabled(explicit);
        }
        if (agentId?.trim()) {
            assertAgentAllowedOnHostedRuntime(agentId);
            throw new Error(`Agent "${agentId.trim()}" is not available on this server.`);
        }
        const mentioned = ctx.extractLastAgentMention(prompt);
        if (mentioned) {
            return ensureEnabled(mentioned);
        }
        const unavailableMention = ctx.extractLastAgentMentionToken(prompt);
        if (unavailableMention) {
            assertAgentAllowedOnHostedRuntime(unavailableMention);
            throw new Error(`Agent "@${unavailableMention}" is not available on this server.`);
        }
        const fallback = ctx.defaultAgent(ownerLogin);
        assertAgentAllowedOnHostedRuntime(fallback);
        return fallback;
}

export function extractLastAgentMentionExtracted(ctx: QaapAgentTaskRunnerContext, prompt: string): string | undefined {
        const regex = /@([a-z][\w-]*)/gi;
        let last: string | undefined;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(prompt)) !== null) {
            const normalized = ctx.normalizeMentionToken(match[1]);
            if (normalized) {
                last = normalized;
            }
        }
        return last;
}

export function extractLastAgentMentionTokenExtracted(ctx: QaapAgentTaskRunnerContext, prompt: string): string | undefined {
        const regex = /@([a-z][\w-]*)/gi;
        let last: string | undefined;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(prompt)) !== null) {
            const token = resolveQaapAgentMentionToken(match[1]);
            if (
                token === QAIQ_AGENT_ID
                || token === SHELL_AGENT_ID
                || QAAP_BUILTIN_AGENT_IDS.has(token)
                || resolveQaapBuiltinAgentMentionId(token)
                || ctx.detectedAgents.has(token)
            ) {
                last = resolveQaapBuiltinAgentMentionId(token) ?? token;
            }
        }
        return last;
}

export function stripLeadingAgentMentionExtracted(ctx: QaapAgentTaskRunnerContext, prompt: string): string {
        const match = /^@([a-z][\w-]*)\b\s*/i.exec(prompt);
        if (match && ctx.normalizeMentionToken(match[1])) {
            return prompt.slice(match[0].length).trim() || prompt.trim();
        }
        return prompt.trim();
}

export function buildTemplateVarsExtracted(ctx: QaapAgentTaskRunnerContext, agentId: string,
        agentModel?: QaapCreateAgentTaskQaiqModel,
        interaction?: QaapQaiqInteractionFlagOptions,): Record<string, string> {
        const empty = { qaiq_flags: '', model_flags: '' };
        // QAIQ and OpenClaude share the stream-json/approval protocol, but only QAIQ owns the
        // Settings → AI Features model catalog. Reusing isQaiqAgent here would make OpenClaude
        // silently inherit QAIQ's configured model whenever no explicit OpenClaude model was sent.
        const usesQaiqSettingsCatalog = agentUsesSettingsModelCatalog(agentId);
        const qaiqInteractionFlags = isQaiqAgent(agentId)
            ? formatQaiqInteractionFlags(interaction ?? {})
            : '';
        const joinQaiqFlags = (...parts: string[]): string => parts.map(part => part.trim()).filter(Boolean).join(' ');
        if (agentModel?.provider && agentModel.modelId?.trim()) {
            const binding = ctx.normalizeAgentBinding(bindingFromQaiqModelSelection(agentModel));
            const flags = formatModelFlagsForAgent(agentId, binding);
            if (isQaiqAgent(agentId)) {
                return { qaiq_flags: joinQaiqFlags(qaiqInteractionFlags, flags), model_flags: '' };
            }
            return { qaiq_flags: '', model_flags: flags };
        }
        if (usesQaiqSettingsCatalog) {
            return { qaiq_flags: joinQaiqFlags(qaiqInteractionFlags, ctx.resolveQaiqProviderFlags()), model_flags: '' };
        }
        return empty;
}

export function resolveQaiqProviderFlagsExtracted(ctx: QaapAgentTaskRunnerContext): string {
        const env = ctx.previewProviderEnv();
        const binding = ctx.resolveQaapQaiqBinding();
        if (binding && vendorHasByokCredential(
            ctx.preferenceReaderForOwner(undefined),
            binding.vendor,
            key => env[key],
        )) {
            return formatQaiqProviderFlags(binding);
        }
        return ctx.resolveQaiqProviderFlagsFromEnv(env);
}

export function resolveQaapQaiqBindingExtracted(ctx: QaapAgentTaskRunnerContext, ownerLogin?: string): QaapQaiqModelBinding | undefined {
        return resolveQaapQaiqModelBinding(ctx.preferenceReaderForOwner(ownerLogin));
}

export function resolveAgentBindingForTaskExtracted(ctx: QaapAgentTaskRunnerContext, task: QaapAgentTask): QaapQaiqModelBinding | undefined {
        const selected = resolveTaskAgentModel(task);
        if (selected?.provider && selected.modelId?.trim()) {
            return ctx.normalizeAgentBinding(bindingFromQaiqModelSelection(selected), task.ownerLogin);
        }
        // OpenClaude is a QAIQ-protocol runner, not a QAIQ Settings runner. Without this guard a
        // task with no explicit OpenClaude model would receive QAIQ's alias/provider binding.
        if (agentUsesSettingsModelCatalog(task.agentId)
            || (!task.agentId && /\bqaiq\b/.test(task.command) && !/\bopenclaude\b/.test(task.command))) {
            const binding = ctx.resolveQaapQaiqBinding(task.ownerLogin);
            return binding ? ctx.normalizeAgentBinding(binding, task.ownerLogin) : undefined;
        }
        return undefined;
}

export function normalizeAgentBindingExtracted(ctx: QaapAgentTaskRunnerContext, binding: QaapQaiqModelBinding, ownerLogin?: string): QaapQaiqModelBinding {
        return normalizeQaiqModelBinding(binding, ctx.preferenceReaderForOwner(ownerLogin));
}

export function previewProviderEnvExtracted(ctx: QaapAgentTaskRunnerContext): NodeJS.ProcessEnv {
        const env: NodeJS.ProcessEnv = { ...process.env };
        ctx.applyProviderPreferenceEnv(env, undefined);
        return env;
}

export function assertQaiqConfiguredExtracted(ctx: QaapAgentTaskRunnerContext, agentId: string): void {
        // OpenClaude has its own model/auth configuration. The shared stream protocol does not
        // make QAIQ's Settings catalog a prerequisite for running it.
        if (!agentUsesSettingsModelCatalog(agentId)) {
            return;
        }
        const env = ctx.previewProviderEnv();
        if (ctx.resolveQaiqProviderFlags()) {
            return;
        }
        if (env.ANTHROPIC_API_KEY?.trim() || env.OPENAI_API_KEY?.trim()) {
            return;
        }
        throw new Error(
            'QAIQ/OpenClaude needs an API key from QAAP Settings (Gemini, OpenRouter, NVIDIA, Ollama, OpenAI, or Anthropic) '
            + 'or from server env (e.g. OPENROUTER_API_KEY / GEMINI_API_KEY in .env on Docker). '
            + 'Add one, restart the server, then retry.'
        );
}

export function cancelExtracted(ctx: QaapAgentTaskRunnerContext, id: string): QaapAgentTask | undefined {
        const child = ctx.processes.get(id);
        ctx.queuedCreateRequests.delete(id);
        const task = ctx.tasks.get(id);
        if (task && (task.state === 'running' || task.state === 'queued')) {
            if (child) {
                ctx.stoppingTaskIds.add(id);
            }
            const finished = ctx.finishTask(id, 'cancelled', undefined);
            if (child) {
                // Cancellation is visible immediately, but retain the concurrency slot until the
                // process group has had time to finish an in-flight workspace write safely.
                ctx.killAgentProcessTree(child, {
                    escalateAfterMs: AGENT_STOP_GRACE_TIMEOUT_MS,
                    onGracePeriodElapsed: () => {
                        ctx.stoppingTaskIds.delete(id);
                        ctx.drainQueuedTasks();
                    },
                });
            } else {
                ctx.drainQueuedTasks();
            }
            return finished;
        }
        if (child) {
            ctx.killAgentProcessTree(child, { escalateAfterMs: AGENT_STOP_GRACE_TIMEOUT_MS });
        }
        return task;
}

/** Remove every persisted task rooted in a project after the user confirms project deletion. */
export function deleteForCwdExtracted(ctx: QaapAgentTaskRunnerContext, cwd: string): number {
        const root = cwd.trim().replace(/\\+$/, '');
        if (!root) {
            return 0;
        }
        const ids = [...ctx.tasks.values()]
            .filter(task => task.cwd === root || task.cwd.startsWith(`${root}/`))
            .map(task => task.id);
        for (const id of ids) {
            const task = ctx.tasks.get(id);
            if (!task) {
                continue;
            }
            const hadProcess = ctx.processes.has(id);
            if (task.state === 'running' || task.state === 'queued') {
                ctx.cancel(id);
            }
            if (hadProcess) {
                ctx.deletedTaskIds.add(id);
            }
            ctx.tasks.delete(id);
            ctx.queuedCreateRequests.delete(id);
            ctx.processes.delete(id);
            ctx.stdinInteractiveTasks.delete(id);
            ctx.stdinPrompts.delete(id);
            ctx.pendingQaiqControlRequests.delete(id);
            ctx.clearQueuedApprovalTimers(id);
            ctx.qaiqStdioTasks.delete(id);
            void fsp.rm(ctx.logPath(id), { force: true }).catch(() => undefined);
            ctx.onDidChangeTaskEmitter.fire({ type: 'deleted', task });
            if (!hadProcess) {
                ctx.deletedTaskIds.delete(id);
            }
        }
        for (const cache of [ctx.projectNameCache, ctx.projectInfoCache, ctx.agentInstructionsCache, ctx.repoMapCache]) {
            for (const key of cache.keys()) {
                if (key === root || key.startsWith(`${root}/`)) {
                    cache.delete(key);
                }
            }
        }
        if (ids.length > 0) {
            void ctx.persist();
        }
        return ids.length;
}
