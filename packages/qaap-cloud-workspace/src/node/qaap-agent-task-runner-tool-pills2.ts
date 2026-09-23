import {
    HELPER_BIN_DIR, STORE_DIR, INDEX_PATH, MAX_LOG_BYTES, AGENT_ENV_PREFS, QAAP_AGENT_VERIFY_OUTPUT_TAIL_CHARS, STORE_DIR_MODE, STORE_FILE_MODE,
    type PersistedAgentTaskIndex, type QaapGenericCommandResult,
} from './qaap-agent-task-runner-constants';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';
// Extracted from qaap-agent-task-runner.ts

import { ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { writeJsonAtomic } from './qaap-write-json-atomic';
import * as path from 'path';
import {
    buildImproveComposerPromptRequest,
} from '@theia/qaap-mobile-shell/lib/common/qaap-composer-prompt-improve';
import {
    isQaapAgentTaskFinished,
    type QaapCreateAgentTaskQaiqModel,
    type QaapAgentTask,
    type QaapAgentTaskState,
    type QaapCreateAgentTaskRequest,
} from '../common/qaap-agent-task';
import { billableAgentDurationMs } from '../common/qaap-billing-agent-runtime';
import { agentUsesSettingsModelCatalog } from '../common/qaap-agent-native-model-catalog';
import {
    applyAgentApprovalPolicyToCommand,
} from '../common/qaap-agent-approval-flags';
import { filterAgentProcessLogChunk } from '../common/qaap-agent-log-filter';
import {
    applyQaapQaiqCredentialEnv,
    applyQaapQaiqModelEnv,
    type QaapQaiqModelBinding,
} from '../common/qaap-qaiq-model-binding';
import {
    prependPathEntry as prependPathEntryHelper,
} from './qaap-agent-task-runner-utils';
import { buildPromptTransportCommand } from './qaap-agent-task-runner-utils';

export async function runGenericCommandExtracted(ctx: QaapAgentTaskRunnerContext, command: string,
        cwd: string,
        env: NodeJS.ProcessEnv,
        taskId: string,
        timeoutMs: number,
        options: {
            readonly header?: string;
            readonly streamOutput?: boolean;
            readonly tailOutput?: boolean;
            /** Bounds each captured stream in memory while retaining its most recent output. */
            readonly maxCaptureChars?: number;
            /** Plain-text prompt to deliver over stdin instead of embedding it in the command. */
            readonly stdinPrompt?: string;
            /** Owner for ephemeral commands that do not have a persisted QaapAgentTask entry. */
            readonly ownerLogin?: string;
        } = {},): Promise<QaapGenericCommandResult> {
        const persistedTask = ctx.tasks.get(taskId);
        const auditTask = {
            id: taskId,
            command,
            cwd,
            agentId: persistedTask?.agentId,
            ownerLogin: persistedTask?.ownerLogin ?? options.ownerLogin,
        };
        const executionKind = persistedTask ? 'verification' : 'shell';
        const auditStartedAt = Date.now();
        ctx.observability?.recordAgentCommandStarted(auditTask, executionKind);
        if (options.header) {
            ctx.appendAndFireOutput(taskId, options.header, options.ownerLogin);
        }
        try {
            ctx.enforceAgentIsolationPolicy();
            await (ctx.ensureAgentCwdOwnershipAsync
                ? ctx.ensureAgentCwdOwnershipAsync(cwd)
                : ctx.ensureAgentCwdOwnership(cwd));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            ctx.observability?.recordAgentCommandFinished(
                auditTask,
                'failed',
                1,
                Date.now() - auditStartedAt,
                executionKind,
            );
            return { exitCode: 1, stdout: '', stderr: message, timedOut: false };
        }
        return new Promise(resolve => {
            let stdout = '';
            let stderr = '';
            let timedOut = false;
            let child: ChildProcess;
            const finish = (exitCode: number): void => {
                ctx.observability?.recordAgentCommandFinished(
                    auditTask,
                    exitCode === 0 ? 'completed' : 'failed',
                    exitCode,
                    Date.now() - auditStartedAt,
                    executionKind,
                );
                if (options.tailOutput) {
                    const combined = `${stdout}${stderr}`;
                    const tail = ctx.truncateHead(combined, QAAP_AGENT_VERIFY_OUTPUT_TAIL_CHARS);
                    if (tail.trim()) {
                        ctx.appendAndFireOutput(taskId, `${tail.endsWith('\n') ? tail : `${tail}\n`}`, options.ownerLogin);
                    }
                }
                resolve({ exitCode, stdout, stderr, timedOut });
            };
            try {
                child = ctx.spawnAgentCommand(command, {
                    cwd,
                    env,
                    stdio: options.stdinPrompt === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
                    detached: options.stdinPrompt === undefined ? undefined : false,
                });
            } catch (error) {
                stderr = error instanceof Error ? error.message : String(error);
                finish(1);
                return;
            }
            ctx.processes.set(taskId, child);
            if (options.stdinPrompt !== undefined) {
                child.stdin?.end(options.stdinPrompt);
            }
            let killTimer: NodeJS.Timeout | undefined;
            const timeout = setTimeout(() => {
                timedOut = true;
                killTimer = ctx.killAgentProcessTree(child);
            }, Math.max(1, timeoutMs));
            child.stdout?.on('data', (chunk: Buffer | string) => {
                const text = String(chunk);
                stdout = ctx.appendBoundedCommandOutput(stdout, text, options.maxCaptureChars);
                if (options.streamOutput) {
                    ctx.appendAndFireOutput(taskId, text, options.ownerLogin);
                }
            });
            child.stderr?.on('data', (chunk: Buffer | string) => {
                const text = String(chunk);
                stderr = ctx.appendBoundedCommandOutput(stderr, text, options.maxCaptureChars);
                if (options.streamOutput) {
                    ctx.appendAndFireOutput(taskId, text, options.ownerLogin);
                }
            });
            child.on('error', error => {
                stderr = ctx.appendBoundedCommandOutput(stderr, `${error.message}\n`, options.maxCaptureChars);
            });
            child.once('exit', () => {
                ctx.reapAgentProcessGroupAfterExit(child);
            });
            child.on('close', code => {
                clearTimeout(timeout);
                if (killTimer) {
                    clearTimeout(killTimer);
                }
                if (ctx.processes.get(taskId) === child) {
                    ctx.processes.delete(taskId);
                }
                finish(timedOut && code === 0 ? 1 : code ?? 1);
            });
        });
}

export function appendAndFireOutputExtracted(ctx: QaapAgentTaskRunnerContext, taskId: string, chunk: string, ownerLogin?: string): void {
        if (ctx.deletedTaskIds?.has(taskId)) {
            return;
        }
        try {
            const logPath = ctx.logPath(taskId, ownerLogin);
            fs.mkdirSync(path.dirname(logPath), { recursive: true, mode: STORE_DIR_MODE });
            if (!fs.existsSync(logPath)) {
                fs.writeFileSync(logPath, '', { encoding: 'utf8', mode: STORE_FILE_MODE });
            }
            const currentBytes = fs.statSync(logPath).size;
            const remainingBytes = Math.max(0, MAX_LOG_BYTES - currentBytes);
            if (remainingBytes > 0) {
                const encoded = Buffer.from(chunk, 'utf8');
                fs.appendFileSync(logPath, encoded.subarray(0, remainingBytes));
            }
        } catch {
            /* log append is best-effort */
        }
        ctx.fireOutput(taskId, chunk);
}

export function summarizeVerificationFailureExtracted(ctx: QaapAgentTaskRunnerContext, command: string, result: QaapGenericCommandResult): string {
        const timedOut = result.timedOut ? ' The command timed out.' : '';
        const output = ctx.truncateHead(`${result.stdout}\n${result.stderr}`.trim(), 1000);
        return `${command} exited with code ${result.exitCode}.${timedOut}${output ? `\n${output}` : ''}`;
}

export function fireOutputExtracted(ctx: QaapAgentTaskRunnerContext, taskId: string, chunk: unknown): void {
        const task = ctx.tasks.get(taskId);
        // Drop stdout after cancel/finish — otherwise a dying CLI can keep painting the
        // transcript for hundreds of ms and make Stop feel ignored.
        if (!task || task.state !== 'running') {
            return;
        }
        const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        const filtered = filterAgentProcessLogChunk(text);
        if (!filtered) {
            return;
        }
        ctx.onDidChangeTaskEmitter.fire({ type: 'output', task, chunk: filtered });
}

export function spawnAgentCommandExtracted(ctx: QaapAgentTaskRunnerContext, command: string, options: {
        cwd: string;
        env: NodeJS.ProcessEnv;
        stdio: ('pipe' | 'ignore')[];
        detached?: boolean;
    }): ChildProcess {
        return ctx.tenantSpawn.spawn(command, options);
}

export function buildChildEnvExtracted(ctx: QaapAgentTaskRunnerContext, task: QaapAgentTask): NodeJS.ProcessEnv {
        const env: NodeJS.ProcessEnv = { ...process.env };
        env.PWD = task.cwd;
        // When an agent is dropped to a non-root uid, its inherited HOME may point at root's
        // /root, which it cannot write. In Docker mode the overlay deliberately points inside the
        // worker; never copy the host's per-tenant HOME into a container that does not mount it.
        if (ctx.tenantHomeEnvOverlay) {
            Object.assign(env, ctx.tenantHomeEnvOverlay(task.cwd));
        } else if (ctx.resolveAgentSpawnIdentity(task.cwd).uid !== undefined) {
            env.HOME = ctx.resolveAgentHome(task.cwd);
        }
        // Strip shared provider API keys from process.env so per-user settings
        // are the sole source. Without this, User B's agent would inherit User
        // A's keys (or operator-level keys) from the shared backend process.
        ctx.stripSharedProviderEnv(env);
        // QAIQ and OpenClaude share the hosted protocol, but OpenClaude must not inherit QAIQ's
        // Settings → AI Features credentials/base URL as an implicit model selection. Explicit
        // OpenClaude picks still receive their own binding below.
        const usesQaiqSettingsCatalog = agentUsesSettingsModelCatalog(task.agentId)
            || (!task.agentId && /\bqaiq\b/.test(task.command) && !/\bopenclaude\b/.test(task.command));
        if (usesQaiqSettingsCatalog) {
            ctx.applyProviderPreferenceEnv(env, task.ownerLogin);
        }
        const binding = ctx.resolveAgentBindingForTask(task);
        if (binding) {
            applyQaapQaiqModelEnv(env, binding);
            applyQaapQaiqCredentialEnv(env, binding, ctx.preferenceReaderForOwner(task.ownerLogin));
        }
        if (usesQaiqSettingsCatalog) {
            ctx.applyQaiqProviderEnv(env, task.command, binding);
        }
        if (ctx.isQaiqRunner(undefined, task.command)) {
            env.QAAP_HOSTED_AGENT = '1';
            // QAIQ's full-access mode bypasses its permission callbacks. Force every hosted
            // QAIQ shell through the versioned Qaap boundary so destructive commands remain
            // denied even in headless/bypass runs. The boundary loads the compiled guard and
            // fails closed when the package has not been compiled yet.
            env.CLAUDE_CODE_SHELL = path.resolve(
                __dirname,
                '../../../../scripts/qaap-guarded-bash.mjs',
            );
            // The hosted backend runs as root inside its container, where qaiq refuses
            // `--dangerously-skip-permissions` unless it detects a sandbox. The container IS the
            // sandbox, so opt in explicitly (qaiq honours IS_SANDBOX=1 as the root-bypass escape
            // hatch). Scoped to the qaiq child rather than set globally so it never leaks into
            // unrelated processes. Respect an operator override if one is already present.
            if (env.IS_SANDBOX === undefined) {
                env.IS_SANDBOX = '1';
            }
        }
        ctx.applyHelperEnv(env, task.ownerLogin, task.id, task.autoApprove);
        return env;
}

export function applyOpenAiVendorCompatEnvExtracted(ctx: QaapAgentTaskRunnerContext, env: NodeJS.ProcessEnv, binding: QaapQaiqModelBinding): void {
        switch (binding.vendor) {
            case 'huggingface':
                ctx.applyHuggingfaceOpenAiCompatEnv(env);
                break;
            case 'openrouter':
                ctx.applyOpenRouterOpenAiCompatEnv(env);
                break;
            case 'nvidia':
                ctx.applyNvidiaOpenAiCompatEnv(env);
                break;
            default:
                break;
        }
}

export function applyQaiqProviderEnvExtracted(ctx: QaapAgentTaskRunnerContext, env: NodeJS.ProcessEnv, command: string, binding?: QaapQaiqModelBinding): void {
        if (!ctx.isQaiqRunner(undefined, command)) {
            return;
        }
        const usesThirdPartyProvider = (binding !== undefined && binding.provider !== 'anthropic')
            || command.includes('--provider openai')
            || command.includes('--provider gemini')
            || command.includes('--provider ollama')
            || command.includes('--provider mistral');
        if (usesThirdPartyProvider) {
            delete env.ANTHROPIC_API_KEY;
        }
        if (binding?.vendor === 'openrouter' || (!binding && command.includes('--provider openai') && env.OPENROUTER_API_KEY?.trim())) {
            ctx.applyOpenRouterOpenAiCompatEnv(env);
            env.CLAUDE_CODE_USE_OPENAI = '1';
        } else if (binding?.vendor === 'nvidia' || (!binding && command.includes('--provider openai') && env.NVIDIA_API_KEY?.trim() && !env.OPENROUTER_API_KEY?.trim())) {
            ctx.applyNvidiaOpenAiCompatEnv(env);
            env.CLAUDE_CODE_USE_OPENAI = '1';
        } else if (binding?.vendor === 'huggingface') {
            ctx.applyHuggingfaceOpenAiCompatEnv(env);
            env.CLAUDE_CODE_USE_OPENAI = '1';
        } else if (!binding && command.includes('--provider openai') && env.OPENAI_API_KEY?.trim()) {
            env.CLAUDE_CODE_USE_OPENAI = '1';
        } else if (binding?.provider === 'openai') {
            ctx.applyOpenAiVendorCompatEnv(env, binding);
            env.CLAUDE_CODE_USE_OPENAI = '1';
        } else {
            // Gemini, Ollama, Anthropic, Mistral — profile files must not force OpenAI mode.
            env.CLAUDE_CODE_USE_OPENAI = '0';
        }
}

export function applyProviderPreferenceEnvExtracted(ctx: QaapAgentTaskRunnerContext, env: NodeJS.ProcessEnv, ownerLogin?: string): void {
        const readPref = ctx.preferenceReaderForOwner(ownerLogin);
        for (const mapping of AGENT_ENV_PREFS) {
            if (env[mapping.env]?.trim()) {
                continue;
            }
            const value = readPref(mapping.pref);
            if (typeof value === 'string' && value.trim()) {
                env[mapping.env] = value.trim();
            }
        }
        ctx.applyOpenRouterOpenAiCompatEnv(env);
}

export function applyHelperEnvExtracted(ctx: QaapAgentTaskRunnerContext, env: NodeJS.ProcessEnv, ownerLogin?: string, parentTaskId?: string, autoApprove?: boolean): boolean {
        if (!ctx.helperApiUrl) {
            return false;
        }
        // Seed the token bound to this task's owner so a spawned agent can only fan out
        // sub-tasks as its own user (the endpoint resolves the owner from the token).
        env.QAAP_TASK_TOKEN = ctx.helperTokenForOwner(ownerLogin);
        env.QAAP_TASK_API_URL = ctx.helperApiUrl;
        if (parentTaskId) {
            env.QAAP_TASK_PARENT_ID = parentTaskId;
        }
        if (autoApprove !== false) {
            env.QAAP_TASK_AUTO_APPROVE = '1';
        }
        prependPathEntryHelper(env, HELPER_BIN_DIR);
        return true;
}

export function markTaskBlockedExtracted(ctx: QaapAgentTaskRunnerContext, id: string): QaapAgentTask | undefined {
        const task = ctx.tasks.get(id);
        if (!task || (task.state !== 'completed' && task.state !== 'completed_with_warnings')) {
            return undefined;
        }
        const blocked: QaapAgentTask = { ...task, state: 'blocked' };
        ctx.tasks.set(id, blocked);
        void ctx.persist();
        return blocked;
}

export function finishTaskExtracted(ctx: QaapAgentTaskRunnerContext, id: string, state: QaapAgentTaskState, exitCode: number | undefined): QaapAgentTask | undefined {
        const task = ctx.tasks.get(id);
        if (!task) {
            return undefined;
        }
        const worktreeFinishedFingerprint = task.worktreeBaselineFingerprint && task.agentId === 'shell'
            ? ctx.captureWorktreeFingerprint(task.cwd) : undefined;
        const finished: QaapAgentTask = { ...task, state, exitCode, finishedAt: Date.now(), worktreeFinishedFingerprint };
        ctx.tasks.set(id, finished);
        void ctx.persist();
        ctx.observability?.recordAgentCommandFinished(
            finished,
            state,
            exitCode,
            finished.startedAt === undefined ? undefined : finished.finishedAt! - finished.startedAt,
        );
        const durationMs = billableAgentDurationMs(finished);
        if (durationMs > 0 && finished.ownerLogin && ctx.billingStore) {
            void ctx.billingStore.debitRuntime(finished.ownerLogin, durationMs).catch(() => undefined);
        }
        // 'completed'/'failed'/'interrupted' map to 'completed' for subscribers; 'cancelled' stays distinct.
        ctx.onDidChangeTaskEmitter.fire({
            type: state === 'cancelled' ? 'cancelled' : 'completed',
            task: finished,
        });
        if (isQaapAgentTaskFinished(state) && state !== 'cancelled') {
            void ctx.notifyCompletion(finished);
        }
        // A cancelled running process retains its concurrency slot through the graceful-stop
        // window; cancel() drains after that window. Queued cancellations drain immediately there.
        if (state !== 'cancelled') {
            ctx.drainQueuedTasks();
        }
        return finished;
}

export async function notifyCompletionExtracted(ctx: QaapAgentTaskRunnerContext, task: QaapAgentTask): Promise<void> {
        // Deep-link target: the Work Hub session that spawned this task (when known),
        // so tapping the notification lands on the agent conversation, not a generic surface.
        const conversationId = ctx.conversationIdForTask?.(task.id);
        const link = { route: 'conversation' as const, conversationId, cwd: task.cwd, userLogin: task.ownerLogin };
        if (task.state === 'completed_with_warnings') {
            try {
                await ctx.webPush.notify({
                    title: 'Task finished — checks failing',
                    body: `${task.title} completed, but verification checks are still failing.`,
                    tag: `qaap-agent-task-${task.id}`,
                    ...link,
                });
            } catch {
                /* push failure must not crash the runner */
            }
            return;
        }
        const ok = task.state === 'completed';
        try {
            await ctx.webPush.notify({
                title: ok ? 'Task finished' : 'Task failed',
                body: `${task.title}${ok ? ' completed.' : ` exited with code ${task.exitCode ?? 'unknown'}.`}`,
                tag: `qaap-agent-task-${task.id}`,
                ...link,
            });
        } catch {
            /* push failure must not crash the runner */
        }
}

export async function readLogExtracted(ctx: QaapAgentTaskRunnerContext, id: string): Promise<string> {
        try {
            const logPath = ctx.logPath(id);
            const stat = await fsp.stat(logPath);
            const handle = await fsp.open(logPath, 'r');
            try {
                const start = Math.max(0, stat.size - MAX_LOG_BYTES);
                const { buffer, bytesRead } = await handle.read({
                    buffer: Buffer.alloc(Math.min(stat.size, MAX_LOG_BYTES)),
                    position: start,
                });
                const text = buffer.subarray(0, bytesRead).toString('utf8');
                const raw = start > 0 ? `…(truncated)\n${text}` : text;
                return filterAgentProcessLogChunk(raw);
            } finally {
                await handle.close();
            }
        } catch {
            return '';
        }
}

export function persistExtracted(ctx: QaapAgentTaskRunnerContext): Promise<void> {
        if (ctx.recoveryState === 'loading' || ctx.recoveryState === 'failed') {
            return Promise.resolve();
        }
        const queuedRequests: Record<string, QaapCreateAgentTaskRequest> = {};
        for (const [taskId, request] of ctx.queuedCreateRequests) {
            if (ctx.tasks.get(taskId)?.state === 'queued') {
                queuedRequests[taskId] = request;
            }
        }
        const index: PersistedAgentTaskIndex = {
            version: 2,
            tasks: [...ctx.tasks.values()],
            queuedRequests,
        };
        const previous = ctx.persistChain ?? Promise.resolve();
        ctx.persistChain = previous
            .catch(() => undefined)
            .then(async () => {
                if (ctx.recoveryState === 'loading' || ctx.recoveryState === 'failed') {
                    return;
                }
                await fsp.mkdir(STORE_DIR, { recursive: true, mode: STORE_DIR_MODE });
                await fsp.chmod(STORE_DIR, STORE_DIR_MODE).catch(() => undefined);
                await writeJsonAtomic(INDEX_PATH, index, { mode: STORE_FILE_MODE });
                const wasFailed = ctx.storageWriteFailed;
                ctx.storageWriteFailed = false;
                if (wasFailed) {
                    ctx.drainQueuedTasks();
                }
            })
            .catch(() => {
                ctx.storageWriteFailed = true;
                console.warn('[qaap-agent-tasks] task storage write failed; new tasks and queue promotion are blocked.');
            });
        return ctx.persistChain;
}

export async function improveComposerPromptExtracted(ctx: QaapAgentTaskRunnerContext, options: {
        readonly prompt: string;
        readonly agentId: string;
        readonly agentModel?: QaapCreateAgentTaskQaiqModel;
        readonly cwd?: string;
    }): Promise<string> {
        if (ctx.preferenceService) {
            await ctx.preferenceService.ready;
        }
        const trimmed = options.prompt.trim();
        if (!trimmed) {
            throw new Error('Composer prompt is empty.');
        }
        const improveText = buildImproveComposerPromptRequest(trimmed);
        const agentId = ctx.resolveAgentId(improveText, options.agentId);
        ctx.assertQaiqConfigured(agentId);
        const detected = ctx.detectedAgents.get(agentId);
        if (!detected) {
            throw new Error(`Agent "${agentId}" is not available for prompt improvement.`);
        }
        const vars = ctx.buildTemplateVars(agentId, options.agentModel, {
            autoApprove: true,
            approvalPolicyId: 'approve-for-me',
        });
        const template = detected.template
            .replace(/--output-format\s+\S+/g, '')
            .replace(/--include-partial-messages/g, '')
            .replace(/--verbose/g, '');
        const cwd = options.cwd?.trim() || process.cwd();
        const transported = buildPromptTransportCommand(
            template,
            improveText,
            agentId,
            detected,
            vars,
        );
        const command = applyAgentApprovalPolicyToCommand(
            transported.command,
            {
                agentId,
                approvalPolicyId: 'approve-for-me',
                autoApprove: true,
                codexSupportsApproveForMe: detected.codexSupportsApproveForMe,
            },
        );
        const createdAt = Date.now();
        const task: QaapAgentTask = {
            id: 'composer-improve-prompt',
            title: 'Improve prompt',
            command,
            cwd,
            agentId,
            state: 'running',
            createdAt,
            startedAt: createdAt,
            autoApprove: true,
            ...(options.agentModel ? { agentModel: options.agentModel, qaiqModel: options.agentModel } : {}),
        };
        return ctx.runOneShotCommand(
            command,
            cwd,
            ctx.buildChildEnv(task),
            agentId,
            45_000,
            transported.stdinPrompt,
            transported.promptTempDir,
        );
}
