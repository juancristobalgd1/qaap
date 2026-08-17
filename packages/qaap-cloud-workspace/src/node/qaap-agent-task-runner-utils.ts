// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// Pure utility helpers extracted from QaapAgentTaskRunner.
// These functions operate only on their parameters and do not access instance state.

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { OPENCLAUDE_AGENT_ID } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-task-client';
import { QAIQ_AGENT_ID } from './qaap-agent-task-runner';
import { truncateProjectInfo } from '../common/qaap-agent-task-context';
import {
    resolveAgentReadOnlyEnforcement,
    type QaapAgentReadOnlyEnforcement,
} from '../common/qaap-agent-readonly-workspace';
import type { QaapQaiqPendingControlRequest } from '../common/qaap-qaiq-stdio-approvals';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import { diffSensitiveFiles, hashSensitiveFiles } from './qaap-sensitive-files';

// ─── Constants (re-exported for the helpers) ─────────────────────────────────

export const PROJECT_INFO_MAX_CHARS = 8000;
export const AGENT_INSTRUCTIONS_MAX_CHARS = 6000;
export const REPO_MEMORY_MAX_CHARS = 2000;
export const AGENT_INSTRUCTION_FILES: readonly string[] = ['CLAUDE.md', 'AGENTS.md', '.cursorrules'];

// ─── Agent detection ─────────────────────────────────────────────────────────

export function readCodexHelp(): string {
    try {
        const probe = spawnSync('codex', ['--help'], { encoding: 'utf8' });
        return `${probe.stdout || ''}\n${probe.stderr || ''}`;
    } catch {
        return '';
    }
}

export function isQaiqRunner(agentId: string | undefined, command: string): boolean {
    if (agentId === QAIQ_AGENT_ID || agentId === OPENCLAUDE_AGENT_ID) {
        return true;
    }
    return /\b(qaiq|openclaude)\b/.test(command);
}

export function isOnPath(bin: string): boolean {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    try {
        const result = spawnSync(cmd, [bin], { encoding: 'utf8' });
        if (result.status !== 0 || result.error) {
            return false;
        }
        const resolved = result.stdout?.trim().split(/\r?\n/)[0];
        if (!resolved) {
            return false;
        }
        fs.accessSync(resolved, fs.constants.X_OK);
        return fs.statSync(resolved).isFile();
    } catch {
        return false;
    }
}

// ─── String / template utilities ─────────────────────────────────────────────

export function applyTemplateVars(template: string, vars: Record<string, string>): string {
    let resolved = template;
    for (const [key, value] of Object.entries(vars)) {
        resolved = resolved.split(`{${key}}`).join(value.trim());
    }
    return resolved.replace(/\s+/g, ' ').trim();
}

/** POSIX single-quote escaping so the prompt is passed as one safe argument. */
export function shellQuote(value: string): string {
    return `'${value.split('\'').join('\'\\\'\'')}'`;
}

export function applyTemplate(template: string, prompt: string, vars: Record<string, string> = {}): string {
    const quoted = shellQuote(prompt);
    const resolved = template.includes('{prompt}')
        ? template.split('{prompt}').join(quoted)
        : `${template} ${quoted}`;
    return applyTemplateVars(resolved, vars);
}

/** Template expansion for stdio-approval runs: the prompt is delivered over stdin, not argv. */
export function applyTemplateWithoutPrompt(template: string, vars: Record<string, string> = {}): string {
    return applyTemplateVars(template.split('{prompt}').join(' '), vars);
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
 * Env-only model when Settings aliases are missing or point at a vendor with no credentials.
 * Keep in lockstep with {@link resolveQaiqProviderFlagsFromEnv}.
 */
export function resolveQaiqEnvFallbackModel(env: NodeJS.ProcessEnv): QaapQaiqEnvFallbackModel | undefined {
    if (env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim()) {
        return { provider: 'gemini', vendor: 'google', modelId: 'gemini-2.5-flash' };
    }
    if (env.OPENROUTER_API_KEY?.trim()) {
        return { provider: 'openai', vendor: 'openrouter', modelId: 'nvidia/nemotron-3-super-120b-a12b:free' };
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
