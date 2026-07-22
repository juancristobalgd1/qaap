// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

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
    extractImprovedComposerPromptFromAgentStdout,
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
import { safeUserIdSegment } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { QaapTenantSpawnService } from './qaap-tenant-spawn-service';
import { extractRetrievalKeywords, formatRelevantFilesHint } from '../common/qaap-agent-retrieval';
import { listNativeAgentModels } from './qaap-agent-native-models';
import { listQaiqModelsFromPreferences } from '@theia/qaap-mobile-shell/lib/common/qaap-qaiq-model-catalog';
import {
    applyAgentApprovalPolicyToCommand,
    shouldUseQaiqStdioApprovals,
} from '../common/qaap-agent-approval-flags';
import {
    QAIQ_STDIO_APPROVAL_FLAGS,
    buildQaiqControlResponseLine,
    buildQaiqStdioPromptLine,
    parseQaiqStdioEvent,
    type QaapQaiqPendingControlRequest,
} from '../common/qaap-qaiq-stdio-approvals';
import { findQaiqDestructiveCommandGuardDenial } from '../common/qaap-agent-destructive-command-guard';
import { findQaiqDevServerGuardDenial } from '../common/qaap-agent-dev-server-guard';
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
import { appendAgentDefaultWorkflowToPrompt } from '../common/qaap-agent-default-workflow';
import { prependAgentTaskContextToPrompt, truncateProjectInfo, type QaapAgentRepoContext } from '../common/qaap-agent-task-context';
import {
    applyAntigravityModelSetting,
    isAntigravityCliCommand,
} from './qaap-antigravity-settings';
import { QaapWebPushService } from './qaap-web-push-service';
import { resolveQaapAgentVerificationScripts } from './qaap-agent-verification';
import {
    buildAgentReviewPrompt,
    parseAgentReviewVerdict,
    parseGitNumstat,
    resolveAgentReviewMode,
    resolveTaskReviewRisk,
} from '../common/qaap-agent-review';
import { buildQaapAgentRepoProfile } from './qaap-agent-repo-profile';

/** Built-in coding agents the runner can auto-detect on the server's PATH. */
interface AgentCandidate {
    readonly id: string;
    readonly label: string;
    /** Executable name to look up on PATH (`which <bin>`). */
    readonly bin?: string;
    /** Template applied to the user prompt; `{prompt}` is replaced with a shell-quoted value. */
    readonly template: string;
}

/** Built-in QAAP coding agent (fork of OpenClaude): https://github.com/juancristobalgd1/qaiq */
export const QAIQ_AGENT_ID = 'qaiq';

const AGENT_CANDIDATES: readonly AgentCandidate[] = QAAP_BUILTIN_AGENT_DEFINITIONS;

/**
 * Optional JSON env var for server-side agent backends beyond the built-ins. Example:
 *
 * QAAP_AGENT_COMMANDS='[
 *   {"id":"grok-fast","label":"Grok Build (fast)","bin":"grok","template":"grok --always-approve -m grok-4.5 -p {prompt}"},
 *   {"id":"qaiq-gemini","label":"QAIQ Gemini","bin":"qaiq","template":"qaiq --print --dangerously-skip-permissions --provider gemini --model gemini-2.5-flash {prompt}"}
 * ]'
 *
 * API keys stay in the regular provider env vars consumed by the underlying CLI
 * (for example GEMINI_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY, OPENAI_BASE_URL).
 */
const CUSTOM_AGENTS_ENV = 'QAAP_AGENT_COMMANDS';
// Default-on so the `[QAAP honest reporting]` prompt contract is backed by a real backend check
// (mirrors QAAP_AGENT_AUTO_CONTINUE). Opt out with QAAP_AGENT_VERIFY=0 (or `false`/`off`).
const QAAP_AGENT_VERIFY_ENABLED = !/^(0|false|off)$/i.test(process.env.QAAP_AGENT_VERIFY?.trim() ?? '');
const QAAP_AGENT_VERIFY_MAX_ATTEMPTS = 2;
const QAAP_AGENT_VERIFY_WALL_CLOCK_MS = 5 * 60 * 1000;
const QAAP_AGENT_VERIFY_OUTPUT_TAIL_CHARS = 12_000;
const QAAP_AGENT_FIX_PROMPT_OUTPUT_CHARS = 4_000;
/** Wall clock for the independent adversarial review pass (phase C). Mode knob: QAAP_AGENT_REVIEW. */
const QAAP_AGENT_REVIEW_WALL_CLOCK_MS = 3 * 60 * 1000;
const QAAP_AGENT_REVIEW_GIT_TIMEOUT_MS = 15_000;

/** Exported so other node/ services that reuse {@link QaapAgentTaskRunner.runGenericCommand} — the
 *  auto-researcher runner's `run`/`measure` phases — can type its result. */
export interface QaapGenericCommandResult {
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
    readonly timedOut: boolean;
}

/** Cap on the per-project info artifact injected into prompts, to keep the agent command bounded. */
const PROJECT_INFO_MAX_CHARS = 8000;

/** Cap on the workspace agent-instructions file (CLAUDE.md / AGENTS.md) injected into prompts. */
const AGENT_INSTRUCTIONS_MAX_CHARS = 6000;
/** Candidate agent-instruction filenames, in priority order (first match wins). */
const AGENT_INSTRUCTION_FILES: readonly string[] = ['CLAUDE.md', 'AGENTS.md', '.cursorrules'];
/** Cap on the generated repo-map block (shallow tree + recently-changed files). */
const REPO_MAP_MAX_CHARS = 4000;
/** Cap on the git status snapshot block (branch + working tree + recent commits). */
const GIT_STATUS_SNAPSHOT_MAX_CHARS = 1500;
/** Cap on the durable repo memory (`.qaap/memory.md`) injected into prompts. */
const REPO_MEMORY_MAX_CHARS = 2000;
/**
 * Query-specific retrieval: ripgrep the user's message keywords over source and inject the top
 * matching file paths as a "likely relevant files" hint. Default-on (bounded, 4s timeout) so the
 * agent starts oriented in large repos; opt out with QAAP_AGENT_RETRIEVAL=0 (or `false`/`off`).
 */
const QAAP_AGENT_RETRIEVAL_ENABLED = !/^(0|false|off)$/i.test(process.env.QAAP_AGENT_RETRIEVAL?.trim() ?? '');
/** Max relevant-file paths injected, and the char cap on that block. */
const RETRIEVAL_MAX_FILES = 5;
const RETRIEVAL_HINT_MAX_CHARS = 400;
/** Repo-map cache TTL — short, because the changed-files list drifts as the agent edits. */
const REPO_MAP_CACHE_TTL_MS = 60_000;
/** Directories never listed in the repo map (mirrors the search-hygiene exclude list). */
const REPO_MAP_EXCLUDED_DIRS = new Set<string>([
    'node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', '.turbo', '.cache',
    '.venv', 'venv', '__pycache__', 'target', 'vendor', '.idea', '.vscode',
]);
/** Source-ish top-level directories worth expanding one level deeper in the repo map. */
const REPO_MAP_SOURCE_DIRS = new Set<string>(['src', 'app', 'components', 'pages', 'packages', 'server', 'api']);

/** When several CLIs are on PATH, prefer BYOK/free-tier runners over subscription CLIs. */
const DEFAULT_AGENT_PREFERENCE: readonly string[] = [QAIQ_AGENT_ID, 'grok', 'codex', 'claude'];

const AGENT_ENV_PREFS: readonly { readonly env: string; readonly pref: string }[] = [
    { env: 'OPENAI_API_KEY', pref: 'ai-features.openAiOfficial.openAiApiKey' },
    { env: 'ANTHROPIC_API_KEY', pref: 'ai-features.anthropic.AnthropicApiKey' },
    { env: 'GOOGLE_API_KEY', pref: 'ai-features.google.apiKey' },
    { env: 'GEMINI_API_KEY', pref: 'ai-features.google.apiKey' },
    { env: 'OPENROUTER_API_KEY', pref: 'ai-features.openrouter.openrouterApiKey' },
    { env: 'OPENROUTER_BASE_URL', pref: 'ai-features.openrouter.openrouterBaseUrl' },
    { env: 'NVIDIA_API_KEY', pref: 'ai-features.nvidia.nvidiaApiKey' },
    { env: 'OLLAMA_HOST', pref: 'ai-features.ollama.ollamaHost' },
    { env: 'HUGGINGFACE_API_KEY', pref: 'ai-features.huggingFace.apiKey' },
];

/** Pseudo-agent that runs the prompt verbatim as a shell command. */
const SHELL_AGENT_ID = 'shell';
/** Reserved id for the QAAP_AGENT_COMMAND env-var template, when set. */
const ENV_AGENT_ID = 'env';

const STORE_DIR = path.join(os.homedir(), '.qaap', 'agent-tasks');
const INDEX_PATH = path.join(STORE_DIR, 'index.json');
const STORE_DIR_MODE = 0o700;
const STORE_FILE_MODE = 0o600;

/**
 * Versioned task index. Queued requests must be persisted alongside their public task summaries:
 * without the original request the runner cannot reconstruct the agent command after a backend
 * restart, and the old array-only format silently turned every queued task into a failure.
 */
interface PersistedAgentTaskIndex {
    readonly version: 2;
    readonly tasks: QaapAgentTask[];
    readonly queuedRequests: Record<string, QaapCreateAgentTaskRequest>;
}
/** Cap returned log size so a runaway task cannot blow up the response. */
const MAX_LOG_BYTES = 512 * 1024;
/** Kill agent CLIs that sit silent for too long, usually waiting for auth/quota/input. */
const IDLE_TASK_TIMEOUT_MS = 20 * 60 * 1000;
/**
 * Auto-approve runs ("approve for me") queue gated shell/network tools to the approvals UI,
 * but must not hang forever if nobody is watching — deny after this grace period so the
 * agent can finish the turn with the tools it has.
 */
const QUEUED_APPROVAL_GRACE_TIMEOUT_MS = 5 * 60 * 1000;
/** Default cap on simultaneously running VPS agent processes per backend instance. */
const DEFAULT_MAX_CONCURRENT_AGENTS = 4;
const MAX_CONCURRENT_AGENTS_ENV = 'QAAP_MAX_CONCURRENT_AGENTS';
/**
 * Default cap on simultaneously running agents for ONE authenticated user. Without it the global
 * cap is per-instance, so one user (or a fan-out of sub-tasks) fills every slot and starves all
 * other tenants — and each agent can spawn its own subprocesses, so RAM saturates first on a small
 * VPS. Only enforced for authenticated owners; the shared/anonymous (local single-user) bucket
 * keeps using the global cap alone.
 */
const DEFAULT_MAX_CONCURRENT_AGENTS_PER_USER = 2;
const MAX_CONCURRENT_AGENTS_PER_USER_ENV = 'QAAP_MAX_CONCURRENT_AGENTS_PER_USER';

/** Legacy single-token file (pre per-user tokens); retained only for directory creation. */
const TOKEN_PATH = path.join(os.homedir(), '.qaap', 'task-token');
/** Per-user helper-CLI tokens: `{ "<ownerLogin>": "<token>" }` (empty key = shared/anonymous). */
const TOKENS_PATH = path.join(os.homedir(), '.qaap', 'task-tokens.json');
/** Helper-CLI install location; agents get this dir prepended to their PATH. */
const HELPER_BIN_DIR = path.join(os.homedir(), '.qaap', 'bin');
const HELPER_BIN_PATH = path.join(HELPER_BIN_DIR, 'qaap-task');

/**
 * Source of the `qaap-task` helper script written to {@link HELPER_BIN_PATH} at startup.
 * The script POSTs `{prompt, cwd, parentId, agent?}` to the agent-tasks API using the shared
 * token, then prints the new task id and exits — fire-and-forget by design so a parent agent
 * can fan out work without blocking. Kept dependency-free (only Node built-ins).
 */
const HELPER_CLI_SOURCE = `#!/usr/bin/env node
'use strict';
const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

const apiUrl = process.env.QAAP_TASK_API_URL;
const token = process.env.QAAP_TASK_TOKEN;
if (!apiUrl || !token) {
    console.error('qaap-task: missing QAAP_TASK_API_URL or QAAP_TASK_TOKEN in env.');
    process.exit(2);
}

const args = process.argv.slice(2);
let agent;
const positional = [];
for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--agent' && i + 1 < args.length) {
        agent = args[++i];
    } else if (arg.startsWith('--agent=')) {
        agent = arg.slice('--agent='.length);
    } else if (arg === '--help' || arg === '-h') {
        console.log('Usage: qaap-task [--agent <id>] <prompt>');
        process.exit(0);
    } else {
        positional.push(arg);
    }
}
const prompt = positional.join(' ').trim();
if (!prompt) {
    console.error('qaap-task: <prompt> is required.');
    process.exit(2);
}

const payload = JSON.stringify({
    prompt,
    cwd: process.cwd(),
    parentId: process.env.QAAP_TASK_PARENT_ID || undefined,
    agent,
    autoApprove: process.env.QAAP_TASK_AUTO_APPROVE === '1' ? true : undefined,
});
const target = new URL(apiUrl);
const transport = target.protocol === 'https:' ? https : http;
const req = transport.request({
    hostname: target.hostname,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    path: target.pathname + (target.search || ''),
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'X-Qaap-Task-Token': token,
    },
}, res => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
                const task = JSON.parse(data);
                console.log(task.id || data);
            } catch {
                console.log(data);
            }
            process.exit(0);
        }
        console.error('qaap-task: HTTP ' + res.statusCode + ': ' + data);
        process.exit(1);
    });
});
req.on('error', err => { console.error('qaap-task: ' + err.message); process.exit(1); });
req.write(payload);
req.end();
`;

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

    @inject(PreferenceService) @optional()
    protected readonly preferenceService: PreferenceService | undefined;

    protected readonly tasks = new Map<string, QaapAgentTask>();
    protected readonly processes = new Map<string, ChildProcess>();
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
        this.detectAgents();
        this.ensureHelperCli();
        void this.restoreFromDisk();
    }

    /**
     * Provision the auth token and write the `qaap-task` helper script to disk so spawned
     * agents can call back into this API. Idempotent — safe to run on every startup.
     */
    protected ensureHelperCli(): void {
        try {
            fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
            this.loadHelperTokens();
            fs.mkdirSync(HELPER_BIN_DIR, { recursive: true });
            fs.writeFileSync(HELPER_BIN_PATH, HELPER_CLI_SOURCE, { mode: 0o755 });
        } catch (error) {
            console.warn('[qaap-agent-tasks] failed to install helper CLI:', error);
        }
    }

    /** Load persisted per-owner helper tokens (best-effort; tokens are re-created lazily if missing). */
    protected loadHelperTokens(): void {
        try {
            const raw = fs.readFileSync(TOKENS_PATH, 'utf8');
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            for (const [owner, token] of Object.entries(parsed)) {
                if (typeof token === 'string' && token) {
                    this.helperTokens.set(owner, token);
                }
            }
        } catch {
            /* no prior tokens — created on demand */
        }
    }

    protected persistHelperTokens(): void {
        try {
            const obj: Record<string, string> = {};
            for (const [owner, token] of this.helperTokens) {
                obj[owner] = token;
            }
            writeJsonAtomicSync(TOKENS_PATH, obj, { space: 0, mode: 0o600 });
        } catch {
            /* persistence is best-effort */
        }
    }

    /** Get-or-create the helper token bound to `ownerLogin` (`undefined` → shared/anonymous bucket). */
    protected helperTokenForOwner(ownerLogin?: string): string {
        const key = ownerLogin?.trim() ?? '';
        let token = this.helperTokens.get(key);
        if (!token) {
            token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
            this.helperTokens.set(key, token);
            this.persistHelperTokens();
        }
        return token;
    }

    /**
     * Reverse-lookup the owner that a presented helper token belongs to. Returns `{ ownerLogin }`
     * (with `ownerLogin` undefined for the shared bucket) when the token matches exactly one owner,
     * or `undefined` when no token matches. Comparison is constant-time per candidate.
     */
    resolveHelperTokenOwner(presented: string | undefined): { ownerLogin: string | undefined } | undefined {
        if (!presented) {
            return undefined;
        }
        const a = Buffer.from(presented);
        for (const [owner, token] of this.helperTokens) {
            const b = Buffer.from(token);
            if (a.length !== b.length) {
                continue;
            }
            let diff = 0;
            for (let i = 0; i < a.length; i++) {
                diff |= a[i] ^ b[i];
            }
            if (diff === 0) {
                return { ownerLogin: owner || undefined };
            }
        }
        return undefined;
    }

    /** True when the presented token matches any provisioned helper token. */
    verifyHelperToken(presented: string | undefined): boolean {
        return !!this.resolveHelperTokenOwner(presented);
    }

    /** Called by the backend application once the HTTP server is listening on `port`. */
    bindHelperApiUrl(port: number): void {
        this.helperApiUrl = `http://127.0.0.1:${port}/qaap/api/agent-tasks`;
    }

    /** Probe each known agent's binary on PATH once at startup. */
    protected detectAgents(): void {
        for (const candidate of AGENT_CANDIDATES) {
            if (this.isCandidateAvailable(candidate)) {
                this.detectedAgents.set(candidate.id, candidate);
            }
        }
        this.detectAntigravityAgent();
        this.detectCodexAgent();
        this.detectQaiqAgent();
        for (const candidate of this.readCustomAgents()) {
            if (this.isCandidateAvailable(candidate)) {
                this.detectedAgents.set(candidate.id, candidate);
            }
        }
        this.logDetectedAgents();
    }

    /** Startup diagnostics for VPS/Docker: confirms QAIQ is on PATH before users hit @qaiq. */
    protected logDetectedAgents(): void {
        const ids = [...this.detectedAgents.keys()];
        console.log(`[qaap-agent-tasks] detected agents: ${ids.length ? ids.join(', ') : '(none — install qaiq or set QAAP_AGENT_COMMAND)'}`);
        if (!this.detectedAgents.has(QAIQ_AGENT_ID)) {
            return;
        }
        try {
            const probe = spawnSync('qaiq', ['--version'], { encoding: 'utf8' });
            const line = (probe.stdout || probe.stderr || '').trim().split('\n')[0];
            if (line) {
                console.log(`[qaap-agent-tasks] qaiq: ${line}`);
            }
        } catch {
            /* ignore */
        }
    }

    protected isCandidateAvailable(candidate: AgentCandidate): boolean {
        return !candidate.bin || this.isOnPath(candidate.bin);
    }

    /**
     * Prefer the Google Antigravity CLI (`agy`), then community `antigravity`, then legacy `gemini`.
     */
    protected resolveAntigravityBin(): string | undefined {
        if (this.isOnPath('agy')) {
            return 'agy';
        }
        if (this.isOnPath('antigravity')) {
            return 'antigravity';
        }
        if (this.isOnPath('gemini')) {
            return 'gemini';
        }
        return undefined;
    }

    protected detectAntigravityAgent(): void {
        const bin = this.resolveAntigravityBin();
        if (!bin) {
            return;
        }
        const template = bin === 'gemini'
            ? 'gemini --approval-mode=yolo -p {prompt}'
            : `${bin} -p {prompt}`;
        this.detectedAgents.set('antigravity', {
            id: 'antigravity',
            label: 'Antigravity CLI',
            bin,
            template,
        });
    }

    /** Prefer `qaiq` on PATH; accept legacy `openclaude` binary until installs catch up. */
    protected resolveQaiqBin(): string | undefined {
        if (this.isOnPath('qaiq')) {
            return 'qaiq';
        }
        if (this.isOnPath('openclaude')) {
            return 'openclaude';
        }
        return undefined;
    }

    protected detectQaiqAgent(): void {
        const bin = this.resolveQaiqBin();
        if (!bin) {
            return;
        }
        this.detectedAgents.set(QAIQ_AGENT_ID, {
            id: QAIQ_AGENT_ID,
            label: 'QAIQ',
            bin,
            template: `${bin} --print --output-format stream-json --verbose --include-partial-messages {qaiq_flags} {prompt}`,
        });
    }

    protected detectCodexAgent(): void {
        if (!this.isOnPath('codex')) {
            return;
        }
        const help = this.readCodexHelp();
        this.detectedAgents.set('codex', {
            id: 'codex',
            label: 'Codex',
            bin: 'codex',
            template: resolveQaapCodexTemplate(help),
        });
    }

    protected readCodexHelp(): string {
        try {
            const probe = spawnSync('codex', ['--help'], { encoding: 'utf8' });
            return `${probe.stdout || ''}\n${probe.stderr || ''}`;
        } catch {
            return '';
        }
    }

    protected isQaiqRunner(agentId: string | undefined, command: string): boolean {
        if (agentId === QAIQ_AGENT_ID) {
            return true;
        }
        return /\b(qaiq|openclaude)\b/.test(command);
    }

    /**
     * Id of the coding agent that ran (or will run) {@link task}. Tasks created after {@link
     * QaapAgentTask.agentId} was introduced always carry it, resolved once in {@link
     * buildAgentCommand}. Tasks persisted before that field existed fall back to the same
     * command-sniffing heuristic {@link isQaiqRunner} always used — {@code 'qaiq'} when the command
     * looks like a QAIQ/OpenClaude invocation, else {@code 'shell'} (no coding agent to re-invoke
     * for a fix turn).
     */
    protected resolveTaskAgentId(task: QaapAgentTask): string {
        if (task.agentId) {
            return task.agentId;
        }
        return this.isQaiqRunner(undefined, task.command) ? QAIQ_AGENT_ID : SHELL_AGENT_ID;
    }

    protected readCustomAgents(): AgentCandidate[] {
        const raw = process.env[CUSTOM_AGENTS_ENV]?.trim();
        if (!raw) {
            return [];
        }
        try {
            const parsed = JSON.parse(raw) as unknown;
            if (!Array.isArray(parsed)) {
                throw new Error(`${CUSTOM_AGENTS_ENV} must be a JSON array.`);
            }
            return parsed.flatMap((entry, index) => this.parseCustomAgent(entry, index));
        } catch (error) {
            console.warn(`[qaap-agent-tasks] ignored ${CUSTOM_AGENTS_ENV}:`, error instanceof Error ? error.message : error);
            return [];
        }
    }

    protected parseCustomAgent(entry: unknown, index: number): AgentCandidate[] {
        if (!entry || typeof entry !== 'object') {
            console.warn(`[qaap-agent-tasks] ignored ${CUSTOM_AGENTS_ENV}[${index}]: entry must be an object.`);
            return [];
        }
        const record = entry as { id?: unknown; label?: unknown; bin?: unknown; template?: unknown; command?: unknown };
        const id = typeof record.id === 'string' ? record.id.trim().toLowerCase() : '';
        const label = typeof record.label === 'string' ? record.label.trim() : '';
        const bin = typeof record.bin === 'string' ? record.bin.trim() : undefined;
        const template = typeof record.template === 'string'
            ? record.template.trim()
            : typeof record.command === 'string'
                ? record.command.trim()
                : '';
        if (
            !/^[a-z][a-z0-9-]{1,63}$/.test(id)
            || id === SHELL_AGENT_ID
            || id === ENV_AGENT_ID
            || id === QAIQ_AGENT_ID
            || AGENT_CANDIDATES.some(candidate => candidate.id === id)
        ) {
            console.warn(`[qaap-agent-tasks] ignored ${CUSTOM_AGENTS_ENV}[${index}]: invalid or reserved id "${id}".`);
            return [];
        }
        if (!template) {
            console.warn(`[qaap-agent-tasks] ignored ${CUSTOM_AGENTS_ENV}[${index}]: template is required.`);
            return [];
        }
        return [{ id, label: label || id, bin, template }];
    }

    protected isOnPath(bin: string): boolean {
        const cmd = process.platform === 'win32' ? 'where' : 'which';
        try {
            return spawnSync(cmd, [bin], { stdio: 'ignore' }).status === 0;
        } catch {
            return false;
        }
    }

    /** Reload persisted tasks; any task still marked running lost its process on backend restart. */
    protected async restoreFromDisk(): Promise<void> {
        try {
            const raw = await fsp.readFile(INDEX_PATH, 'utf8');
            this.restorePersistedIndex(JSON.parse(raw));
            await this.persist();
            this.drainQueuedTasks();
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                console.warn('[qaap-agent-tasks] failed to restore task index:', error);
            }
        }
    }

    /**
     * Restore both the current versioned index and the legacy task-array format. A legacy queued
     * task has no executable request to resume, so report it as interrupted rather than claiming
     * that a newly attempted run failed.
     */
    protected restorePersistedIndex(stored: unknown): void {
        const legacy = Array.isArray(stored);
        const tasks = legacy
            ? stored as QaapAgentTask[]
            : (stored as Partial<PersistedAgentTaskIndex> | undefined)?.tasks;
        const queuedRequests: Readonly<Record<string, QaapCreateAgentTaskRequest>> = legacy
            ? {}
            : (stored as Partial<PersistedAgentTaskIndex> | undefined)?.queuedRequests ?? {};
        if (!Array.isArray(tasks)) {
            throw new Error('Invalid persisted agent task index.');
        }
        for (const task of tasks) {
            if (!task?.id) {
                continue;
            }
            const queuedRequest = task.state === 'queued' ? queuedRequests[task.id] : undefined;
            const state = task.state === 'running' || (task.state === 'queued' && !queuedRequest)
                ? 'interrupted' as const
                : task.state;
            this.tasks.set(task.id, { ...task, state });
            if (state === 'queued' && queuedRequest) {
                this.queuedCreateRequests.set(task.id, queuedRequest);
            }
        }
    }

    protected maxConcurrentAgents(): number {
        const raw = process.env[MAX_CONCURRENT_AGENTS_ENV]?.trim();
        if (!raw) {
            return DEFAULT_MAX_CONCURRENT_AGENTS;
        }
        const parsed = Number.parseInt(raw, 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_CONCURRENT_AGENTS;
    }

    protected countRunningTasks(): number {
        let count = 0;
        for (const task of this.tasks.values()) {
            if (task.state === 'running') {
                count++;
            }
        }
        return count;
    }

    protected maxConcurrentAgentsPerUser(): number {
        const raw = process.env[MAX_CONCURRENT_AGENTS_PER_USER_ENV]?.trim();
        if (!raw) {
            return DEFAULT_MAX_CONCURRENT_AGENTS_PER_USER;
        }
        const parsed = Number.parseInt(raw, 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_CONCURRENT_AGENTS_PER_USER;
    }

    protected runningTaskCountForOwner(ownerLogin: string): number {
        let count = 0;
        for (const task of this.tasks.values()) {
            if (task.state === 'running' && task.ownerLogin === ownerLogin) {
                count++;
            }
        }
        return count;
    }

    /**
     * True when this owner already has their per-user quota of running agents. Only authenticated
     * owners are capped; the shared/anonymous bucket (`undefined`/empty, i.e. local single-user)
     * is governed by the global cap alone so it is never throttled below it.
     */
    protected ownerAtConcurrencyCap(ownerLogin: string | undefined): boolean {
        const owner = ownerLogin?.trim();
        if (!owner) {
            return false;
        }
        return this.runningTaskCountForOwner(owner) >= this.maxConcurrentAgentsPerUser();
    }

    protected drainQueuedTasks(): void {
        while (this.countRunningTasks() < this.maxConcurrentAgents()) {
            // Skip queued tasks whose owner is already at their per-user cap so one busy user can't
            // block everyone behind them in the FIFO queue — promote the next eligible tenant instead.
            const next = [...this.tasks.values()]
                .filter(task => task.state === 'queued' && !this.ownerAtConcurrencyCap(task.ownerLogin))
                .sort((left, right) => left.createdAt - right.createdAt)[0];
            if (!next) {
                return;
            }
            const request = this.queuedCreateRequests.get(next.id);
            if (!request) {
                this.finishTask(next.id, 'failed', undefined);
                continue;
            }
            const running: QaapAgentTask = { ...next, state: 'running' };
            this.tasks.set(next.id, running);
            this.queuedCreateRequests.delete(next.id);
            void this.spawnProcessWhenReady(running, request);
            void this.persist();
            this.onDidChangeTaskEmitter.fire({ type: 'created', task: running });
        }
    }

    list(): QaapAgentTask[] {
        return [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
    }

    /** Tasks scoped to one project (by working directory); all tasks when `cwd` is omitted. */
    listForCwd(cwd: string | undefined): QaapAgentTask[] {
        const all = this.list();
        if (!cwd) {
            return all;
        }
        const resolved = path.resolve(cwd);
        return all.filter(task => task.cwd === resolved);
    }

    /**
     * All tasks bucketed by their (already-normalized) {@link QaapAgentTask.cwd}. Groups are
     * ordered by the most recent task in each — so a project with an actively-running task floats
     * to the top of the cross-project dashboard.
     */
    listAllGroupedByCwd(): QaapAgentTaskCwdGroup[] {
        const buckets = new Map<string, QaapAgentTask[]>();
        for (const task of this.list()) {
            const bucket = buckets.get(task.cwd);
            if (bucket) {
                bucket.push(task);
            } else {
                buckets.set(task.cwd, [task]);
            }
        }
        const groups: QaapAgentTaskCwdGroup[] = [];
        for (const [cwd, tasks] of buckets) {
            groups.push({
                cwd,
                projectName: this.resolveProjectName(cwd),
                activeCount: tasks.reduce((n, task) => n + (task.state === 'running' ? 1 : 0), 0),
                tasks,
            });
        }
        // `list()` already returns newest-first, so tasks[0] is the most recent in each group.
        groups.sort((a, b) => (b.tasks[0]?.createdAt ?? 0) - (a.tasks[0]?.createdAt ?? 0));
        return groups;
    }

    /**
     * Best-effort display name for a cwd. Reads `package.json#name` once and caches it; falls
     * back to the directory basename when no package manifest is present or readable.
     */
    protected resolveProjectName(cwd: string): string {
        const cached = this.projectNameCache.get(cwd);
        if (cached !== undefined) {
            return cached;
        }
        let name = path.basename(cwd) || cwd;
        try {
            const manifest = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')) as { name?: unknown };
            if (typeof manifest.name === 'string' && manifest.name.trim()) {
                name = manifest.name.trim();
            }
        } catch {
            /* no package.json — fall back to basename */
        }
        this.projectNameCache.set(cwd, name);
        return name;
    }

    /** True when at least one coding agent is available — autodetected or env-configured. */
    isAgentConfigured(): boolean {
        return this.detectedAgents.size > 0 || !!process.env.QAAP_AGENT_COMMAND?.trim();
    }

    /** Agents the UI can offer in its picker, in priority order. */
    listAgents(): QaapAgentDescriptor[] {
        const result: QaapAgentDescriptor[] = [];
        for (const candidate of AGENT_CANDIDATES) {
            if (this.detectedAgents.has(candidate.id)) {
                result.push({ id: candidate.id, label: candidate.label, available: true });
            }
        }
        for (const [, candidate] of this.detectedAgents) {
            if (!AGENT_CANDIDATES.some(builtIn => builtIn.id === candidate.id)) {
                result.push({ id: candidate.id, label: candidate.label, available: true });
            }
        }
        if (process.env.QAAP_AGENT_COMMAND?.trim()) {
            result.push({ id: ENV_AGENT_ID, label: 'Custom (QAAP_AGENT_COMMAND)', available: true });
        }
        result.push({ id: SHELL_AGENT_ID, label: 'Shell command', available: true });
        return result.filter(agent => !isUiHiddenVpsAgent(agent.id));
    }

    /**
     * Best-effort warm-up after workspace open: cache project metadata and probe the QAIQ binary
     * so the first user message skips cold-start disk reads and Node CLI startup.
     */
    warmForCwd(cwd: string): QaapAgentWarmResult {
        const resolved = path.resolve(cwd);
        if (!fs.existsSync(resolved)) {
            throw new Error(`Workspace directory does not exist: ${resolved}`);
        }
        this.readProjectInfo(resolved);
        this.readAgentInstructions(resolved);
        this.readRepoMap(resolved);
        this.resolveProjectName(resolved);
        const qaiqProbed = this.probeAgentBinOnce(QAIQ_AGENT_ID, () => this.resolveQaiqBin());
        return {
            cwd: resolved,
            agentsReady: this.isAgentConfigured(),
            projectInfoCached: this.projectInfoCache.has(resolved),
            projectNameCached: this.projectNameCache.has(resolved),
            qaiqProbed,
        };
    }

    protected probeAgentBinOnce(agentId: string, resolveBin: () => string | undefined): boolean {
        if (this.probedAgentBins.has(agentId)) {
            return true;
        }
        const bin = resolveBin();
        if (!bin) {
            return false;
        }
        try {
            spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 8000 });
            this.probedAgentBins.add(agentId);
            return true;
        } catch {
            return false;
        }
    }

    listQaiqModels(): QaapQaiqModelOption[] {
        if (!this.preferenceService) {
            return [];
        }
        return listQaiqModelsFromPreferences(
            key => this.preferenceService!.get(key),
            key => process.env[key],
        );
    }

    /** Model options for the mobile agent picker (native CLI catalog, or Settings on the browser for Qwen). */
    listModelsForAgent(agentId: string | undefined): QaapQaiqModelOption[] {
        const normalized = this.normalizeAgentId(agentId ?? '');
        if (!normalized || agentUsesSettingsModelCatalog(normalized)) {
            return [];
        }
        return listNativeAgentModels(normalized);
    }

    /** Id picked when a create request omits one — first detected agent, env template, or shell. */
    defaultAgent(): string {
        const configured = this.normalizeAgentId(process.env.QAAP_DEFAULT_AGENT);
        if (configured && this.detectedAgents.has(configured) && !isUiHiddenVpsAgent(configured)) {
            return configured;
        }
        for (const id of DEFAULT_AGENT_PREFERENCE) {
            if (this.detectedAgents.has(id) && !isUiHiddenVpsAgent(id)) {
                return id;
            }
        }
        for (const candidate of [...this.detectedAgents.values()]) {
            if (
                !AGENT_CANDIDATES.some(builtIn => builtIn.id === candidate.id)
                && !isUiHiddenVpsAgent(candidate.id)
            ) {
                return candidate.id;
            }
        }
        if (process.env.QAAP_AGENT_COMMAND?.trim()) {
            return ENV_AGENT_ID;
        }
        return SHELL_AGENT_ID;
    }

    /** Public resolver used by conversation/mobile bridges to accept dynamic custom agent ids. */
    normalizeAgentId(token: string | undefined): string | undefined {
        const normalized = token?.trim().toLowerCase();
        if (!normalized) {
            return undefined;
        }
        const canonical = resolveQaapAgentMentionToken(normalized);
        if (canonical === LEGACY_OPENCLAUDE_AGENT_ID && this.detectedAgents.has(QAIQ_AGENT_ID)) {
            return QAIQ_AGENT_ID;
        }
        if (canonical === SHELL_AGENT_ID) {
            return SHELL_AGENT_ID;
        }
        if (canonical === ENV_AGENT_ID && process.env.QAAP_AGENT_COMMAND?.trim()) {
            return ENV_AGENT_ID;
        }
        if (this.detectedAgents.has(canonical)) {
            return canonical;
        }
        const builtin = resolveQaapBuiltinAgentMentionId(canonical);
        if (builtin && this.detectedAgents.has(builtin)) {
            return builtin;
        }
        return undefined;
    }

    async detail(id: string): Promise<QaapAgentTaskDetail | undefined> {
        const task = this.tasks.get(id);
        if (!task) {
            return undefined;
        }
        return { ...task, log: await this.readLog(id) };
    }

    /** Resolve explicit picker model or route by task kind when none was sent. */
    protected resolveAgentModelForRequest(
        request: QaapCreateAgentTaskRequest,
        prompt: string,
    ): QaapCreateAgentTaskQaiqModel | undefined {
        const explicit = resolveRequestAgentModel(request);
        if (explicit) {
            return explicit;
        }
        if (!this.preferenceService) {
            return undefined;
        }
        const agentId = this.resolveAgentId(prompt, request.agent);
        return resolveEffectiveRequestAgentModel(
            request,
            key => this.preferenceService!.get(key),
            agentId,
        );
    }

    /** Validate the request, spawn the process and start tracking the task. */
    create(request: QaapCreateAgentTaskRequest, ownerLogin?: string): QaapAgentTask {
        const prompt = (request.prompt ?? '').trim();
        const rawCommand = (request.command ?? '').trim();
        if (!prompt && !rawCommand) {
            throw new Error('A non-empty "command" or "prompt" is required.');
        }
        const cwd = path.resolve(request.cwd ?? '');
        if (!path.isAbsolute(cwd) || !this.isDirectory(cwd)) {
            throw new Error('A valid absolute "cwd" directory is required.');
        }
        // Last line of defence, shared by every caller (endpoints, routine runner, retries): a
        // container cwd would spawn the agent over EVERY repository the user owns at once — wrong
        // scope, and an enormous LLM context billed to them. Endpoints normally reject it earlier.
        if (isQaapWorkspaceContainerPath(cwd)) {
            throw new Error(QAAP_CONTAINER_CWD_ERROR);
        }
        const id = randomUUID();
        const parentId = request.parentId && this.tasks.has(request.parentId) ? request.parentId : undefined;
        const parentTask = parentId ? this.tasks.get(parentId) : undefined;
        const autoApprove = resolveAgentAutoApprove(
            request.autoApprove ?? (parentTask?.autoApprove !== false ? undefined : false),
        );
        const atCapacity = this.countRunningTasks() >= this.maxConcurrentAgents()
            || this.ownerAtConcurrencyCap(ownerLogin);
        const task: QaapAgentTask = {
            id,
            title: (request.title ?? '').trim() || prompt || rawCommand,
            command: rawCommand || prompt,
            cwd,
            state: atCapacity ? 'queued' : 'running',
            createdAt: Date.now(),
            parentId,
            autoApprove,
            ...(ownerLogin ? { ownerLogin } : {}),
            ...(request.latencyMarks ? { latencyMarks: request.latencyMarks } : {}),
            ...(() => {
                const agentModel = this.resolveAgentModelForRequest(request, prompt || rawCommand);
                return agentModel ? { agentModel, qaiqModel: agentModel } : {};
            })(),
        };
        this.tasks.set(id, task);
        if (atCapacity) {
            this.queuedCreateRequests.set(id, request);
        } else {
            void this.spawnProcessWhenReady(task, request);
        }
        void this.persist();
        this.onDidChangeTaskEmitter.fire({ type: 'created', task });
        return task;
    }

    /**
     * Turn a natural-language prompt into the command that runs the coding agent.
     *
     * Resolution order, given the requested {@link agentId}:
     *   1. A detected built-in agent (`claude`, `codex`, `qaiq`, `grok`) → use its template.
     *   2. `'env'` or any unknown id, when `QAAP_AGENT_COMMAND` is set → use that template.
     *   3. `'shell'`, or no agent available → run the prompt verbatim as a shell command.
     *
     * A template's `{prompt}` placeholder is replaced with a POSIX shell-quoted prompt;
     * without a placeholder the prompt is appended.
     *
     * QAIQ + explicit "request approval" uses the SDK stdio permission flow: the prompt moves to stdin
     * ({@code stdinPrompt}) and the CLI is launched with {@link QAIQ_STDIO_APPROVAL_FLAGS}.
     * Default {@code approve-for-me} / {@code full-access} stay non-interactive (OpenCode-style):
     * {@code --dangerously-skip-permissions}, stream-json on stdout, blocked headless tools at CLI.
     */
    protected buildAgentCommand(
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
    ): { command: string; stdinPrompt?: string; agentId: string } {
        const id = this.resolveAgentId(prompt, agentId);
        const runnerPrompt = this.stripLeadingAgentMention(prompt);
        if (id === SHELL_AGENT_ID) {
            return { command: runnerPrompt, agentId: id };
        }
        const workflowPrompt = appendAgentDefaultWorkflowToPrompt(
            runnerPrompt,
            id,
            { gitAvailable: cwd ? fs.existsSync(path.join(path.resolve(cwd), '.git')) : true },
        );
        // Inject important project context for every agent: cross-project context from the request
        // body, the per-project info artifact, the repo's own agent instructions (CLAUDE.md /
        // AGENTS.md), and a shallow repo map — so a stateless CLI starts warm instead of cold.
        const resolvedCwd = cwd ? path.resolve(cwd) : undefined;
        const repoContext: QaapAgentRepoContext | undefined = resolvedCwd
            ? {
                agentInstructions: this.readAgentInstructions(resolvedCwd),
                repoMap: this.readRepoMap(resolvedCwd),
                relevantFiles: this.readRelevantFiles(resolvedCwd, userQuery),
                gitStatus: this.readGitStatusSnapshot(resolvedCwd),
                repoMemory: this.readRepoMemory(resolvedCwd),
                researchLedger: this.readResearchLedger(resolvedCwd),
            }
            : undefined;
        const agentPrompt = prependAgentTaskContextToPrompt(
            workflowPrompt,
            contextPreamble,
            resolvedCwd ? this.readProjectInfo(resolvedCwd) : undefined,
            repoContext,
        );
        this.assertQaiqConfigured(id);
        const detected = this.detectedAgents.get(id);
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
        };
        const useStdioApprovals = id === QAIQ_AGENT_ID
            && !!detected
            && shouldUseQaiqStdioApprovals(approvalOptions);
        if (detected) {
            const vars = this.buildTemplateVars(id, agentModel, interaction);
            command = useStdioApprovals
                ? this.applyTemplateWithoutPrompt(detected.template, vars)
                : this.applyTemplate(detected.template, agentPrompt, vars);
        } else {
            const envTemplate = process.env.QAAP_AGENT_COMMAND?.trim();
            if (envTemplate) {
                command = this.applyTemplate(envTemplate, agentPrompt, this.buildTemplateVars(id, agentModel, interaction));
            } else {
                command = agentPrompt;
            }
        }
        command = applyAgentApprovalPolicyToCommand(command, approvalOptions);
        if (useStdioApprovals) {
            return { command: `${command} ${QAIQ_STDIO_APPROVAL_FLAGS}`, stdinPrompt: agentPrompt, agentId: id };
        }
        return { command, agentId: id };
    }

    /** Best-effort read of the workspace per-project info artifact (`.prompts/project-info.prompttemplate`). */
    protected readProjectInfo(cwd: string): string | undefined {
        const resolved = path.resolve(cwd);
        if (this.projectInfoCache.has(resolved)) {
            return this.projectInfoCache.get(resolved);
        }
        const info = this.loadProjectInfoFromDisk(resolved);
        this.projectInfoCache.set(resolved, info);
        return info;
    }

    protected loadProjectInfoFromDisk(cwd: string): string | undefined {
        try {
            const file = path.join(cwd, '.prompts', 'project-info.prompttemplate');
            const text = fs.readFileSync(file, 'utf8').trim();
            if (!text) {
                return undefined;
            }
            return truncateProjectInfo(text, PROJECT_INFO_MAX_CHARS);
        } catch {
            return undefined;
        }
    }

    /**
     * Best-effort read of the workspace's own agent-instructions file (`CLAUDE.md` / `AGENTS.md` /
     * `.cursorrules`). QAIQ is a Claude-Code-family CLI, but spawned fresh per turn in the workspace
     * cwd, so it never auto-loads these — injecting them makes it honor the repo's rules from turn 1.
     */
    protected readAgentInstructions(cwd: string): string | undefined {
        const resolved = path.resolve(cwd);
        if (this.agentInstructionsCache.has(resolved)) {
            return this.agentInstructionsCache.get(resolved);
        }
        const info = this.loadAgentInstructionsFromDisk(resolved);
        this.agentInstructionsCache.set(resolved, info);
        return info;
    }

    protected loadAgentInstructionsFromDisk(cwd: string): string | undefined {
        for (const name of AGENT_INSTRUCTION_FILES) {
            try {
                const text = fs.readFileSync(path.join(cwd, name), 'utf8').trim();
                if (text) {
                    return truncateProjectInfo(text, AGENT_INSTRUCTIONS_MAX_CHARS);
                }
            } catch {
                // Try the next candidate filename.
            }
        }
        return undefined;
    }

    /**
     * Best-effort shallow repo map: a two-level source tree plus recently-changed files. Cached with
     * a short TTL because the changed-files list drifts as the agent works. Front-loading the repo
     * shape is the single biggest context edge over a cold-searching CLI (the Cursor-style priming).
     */
    protected readRepoMap(cwd: string): string | undefined {
        const resolved = path.resolve(cwd);
        const cached = this.repoMapCache.get(resolved);
        if (cached && Date.now() - cached.at < REPO_MAP_CACHE_TTL_MS) {
            return cached.text;
        }
        const text = this.buildRepoMap(resolved);
        this.repoMapCache.set(resolved, { text, at: Date.now() });
        return text;
    }

    /**
     * Query-specific "likely relevant files" hint: ripgrep the user's message keywords over the repo
     * and return the top matching file paths (repo-relative). Best-effort — returns undefined when
     * disabled, no keywords, ripgrep missing, or nothing matches. Bounded and short-timeout so it
     * never blocks a turn.
     */
    protected readRelevantFiles(cwd: string, userQuery: string | undefined): string | undefined {
        if (!QAAP_AGENT_RETRIEVAL_ENABLED) {
            return undefined;
        }
        const keywords = extractRetrievalKeywords(userQuery);
        if (keywords.length === 0) {
            return undefined;
        }
        try {
            // Case-insensitive, files-with-matches, count per file so we can rank by hit count.
            // Exclude the hygiene dirs; -g globs keep it scoped to source.
            const pattern = keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
            const args = ['--count-matches', '--no-messages', '-i', '-e', pattern, '--max-count', '50'];
            for (const dir of REPO_MAP_EXCLUDED_DIRS) {
                args.push('-g', `!${dir}/**`);
            }
            args.push('--', '.');
            const out = spawnSync('rg', args, { cwd, encoding: 'utf8', timeout: 4000, maxBuffer: 4 * 1024 * 1024 });
            if (out.status !== 0 && out.status !== 1 || !out.stdout) {
                return undefined; // status 1 = no matches; other non-zero = rg missing/error
            }
            const ranked: Array<{ file: string; hits: number }> = [];
            for (const line of out.stdout.split('\n')) {
                const sep = line.lastIndexOf(':');
                if (sep <= 0) {
                    continue;
                }
                const file = line.slice(0, sep).replace(/^\.\//, '');
                const hits = Number.parseInt(line.slice(sep + 1), 10);
                if (file && Number.isFinite(hits)) {
                    ranked.push({ file, hits });
                }
            }
            ranked.sort((a, b) => b.hits - a.hits);
            return formatRelevantFilesHint(ranked.slice(0, RETRIEVAL_MAX_FILES).map(r => r.file), RETRIEVAL_HINT_MAX_CHARS);
        } catch {
            return undefined;
        }
    }

    protected buildRepoMap(cwd: string): string | undefined {
        const sections: string[] = [];
        const profile = buildQaapAgentRepoProfile(cwd);
        if (profile) {
            sections.push(profile);
        }
        const tree = this.buildRepoTree(cwd);
        if (tree) {
            sections.push(tree);
        }
        const changed = this.buildRecentlyChangedFiles(cwd);
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

    /** Two-level directory listing, source dirs expanded one level, hygiene dirs excluded. */
    protected buildRepoTree(cwd: string): string | undefined {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(cwd, { withFileTypes: true });
        } catch {
            return undefined;
        }
        const lines: string[] = [];
        const dirs = entries.filter(e => e.isDirectory() && !REPO_MAP_EXCLUDED_DIRS.has(e.name) && !e.name.startsWith('.'))
            .map(e => e.name).sort();
        const files = entries.filter(e => e.isFile() && !e.name.startsWith('.')).map(e => e.name).sort();
        for (const dir of dirs) {
            lines.push(`${dir}/`);
            if (REPO_MAP_SOURCE_DIRS.has(dir)) {
                let children: fs.Dirent[] = [];
                try {
                    children = fs.readdirSync(path.join(cwd, dir), { withFileTypes: true });
                } catch {
                    children = [];
                }
                const childNames = children
                    .filter(c => !REPO_MAP_EXCLUDED_DIRS.has(c.name) && !c.name.startsWith('.'))
                    .map(c => (c.isDirectory() ? `${c.name}/` : c.name))
                    .sort()
                    .slice(0, 40);
                for (const child of childNames) {
                    lines.push(`  ${child}`);
                }
            }
        }
        for (const file of files.slice(0, 30)) {
            lines.push(file);
        }
        if (lines.length === 0) {
            return undefined;
        }
        return `Source tree (depth 2):\n${lines.join('\n')}`;
    }

    /** Recently-changed files via git, so the agent knows where work is already in flight. */
    protected buildRecentlyChangedFiles(cwd: string): string | undefined {
        if (!fs.existsSync(path.join(cwd, '.git'))) {
            return undefined;
        }
        const names = new Set<string>();
        for (const args of [['diff', '--name-only', 'HEAD~5', '--'], ['status', '--porcelain', '--untracked-files=all']]) {
            try {
                const out = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 4000 });
                if (out.status !== 0 || !out.stdout) {
                    continue;
                }
                for (const raw of out.stdout.split('\n')) {
                    const line = args[0] === 'status' ? raw.slice(3).trim() : raw.trim();
                    if (line) {
                        names.add(line);
                    }
                    if (names.size >= 25) {
                        break;
                    }
                }
            } catch {
                // git unavailable or slow — skip this source.
            }
        }
        if (names.size === 0) {
            return undefined;
        }
        return `Recently changed files:\n${[...names].slice(0, 25).map(n => `- ${n}`).join('\n')}`;
    }

    /**
     * Fresh branch + working-tree + recent-commits snapshot, so the agent starts every turn knowing
     * where it stands instead of spending its first tool call on `git status`. Never cached — the
     * working tree drifts as the agent edits between turns.
     */
    protected readGitStatusSnapshot(cwd: string): string | undefined {
        if (!fs.existsSync(path.join(cwd, '.git'))) {
            return undefined;
        }
        const run = (args: string[]): string | undefined => {
            try {
                const out = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 4000 });
                return out.status === 0 && out.stdout.trim() ? out.stdout.trim() : undefined;
            } catch {
                return undefined;
            }
        };
        const sections: string[] = [];
        const branch = run(['rev-parse', '--abbrev-ref', 'HEAD']);
        if (branch) {
            sections.push(`Branch: ${branch}`);
        }
        const status = run(['status', '--porcelain']);
        if (status) {
            const lines = status.split('\n');
            const shown = lines.slice(0, 20);
            const more = lines.length > shown.length ? `\n…(${lines.length - shown.length} more)` : '';
            sections.push(`Working tree:\n${shown.join('\n')}${more}`);
        } else {
            sections.push('Working tree: clean');
        }
        const log = run(['log', '--oneline', '-5']);
        if (log) {
            sections.push(`Recent commits:\n${log}`);
        }
        if (sections.length === 0) {
            return undefined;
        }
        const text = sections.join('\n\n');
        return text.length > GIT_STATUS_SNAPSHOT_MAX_CHARS
            ? `${text.slice(0, GIT_STATUS_SNAPSHOT_MAX_CHARS - 1).trimEnd()}…`
            : text;
    }

    /**
     * Durable repo memory (`.qaap/memory.md`) appended by previous agent turns — user corrections,
     * lasting preferences, non-obvious repo facts. Never cached: the agent updates it between turns.
     */
    protected readRepoMemory(cwd: string): string | undefined {
        try {
            const text = fs.readFileSync(path.join(cwd, '.qaap', 'memory.md'), 'utf8').trim();
            return text ? truncateProjectInfo(text, REPO_MEMORY_MAX_CHARS) : undefined;
        } catch {
            return undefined;
        }
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
        try {
            const raw = fs.readFileSync(path.join(cwd, '.qaap', 'experiments.jsonl'), 'utf8');
            const rounds = raw.split('\n').map(line => line.trim()).filter(line => line.length > 0).length;
            if (rounds === 0) {
                return undefined;
            }
            return `An auto-researcher loop is active in this repository (${rounds} experiment round${rounds === 1 ? '' : 's'} `
                + 'recorded so far). Do not edit `.qaap/experiments.jsonl` — it is written by the research runner, not agents.';
        } catch {
            return undefined;
        }
    }

    protected resolveAgentId(prompt: string, agentId: string | undefined): string {
        const explicit = this.normalizeAgentId(agentId);
        if (explicit) {
            return explicit;
        }
        if (agentId?.trim()) {
            throw new Error(`Agent "${agentId.trim()}" is not available on this server.`);
        }
        const mentioned = this.extractLastAgentMention(prompt);
        if (mentioned) {
            return mentioned;
        }
        const unavailableMention = this.extractLastAgentMentionToken(prompt);
        if (unavailableMention) {
            throw new Error(`Agent "@${unavailableMention}" is not available on this server.`);
        }
        return this.defaultAgent();
    }

    /** Last recognized `@agent` token wins — avoids stale mentions earlier in a long transcript. */
    protected extractLastAgentMention(prompt: string): string | undefined {
        const regex = /@([a-z][\w-]*)/gi;
        let last: string | undefined;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(prompt)) !== null) {
            const normalized = this.normalizeMentionToken(match[1]);
            if (normalized) {
                last = normalized;
            }
        }
        return last;
    }

    protected extractLastAgentMentionToken(prompt: string): string | undefined {
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
                || this.detectedAgents.has(token)
            ) {
                last = resolveQaapBuiltinAgentMentionId(token) ?? token;
            }
        }
        return last;
    }

    protected normalizeMentionToken(token: string): string | undefined {
        const normalized = token.toLowerCase();
        return this.normalizeAgentId(normalized);
    }

    protected stripLeadingAgentMention(prompt: string): string {
        const match = /^@([a-z][\w-]*)\b\s*/i.exec(prompt);
        if (match && this.normalizeMentionToken(match[1])) {
            return prompt.slice(match[0].length).trim() || prompt.trim();
        }
        return prompt.trim();
    }

    protected buildTemplateVars(
        agentId: string,
        agentModel?: QaapCreateAgentTaskQaiqModel,
        interaction?: QaapQaiqInteractionFlagOptions,
    ): Record<string, string> {
        const empty = { qaiq_flags: '', model_flags: '' };
        const qaiqInteractionFlags = agentId === QAIQ_AGENT_ID
            ? formatQaiqInteractionFlags(interaction ?? {})
            : '';
        const joinQaiqFlags = (...parts: string[]): string => parts.map(part => part.trim()).filter(Boolean).join(' ');
        if (agentModel?.provider && agentModel.modelId?.trim()) {
            const binding = this.normalizeAgentBinding(bindingFromQaiqModelSelection(agentModel));
            const flags = formatModelFlagsForAgent(agentId, binding);
            if (agentId === QAIQ_AGENT_ID) {
                return { qaiq_flags: joinQaiqFlags(qaiqInteractionFlags, flags), model_flags: '' };
            }
            return { qaiq_flags: '', model_flags: flags };
        }
        if (agentId === QAIQ_AGENT_ID) {
            return { qaiq_flags: joinQaiqFlags(qaiqInteractionFlags, this.resolveQaiqProviderFlags()), model_flags: '' };
        }
        return empty;
    }

    /**
     * Pick QAIQ --provider/--model flags from languageModelAliases and provider model lists so
     * background jobs follow the same model the user configured in Settings.
     */
    protected resolveQaiqProviderFlags(): string {
        const binding = this.resolveQaapQaiqBinding();
        if (binding) {
            return formatQaiqProviderFlags(binding);
        }
        return this.resolveQaiqProviderFlagsFromEnv(this.previewProviderEnv());
    }

    protected resolveQaapQaiqBinding(): QaapQaiqModelBinding | undefined {
        if (!this.preferenceService) {
            return undefined;
        }
        return resolveQaapQaiqModelBinding(key => this.preferenceService!.get(key));
    }

    /** Prefer the model the user picked in the composer; fall back to Settings aliases. */
    protected resolveAgentBindingForTask(task: QaapAgentTask): QaapQaiqModelBinding | undefined {
        const selected = resolveTaskAgentModel(task);
        if (selected?.provider && selected.modelId?.trim()) {
            return this.normalizeAgentBinding(bindingFromQaiqModelSelection(selected));
        }
        if (this.isQaiqRunner(undefined, task.command)) {
            const binding = this.resolveQaapQaiqBinding();
            return binding ? this.normalizeAgentBinding(binding) : undefined;
        }
        return undefined;
    }

    protected normalizeAgentBinding(binding: QaapQaiqModelBinding): QaapQaiqModelBinding {
        if (!this.preferenceService) {
            return binding;
        }
        return normalizeQaiqModelBinding(binding, key => this.preferenceService!.get(key));
    }

    protected previewProviderEnv(): NodeJS.ProcessEnv {
        const env: NodeJS.ProcessEnv = { ...process.env };
        this.applyProviderPreferenceEnv(env, undefined);
        return env;
    }

    /** Env-only fallback when no model alias or provider list is configured yet. */
    protected resolveQaiqProviderFlagsFromEnv(env: NodeJS.ProcessEnv): string {
        if (env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim()) {
            return '--provider gemini --model gemini-2.5-flash';
        }
        if (env.OPENROUTER_API_KEY?.trim()) {
            return '--provider openai --model nvidia/nemotron-3-super-120b-a12b:free';
        }
        if (env.NVIDIA_API_KEY?.trim()) {
            return '--provider openai --model meta/llama-3.3-70b-instruct';
        }
        if (env.OLLAMA_HOST?.trim()) {
            return '--provider ollama --model qwen2.5-coder:7b';
        }
        if (env.OPENAI_API_KEY?.trim()) {
            return '--provider openai';
        }
        return '';
    }

    /** Fail fast when QAIQ would fall back to Anthropic OAuth / empty auth and hang. */
    protected assertQaiqConfigured(agentId: string): void {
        if (agentId !== QAIQ_AGENT_ID) {
            return;
        }
        const env = this.previewProviderEnv();
        if (this.resolveQaiqProviderFlags()) {
            return;
        }
        if (env.ANTHROPIC_API_KEY?.trim() || env.OPENAI_API_KEY?.trim()) {
            return;
        }
        throw new Error(
            'QAIQ needs an API key from QAAP Settings (Gemini, OpenRouter, NVIDIA, Ollama, OpenAI, or Anthropic) '
            + 'or from server env (e.g. OPENROUTER_API_KEY / GEMINI_API_KEY in .env on Docker). '
            + 'Add one, restart the server, then retry.'
        );
    }

    protected applyTemplate(template: string, prompt: string, vars: Record<string, string> = {}): string {
        const quoted = this.shellQuote(prompt);
        const resolved = template.includes('{prompt}')
            ? template.split('{prompt}').join(quoted)
            : `${template} ${quoted}`;
        return this.applyTemplateVars(resolved, vars);
    }

    /** Template expansion for stdio-approval runs: the prompt is delivered over stdin, not argv. */
    protected applyTemplateWithoutPrompt(template: string, vars: Record<string, string> = {}): string {
        return this.applyTemplateVars(template.split('{prompt}').join(' '), vars);
    }

    protected applyTemplateVars(template: string, vars: Record<string, string>): string {
        let resolved = template;
        for (const [key, value] of Object.entries(vars)) {
            resolved = resolved.split(`{${key}}`).join(value.trim());
        }
        return resolved.replace(/\s+/g, ' ').trim();
    }

    /** POSIX single-quote escaping so the prompt is passed as one safe argument. */
    protected shellQuote(value: string): string {
        return `'${value.split('\'').join('\'\\\'\'')}'`;
    }

    cancel(id: string): QaapAgentTask | undefined {
        const child = this.processes.get(id);
        if (child) {
            this.killAgentProcessTree(child);
        }
        this.queuedCreateRequests.delete(id);
        const task = this.tasks.get(id);
        if (task && (task.state === 'running' || task.state === 'queued')) {
            const finished = this.finishTask(id, 'cancelled', undefined);
            this.drainQueuedTasks();
            return finished;
        }
        return task;
    }

    /**
     * Kill the agent's WHOLE process tree, escalating SIGTERM → SIGKILL after 5s.
     *
     * The agent is spawned with `shell: true` + `detached: true`, so the shell is a
     * process-group leader and `kill(-pid)` reaches the actual agent (qaiq/claude/…)
     * underneath it. A single `child.kill('SIGTERM')` only signals the wrapper shell —
     * a compound command (`cd … && qaiq …`) left the agent orphaned and still running,
     * which is why the composer Stop appeared to do nothing on the VPS. The backend runs
     * as root there, so signalling a uid-dropped (per-tenant) agent is never an EPERM.
     *
     * Returns the escalation timer (unref'ed) so callers that observe the process exit
     * can clear it and avoid a stray SIGKILL to a recycled pid/group.
     */
    protected killAgentProcessTree(child: ChildProcess): NodeJS.Timeout | undefined {
        const pid = child.pid;
        if (!pid) {
            return undefined;
        }
        if (globalThis.process.platform === 'win32') {
            child.kill('SIGTERM'); // no process groups on Windows; dev-only path
            return undefined;
        }
        try {
            globalThis.process.kill(-pid, 'SIGTERM');
        } catch {
            try {
                child.kill('SIGTERM');
            } catch { /* already gone */ }
        }
        const escalation = setTimeout(() => {
            try {
                globalThis.process.kill(-pid, 'SIGKILL');
            } catch { /* already gone */ }
        }, 5_000);
        escalation.unref?.();
        return escalation;
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
        const pid = child.pid;
        if (!pid || globalThis.process.platform === 'win32') {
            return;
        }
        try {
            globalThis.process.kill(-pid, 'SIGKILL');
        } catch {
            // ESRCH is the common clean case: the agent left no descendants behind.
        }
    }

    /** Pending QAIQ stdio `can_use_tool` requests for a running task. */
    listPendingQaiqControlRequests(taskId: string): readonly QaapQaiqPendingControlRequest[] {
        return this.pendingQaiqControlRequests.get(taskId) ?? [];
    }

    /**
     * How a running task can receive approval answers:
     * `'qaiq-stdio'` — QAIQ control protocol (only pending `can_use_tool` requests are answerable),
     * `'stdin'` — legacy interactive stdin (`y`/`n` lines),
     * `'none'` — no channel; approval prompts cannot be delivered to this process.
     */
    getApprovalChannel(taskId: string): 'qaiq-stdio' | 'stdin' | 'none' {
        if (!this.processes.get(taskId)?.stdin) {
            return 'none';
        }
        if (this.qaiqStdioTasks.has(taskId)) {
            return 'qaiq-stdio';
        }
        if (this.stdinInteractiveTasks.has(taskId)) {
            return 'stdin';
        }
        return 'none';
    }

    /**
     * Best-effort reply to a CLI permission prompt for a manual-approval task.
     *
     * QAIQ stdio-approval runs answer the matching `can_use_tool` control request
     * (resuming the paused tool call); other interactive agents get a legacy
     * `y`/`n` line on stdin. Requires the task to have been spawned with stdin piped.
     */
    respondToApprovalPrompt(taskId: string, action: 'approve' | 'reject', toolUseId?: string): boolean {
        const child = this.processes.get(taskId);
        if (!child?.stdin) {
            return false;
        }
        const pending = this.pendingQaiqControlRequests.get(taskId);
        if (pending?.length) {
            const entry = this.findPendingControlRequestEntry(pending, toolUseId);
            if (!entry) {
                return false;
            }
            try {
                child.stdin.write(buildQaiqControlResponseLine(entry, action));
            } catch {
                return false;
            }
            pending.splice(pending.indexOf(entry), 1);
            this.clearQueuedApprovalTimer(taskId, entry.requestId);
            return true;
        }
        if (this.qaiqStdioTasks.has(taskId)) {
            return false;
        }
        if (!this.stdinInteractiveTasks.has(taskId)) {
            return false;
        }
        const payload = action === 'approve' ? 'y\n' : 'n\n';
        try {
            child.stdin.write(payload);
            return true;
        } catch {
            return false;
        }
    }

    protected findPendingControlRequestEntry(
        pending: QaapQaiqPendingControlRequest[],
        idFromApproval?: string,
    ): QaapQaiqPendingControlRequest | undefined {
        if (idFromApproval) {
            const matched = pending.find(entry =>
                entry.toolUseId === idFromApproval || entry.requestId === idFromApproval,
            );
            if (matched) {
                return matched;
            }
        }
        return pending[0];
    }

    /**
     * Arm the grace timer for a queued `can_use_tool` request of an auto-approve run.
     * If nobody answers from the approvals UI in time, the request is denied with
     * guidance so the agent finishes the turn instead of hanging or insta-failing.
     */
    protected scheduleQueuedApprovalTimeout(
        taskId: string,
        request: QaapQaiqPendingControlRequest,
        logStream: fs.WriteStream,
    ): void {
        const timers = this.queuedApprovalTimers.get(taskId) ?? new Map<string, NodeJS.Timeout>();
        this.queuedApprovalTimers.set(taskId, timers);
        const timer = setTimeout(() => {
            timers.delete(request.requestId);
            const pending = this.pendingQaiqControlRequests.get(taskId);
            const index = pending?.findIndex(entry => entry.requestId === request.requestId) ?? -1;
            if (!pending || index < 0) {
                return;
            }
            pending.splice(index, 1);
            const toolName = request.toolName ?? 'Tool';
            logStream.write(`\n[qaap] approval for ${toolName} not granted within `
                + `${Math.round(QUEUED_APPROVAL_GRACE_TIMEOUT_MS / 1000)}s — auto-denied.\n`);
            try {
                this.processes.get(taskId)?.stdin?.write(buildQaiqControlResponseLine(
                    request,
                    'reject',
                    { denyMessage: buildQaiqQueuedApprovalTimeoutMessage(toolName) },
                ));
            } catch {
                // stdin already closed — the turn is over anyway.
            }
        }, QUEUED_APPROVAL_GRACE_TIMEOUT_MS);
        timers.set(request.requestId, timer);
    }

    protected clearQueuedApprovalTimer(taskId: string, requestId: string): void {
        const timers = this.queuedApprovalTimers.get(taskId);
        const timer = timers?.get(requestId);
        if (timers && timer) {
            clearTimeout(timer);
            timers.delete(requestId);
            if (timers.size === 0) {
                this.queuedApprovalTimers.delete(taskId);
            }
        }
    }

    protected clearQueuedApprovalTimers(taskId: string): void {
        const timers = this.queuedApprovalTimers.get(taskId);
        if (timers) {
            for (const timer of timers.values()) {
                clearTimeout(timer);
            }
            this.queuedApprovalTimers.delete(taskId);
        }
    }

    protected async spawnProcessWhenReady(task: QaapAgentTask, request: QaapCreateAgentTaskRequest): Promise<void> {
        if (this.preferenceService) {
            await this.preferenceService.ready;
        }
        const prompt = (request.prompt ?? '').trim();
        if (prompt) {
            try {
                this.recordTaskLatencyMark(task.id, 'build_agent_command_start');
                const autoApprove = task.autoApprove !== false;
                const agentModel = this.resolveAgentModelForRequest(request, prompt);
                const { command, stdinPrompt, agentId } = this.buildAgentCommand(
                    prompt,
                    request.agent,
                    autoApprove,
                    agentModel,
                    task.cwd,
                    request.contextPreamble,
                    request.interactionModeId,
                    request.approvalPolicyId,
                    request.toolApprovalRules,
                    request.userQuery,
                );
                this.recordTaskLatencyMark(task.id, 'build_agent_command_end');
                if (stdinPrompt) {
                    this.stdinPrompts.set(task.id, stdinPrompt);
                }
                const markedTask = this.tasks.get(task.id) ?? task;
                const next: QaapAgentTask = {
                    ...markedTask,
                    command,
                    agentId,
                    ...(agentModel ? { agentModel, qaiqModel: agentModel } : {}),
                };
                this.tasks.set(task.id, next);
                void this.persist();
                this.spawnProcess(next);
                return;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                fs.mkdirSync(STORE_DIR, { recursive: true });
                fs.writeFileSync(this.logPath(task.id), `${message}\n`, 'utf8');
                this.finishTask(task.id, 'failed', 1);
                return;
            }
        }
        this.spawnProcess(task);
    }

    protected spawnProcess(task: QaapAgentTask): void {
        fs.mkdirSync(STORE_DIR, { recursive: true });
        const logStream = fs.createWriteStream(this.logPath(task.id), { flags: 'w' });
        const stdioPrompt = this.stdinPrompts.get(task.id);
        const stdinInteractive = task.autoApprove === false || stdioPrompt !== undefined;
        const agentModel = resolveTaskAgentModel(task);
        const restoreAntigravitySettings = agentModel?.modelId?.trim()
            && isAntigravityCliCommand(task.command)
            ? applyAntigravityModelSetting(agentModel.modelId)?.restore
            : undefined;
        const finishAntigravitySettings = (): void => {
            restoreAntigravitySettings?.();
        };
        let child: ChildProcess;
        try {
            this.enforceAgentIsolationPolicy();
            this.ensureAgentCwdOwnership(task.cwd);
            this.recordTaskLatencyMark(task.id, 'spawn_start');
            // Pipes stay attached (no unref()), so logging and stdio approvals are unaffected.
            child = this.spawnAgentCommand(task.command, {
                cwd: task.cwd,
                env: this.buildChildEnv(task),
                stdio: stdinInteractive ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
            });
            this.recordTaskLatencyMark(task.id, 'spawn_end');
        } catch (error) {
            finishAntigravitySettings();
            this.stdinPrompts.delete(task.id);
            logStream.end(`Failed to start: ${error instanceof Error ? error.message : String(error)}\n`);
            this.finishTask(task.id, 'failed', undefined);
            return;
        }
        this.processes.set(task.id, child);
        if (stdinInteractive) {
            this.stdinInteractiveTasks.add(task.id);
        }
        if (stdioPrompt !== undefined) {
            this.qaiqStdioTasks.add(task.id);
            this.stdinPrompts.delete(task.id);
            // stream-json input: the prompt travels over stdin, which stays open
            // for control_responses until the end-of-turn `result` message.
            try {
                child.stdin?.write(buildQaiqStdioPromptLine(stdioPrompt));
            } catch (error) {
                logStream.write(`\n[qaap] failed to write prompt to agent stdin: ${error instanceof Error ? error.message : String(error)}\n`);
            }
        }
        let idleTimer: NodeJS.Timeout | undefined;
        const clearIdleTimer = (): void => {
            if (idleTimer) {
                clearTimeout(idleTimer);
                idleTimer = undefined;
            }
        };
        const bumpIdleTimer = (): void => {
            clearIdleTimer();
            idleTimer = setTimeout(() => {
                if (this.tasks.get(task.id)?.state !== 'running') {
                    return;
                }
                // A run paused on a permission approval is waiting for the user,
                // not hung — keep it alive until someone responds.
                if (this.pendingQaiqControlRequests.get(task.id)?.length) {
                    bumpIdleTimer();
                    return;
                }
                logStream.write(`\n[qaap] task timed out after ${Math.round(IDLE_TASK_TIMEOUT_MS / 1000)}s without output.\n`);
                this.killAgentProcessTree(child);
                this.finishTask(task.id, 'failed', undefined);
            }, IDLE_TASK_TIMEOUT_MS);
        };
        bumpIdleTimer();
        let stdioLineBuffer = '';
        const scanStdioApprovalChunk = (chunk: unknown): void => {
            stdioLineBuffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
            let newline: number;
            while ((newline = stdioLineBuffer.indexOf('\n')) >= 0) {
                const line = stdioLineBuffer.slice(0, newline);
                stdioLineBuffer = stdioLineBuffer.slice(newline + 1);
                const event = parseQaiqStdioEvent(line);
                if (!event) {
                    continue;
                }
                if (event.type === 'control-request') {
                    const autoAction = resolveQaiqControlRequestAutoAction(
                        task.command,
                        task.autoApprove,
                        event.request,
                    );
                    if (autoAction !== 'queue') {
                        const devServerDenial = findQaiqDevServerGuardDenial(event.request);
                        const destructiveDenial = findQaiqDestructiveCommandGuardDenial(event.request);
                        const denyMessage = devServerDenial
                            ?? destructiveDenial
                            ?? (autoAction === 'deny' && event.request.toolName
                                ? buildQaiqAutoDeniedToolMessage(event.request.toolName, event.request.toolInput)
                                : undefined);
                        if (devServerDenial) {
                            logStream.write('\n[qaap] auto-denied long-lived dev-server shell command; Qaap manages dev servers via the preview bootstrap.\n');
                        } else if (destructiveDenial) {
                            logStream.write('\n[qaap] auto-denied destructive shell command; the agent must propose it for explicit user approval.\n');
                        }
                        try {
                            child.stdin?.write(buildQaiqControlResponseLine(
                                event.request,
                                autoAction === 'allow' ? 'approve' : 'reject',
                                denyMessage ? { denyMessage } : {},
                            ));
                        } catch {
                            // stdin already closed — the turn is over anyway.
                        }
                        continue;
                    }
                    const pending = this.pendingQaiqControlRequests.get(task.id) ?? [];
                    pending.push(event.request);
                    this.pendingQaiqControlRequests.set(task.id, pending);
                    // "Request approval" runs wait indefinitely; auto-approve runs get a
                    // grace window so an unattended turn still finishes.
                    if (task.autoApprove !== false) {
                        this.scheduleQueuedApprovalTimeout(task.id, event.request, logStream);
                    }
                } else if (event.type === 'control-cancel') {
                    const pending = this.pendingQaiqControlRequests.get(task.id);
                    const index = pending?.findIndex(entry => entry.requestId === event.requestId) ?? -1;
                    if (pending && index >= 0) {
                        pending.splice(index, 1);
                    }
                    this.clearQueuedApprovalTimer(task.id, event.requestId);
                } else if (event.type === 'result') {
                    // End of turn — close stdin so the headless CLI exits.
                    try {
                        child.stdin?.end();
                    } catch {
                        // Already closed — nothing to do.
                    }
                }
            }
        };
        child.stdout?.on('data', chunk => {
            bumpIdleTimer();
            this.recordTaskLatencyMark(task.id, 'first_stdout_chunk');
            logStream.write(chunk);
            this.fireOutput(task.id, chunk);
            if (stdioPrompt !== undefined) {
                scanStdioApprovalChunk(chunk);
            }
        });
        child.stderr?.on('data', chunk => {
            bumpIdleTimer();
            this.recordTaskLatencyMark(task.id, 'first_stdout_chunk');
            logStream.write(chunk);
            this.fireOutput(task.id, chunk);
        });
        child.on('error', error => {
            logStream.write(`\n[qaap] process error: ${error.message}\n`);
        });
        child.once('exit', () => {
            this.reapAgentProcessGroupAfterExit(child);
        });
        child.on('close', code => {
            clearIdleTimer();
            finishAntigravitySettings();
            logStream.end();
            this.processes.delete(task.id);
            this.stdinInteractiveTasks.delete(task.id);
            this.stdinPrompts.delete(task.id);
            this.pendingQaiqControlRequests.delete(task.id);
            this.clearQueuedApprovalTimers(task.id);
            this.qaiqStdioTasks.delete(task.id);
            // A SIGTERM-killed task is already marked 'cancelled' by cancel().
            if (this.tasks.get(task.id)?.state !== 'running') {
                return;
            }
            if (code === 0 && QAAP_AGENT_VERIFY_ENABLED) {
                void this.finishSuccessfulTaskAfterVerification(task, code ?? undefined);
                return;
            }
            this.finishTask(task.id, code === 0 ? 'completed' : 'failed', code ?? undefined);
        });
    }

    /** In-flight self-verification passes. Each may spawn an extra (fix-turn) qaiq — bounded below. */
    protected activeVerificationPasses = 0;
    /** FIFO waiters for a verification slot. A released slot is transferred directly to one waiter. */
    protected verificationPassWaiters: Array<() => void> = [];

    protected maxConcurrentVerificationPasses(): number {
        const raw = process.env.QAAP_AGENT_VERIFY_MAX_CONCURRENT?.trim();
        const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
        return Number.isFinite(parsed) && parsed > 0 ? parsed : this.maxConcurrentAgents();
    }

    protected acquireVerificationPass(): Promise<void> {
        if (this.activeVerificationPasses < this.maxConcurrentVerificationPasses()) {
            this.activeVerificationPasses++;
            return Promise.resolve();
        }
        return new Promise(resolve => {
            this.verificationPassWaiters.push(resolve);
        });
    }

    protected releaseVerificationPass(): void {
        const next = this.verificationPassWaiters.shift();
        if (next) {
            // Transfer the occupied slot directly. Decrementing first would let a newly arriving
            // task overtake this FIFO waiter and briefly exceed the configured process budget.
            next();
            return;
        }
        this.activeVerificationPasses = Math.max(0, this.activeVerificationPasses - 1);
    }

    protected async finishSuccessfulTaskAfterVerification(task: QaapAgentTask, exitCode: number | undefined): Promise<void> {
        // Verification/fix turns use their own bounded lane. A saturated lane waits FIFO instead of
        // silently upgrading an unverified change to `completed`. The commands inside the lane have
        // hard wall clocks, so a waiter cannot be held indefinitely by a healthy runner.
        await this.acquireVerificationPass();
        try {
            if (this.tasks.get(task.id)?.state !== 'running') {
                return;
            }
            let verification: QaapAgentTaskVerification | undefined;
            try {
                verification = await this.verifySuccessfulAgentTask(task);
            } catch (error) {
                verification = {
                    status: 'failed',
                    command: 'qaap self-verification',
                    attempts: 0,
                    summary: error instanceof Error ? error.message : String(error),
                };
            }
            if (this.tasks.get(task.id)?.state !== 'running') {
                return;
            }
            if (verification) {
                const current = this.tasks.get(task.id);
                if (current) {
                    this.tasks.set(task.id, { ...current, verification });
                }
            }
            // Independent adversarial review (phase C): only when the deterministic gate did not
            // already flag the task — a red verification closes as warnings without paying for a
            // second agent. Runs inside the verification slot held above, so concurrency stays
            // bounded by the same cap.
            let review: QaapAgentTaskReview | undefined;
            if (verification?.status !== 'failed') {
                try {
                    review = await this.reviewSuccessfulAgentTask(task, verification);
                } catch (error) {
                    review = {
                        status: 'inconclusive',
                        reason: error instanceof Error ? error.message : String(error),
                    };
                }
                if (this.tasks.get(task.id)?.state !== 'running') {
                    return;
                }
                if (review) {
                    const current = this.tasks.get(task.id);
                    if (current) {
                        this.tasks.set(task.id, { ...current, review });
                    }
                }
            }
            // Blocking gate: a clean exit does not earn 'completed' while the repo's own checks
            // are red or the independent reviewer rejected the change — surface it as a distinct
            // terminal state instead of badge-only metadata so the conversation store and the UI
            // can react to it. An inconclusive review fails OPEN: the deterministic gates already
            // ran, and closing every reviewer timeout as a warning would erode trust in the state.
            const withWarnings = verification?.status === 'failed' || review?.status === 'failed';
            this.finishTask(task.id, withWarnings ? 'completed_with_warnings' : 'completed', exitCode);
        } finally {
            this.releaseVerificationPass();
        }
    }

    /**
     * Self-verification gate for ANY agent, not just QAIQ: any task that edited files and whose
     * cwd exposes verification scripts (typecheck/build/test/lint) gets verified, and — on failure
     * — a fix-turn re-invokes whichever agent ran the original task (see {@link resolveTaskAgentId}).
     */
    protected async verifySuccessfulAgentTask(task: QaapAgentTask): Promise<QaapAgentTaskVerification | undefined> {
        const env = this.buildChildEnv(task);
        const startedAt = Date.now();
        if (!await this.hasEditedFilesForVerification(task, env)) {
            return undefined;
        }
        const scripts = await this.resolveVerificationScriptsForCwd(task.cwd);
        if (scripts.length === 0) {
            return undefined;
        }
        let attempts = 0;
        let lastCommand = '';
        let lastFailure: QaapGenericCommandResult | undefined;
        while (this.isTaskStillRunning(task.id) && Date.now() - startedAt < QAAP_AGENT_VERIFY_WALL_CLOCK_MS) {
            const failed = await this.runVerificationScripts(task, env, scripts, startedAt);
            if (!failed) {
                return { status: 'passed', command: lastCommand || `npm run ${scripts[scripts.length - 1]}`, attempts };
            }
            lastCommand = failed.command;
            lastFailure = failed.result;
            if (attempts >= QAAP_AGENT_VERIFY_MAX_ATTEMPTS || Date.now() - startedAt >= QAAP_AGENT_VERIFY_WALL_CLOCK_MS) {
                break;
            }
            attempts++;
            const fixed = await this.runAgentVerificationFixTurn(task, env, failed.command, failed.result, attempts, startedAt);
            if (fixed === undefined) {
                // No agent was available to attempt a fix — retrying the same failing scripts again
                // would just burn the remaining attempts for nothing, so stop here.
                break;
            }
        }
        if (!lastFailure) {
            return {
                status: 'failed',
                command: lastCommand || 'qaap self-verification',
                attempts,
                summary: 'Verification did not complete before the task stopped or the wall-clock limit was reached.',
            };
        }
        return {
            status: 'failed',
            command: lastCommand,
            attempts,
            summary: this.summarizeVerificationFailure(lastCommand, lastFailure),
        };
    }

    /**
     * Independent adversarial review pass (senior-engineer contract, phase C): a second agent with
     * a CLEAN context judges the finished change against the original request — bugs, scope creep,
     * false claims — and returns a verdict sentinel. Deliberately runs even when script
     * verification was skipped for lack of scripts: user repos without typecheck/test leave the
     * deterministic gate empty, and this pass is the only defense there. Judge-only: no fix turns.
     * Returns undefined when review is off, the task is low-risk, or no reviewer agent exists.
     */
    protected async reviewSuccessfulAgentTask(
        task: QaapAgentTask,
        verification: QaapAgentTaskVerification | undefined,
    ): Promise<QaapAgentTaskReview | undefined> {
        const mode = resolveAgentReviewMode(process.env.QAAP_AGENT_REVIEW);
        if (mode === 'off' || !this.isTaskStillRunning(task.id)) {
            return undefined;
        }
        const agentId = this.resolveTaskAgentId(task);
        if (agentId === SHELL_AGENT_ID) {
            return undefined;
        }
        const env = this.buildChildEnv(task);
        // Verification already proved edits exist when it ran; re-check only when it was skipped
        // (undefined covers both "no edits" and "no scripts" — review only cares about the former).
        if (verification === undefined && !await this.hasEditedFilesForVerification(task, env)) {
            return undefined;
        }
        const numstat = await this.runGenericCommand('git diff --numstat HEAD', task.cwd, env, task.id, QAAP_AGENT_REVIEW_GIT_TIMEOUT_MS, {});
        const untracked = await this.runGenericCommand('git ls-files --others --exclude-standard', task.cwd, env, task.id, QAAP_AGENT_REVIEW_GIT_TIMEOUT_MS, {});
        const changedFiles = [
            ...parseGitNumstat(numstat.stdout),
            // Untracked (new) files never show in `diff HEAD` — count them for the file-count and
            // sensitive-path signals; their line counts are unknown and stay at 0.
            ...untracked.stdout.split('\n').map(line => line.trim()).filter(Boolean)
                .map(path => ({ path, added: 0, removed: 0 })),
        ];
        if (mode === 'high-risk' && resolveTaskReviewRisk(changedFiles) === 'low') {
            return undefined;
        }
        const diff = await this.runGenericCommand('git diff HEAD', task.cwd, env, task.id, QAAP_AGENT_REVIEW_GIT_TIMEOUT_MS, {});
        const prompt = buildAgentReviewPrompt({ originalCommand: task.command, diff: diff.stdout });
        let command: string;
        try {
            ({ command } = this.buildAgentCommand(
                prompt,
                agentId,
                true,
                resolveTaskAgentModel(task),
                task.cwd,
                undefined,
                undefined,
                'full-access',
            ));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.appendAndFireOutput(task.id, `\n[qaap] Skipping independent review: ${message}\n`);
            return undefined;
        }
        const result = await this.runGenericCommand(command, task.cwd, env, task.id, QAAP_AGENT_REVIEW_WALL_CLOCK_MS, {
            header: `\n[qaap] High-risk change — starting independent ${agentId} review.\n`,
            streamOutput: true,
        });
        const verdict = parseAgentReviewVerdict(`${result.stdout}\n${result.stderr}`);
        if (!verdict) {
            return {
                status: 'inconclusive',
                reason: result.timedOut
                    ? 'Reviewer timed out before emitting a verdict.'
                    : 'Reviewer did not emit a verdict.',
                agentId,
            };
        }
        return { status: verdict.status, reason: verdict.reason, agentId };
    }

    protected async hasEditedFilesForVerification(task: QaapAgentTask, env: NodeJS.ProcessEnv): Promise<boolean> {
        const result = await this.runGenericCommand(
            `git -C ${this.shellQuote(task.cwd)} status --porcelain`,
            task.cwd,
            env,
            task.id,
            10_000,
        );
        return result.exitCode === 0 && result.stdout.trim().length > 0;
    }

    protected async resolveVerificationScriptsForCwd(cwd: string): Promise<string[]> {
        try {
            const raw = await fsp.readFile(path.join(cwd, 'package.json'), 'utf8');
            return resolveQaapAgentVerificationScripts(JSON.parse(raw) as unknown);
        } catch {
            return [];
        }
    }

    protected async runVerificationScripts(
        task: QaapAgentTask,
        env: NodeJS.ProcessEnv,
        scripts: readonly string[],
        startedAt: number,
    ): Promise<{ command: string; result: QaapGenericCommandResult } | undefined> {
        for (const script of scripts) {
            if (!this.isTaskStillRunning(task.id)) {
                return undefined;
            }
            const remaining = QAAP_AGENT_VERIFY_WALL_CLOCK_MS - (Date.now() - startedAt);
            if (remaining <= 0) {
                return {
                    command: `npm run ${script}`,
                    result: { exitCode: 1, stdout: '', stderr: 'Verification timed out.', timedOut: true },
                };
            }
            const command = `npm run ${script}`;
            const result = await this.runGenericCommand(command, task.cwd, env, task.id, remaining, {
                header: `\n[qaap] Verifying: ${command}\n`,
                tailOutput: true,
            });
            if (result.exitCode !== 0 || result.timedOut) {
                return { command, result };
            }
        }
        return undefined;
    }

    /**
     * Re-invokes whichever agent ran {@link task} (see {@link resolveTaskAgentId}) with a prompt
     * describing the failed verification command. Returns {@code undefined} — instead of throwing —
     * when there is no usable agent to run the fix with (e.g. a raw shell task, or an agent id that
     * is no longer detected/configured on this server), so the caller can stop retrying gracefully
     * without failing the whole task.
     */
    protected async runAgentVerificationFixTurn(
        task: QaapAgentTask,
        env: NodeJS.ProcessEnv,
        failedCommand: string,
        failure: QaapGenericCommandResult,
        attempt: number,
        startedAt: number,
    ): Promise<QaapGenericCommandResult | undefined> {
        // Close the cancel race: if the task was cancelled between the failed verification and here,
        // do not spawn a full (token-costing) agent fix turn.
        if (!this.isTaskStillRunning(task.id)) {
            return { exitCode: 1, stdout: '', stderr: 'Task no longer running; skipped fix turn.', timedOut: false };
        }
        const remaining = QAAP_AGENT_VERIFY_WALL_CLOCK_MS - (Date.now() - startedAt);
        if (remaining <= 0) {
            return { exitCode: 1, stdout: '', stderr: 'Verification timed out before fix turn.', timedOut: true };
        }
        const agentId = this.resolveTaskAgentId(task);
        if (agentId === SHELL_AGENT_ID) {
            // A raw shell task (or one whose original agent could not be inferred) has no coding
            // agent to re-invoke — running the fix prompt as a literal shell command would be wrong.
            this.appendAndFireOutput(task.id, '\n[qaap] Skipping self-verification fix turn: no coding agent to invoke.\n');
            return undefined;
        }
        const prompt = this.buildAgentVerificationFixPrompt(failedCommand, failure, attempt);
        let command: string;
        try {
            ({ command } = this.buildAgentCommand(
                prompt,
                agentId,
                true,
                resolveTaskAgentModel(task),
                task.cwd,
                undefined,
                undefined,
                'full-access',
            ));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.appendAndFireOutput(task.id, `\n[qaap] Skipping self-verification fix turn: ${message}\n`);
            return undefined;
        }
        return this.runGenericCommand(command, task.cwd, env, task.id, remaining, {
            header: `\n[qaap] Verification failed. Starting ${agentId} fix attempt ${attempt}/${QAAP_AGENT_VERIFY_MAX_ATTEMPTS}.\n`,
            streamOutput: true,
        });
    }

    protected buildAgentVerificationFixPrompt(
        failedCommand: string,
        failure: QaapGenericCommandResult,
        attempt: number,
    ): string {
        const output = this.truncateForPrompt(`${failure.stdout}\n${failure.stderr}`.trim(), QAAP_AGENT_FIX_PROMPT_OUTPUT_CHARS);
        return [
            'The previous coding-agent turn completed and edited files, but backend self-verification failed.',
            `Fix the issue causing this command to fail: ${failedCommand}`,
            `This is fix attempt ${attempt} of ${QAAP_AGENT_VERIFY_MAX_ATTEMPTS}.`,
            'Make the smallest safe code changes needed. Do not ask questions. Do not commit.',
            'After your edits, stop; the backend will rerun verification.',
            '',
            'Captured verification output:',
            output || '(no output captured)',
        ].join('\n');
    }

    /**
     * Public (was `protected`) so the auto-researcher runner ({@link ../node/qaap-research-runner})
     * can reuse the exact same spawn/timeout/kill-tree/tenant-isolation machinery for its `run` and
     * `measure` phases — those need a hard multi-hour timeout with no idle-based kill, unlike
     * {@link create} which is tuned for interactive-ish agent turns (see `IDLE_TASK_TIMEOUT_MS`).
     */
    runGenericCommand(
        command: string,
        cwd: string,
        env: NodeJS.ProcessEnv,
        taskId: string,
        timeoutMs: number,
        options: {
            readonly header?: string;
            readonly streamOutput?: boolean;
            readonly tailOutput?: boolean;
        } = {},
    ): Promise<QaapGenericCommandResult> {
        if (options.header) {
            this.appendAndFireOutput(taskId, options.header);
        }
        return new Promise(resolve => {
            let stdout = '';
            let stderr = '';
            let timedOut = false;
            let child: ChildProcess;
            const finish = (exitCode: number): void => {
                if (options.tailOutput) {
                    const combined = `${stdout}${stderr}`;
                    const tail = this.truncateHead(combined, QAAP_AGENT_VERIFY_OUTPUT_TAIL_CHARS);
                    if (tail.trim()) {
                        this.appendAndFireOutput(taskId, `${tail.endsWith('\n') ? tail : `${tail}\n`}`);
                    }
                }
                resolve({ exitCode, stdout, stderr, timedOut });
            };
            try {
                this.enforceAgentIsolationPolicy();
                this.ensureAgentCwdOwnership(cwd);
                child = this.spawnAgentCommand(command, {
                    cwd,
                    env,
                    stdio: ['ignore', 'pipe', 'pipe'],
                });
            } catch (error) {
                stderr = error instanceof Error ? error.message : String(error);
                finish(1);
                return;
            }
            this.processes.set(taskId, child);
            let killTimer: NodeJS.Timeout | undefined;
            const timeout = setTimeout(() => {
                timedOut = true;
                killTimer = this.killAgentProcessTree(child);
            }, Math.max(1, timeoutMs));
            child.stdout?.on('data', (chunk: Buffer | string) => {
                const text = String(chunk);
                stdout += text;
                if (options.streamOutput) {
                    this.appendAndFireOutput(taskId, text);
                }
            });
            child.stderr?.on('data', (chunk: Buffer | string) => {
                const text = String(chunk);
                stderr += text;
                if (options.streamOutput) {
                    this.appendAndFireOutput(taskId, text);
                }
            });
            child.on('error', error => {
                stderr += `${error.message}\n`;
            });
            child.once('exit', () => {
                this.reapAgentProcessGroupAfterExit(child);
            });
            child.on('close', code => {
                clearTimeout(timeout);
                if (killTimer) {
                    clearTimeout(killTimer);
                }
                if (this.processes.get(taskId) === child) {
                    this.processes.delete(taskId);
                }
                finish(timedOut && code === 0 ? 1 : code ?? 1);
            });
        });
    }

    protected appendAndFireOutput(taskId: string, chunk: string): void {
        try {
            fs.appendFileSync(this.logPath(taskId), chunk, 'utf8');
        } catch {
            /* log append is best-effort */
        }
        this.fireOutput(taskId, chunk);
    }

    protected isTaskStillRunning(taskId: string): boolean {
        return this.tasks.get(taskId)?.state === 'running';
    }

    protected summarizeVerificationFailure(command: string, result: QaapGenericCommandResult): string {
        const timedOut = result.timedOut ? ' The command timed out.' : '';
        const output = this.truncateHead(`${result.stdout}\n${result.stderr}`.trim(), 1000);
        return `${command} exited with code ${result.exitCode}.${timedOut}${output ? `\n${output}` : ''}`;
    }

    protected truncateForPrompt(value: string, maxChars: number): string {
        if (value.length <= maxChars) {
            return value;
        }
        return `${value.slice(0, Math.floor(maxChars / 2))}\n...[truncated]...\n${value.slice(value.length - Math.floor(maxChars / 2))}`;
    }

    protected truncateHead(value: string, maxChars: number): string {
        if (value.length <= maxChars) {
            return value;
        }
        return `...[truncated]...\n${value.slice(value.length - maxChars)}`;
    }

    protected fireOutput(taskId: string, chunk: unknown): void {
        const task = this.tasks.get(taskId);
        const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        const filtered = filterAgentProcessLogChunk(text);
        if (!task || !filtered) {
            return;
        }
        this.onDidChangeTaskEmitter.fire({ type: 'output', task, chunk: filtered });
    }

    protected recordTaskLatencyMark(taskId: string, mark: QaapTurnLatencyMark, at = Date.now()): void {
        const task = this.tasks.get(taskId);
        if (!task || task.latencyMarks?.[mark] !== undefined) {
            return;
        }
        this.tasks.set(taskId, {
            ...task,
            latencyMarks: {
                ...task.latencyMarks,
                [mark]: at,
            },
        });
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

    /** @see QaapTenantSpawnService.spawn */
    protected spawnAgentCommand(command: string, options: {
        cwd: string;
        env: NodeJS.ProcessEnv;
        stdio: ('pipe' | 'ignore')[];
    }): ChildProcess {
        return this.tenantSpawn.spawn(command, options);
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
        const env: NodeJS.ProcessEnv = { ...process.env };
        env.PWD = task.cwd;
        // When the agent is dropped to a non-root uid (QAAP_AGENT_UID), its inherited HOME still
        // points at root's /root, which it cannot write — CLI caches/configs would fail. Point HOME
        // at a writable agent home so the non-root process has somewhere to write. In uid-per-user
        // mode this is a PER-TENANT home (the shared /home/qaap-agent is owned by uid 1001 and is
        // neither writable nor private under a tenant uid) — see resolveAgentHome.
        if (this.resolveAgentSpawnIdentity(task.cwd).uid !== undefined) {
            env.HOME = this.resolveAgentHome(task.cwd);
        }
        // Strip shared provider API keys from process.env so per-user settings
        // are the sole source. Without this, User B's agent would inherit User
        // A's keys (or operator-level keys) from the shared backend process.
        this.stripSharedProviderEnv(env);
        this.applyProviderPreferenceEnv(env, task.ownerLogin);
        const binding = this.resolveAgentBindingForTask(task);
        if (binding) {
            applyQaapQaiqModelEnv(env, binding);
            applyQaapQaiqCredentialEnv(env, binding, key => this.preferenceService?.get(key));
        }
        if (this.isQaiqRunner(undefined, task.command)) {
            this.applyQaiqProviderEnv(env, task.command, binding);
        }
        if (this.isQaiqRunner(undefined, task.command)) {
            env.QAAP_HOSTED_AGENT = '1';
            // The hosted backend runs as root inside its container, where qaiq refuses
            // `--dangerously-skip-permissions` unless it detects a sandbox. The container IS the
            // sandbox, so opt in explicitly (qaiq honours IS_SANDBOX=1 as the root-bypass escape
            // hatch). Scoped to the qaiq child rather than set globally so it never leaks into
            // unrelated processes. Respect an operator override if one is already present.
            if (env.IS_SANDBOX === undefined) {
                env.IS_SANDBOX = '1';
            }
        }
        this.applyHelperEnv(env, task.ownerLogin, task.id, task.autoApprove);
        return env;
    }

    /**
     * When QAIQ runs with OpenRouter/Gemini/Ollama/NVIDIA flags, drop Anthropic credentials so the
     * CLI does not fall back to subscription OAuth and return 429 instead of using BYOK keys.
     *
     * Always sets CLAUDE_CODE_USE_OPENAI explicitly so that saved profile files
     * (/root/.openclaude.json, .openclaude-profile.json) cannot override the provider
     * the user configured in QAAP Settings.
     */
    /** Map OpenAI-compat credentials for explicit picker bindings (HF / OpenRouter / NVIDIA / official). */
    protected applyOpenAiVendorCompatEnv(env: NodeJS.ProcessEnv, binding: QaapQaiqModelBinding): void {
        switch (binding.vendor) {
            case 'huggingface':
                this.applyHuggingfaceOpenAiCompatEnv(env);
                break;
            case 'openrouter':
                this.applyOpenRouterOpenAiCompatEnv(env);
                break;
            case 'nvidia':
                this.applyNvidiaOpenAiCompatEnv(env);
                break;
            default:
                break;
        }
    }

    protected applyQaiqProviderEnv(env: NodeJS.ProcessEnv, command: string, binding?: QaapQaiqModelBinding): void {
        if (!this.isQaiqRunner(undefined, command)) {
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
            this.applyOpenRouterOpenAiCompatEnv(env);
            env.CLAUDE_CODE_USE_OPENAI = '1';
        } else if (binding?.vendor === 'nvidia' || (!binding && command.includes('--provider openai') && env.NVIDIA_API_KEY?.trim() && !env.OPENROUTER_API_KEY?.trim())) {
            this.applyNvidiaOpenAiCompatEnv(env);
            env.CLAUDE_CODE_USE_OPENAI = '1';
        } else if (binding?.vendor === 'huggingface') {
            this.applyHuggingfaceOpenAiCompatEnv(env);
            env.CLAUDE_CODE_USE_OPENAI = '1';
        } else if (!binding && command.includes('--provider openai') && env.OPENAI_API_KEY?.trim()) {
            env.CLAUDE_CODE_USE_OPENAI = '1';
        } else if (binding?.provider === 'openai') {
            this.applyOpenAiVendorCompatEnv(env, binding);
            env.CLAUDE_CODE_USE_OPENAI = '1';
        } else {
            // Gemini, Ollama, Anthropic, Mistral — profile files must not force OpenAI mode.
            env.CLAUDE_CODE_USE_OPENAI = '0';
        }
    }

    protected applyProviderPreferenceEnv(env: NodeJS.ProcessEnv, ownerLogin?: string): void {
        const diskSettings = this.readUserSettingsFromDisk(ownerLogin);
        for (const mapping of AGENT_ENV_PREFS) {
            if (env[mapping.env]?.trim()) {
                continue;
            }
            let value = this.preferenceService?.get<string>(mapping.pref);
            if (typeof value !== 'string' || !value.trim()) {
                const diskValue = diskSettings[mapping.pref];
                if (typeof diskValue === 'string' && diskValue.trim()) {
                    value = diskValue.trim();
                }
            }
            if (typeof value === 'string' && value.trim()) {
                env[mapping.env] = value.trim();
            }
        }
        this.applyOpenRouterOpenAiCompatEnv(env);
    }

    /** Remove provider API keys inherited from the shared process.env so they
     *  don't leak across users. Operator-level keys are intentionally stripped;
     *  each user must configure their own keys via per-user settings. */
    protected stripSharedProviderEnv(env: NodeJS.ProcessEnv): void {
        for (const mapping of AGENT_ENV_PREFS) {
            delete env[mapping.env];
        }
        // Also strip compat-derived keys that would short-circuit per-user resolution.
        delete env.OPENAI_BASE_URL;
        delete env.CLAUDE_CODE_USE_OPENAI;
        delete env.NVIDIA_NIM;
        // Backend-only secrets the agent never needs. Without this the child inherits them via
        // {...process.env}, so any user could exfiltrate them with `env | grep -i secret`: the OAuth
        // client secret enables app impersonation, and the VAPID private key lets it forge Web Push
        // to other users. Deleting them here (the single spawn-env chokepoint) closes SEC-3.
        delete env.QAAP_GITHUB_CLIENT_SECRET;
        delete env.QAAP_VAPID_PRIVATE_KEY;
        delete env.QAAP_VAPID_SUBJECT;
    }

    /** Fallback when the backend PreferenceService has no User provider (common in VPS containers).
     *  When ownerLogin is provided, prefers the per-user settings file; falls back to the shared
     *  ~/.theia/settings.json so single-user VPS deployments keep working with Settings → AI. */
    protected readUserSettingsFromDisk(ownerLogin?: string): Record<string, unknown> {
        try {
            const userSettingsPath = ownerLogin?.trim()
                ? path.join(os.homedir(), '.qaap', 'users', safeUserIdSegment(ownerLogin), 'settings.json')
                : undefined;
            const sharedSettingsPath = path.join(os.homedir(), '.theia', 'settings.json');
            const settingsPath = userSettingsPath && fs.existsSync(userSettingsPath)
                ? userSettingsPath
                : sharedSettingsPath;
            if (!fs.existsSync(settingsPath)) {
                return {};
            }
            const raw = fs.readFileSync(settingsPath, 'utf8');
            if (!raw.trim()) {
                return {};
            }
            return JSON.parse(raw) as Record<string, unknown>;
        } catch (error) {
            console.warn('[qaap-agent-tasks] failed to read user settings from disk:', error instanceof Error ? error.message : String(error));
            return {};
        }
    }

    /** QAIQ's OpenAI provider reads OPENAI_*; map OpenRouter prefs when needed. */
    protected applyOpenRouterOpenAiCompatEnv(env: NodeJS.ProcessEnv): void {
        if (!env.OPENROUTER_API_KEY?.trim() || env.OPENAI_API_KEY?.trim()) {
            return;
        }
        env.OPENAI_API_KEY = env.OPENROUTER_API_KEY.trim();
        if (!env.OPENAI_BASE_URL?.trim()) {
            env.OPENAI_BASE_URL = env.OPENROUTER_BASE_URL?.trim() || 'https://openrouter.ai/api/v1';
        }
    }

    /** QAIQ's OpenAI provider reads OPENAI_*; map NVIDIA NIM prefs when needed. */
    protected applyNvidiaOpenAiCompatEnv(env: NodeJS.ProcessEnv): void {
        if (!env.NVIDIA_API_KEY?.trim() || env.OPENAI_API_KEY?.trim()) {
            return;
        }
        env.OPENAI_API_KEY = env.NVIDIA_API_KEY.trim();
        if (!env.OPENAI_BASE_URL?.trim()) {
            env.OPENAI_BASE_URL = 'https://integrate.api.nvidia.com/v1';
        }
        env.NVIDIA_NIM = '1';
    }

    /** QAIQ's OpenAI provider reads OPENAI_*; map Hugging Face Inference Router prefs when needed. */
    protected applyHuggingfaceOpenAiCompatEnv(env: NodeJS.ProcessEnv): void {
        const hfKey = env.HUGGINGFACE_API_KEY?.trim() || env.HF_TOKEN?.trim();
        if (!hfKey) {
            return;
        }
        env.HUGGINGFACE_API_KEY = hfKey;
        env.HF_TOKEN = hfKey;
        env.OPENAI_API_KEY = hfKey;
        env.OPENAI_BASE_URL = 'https://router.huggingface.co/v1';
        delete env.NVIDIA_NIM;
    }

    /**
     * Mutates `env` in place to add the helper-CLI bindings (PATH prefix, token, API URL, optional
     * parent id). Returns `true` when the helper is provisioned and the env was updated, `false`
     * when the helper isn't ready yet (e.g. backend just booted and the port hasn't been bound).
     * Callers can use this to expose `qaap-task` to any spawned process — agent tasks, interactive
     * terminals, etc.
     */
    applyHelperEnv(env: NodeJS.ProcessEnv, ownerLogin?: string, parentTaskId?: string, autoApprove?: boolean): boolean {
        if (!this.helperApiUrl) {
            return false;
        }
        // Seed the token bound to this task's owner so a spawned agent can only fan out
        // sub-tasks as its own user (the endpoint resolves the owner from the token).
        env.QAAP_TASK_TOKEN = this.helperTokenForOwner(ownerLogin);
        env.QAAP_TASK_API_URL = this.helperApiUrl;
        if (parentTaskId) {
            env.QAAP_TASK_PARENT_ID = parentTaskId;
        }
        if (autoApprove !== false) {
            env.QAAP_TASK_AUTO_APPROVE = '1';
        }
        env.PATH = `${HELPER_BIN_DIR}${path.delimiter}${env.PATH ?? ''}`;
        return true;
    }

    /**
     * Reclassify an already-delivered task as 'blocked' — called by the conversation store when the
     * agent's final message ends with the blocked-signal sentinel. Deliberately does NOT re-fire
     * onDidChangeTask (a second settled event would re-run the subtask mailbox delivery) nor send
     * another push notification; clients pick the state up on the next list()/detail().
     */
    markTaskBlocked(id: string): QaapAgentTask | undefined {
        const task = this.tasks.get(id);
        if (!task || (task.state !== 'completed' && task.state !== 'completed_with_warnings')) {
            return undefined;
        }
        const blocked: QaapAgentTask = { ...task, state: 'blocked' };
        this.tasks.set(id, blocked);
        void this.persist();
        return blocked;
    }

    protected finishTask(id: string, state: QaapAgentTaskState, exitCode: number | undefined): QaapAgentTask | undefined {
        const task = this.tasks.get(id);
        if (!task) {
            return undefined;
        }
        const finished: QaapAgentTask = { ...task, state, exitCode, finishedAt: Date.now() };
        this.tasks.set(id, finished);
        void this.persist();
        // 'completed'/'failed'/'interrupted' map to 'completed' for subscribers; 'cancelled' stays distinct.
        this.onDidChangeTaskEmitter.fire({
            type: state === 'cancelled' ? 'cancelled' : 'completed',
            task: finished,
        });
        if (isQaapAgentTaskFinished(state) && state !== 'cancelled') {
            void this.notifyCompletion(finished);
        }
        this.drainQueuedTasks();
        return finished;
    }

    /** Push the result to the user's devices — works with every tab closed. */
    protected async notifyCompletion(task: QaapAgentTask): Promise<void> {
        if (task.state === 'completed_with_warnings') {
            try {
                await this.webPush.notify({
                    title: 'Task finished — checks failing',
                    body: `${task.title} completed, but verification checks are still failing.`,
                    tag: `qaap-agent-task-${task.id}`,
                    route: 'diff-review',
                });
            } catch {
                /* push failure must not crash the runner */
            }
            return;
        }
        const ok = task.state === 'completed';
        try {
            await this.webPush.notify({
                title: ok ? 'Task finished' : 'Task failed',
                body: `${task.title}${ok ? ' completed.' : ` exited with code ${task.exitCode ?? 'unknown'}.`}`,
                tag: `qaap-agent-task-${task.id}`,
                route: 'diff-review',
            });
        } catch {
            /* push failure must not crash the runner */
        }
    }

    protected async readLog(id: string): Promise<string> {
        try {
            const logPath = this.logPath(id);
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

    protected persist(): Promise<void> {
        const queuedRequests: Record<string, QaapCreateAgentTaskRequest> = {};
        for (const [taskId, request] of this.queuedCreateRequests) {
            if (this.tasks.get(taskId)?.state === 'queued') {
                queuedRequests[taskId] = request;
            }
        }
        const index: PersistedAgentTaskIndex = {
            version: 2,
            tasks: [...this.tasks.values()],
            queuedRequests,
        };
        const previous = this.persistChain ?? Promise.resolve();
        this.persistChain = previous
            .catch(() => undefined)
            .then(async () => {
                await fsp.mkdir(STORE_DIR, { recursive: true, mode: STORE_DIR_MODE });
                await fsp.chmod(STORE_DIR, STORE_DIR_MODE).catch(() => undefined);
                await writeJsonAtomic(INDEX_PATH, index, { mode: STORE_FILE_MODE });
            })
            .catch(error => {
                console.warn('[qaap-agent-tasks] failed to persist task index:', error);
            });
        return this.persistChain;
    }

    protected logPath(id: string): string {
        return path.join(STORE_DIR, `${id}.log`);
    }

    protected isDirectory(target: string): boolean {
        try {
            return fs.statSync(target).isDirectory();
        } catch {
            return false;
        }
    }

    /** One-shot prompt rewrite via the selected VPS agent/model (composer "Improve prompt"). */
    async improveComposerPrompt(options: {
        readonly prompt: string;
        readonly agentId: string;
        readonly agentModel?: QaapCreateAgentTaskQaiqModel;
        readonly cwd?: string;
    }): Promise<string> {
        if (this.preferenceService) {
            await this.preferenceService.ready;
        }
        const trimmed = options.prompt.trim();
        if (!trimmed) {
            throw new Error('Composer prompt is empty.');
        }
        const improveText = buildImproveComposerPromptRequest(trimmed);
        const agentId = this.resolveAgentId(improveText, options.agentId);
        this.assertQaiqConfigured(agentId);
        const detected = this.detectedAgents.get(agentId);
        if (!detected) {
            throw new Error(`Agent "${agentId}" is not available for prompt improvement.`);
        }
        const vars = this.buildTemplateVars(agentId, options.agentModel, {
            autoApprove: true,
            approvalPolicyId: 'approve-for-me',
        });
        let template = detected.template
            .replace(/--output-format\s+\S+/g, '')
            .replace(/--include-partial-messages/g, '')
            .replace(/--verbose/g, '');
        const command = applyAgentApprovalPolicyToCommand(
            this.applyTemplate(template, improveText, vars),
            {
                agentId,
                approvalPolicyId: 'approve-for-me',
                autoApprove: true,
            },
        );
        const cwd = options.cwd?.trim() || process.cwd();
        const task: QaapAgentTask = {
            id: 'composer-improve-prompt',
            title: 'Improve prompt',
            command,
            cwd,
            state: 'running',
            createdAt: Date.now(),
            autoApprove: true,
            ...(options.agentModel ? { agentModel: options.agentModel, qaiqModel: options.agentModel } : {}),
        };
        return this.runOneShotCommand(command, cwd, this.buildChildEnv(task), agentId);
    }

    protected runOneShotCommand(
        command: string,
        cwd: string,
        env: NodeJS.ProcessEnv,
        agentId?: string,
        timeoutMs = 45_000,
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            let stdout = '';
            let stderr = '';
            let child: ChildProcess;
            try {
                this.enforceAgentIsolationPolicy();
                this.ensureAgentCwdOwnership(cwd);
                child = this.spawnAgentCommand(command, {
                    cwd,
                    env,
                    stdio: ['ignore', 'pipe', 'pipe'],
                });
            } catch (error) {
                reject(error instanceof Error ? error : new Error(String(error)));
                return;
            }
            const timer = setTimeout(() => {
                this.killAgentProcessTree(child);
                reject(new Error('Prompt improvement timed out.'));
            }, timeoutMs);
            child.stdout?.on('data', (chunk: Buffer | string) => {
                stdout += String(chunk);
            });
            child.stderr?.on('data', (chunk: Buffer | string) => {
                stderr += String(chunk);
            });
            child.on('error', error => {
                clearTimeout(timer);
                reject(error);
            });
            child.once('exit', () => {
                this.reapAgentProcessGroupAfterExit(child);
            });
            child.on('close', code => {
                clearTimeout(timer);
                if (code !== 0) {
                    reject(new Error(stderr.trim() || stdout.trim() || `Agent exited with code ${code ?? 'unknown'}.`));
                    return;
                }
                const improved = extractImprovedComposerPromptFromAgentStdout(agentId, stdout);
                if (!improved) {
                    reject(new Error('Agent returned an empty prompt.'));
                    return;
                }
                resolve(improved);
            });
        });
    }
}
