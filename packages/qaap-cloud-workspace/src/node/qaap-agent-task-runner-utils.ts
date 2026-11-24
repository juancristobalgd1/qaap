// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// Pure utility helpers extracted from QaapAgentTaskRunner.
// These functions operate only on their parameters and do not access instance state.

import { execFile, spawnSync } from 'child_process';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OPENCLAUDE_AGENT_ID } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import { findQaiqByokProvider } from '@theia/qaap-shared-core/lib/common/qaap-qaiq-byok-provider-registry';
import { QAIQ_AGENT_ID } from './qaap-agent-task-runner';
import { truncateProjectInfo } from '../common/qaap-agent-task-context';
import {
    resolveAgentReadOnlyEnforcement,
    type QaapAgentReadOnlyEnforcement,
} from '../common/qaap-agent-readonly-workspace';
import type { QaapQaiqPendingControlRequest } from '../common/qaap-qaiq-stdio-approvals';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import { diffSensitiveFiles, hashSensitiveFiles } from './qaap-sensitive-files';
import { findExecutableOnPath, readEnvPath, resolveTrustedExecutable } from './qaap-trusted-executable';
import { childProcessEnv } from './qaap-child-process-env';
import { NICE_COMMAND_NOT_EXECUTABLE, NICE_COMMAND_NOT_FOUND, withLowCpuPriority } from './qaap-exec-file-group';
import { QAAP_HARNESS_ADAPTER_REGISTRY } from './harness/qaap-harness-adapter-registry';

// ─── Constants (re-exported for the helpers) ─────────────────────────────────

export const PROJECT_INFO_MAX_CHARS = 8000;
export const AGENT_INSTRUCTIONS_MAX_CHARS = 6000;
export const REPO_MEMORY_MAX_CHARS = 2000;
export const AGENT_INSTRUCTION_FILES: readonly string[] = ['CLAUDE.md', 'AGENTS.md', '.cursorrules'];

export type QaapAgentStdinPromptMode = 'qaiq-stdio' | 'plain';

export interface QaapAgentStdinPrompt {
    readonly text: string;
    readonly mode: QaapAgentStdinPromptMode;
}

// ─── Agent detection ─────────────────────────────────────────────────────────

/** Boot-time `codex --help` probes; each call is capped here (two may run in sequence). */
const CODEX_HELP_PROBE_TIMEOUT_MS = 5_000;

/** Runs one help command and resolves its stdout and stderr; never rejects (a failed run resolves what it printed). */
export type QaapCodexHelpCommandRunner = (file: string, args: readonly string[], env: NodeJS.ProcessEnv) => Promise<string>;

const runCodexHelpCommand: QaapCodexHelpCommandRunner = (file, args, env) => new Promise<string>(resolve => {
    try {
        // Background work: below the backend's event loop for the tenant's single CPU (see withLowCpuPriority).
        const command = withLowCpuPriority(file, args);
        execFile(command.file, command.args, {
            encoding: 'utf8',
            timeout: CODEX_HELP_PROBE_TIMEOUT_MS,
            killSignal: 'SIGTERM',
            windowsHide: true,
            env: childProcessEnv(env),
        }, (error, stdout, stderr) => {
            // `nice` could not start codex: no help text, as when the spawn itself failed.
            const status = (error as { code?: unknown } | null)?.code;
            const notStarted = command.file !== file && (status === NICE_COMMAND_NOT_FOUND || status === NICE_COMMAND_NOT_EXECUTABLE);
            resolve(notStarted ? '' : `${stdout || ''}\n${stderr || ''}`);
        });
    } catch {
        resolve('');
    }
});

/**
 * Top-level and `exec` help text of the trusted codex, read without blocking the event loop and kept per
 * codex binary (path, size and mtime), so re-detecting agents does not run codex again until it changes.
 *
 * The probe used `spawnSync` twice (up to 5 s each): on a 1-CPU tenant `codex --help` took 5.4 s of
 * event-loop time at boot and re-ran on every agent catalog refresh, inside the 11.7 s cold-start stall
 * QA saw on staging (24 Nov 2026). `''` means "unknown"; callers fall back to the modern codex defaults
 * (see resolveQaapCodexTemplate), as they already did when the synchronous probe timed out.
 */
export class QaapCodexHelpProbe {

    protected readonly results = new Map<string, string>();
    protected readonly inFlight = new Map<string, Promise<string>>();

    constructor(protected readonly runCommand: QaapCodexHelpCommandRunner = runCodexHelpCommand) { }

    /** Help text of the current codex when it was already probed, `''` without a trusted codex, else `undefined`. */
    cached(env: NodeJS.ProcessEnv = process.env): string | undefined {
        const binary = this.resolveBinary(env);
        return binary ? this.results.get(binary.key) : '';
    }

    /** Probes the current codex once per binary; concurrent calls share the same run. */
    probe(env: NodeJS.ProcessEnv = process.env): Promise<string> {
        const binary = this.resolveBinary(env);
        if (!binary) {
            return Promise.resolve('');
        }
        const done = this.results.get(binary.key);
        if (done !== undefined) {
            return Promise.resolve(done);
        }
        const running = this.inFlight.get(binary.key);
        if (running) {
            return running;
        }
        const run = this.readHelp(binary.path, env)
            .catch(() => '')
            .then(help => {
                this.results.set(binary.key, help);
                this.inFlight.delete(binary.key);
                return help;
            });
        this.inFlight.set(binary.key, run);
        return run;
    }

    protected async readHelp(codex: string, env: NodeJS.ProcessEnv): Promise<string> {
        const topLevelHelp = await this.runCommand(codex, ['--help'], env);
        if (!/\bcodex\s+exec\b|^\s+exec\b/m.test(topLevelHelp)) {
            return topLevelHelp;
        }
        return `${topLevelHelp}\n${await this.runCommand(codex, ['exec', '--help'], env)}`;
    }

    /** Only a codex the backend uid trusts may run here (never a tenant-installed one as root). */
    protected resolveBinary(env: NodeJS.ProcessEnv): { readonly path: string; readonly key: string } | undefined {
        const codex = resolveTrustedExecutable('codex', env);
        if (!codex) {
            return undefined;
        }
        try {
            const stat = fs.statSync(codex);
            return { path: codex, key: `${codex}\0${stat.size}\0${stat.mtimeMs}` };
        } catch {
            return { path: codex, key: codex };
        }
    }
}

export function isQaiqRunner(agentId: string | undefined, command: string): boolean {
    if (agentId === QAIQ_AGENT_ID || agentId === OPENCLAUDE_AGENT_ID) {
        return true;
    }
    return /\b(qaiq|openclaude)\b/.test(command);
}

const WINDOWS_PATHEXT_FALLBACK = '.COM;.EXE;.BAT;.CMD;.VBS;.JS;.MSC';

/**
 * Pick the first real executable from `where`/`which` output.
 * On Windows, `where foo` often prints `foo` without `.cmd`; PATHEXT fills that gap.
 */
export function resolveExistingExecutablePath(
    candidates: readonly string[],
    options: {
        readonly platform?: NodeJS.Platform;
        readonly pathExt?: string;
        readonly stat?: (filePath: string) => { isFile(): boolean } | undefined;
    } = {},
): string | undefined {
    const platform = options.platform ?? process.platform;
    const stat = options.stat ?? ((filePath: string) => {
        try {
            return fs.statSync(filePath);
        } catch {
            return undefined;
        }
    });
    const extensions = platform === 'win32'
        ? (options.pathExt ?? process.env.PATHEXT ?? WINDOWS_PATHEXT_FALLBACK)
            .split(';')
            .map(ext => ext.trim())
            .filter(ext => ext.length > 0)
        : [];
    for (const raw of candidates) {
        const candidate = raw.trim().replace(/^"+|"+$/g, '');
        if (!candidate || /^INFO:/i.test(candidate)) {
            continue;
        }
        if (stat(candidate)?.isFile()) {
            return candidate;
        }
        if (platform === 'win32' && path.extname(candidate) === '') {
            for (const ext of extensions) {
                const variants = [ext, ext.toLowerCase(), ext.toUpperCase()];
                for (const variant of variants) {
                    const withExt = candidate + variant;
                    if (stat(withExt)?.isFile()) {
                        return withExt;
                    }
                }
            }
        }
    }
    return undefined;
}

/**
 * Whether `bin` resolves on `env`'s PATH. The lookup runs in-process: spawning `which`/`where`
 * with a tenant-influenced PATH would let a planted `which` run with the backend's privileges.
 */
export function isOnPath(bin: string, env: NodeJS.ProcessEnv = process.env): boolean {
    return findExecutableOnPath(bin, readEnvPath(env)) !== undefined;
}

// ─── String / template utilities ─────────────────────────────────────────────

export function applyTemplateVars(template: string, vars: Record<string, string>): string {
    let resolved = template;
    for (const [key, value] of Object.entries(vars)) {
        resolved = resolved.split(`{${key}}`).join(value.trim());
    }
    // `{trust_flags}` is always filled by buildTemplateVars; drop it if a caller passed vars without it.
    resolved = resolved.split('{trust_flags}').join('');
    return resolved.replace(/\s+/g, ' ').trim();
}

/** POSIX single-quote escaping so the prompt is passed as one safe argument. */
export function shellQuote(value: string): string {
    return `'${value.split('\'').join('\'\\\'\'')}'`;
}

export function applyTemplate(template: string, prompt: string, vars: Record<string, string> = {}): string {
    const withPromptSlot = template.includes('{prompt}') ? template : `${template} {prompt}`;
    // Normalise the template's whitespace before the prompt goes in: `applyTemplateVars` collapses every
    // whitespace run, and the quoted prompt must keep its spaces and newlines byte-for-byte.
    return applyTemplateVars(withPromptSlot, vars).split('{prompt}').join(shellQuote(prompt));
}

/** Template expansion for stdio-approval runs: the prompt is delivered over stdin, not argv. */
export function applyTemplateWithoutPrompt(template: string, vars: Record<string, string> = {}): string {
    return applyTemplateVars(template.split('{prompt}').join(' '), vars);
}

/** Template expansion for CLIs such as Codex that read a prompt from stdin when given `-`. */
export function applyTemplateWithStdinPrompt(template: string, vars: Record<string, string> = {}): string {
    return applyTemplateVars(template.split('{prompt}').join('-'), vars);
}

/**
 * Drop `-p {prompt}` / `--prompt {prompt}` so the flag does not sit empty after the
 * prompt moves off argv. Used when `-p` *is* the prompt flag (Copilot, Gemini, Grok file).
 */
export function applyTemplateWithoutPromptFlag(template: string, vars: Record<string, string> = {}): string {
    const stripped = template
        .replace(/\s+(?:-p|--prompt|--single)\s+\{prompt\}/g, ' ')
        .split('{prompt}').join(' ');
    return applyTemplateVars(stripped, vars);
}

/** How a harness should receive the (often huge) Qaap task prompt. */
export type QaapAgentPromptPlaceholder = 'omit' | 'omit-flag' | 'dash';

export type QaapAgentPromptTransport =
    | { readonly kind: 'argv' }
    /**
     * Argv, with a size guard ({@link planArgvPrompt}). Only agy uses it: agy 1.5.9 ignores stdin in text mode
     * (`printf ... | agy -p -` never sees the prompt; `agy -p '<text>'` does), and it has no prompt-file flag.
     */
    | { readonly kind: 'argv-prompt' }
    | { readonly kind: 'plain-stdin'; readonly placeholder: QaapAgentPromptPlaceholder }
    | { readonly kind: 'prompt-file'; readonly flag: '--prompt-file' };

/** Largest prompt passed as one argv string on POSIX: Linux caps a single argument at MAX_ARG_STRLEN (128 KiB). */
export const AGENT_ARGV_PROMPT_LIMIT_POSIX_BYTES = 96 * 1024;
/** Largest prompt passed as one argv string on Windows, where cmd.exe caps the whole line near 8191 characters. */
export const AGENT_ARGV_PROMPT_LIMIT_WIN32_CHARS = 24_000;

export interface ArgvPromptPlan {
    /** The text placed in argv: the prompt itself, or a short instruction that points at {@link promptTempDir}. */
    readonly prompt: string;
    /** Private temp dir holding the full prompt; the caller removes it when the task settles. */
    readonly promptTempDir?: string;
}

/**
 * Prompt text for an argv-only harness. Within the limit the prompt goes through unchanged. Over it the full
 * prompt is written to a private file and argv carries a short instruction to read that file. Never truncates.
 */
export function planArgvPrompt(prompt: string, owner?: AgentPromptOwner): ArgvPromptPlan {
    const win32 = process.platform === 'win32';
    const size = win32 ? prompt.length : Buffer.byteLength(prompt, 'utf8');
    const limit = win32 ? AGENT_ARGV_PROMPT_LIMIT_WIN32_CHARS : AGENT_ARGV_PROMPT_LIMIT_POSIX_BYTES;
    if (size <= limit) {
        return { prompt };
    }
    const written = writeAgentPromptFile(prompt, owner);
    return {
        prompt: `Read the file at ${written.file} and follow the instructions it contains exactly; it is the user's full message.`,
        promptTempDir: written.dir,
    };
}

/**
 * Windows `cmd.exe` dies at ~8191 characters ("La línea de comandos es demasiado larga")
 * when the full Qaap context is inlined as `{prompt}`. Prefer stdin, or `--prompt-file`
 * for CLIs that refuse piped input (Grok).
 *
 * The per-harness rules live in the harness adapters (`harness/legacy/*`); this keeps the entry point
 * stable for callers that only have an id and a detected CLI.
 */
export function resolveAgentPromptTransport(
    agentId: string | undefined,
    detected?: { readonly id?: string; readonly bin?: string; readonly template?: string },
): QaapAgentPromptTransport {
    return QAAP_HARNESS_ADAPTER_REGISTRY.resolvePromptTransport(agentId, detected);
}

export function applyTemplateForPromptTransport(
    template: string,
    transport: QaapAgentPromptTransport,
    vars: Record<string, string> = {},
): string {
    if (transport.kind === 'argv' || transport.kind === 'argv-prompt') {
        return applyTemplateVars(template, vars);
    }
    if (transport.kind === 'plain-stdin' && transport.placeholder === 'dash') {
        return applyTemplateWithStdinPrompt(template, vars);
    }
    if (transport.kind === 'prompt-file'
        || (transport.kind === 'plain-stdin' && transport.placeholder === 'omit-flag')) {
        return applyTemplateWithoutPromptFlag(template, vars);
    }
    return applyTemplateWithoutPrompt(template, vars);
}

export interface QaapPromptTransportCommand {
    readonly command: string;
    readonly stdinPrompt?: string;
    readonly promptTempDir?: string;
}

/** Build a one-shot command without placing a long improvement prompt in argv. */
export function buildPromptTransportCommand(
    template: string,
    prompt: string,
    agentId: string | undefined,
    detected?: { readonly id?: string; readonly bin?: string; readonly template?: string },
    vars: Record<string, string> = {},
    owner?: AgentPromptOwner,
): QaapPromptTransportCommand {
    const transport = resolveAgentPromptTransport(agentId, detected);
    if (transport.kind === 'argv') {
        return { command: applyTemplate(template, prompt, vars) };
    }
    if (transport.kind === 'argv-prompt') {
        const planned = planArgvPrompt(prompt, owner);
        return {
            command: applyTemplate(template, planned.prompt, vars),
            ...(planned.promptTempDir ? { promptTempDir: planned.promptTempDir } : {}),
        };
    }
    let command = applyTemplateForPromptTransport(template, transport, vars);
    if (transport.kind === 'prompt-file') {
        const written = writeAgentPromptFile(prompt, owner);
        command = `${command} ${transport.flag} ${quoteShellArg(written.file)}`;
        return { command, promptTempDir: written.dir };
    }
    return { command, stdinPrompt: prompt };
}

/** Quote a filesystem path for `shell: true` (`cmd.exe` on Windows, POSIX elsewhere). */
export function quoteShellArg(value: string): string {
    if (process.platform === 'win32') {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return shellQuote(value);
}

/** The OS identity the agent CLI runs as when the backend drops privileges (`uid` differs from this process). */
export interface AgentPromptOwner {
    readonly uid: number;
    readonly gid?: number;
}

/** Dirs created as another uid, keyed by path, so their removal runs as that uid too (root has no DAC override). */
const promptDirOwners = new Map<string, AgentPromptOwner>();

/**
 * Runs a small Node script as `owner`, with `input` as JSON on stdin. Returns true on exit 0.
 * Overridable through {@link agentPromptOwnerRunner} for tests, which cannot switch uid.
 */
function runAgentPromptScriptAsOwner(owner: AgentPromptOwner, script: string, input: object): boolean {
    const result = spawnSync(process.execPath, ['-e', script], {
        uid: owner.uid, gid: owner.gid ?? owner.uid, cwd: '/',
        input: JSON.stringify(input), timeout: 30000,
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin' }, stdio: ['pipe', 'ignore', 'pipe'],
    });
    if (result.status !== 0 && result.stderr) {
        console.warn(`[qaap-agent-prompt] agent-side prompt file step failed: ${String(result.stderr).slice(0, 200)}`);
    }
    return result.status === 0;
}

/** Seam for the agent-side runner; specs replace `run` to simulate the agent uid without root. */
export const agentPromptOwnerRunner: { run: (owner: AgentPromptOwner, script: string, input: object) => boolean } = {
    run: runAgentPromptScriptAsOwner,
};

/**
 * Runs as the agent uid: creates the 0700 dir and the 0600 prompt file, so the agent (and nobody else) can read
 * the prompt. Refuses to run over an existing entry (`mkdirSync`/`wx`), so nothing is planted in advance.
 */
export const AGENT_PROMPT_WRITE_SCRIPT = [
    "const fs=require('fs');",
    "const i=JSON.parse(fs.readFileSync(0,'utf8'));",
    'try{',
    'fs.mkdirSync(i.dir,{mode:0o700});',
    "const fd=fs.openSync(i.file,'wx',0o600);",
    "try{const b=Buffer.from(i.text,'utf8');let o=0;while(o<b.length){o+=fs.writeSync(fd,b,o,b.length-o);}}finally{fs.closeSync(fd);}",
    '}catch(e){process.stderr.write(String(e&&e.message));process.exit(1);}',
].join('');

/** Runs as the agent uid: removes the prompt dir the agent created. Only ever called with a dir it owns. */
export const AGENT_PROMPT_REMOVE_SCRIPT = [
    "const fs=require('fs');",
    "const i=JSON.parse(fs.readFileSync(0,'utf8'));",
    'try{fs.rmSync(i.dir,{recursive:true,force:true});}catch(e){process.stderr.write(String(e&&e.message));process.exit(1);}',
].join('');

/**
 * Persist a prompt so CLIs such as Grok can take `--prompt-file` instead of argv.
 * Without an `owner` (or when it is this process's uid) the root-owned 0700 dir is enough. With a different
 * `owner` the dir and file are created AS that uid, so the agent can read them; nothing is world-readable.
 * Fails closed: if the agent side cannot write the file, this throws and the prompt is not written by root.
 */
export function writeAgentPromptFile(
    text: string,
    owner?: AgentPromptOwner,
    options: { readonly fileName?: string; readonly dirPrefix?: string; readonly baseDir?: string } = {},
): { readonly file: string; readonly dir: string } {
    const fileName = options.fileName ?? 'prompt.txt';
    const baseDir = options.baseDir ?? os.tmpdir();
    // The prefix always starts with `qaap-agent-prompt-`: removeAgentPromptTempDir only removes such dirs.
    const dirPrefix = `qaap-agent-prompt-${options.dirPrefix ?? ''}`;
    const currentUid = typeof process.getuid === 'function' ? process.getuid() : undefined;
    if (owner && owner.uid !== currentUid) {
        const dir = path.join(baseDir, `${dirPrefix}${randomBytes(16).toString('hex')}`);
        const file = path.join(dir, fileName);
        if (!agentPromptOwnerRunner.run(owner, AGENT_PROMPT_WRITE_SCRIPT, { dir, file, text })) {
            throw new Error(`Could not write the agent prompt file as uid ${owner.uid}.`);
        }
        const stat = fs.lstatSync(dir);
        if (!stat.isDirectory() || stat.uid !== owner.uid) {
            throw new Error(`Refusing the agent prompt dir ${dir}: the agent user did not create it.`);
        }
        promptDirOwners.set(dir, owner);
        return { file, dir };
    }
    const dir = fs.mkdtempSync(path.join(baseDir, dirPrefix));
    const file = path.join(dir, fileName);
    fs.writeFileSync(file, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    return { file, dir };
}

/** Remove a temp dir created by {@link writeAgentPromptFile}. Safe no-op for other paths. */
export function removeAgentPromptTempDir(dir: string | undefined): void {
    if (!dir) {
        return;
    }
    if (!path.basename(dir).startsWith('qaap-agent-prompt-')) {
        return;
    }
    const owner = promptDirOwners.get(dir);
    if (owner) {
        promptDirOwners.delete(dir);
        agentPromptOwnerRunner.run(owner, AGENT_PROMPT_REMOVE_SCRIPT, { dir });
        return;
    }
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch {
        /* already gone */
    }
}

export function agentUsesPlainStdinPrompt(
    agentId: string | undefined,
    detected?: { readonly id?: string; readonly bin?: string; readonly template?: string },
): boolean {
    return resolveAgentPromptTransport(agentId, detected).kind === 'plain-stdin';
}

export function truncateForPrompt(value: string, maxChars: number): string {
    if (value.length <= maxChars) {
        return value;
    }
    return `${value.slice(0, Math.floor(maxChars / 2))}\n...[truncated]...\n${value.slice(value.length - Math.floor(maxChars / 2))}`;
}

export function truncateHead(value: string, maxChars: number): string {
    if (value.length <= maxChars) {
        return value;
    }
    return `...[truncated]...\n${value.slice(value.length - maxChars)}`;
}

// ─── File system utilities ───────────────────────────────────────────────────

export function loadProjectInfoFromDisk(cwd: string): string | undefined {
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

export function loadAgentInstructionsFromDisk(cwd: string): string | undefined {
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

export function readRepoMemory(cwd: string): string | undefined {
    try {
        const text = fs.readFileSync(path.join(cwd, '.qaap', 'memory.md'), 'utf8').trim();
        return text ? truncateProjectInfo(text, REPO_MEMORY_MAX_CHARS) : undefined;
    } catch {
        return undefined;
    }
}

export function readResearchLedger(cwd: string): string | undefined {
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

export function isDirectory(target: string): boolean {
    try {
        return fs.statSync(target).isDirectory();
    } catch {
        return false;
    }
}

// ─── Environment utilities ───────────────────────────────────────────────────

export interface QaapQaiqEnvFallbackModel {
    readonly provider: 'openai' | 'gemini' | 'ollama' | 'anthropic' | 'mistral';
    readonly vendor: string;
    readonly modelId: string;
}

/**
 * OpenRouter model for an env-only key: the head of the curated free list
 * (`OPENROUTER_DEFAULT_FREE_MODELS`), so the default and the fallback chain can never disagree again
 * (Oct 21 2026: the hardcoded `nvidia/nemotron-3-super-120b-a12b:free` died and every default turn
 * burnt a failed attempt). Literal fallback only if the registry is ever emptied.
 */
const QAIQ_OPENROUTER_ENV_FALLBACK_MODEL_ID: string =
    findQaiqByokProvider('openrouter')?.fallbackModels?.[0] ?? 'nvidia/nemotron-3-ultra-550b-a55b:free';

/**
 * Env-only model when Settings aliases are missing or point at a vendor with no credentials.
 * Keep in lockstep with {@link resolveQaiqProviderFlagsFromEnv}.
 */
export function resolveQaiqEnvFallbackModel(env: NodeJS.ProcessEnv): QaapQaiqEnvFallbackModel | undefined {
    if (env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim()) {
        return { provider: 'gemini', vendor: 'google', modelId: 'gemini-2.5-flash' };
    }
    if (env.OPENROUTER_API_KEY?.trim()) {
        return { provider: 'openai', vendor: 'openrouter', modelId: QAIQ_OPENROUTER_ENV_FALLBACK_MODEL_ID };
    }
    if (env.NVIDIA_API_KEY?.trim()) {
        return { provider: 'openai', vendor: 'nvidia', modelId: 'meta/llama-3.3-70b-instruct' };
    }
    if (env.OLLAMA_HOST?.trim()) {
        return { provider: 'ollama', vendor: 'ollama', modelId: 'qwen2.5-coder:7b' };
    }
    return undefined;
}

/** Env-only fallback when no model alias or provider list is configured yet. */
export function resolveQaiqProviderFlagsFromEnv(env: NodeJS.ProcessEnv): string {
    const fallback = resolveQaiqEnvFallbackModel(env);
    if (fallback) {
        return `--provider ${fallback.provider} --model ${fallback.modelId}`;
    }
    if (env.OPENAI_API_KEY?.trim()) {
        return '--provider openai';
    }
    return '';
}

export function applyOpenRouterOpenAiCompatEnv(env: NodeJS.ProcessEnv): void {
    if (!env.OPENROUTER_API_KEY?.trim() || env.OPENAI_API_KEY?.trim()) {
        return;
    }
    env.OPENAI_API_KEY = env.OPENROUTER_API_KEY.trim();
    if (!env.OPENAI_BASE_URL?.trim()) {
        env.OPENAI_BASE_URL = env.OPENROUTER_BASE_URL?.trim() || 'https://openrouter.ai/api/v1';
    }
}

/** QAIQ's OpenAI provider reads OPENAI_*; map NVIDIA NIM prefs when needed. */
export function applyNvidiaOpenAiCompatEnv(env: NodeJS.ProcessEnv): void {
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
export function applyHuggingfaceOpenAiCompatEnv(env: NodeJS.ProcessEnv): void {
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

/** Prepend a directory without creating a duplicate case-variant PATH on Windows. */
export function prependPathEntry(env: NodeJS.ProcessEnv, entry: string): void {
    const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH';
    const existingPath = env[pathKey]?.trim();
    env[pathKey] = existingPath ? `${entry}${path.delimiter}${existingPath}` : entry;
    for (const key of Object.keys(env)) {
        if (key !== pathKey && key.toLowerCase() === 'path') {
            delete env[key];
        }
    }
}

// ─── Other pure helpers ──────────────────────────────────────────────────────

export function noteReadOnlyEnforcement(taskId: string, agentId: string): QaapAgentReadOnlyEnforcement {
    const enforcement = resolveAgentReadOnlyEnforcement(agentId);
    if (enforcement === 'none') {
        console.warn(
            `[qaap-agent-tasks] task ${taskId} was dispatched read-only, but agent "${agentId}" exposes no `
            + 'read-only mechanism. The turn can modify its workspace; "read-only" is prompt text only.',
        );
    }
    return enforcement;
}

export function changedSensitiveFiles(task: QaapAgentTask): string[] {
    if (!task.sensitiveBaselineHashes) {
        return [];
    }
    return diffSensitiveFiles(task.sensitiveBaselineHashes, hashSensitiveFiles(task.cwd));
}

export function findPendingControlRequestEntry(
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
