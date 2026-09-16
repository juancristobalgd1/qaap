// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { bindRootContributionProvider } from '@theia/core';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { MessagingListenerContribution } from '@theia/core/lib/node/messaging/messaging-listeners';
import { FileSystemProvider } from '@theia/filesystem/lib/common/files';
import { DiskFileSystemProvider } from '@theia/filesystem/lib/node/disk-file-system-provider';
import { NodeFileUploadService } from '@theia/filesystem/lib/node/upload/node-file-upload-service';
import { WorkspaceServer } from '@theia/workspace/lib/common';
import { DefaultWorkspaceServer } from '@theia/workspace/lib/node/default-workspace-server';
import { IShellTerminalServer, IShellTerminalServerOptions } from '@theia/terminal/lib/common/shell-terminal-protocol';
import { ShellProcess, getRootPath } from '@theia/terminal/lib/node/shell-process';
import { parseArgs } from '@theia/process/lib/node/utils';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { MultiKeyMap } from '@theia/core/lib/common/collections';
import URI from '@theia/core/lib/common/uri';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { promises as fs } from 'fs';
import {
    QAAP_ANONYMOUS_USER_LOGIN,
    normalizeIsolationPath,
} from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { QaapNodeFileUploadService } from './qaap-node-file-upload-service';
import { QaapAgentApprovalEndpoint } from './qaap-agent-approval-endpoint';
import { QaapAgentApprovalStore } from './qaap-agent-approval-store';
import { QaapAgentConversationEndpoint } from './qaap-agent-conversation-endpoint';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';
import { QaapAgentTaskEndpoint } from './qaap-agent-task-endpoint';
import { QaapUserAiSettingsEndpoint } from './qaap-user-ai-settings-endpoint';
import { QaapBillingEndpoint } from './qaap-billing-endpoint';
import { QaapBillingStore } from './qaap-billing-store';
import { QaapBillingQuotaService } from './qaap-billing-quota-service';
import { QaapBillingQuota } from '@theia/qaap-adapters/lib/common/qaap-billing-quota';
import { QaapAgentCliUpdateService } from './qaap-agent-cli-update-service';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import { QaapWorktreeGcContribution } from './qaap-worktree-gc';
import { QaapCloudOrchestrator } from './qaap-cloud-orchestrator';
import { QaapCloudWorkspaceEndpoint } from './qaap-cloud-workspace-endpoint';
import { QaapCloudWorkspaceStore } from './qaap-cloud-workspace-store';
import { QaapConversationWorktreeService } from './qaap-conversation-worktree';
import { QaapDeployRunner } from './qaap-deploy-runner';
import { QaapDockerOrchestrator } from './qaap-docker-orchestrator';
import { QaapHeadlessVisualCaptureService } from './qaap-headless-visual-capture';
import { QaapParallelRunEndpoint } from './qaap-parallel-run-endpoint';
import { QaapParallelRunStore } from './qaap-parallel-run-store';
import { QaapPreviewShareStore } from './qaap-preview-share-store';
import { QaapPreviewSupervisor } from './qaap-preview-supervisor';
import { QaapPushSubscriptionStore } from './qaap-push-subscription-store';
import { QaapResearchEndpoint } from './qaap-research-endpoint';
import { QaapResearchRunner } from './qaap-research-runner';
import { QaapResearchStore } from './qaap-research-store';
import { QaapTenantSpawnService } from './qaap-tenant-spawn-service';
import { QaapTerminalSessionStore } from './qaap-terminal-session-store';
import { QaapPreviewShareProxyContribution } from './qaap-preview-share-proxy';
import { QaapWebPushService } from './qaap-web-push-service';
import { QaapWorkHubRoutineEndpoint } from './qaap-work-hub-routine-endpoint';
import { QaapWorkHubRoutineRunner } from './qaap-work-hub-routine-runner';
import { QaapWorkHubRoutineScheduler } from './qaap-work-hub-routine-scheduler';
import { QaapWorkHubRoutineStore } from './qaap-work-hub-routine-store';
import { QaapHostedWorkspaceServer } from './qaap-hosted-workspace-server';
import { QaapTenantDiskFileSystemProvider } from './qaap-tenant-disk-file-system-provider';
import { QaapWebsocketAuthListener } from './qaap-websocket-auth-listener';
import { QaapWebsocketAuthRegistry } from './qaap-websocket-auth-registry';
import { QaapMessagingAuthContribution } from './qaap-messaging-auth-contribution';
import { QaapJobEndpoint } from './qaap-job-endpoint';
import { QaapJobRuntime } from './qaap-job-runtime';
import {
    QaapBuiltinJobFunctions,
    QaapJobFunctionContribution,
    QaapJobFunctionRegistry,
} from './qaap-job-function-registry';
import { QaapAgentHealthTracker } from './qaap-agent-health';
import { QAAP_CHAT_TURN_WORKFLOW_ID } from '../common/qaap-chat-turn-workflow';
import { QaapWorkflowPromptRegistry } from '../common/qaap-workflow-prompt-registry';
import { QaapWorkflowRoutingPolicy, parseQaapWorkflowRoutingTable } from '../common/qaap-workflow-routing';
import { QaapWorkflowTemplateRegistry } from '../common/qaap-workflow-template-registry';
import { QaapWorkflowDispatcher } from './qaap-workflow-dispatcher';
import { QaapWorkflowEndpoint } from './qaap-workflow-endpoint';
import { QaapWorkflowJobFunctions } from './qaap-workflow-job-functions';
import { QaapWorkflowRunStore } from './qaap-workflow-run-store';
import {
    QaapWorkflowAgentTurnAdapter,
    QaapWorkflowDeterministicAdapter,
} from './qaap-workflow-runtime-ports';
import { QaapWorkflowService } from './qaap-workflow-service';
import { ProcessManager } from '@theia/process/lib/node';
import { QaapTerminalOwnership, installQaapTerminalOwnership } from './qaap-terminal-ownership';
import { QaapDockerControlPlaneContribution } from './qaap-docker-control-plane-contribution';
import { QaapTenantActivityContribution } from './qaap-tenant-activity-contribution';
import { QaapTenantActivityTracker } from './qaap-tenant-activity-tracker';
import { QaapTenantContainerReaper } from './qaap-tenant-container-reaper';
import { QaapTenantRuntimeEndpoint } from './qaap-tenant-runtime-endpoint';
import { QaapTenantRuntimeMetrics } from './qaap-tenant-runtime-metrics';
import { QaapTenantRuntimeStore } from './qaap-tenant-runtime-store';
import { QaapTenantBackendProxyContribution } from './qaap-tenant-backend-proxy';
import { QaapObservability } from './qaap-observability';
import { isQaapHostedRuntime } from './qaap-docker-control-plane';
import { QaapTenantProcessExecutor } from '@theia/qaap-adapters/lib/common/qaap-tenant-process';
import {
    rememberQaapSharedTheiaConfigDir,
    resolveQaapTenantConfigRoot,
    resolveQaapTenantConfigDir,
    resolveQaapTenantUserRoot,
} from './qaap-tenant-config-scope';
import { filterQaapFrontendEnvironment, isQaapSensitiveEnvKey } from './qaap-env-variables';

export default new ContainerModule((bind, _unbind, _isBound, rebind, _unbindAsync, onActivation) => {
    // Confine HTTP file uploads to the caller's workspace (auth + ownership); the upstream
    // NodeFileUploadService is unauthenticated and lets absolute paths through its traversal check.
    bind(QaapNodeFileUploadService).toSelf().inSingletonScope();
    rebind(NodeFileUploadService).toService(QaapNodeFileUploadService);
    bind(QaapWebsocketAuthRegistry).toSelf().inSingletonScope();
    bind(QaapTerminalOwnership).toSelf().inSingletonScope();
    bind(QaapDockerControlPlaneContribution).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(QaapDockerControlPlaneContribution);
    bind(QaapTenantRuntimeStore).toSelf().inSingletonScope();
    bind(QaapObservability).toSelf().inSingletonScope();
    bind(QaapTenantRuntimeMetrics).toSelf().inSingletonScope();
    bind(QaapTenantActivityTracker).toSelf().inSingletonScope();
    bind(QaapTenantActivityContribution).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(QaapTenantActivityContribution);
    bind(QaapTenantContainerReaper).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(QaapTenantContainerReaper);
    bind(QaapTenantRuntimeEndpoint).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(QaapTenantRuntimeEndpoint);
    bind(QaapTenantBackendProxyContribution).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(QaapTenantBackendProxyContribution);
    bind(QaapWebsocketAuthListener).toSelf().inSingletonScope();
    bind(MessagingListenerContribution).toService(QaapWebsocketAuthListener);
    bind(QaapMessagingAuthContribution).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(QaapMessagingAuthContribution);
    onActivation<ProcessManager>(ProcessManager, (ctx, processManager) => {
        installQaapTerminalOwnership(
            processManager,
            ctx.container.get(QaapTerminalOwnership),
            () => ctx.container.get(QaapWebsocketAuthRegistry).getCurrentLogin(),
        );
        return processManager;
    });
    onActivation<EnvVariablesServer>(EnvVariablesServer, (ctx, environments) => {
        const registry = ctx.container.get(QaapWebsocketAuthRegistry);
        const originalGetConfigDirUri = environments.getConfigDirUri.bind(environments);
        const originalGetHomeDirUri = environments.getHomeDirUri.bind(environments);
        const originalGetVariables = environments.getVariables.bind(environments);
        const originalGetValue = environments.getValue.bind(environments);
        environments.getConfigDirUri = async (): Promise<string> => {
            const baseConfigDirUri = await originalGetConfigDirUri();
            rememberQaapSharedTheiaConfigDir(baseConfigDirUri);
            const ownerLogin = registry.getCurrentLogin();
            if (!isQaapHostedRuntime(process.env)) {
                return baseConfigDirUri;
            }
            const tenantConfigDir = resolveQaapTenantConfigDir(ownerLogin || QAAP_ANONYMOUS_USER_LOGIN);
            await fs.mkdir(tenantConfigDir, { recursive: true, mode: 0o700 });
            if (process.platform !== 'win32') {
                await fs.chmod(tenantConfigDir, 0o700);
            }
            return FileUri.create(tenantConfigDir).toString();
        };
        environments.getHomeDirUri = async (): Promise<string> => {
            const baseHomeDirUri = await originalGetHomeDirUri();
            if (!isQaapHostedRuntime(process.env)) {
                return baseHomeDirUri;
            }
            const ownerLogin = registry.getCurrentLogin() || QAAP_ANONYMOUS_USER_LOGIN;
            const tenantHome = resolveQaapTenantUserRoot(ownerLogin);
            await fs.mkdir(tenantHome, { recursive: true, mode: 0o700 });
            if (process.platform !== 'win32') {
                await fs.chmod(tenantHome, 0o700);
            }
            return FileUri.create(tenantHome).toString();
        };
        environments.getVariables = async () => {
            const variables = await originalGetVariables();
            return isQaapHostedRuntime(process.env) ? filterQaapFrontendEnvironment(variables) : variables;
        };
        environments.getValue = async key => {
            if (isQaapHostedRuntime(process.env) && key === 'QAAP_TENANT_CONFIG_ROOT') {
                return { value: resolveQaapTenantConfigRoot() };
            }
            if (isQaapHostedRuntime(process.env) && isQaapSensitiveEnvKey(key)) {
                return undefined;
            }
            return originalGetValue(key);
        };
        return environments;
    });
    bind(QaapTenantDiskFileSystemProvider).toSelf().inSingletonScope();
    rebind(DiskFileSystemProvider).toService(QaapTenantDiskFileSystemProvider);
    rebind(FileSystemProvider).toService(QaapTenantDiskFileSystemProvider);
    bind(QaapHostedWorkspaceServer).toSelf().inSingletonScope();
    rebind(DefaultWorkspaceServer).toService(QaapHostedWorkspaceServer);
    rebind(WorkspaceServer).toService(QaapHostedWorkspaceServer);
    bind(QaapCloudWorkspaceStore).toSelf().inSingletonScope();
    bind(QaapDockerOrchestrator).toSelf().inSingletonScope();
    bind(QaapCloudOrchestrator).toSelf().inSingletonScope();
    bind(QaapDeployRunner).toSelf().inSingletonScope();
    bind(QaapPushSubscriptionStore).toSelf().inSingletonScope();
    bind(QaapWebPushService).toSelf().inSingletonScope();
    bind(QaapPreviewShareStore).toSelf().inSingletonScope();
    bind(QaapTenantSpawnService).toSelf().inSingletonScope();
    bind(QaapTenantProcessExecutor).toService(QaapTenantSpawnService);
    bindRootContributionProvider(bind, QaapJobFunctionContribution);
    bind(QaapJobFunctionRegistry).toSelf().inSingletonScope();
    bind(QaapBuiltinJobFunctions).toSelf().inSingletonScope();
    bind(QaapJobFunctionContribution).toService(QaapBuiltinJobFunctions);
    bind(QaapWorkflowJobFunctions).toSelf().inSingletonScope();
    bind(QaapJobFunctionContribution).toService(QaapWorkflowJobFunctions);
    bind(QaapJobRuntime).toSelf().inSingletonScope();
    bind(QaapJobEndpoint).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(QaapJobEndpoint);

    // Dynamic Workflows (ADR-001). Inert until a run is started: the service only reacts to
    // terminal events for tasks and jobs that belong to a workflow run.
    bind(QaapAgentHealthTracker).toSelf().inSingletonScope();
    bind(QaapWorkflowPromptRegistry).toSelf().inSingletonScope();
    bind(QaapWorkflowRoutingPolicy).toDynamicValue(
        () => new QaapWorkflowRoutingPolicy(parseQaapWorkflowRoutingTable(process.env.QAAP_WORKFLOW_AGENT_ROUTES)),
    ).inSingletonScope();
    bind(QaapWorkflowRunStore).toSelf().inSingletonScope();
    bind(QaapWorkflowAgentTurnAdapter).toSelf().inSingletonScope();
    bind(QaapWorkflowDeterministicAdapter).toSelf().inSingletonScope();
    bind(QaapWorkflowDispatcher).toDynamicValue(({ container }) => new QaapWorkflowDispatcher(
        container.get(QaapWorkflowRunStore),
        {
            agent: container.get(QaapWorkflowAgentTurnAdapter),
            deterministic: container.get(QaapWorkflowDeterministicAdapter),
        },
        // Chat-turn runs (ADR-002) are reconciled and settled by the conversation store; the
        // template-workflow dispatcher must never spawn, interrupt or expire them.
        record => record.def.id !== QAAP_CHAT_TURN_WORKFLOW_ID,
    )).inSingletonScope();
    bind(QaapWorkflowTemplateRegistry).toSelf().inSingletonScope();
    bind(QaapWorkflowService).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(QaapWorkflowService);
    bind(QaapWorkflowEndpoint).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(QaapWorkflowEndpoint);
    bind(QaapPreviewSupervisor).toSelf().inSingletonScope();
    bind(QaapTerminalSessionStore).toSelf().inSingletonScope();
    bind(QaapPreviewShareProxyContribution).toSelf().inSingletonScope();
    bind(QaapCloudWorkspaceEndpoint).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(QaapCloudWorkspaceEndpoint);
    bind(BackendApplicationContribution).toService(QaapPreviewShareProxyContribution);
    bind(QaapAgentTaskRunner).toSelf().inSingletonScope();
    bind(QaapAgentCliUpdateService).toSelf().inSingletonScope();
    bind(QaapWorktreeGcContribution).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(QaapWorktreeGcContribution);
    bind(QaapAgentTaskEndpoint).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(QaapAgentTaskEndpoint);
    bind(QaapUserAiSettingsEndpoint).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(QaapUserAiSettingsEndpoint);
    bind(QaapBillingStore).toSelf().inSingletonScope();
    bind(QaapBillingQuotaService).toSelf().inSingletonScope();
    bind(QaapBillingQuota).toService(QaapBillingQuotaService);
    bind(QaapBillingEndpoint).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(QaapBillingEndpoint);
    bind(QaapAgentConversationStore).toSelf().inSingletonScope();
    // Headless server-side visual evidence — subscribes to the store on startup, so it must be
    // instantiated eagerly via the contribution provider (singletons are otherwise lazy).
    bind(QaapHeadlessVisualCaptureService).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(QaapHeadlessVisualCaptureService);
    bind(QaapConversationWorktreeService).toSelf().inSingletonScope();
    bind(QaapAgentConversationEndpoint).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(QaapAgentConversationEndpoint);
    bind(QaapAgentApprovalStore).toSelf().inSingletonScope();
    bind(QaapAgentApprovalEndpoint).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(QaapAgentApprovalEndpoint);
    bind(QaapParallelRunStore).toSelf().inSingletonScope();
    bind(QaapParallelRunEndpoint).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(QaapParallelRunEndpoint);
    bind(QaapWorkHubRoutineStore).toSelf().inSingletonScope();
    bind(QaapWorkHubRoutineRunner).toSelf().inSingletonScope();
    bind(QaapWorkHubRoutineScheduler).toSelf().inSingletonScope();
    bind(QaapWorkHubRoutineEndpoint).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(QaapWorkHubRoutineEndpoint);
    bind(QaapResearchStore).toSelf().inSingletonScope();
    bind(QaapResearchRunner).toSelf().inSingletonScope();
    // Eagerly instantiated (via the BackendApplicationContribution provider) so its @postConstruct
    // reconciliation resumes any goal left `running` on disk BEFORE the first HTTP request —
    // mirrors QaapHeadlessVisualCaptureService, the other postConstruct-only eager singleton here.
    bind(BackendApplicationContribution).toService(QaapResearchRunner);
    bind(QaapResearchEndpoint).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(QaapResearchEndpoint);
    // Inject the `qaap-task` helper env (PATH prefix, token, API URL) into every interactive
    // shell so users can call `qaap-task` from the Terminal tab — not just background-task
    // subprocesses, which already get it via QaapAgentTaskRunner.buildChildEnv.
    //
    // We patch the existing IShellTerminalServer instance rather than rebinding so the original
    // dispatching-client wiring (set up via a closure in @theia/terminal's onActivation) stays
    // intact.
    onActivation<IShellTerminalServer>(IShellTerminalServer, (ctx, server) => {
        const taskRunner = ctx.container.get(QaapAgentTaskRunner);
        const tenantSpawn = ctx.container.get(QaapTenantSpawnService);
        const registry = ctx.container.get(QaapWebsocketAuthRegistry);
        const shellServer = server as IShellTerminalServer & {
            collections: MultiKeyMap<string, unknown>;
            applyToProcessEnvironment(cwdUri: URI, env: { [key: string]: string | null }): void;
        };
        const sharedCollections = shellServer.collections;
        const tenantCollections = new Map<string, MultiKeyMap<string, unknown>>();
        const currentCollections = (): MultiKeyMap<string, unknown> => {
            if (!isQaapHostedRuntime(process.env)) {
                return sharedCollections;
            }
            const owner = registry.getCurrentLogin()?.trim().toLowerCase();
            if (!owner) {
                throw new Error('Tenant terminal environment requires an authenticated owner.');
            }
            let collections = tenantCollections.get(owner);
            if (!collections) {
                collections = new MultiKeyMap<string, unknown>(2);
                tenantCollections.set(owner, collections);
            }
            return collections;
        };
        const withTenantCollections = <T>(callback: () => T): T => {
            const previous = shellServer.collections;
            shellServer.collections = currentCollections();
            try {
                return callback();
            } finally {
                shellServer.collections = previous;
            }
        };
        // ShellTerminalServer stores extension environment mutators in one process-global
        // MultiKeyMap. Swap that map only for the synchronous upstream method bodies, so one
        // tenant cannot inject variables into another tenant's terminal. The RPC auth patcher
        // establishes the owner context before any of these methods run.
        const originalApplyToProcessEnvironment = shellServer.applyToProcessEnvironment.bind(shellServer);
        shellServer.applyToProcessEnvironment = (cwdUri, env) =>
            withTenantCollections(() => originalApplyToProcessEnvironment(cwdUri, env));
        const originalSetCollection = shellServer.setCollection.bind(shellServer);
        shellServer.setCollection = (...args) => withTenantCollections(() => originalSetCollection(...args));
        const originalDeleteCollection = shellServer.deleteCollection.bind(shellServer);
        shellServer.deleteCollection = (...args) => withTenantCollections(() => originalDeleteCollection(...args));
        const originalRestorePersisted = shellServer.restorePersisted.bind(shellServer);
        shellServer.restorePersisted = (...args) => withTenantCollections(() => originalRestorePersisted(...args));
        const originalGetEnvVarCollections = shellServer.getEnvVarCollections.bind(shellServer);
        shellServer.getEnvVarCollections = (...args) => withTenantCollections(() => originalGetEnvVarCollections(...args));
        const originalGetEnvVarCollectionDescriptions = shellServer.getEnvVarCollectionDescriptionsByExtension.bind(shellServer);
        shellServer.getEnvVarCollectionDescriptionsByExtension = (...args) =>
            withTenantCollections(() => originalGetEnvVarCollectionDescriptions(...args));
        const originalCreate = server.create.bind(server);
        server.create = async (options: IShellTerminalServerOptions) => {
            if (options.strictEnv !== true) {
                // Under a PTY, corepack's interactive download prompt blocks stdin forever (no
                // packageManager pin ⇒ latest-resolve too); explicit incoming env still wins below.
                options.env = {
                    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
                    COREPACK_DEFAULT_TO_LATEST: '0',
                    ...(options.env ?? {}),
                };
                // Seed PATH from process.env so the helper-bin prefix builds on top of it.
                // mergeProcessEnv (called inside super.create) keeps options.env entries over
                // process.env, so anything we set here survives.
                const seeded: NodeJS.ProcessEnv = { PATH: process.env.PATH };
                for (const [key, value] of Object.entries(options.env ?? {})) {
                    if (value !== undefined && value !== null) {
                        seeded[key] = value;
                    }
                }
                if (taskRunner.applyHelperEnv(seeded)) {
                    options.env = {
                        ...(options.env ?? {}),
                        PATH: seeded.PATH ?? null,
                        QAAP_TASK_TOKEN: seeded.QAAP_TASK_TOKEN ?? null,
                        QAAP_TASK_API_URL: seeded.QAAP_TASK_API_URL ?? null,
                    };
                }
            }
            // SEC-1: the interactive terminal shell runs as the backend uid (root in prod), bypassing
            // the agent's uid drop — a user could read/write another tenant's code from the Terminal
            // tab. Rewrite the shell to run under the tenant uid via `setpriv --clear-groups` (the pty
            // execs setpriv, which execs the shell in the same TTY — signals/resize are preserved), and
            // point HOME/USER at the tenant home. No-op when uid-per-user is off / not root / cwd is
            // outside a tenant tree; throws (failing the terminal open) rather than leaking a root shell.
            //
            // Windows browsers often send FileUri.fsPath as "/\workspace\repos\..." — normalize and
            // rewrite rootURI so ShellProcess.getRootPath also gets a real Linux cwd for the PTY.
            const cwd = normalizeIsolationPath(getRootPath(options.rootURI));
            options.rootURI = FileUri.create(cwd).toString(true);
            const shell = options.shell || ShellProcess.getShellExecutablePath();
            const shellArgs = options.args === undefined
                ? ShellProcess.getShellExecutableArgs()
                : (Array.isArray(options.args) ? options.args : parseArgs(options.args));
            const tenantEnvironment: NodeJS.ProcessEnv = {};
            for (const [key, value] of Object.entries(options.env ?? {})) {
                if (value !== undefined && value !== null) {
                    tenantEnvironment[key] = value;
                }
            }
            // TerminalServer.create is async even though the shell wrapper itself is synchronous.
            // Await the same lifecycle gate used by agents so a terminal is also a valid cold-start
            // entry point after the reaper stopped or destroyed the worker.
            await tenantSpawn.prepareTenantIsolationAsync(cwd);
            const wrapped = tenantSpawn.wrapShellForTenant(cwd, shell, shellArgs, tenantEnvironment);
            options.shell = wrapped.file;
            options.args = wrapped.args;
            const homeOverlay = tenantSpawn.tenantHomeEnvOverlay(cwd);
            if (Object.keys(homeOverlay).length > 0) {
                options.env = { ...(options.env ?? {}), ...homeOverlay };
            }
            return originalCreate(options);
        };
        return server;
    });
});
