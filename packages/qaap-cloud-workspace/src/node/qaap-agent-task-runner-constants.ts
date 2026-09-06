// @ts-nocheck
// Constants and types extracted from qaap-agent-task-runner.ts

import * as os from 'os';
import * as path from 'path';
import { QAAP_BUILTIN_AGENT_DEFINITIONS } from '@theia/qaap-mobile-shell/lib/common/qaap-builtin-agents';

export interface AgentCandidate {
    readonly id: string;
    readonly label: string;
    /** Executable name to look up on PATH (`which <bin>`). */
    readonly bin?: string;
    /** Template applied to the user prompt; `{prompt}` is replaced with a shell-quoted value. */
    readonly template: string;
    /** Whether this detected Codex CLI supports its current automatic approval flag. */
    readonly codexSupportsApproveForMe?: boolean;
}

/** Built-in QAAP coding agent (fork of OpenClaude): https://github.com/juancristobalgd1/qaiq */
export const QAIQ_AGENT_ID = 'qaiq';

export const AGENT_CANDIDATES: readonly AgentCandidate[] = QAAP_BUILTIN_AGENT_DEFINITIONS;

/**
 * Optional JSON env var for server-side agent backends beyond the built-ins. Example:
 *
 * QAAP_AGENT_COMMANDS='[
 *   {"id":"grok-fast","label":"Grok Build (fast)","bin":"grok","template":"grok --always-approve -m grok-4.5 -p {prompt}"},
 *   {"id":"qaiq-gemini","label":"QAIQ Gemini","bin":"qaiq","template":"qaiq --print --provider gemini --model gemini-2.5-flash {prompt}"}
 * ]'
 *
 * API keys stay in the regular provider env vars consumed by the underlying CLI
 * (for example GEMINI_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY, OPENAI_BASE_URL).
 */
export const CUSTOM_AGENTS_ENV = 'QAAP_AGENT_COMMANDS';
// Default-on so the `[QAAP honest reporting]` prompt contract is backed by a real backend check
// (mirrors QAAP_AGENT_AUTO_CONTINUE). Opt out with QAAP_AGENT_VERIFY=0 (or `false`/`off`).
export const QAAP_AGENT_VERIFY_ENABLED = !/^(0|false|off)$/i.test(process.env.QAAP_AGENT_VERIFY?.trim() ?? '');
export const QAAP_AGENT_VERIFY_OUTPUT_TAIL_CHARS = 12_000;
export const QAAP_AGENT_FIX_PROMPT_OUTPUT_CHARS = 4_000;

/** Exported so other node/ services that reuse {@link QaapAgentTaskRunner.runGenericCommand} — the
 *  auto-researcher runner's `run`/`measure` phases — can type its result. */
export interface QaapGenericCommandResult {
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
    readonly timedOut: boolean;
}


/** Cap on the generated repo-map block (shallow tree + recently-changed files). */
export const REPO_MAP_MAX_CHARS = 4000;
/**
 * Query-specific retrieval: ripgrep the user's message keywords over source and inject the top
 * matching file paths as a "likely relevant files" hint. Default-on (bounded, 4s timeout) so the
 * agent starts oriented in large repos; opt out with QAAP_AGENT_RETRIEVAL=0 (or `false`/`off`).
 */
/** Repo-map cache TTL — short, because the changed-files list drifts as the agent edits. */
export const REPO_MAP_CACHE_TTL_MS = 60_000;
/** Source-ish top-level directories worth expanding one level deeper in the repo map. */

/** When several CLIs are on PATH, prefer BYOK/free-tier runners over subscription CLIs. */
export const DEFAULT_AGENT_PREFERENCE: readonly string[] = [QAIQ_AGENT_ID, 'openclaude', 'grok', 'codex', 'claude', 'cursor'];

export const AGENT_ENV_PREFS: readonly { readonly env: string; readonly pref: string }[] = [
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
export const SHELL_AGENT_ID = 'shell';
/** Reserved id for the QAAP_AGENT_COMMAND env-var template, when set. */
export const ENV_AGENT_ID = 'env';

export const STORE_DIR = path.join(os.homedir(), '.qaap', 'agent-tasks');
export const INDEX_PATH = path.join(STORE_DIR, 'index.json');
export const STORE_DIR_MODE = 0o700;
export const STORE_FILE_MODE = 0o600;

/**
 * Versioned task index. Queued requests must be persisted alongside their public task summaries:
 * without the original request the runner cannot reconstruct the agent command after a backend
 * restart, and the old array-only format silently turned every queued task into a failure.
 */
export interface PersistedAgentTaskIndex {
    readonly version: 2;
    readonly tasks: QaapAgentTask[];
    readonly queuedRequests: Record<string, QaapCreateAgentTaskRequest>;
}
/** Cap returned log size so a runaway task cannot blow up the response. */
export const MAX_LOG_BYTES = 512 * 1024;
/** Shown as the failing "command" when a turn is closed for having produced nothing at all. */
export const EMPTY_TURN_GATE_COMMAND = 'qaap empty-turn gate';
/** Kill agent CLIs that sit silent for too long, usually waiting for auth/quota/input. */
export const IDLE_TASK_TIMEOUT_MS = 20 * 60 * 1000;
/**
 * Let a user-stopped agent and its active tools finish cleanup before forcing SIGKILL.
 * The UI still transitions to cancelled immediately; this only controls backend cleanup.
 */
export const DEFAULT_AGENT_STOP_GRACE_TIMEOUT_MS = 5_000;
export const MIN_AGENT_STOP_GRACE_TIMEOUT_MS = 1_000;
export const MAX_AGENT_STOP_GRACE_TIMEOUT_MS = 30_000;

export function resolveAgentStopGraceTimeoutMs(rawValue = process.env.QAAP_AGENT_STOP_GRACE_MS): number {
    const parsed = Number.parseInt(rawValue?.trim() ?? '', 10);
    if (!Number.isFinite(parsed)) {
        return DEFAULT_AGENT_STOP_GRACE_TIMEOUT_MS;
    }
    return Math.min(MAX_AGENT_STOP_GRACE_TIMEOUT_MS, Math.max(MIN_AGENT_STOP_GRACE_TIMEOUT_MS, parsed));
}

export const AGENT_STOP_GRACE_TIMEOUT_MS = resolveAgentStopGraceTimeoutMs();
/**
 * Auto-approve runs ("approve for me") queue gated shell/network tools to the approvals UI,
 * but must not hang forever if nobody is watching — deny after this grace period so the
 * agent can finish the turn with the tools it has.
 */
export const QUEUED_APPROVAL_GRACE_TIMEOUT_MS = 5 * 60 * 1000;
/** Default cap on simultaneously running VPS agent processes per backend instance. */
/**
 * Default cap on simultaneously running agents for ONE authenticated user. Without it the global
 * cap is per-instance, so one user (or a fan-out of sub-tasks) fills every slot and starves all
 * other tenants — and each agent can spawn its own subprocesses, so RAM saturates first on a small
 * VPS. Only enforced for authenticated owners; the shared/anonymous (local single-user) bucket
 * keeps using the global cap alone.
 */

/** Legacy single-token file (pre per-user tokens); retained only for directory creation. */
export const TOKEN_PATH = path.join(os.homedir(), '.qaap', 'task-token');
/** Per-user helper-CLI tokens: `{ "<ownerLogin>": "<token>" }` (empty key = shared/anonymous). */
export const TOKENS_PATH = path.join(os.homedir(), '.qaap', 'task-tokens.json');
/** Helper-CLI install location; agents get this dir prepended to their PATH. */
export const HELPER_BIN_DIR = path.join(os.homedir(), '.qaap', 'bin');
export const HELPER_BIN_PATH = path.join(HELPER_BIN_DIR, 'qaap-task');

/**
 * Source of the `qaap-task` helper script written to {@link HELPER_BIN_PATH} at startup.
 * The script POSTs `{prompt, cwd, parentId, agent?}` to the agent-tasks API using the shared
 * token, then prints the new task id and exits — fire-and-forget by design so a parent agent
 * can fan out work without blocking. Kept dependency-free (only Node built-ins).
 */
export const HELPER_CLI_SOURCE = `#!/usr/bin/env node
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
