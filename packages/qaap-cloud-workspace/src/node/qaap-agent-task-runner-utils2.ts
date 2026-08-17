// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// Pure helpers extracted from QaapAgentTaskRunner (batch 2).
// These functions operate only on their parameters and do not access instance state.

import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
    resolveUserSettingsFilePath,
    usesSharedAiSettingsFallback,
} from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { listQaapAiSettingsPrefKeys } from '@theia/qaap-mobile-shell/lib/common/qaap-qaiq-byok-provider-registry';
import type { QaapPreferenceReader } from '@theia/qaap-mobile-shell/lib/common/qaap-qaiq-byok-provider-registry';
import { resolveQaapAgentVerificationScripts } from './qaap-agent-verification';
import { QAIQ_AGENT_ID } from './qaap-agent-task-runner';
import type { AgentCandidate } from './qaap-agent-task-runner-types';

// ─── Constants (shared with the main class) ──────────────────────────────────

export const GENERIC_COMMAND_TRUNCATED_PREFIX = '...[truncated]...\n';
export const GIT_STATUS_SNAPSHOT_MAX_CHARS = 1500;
export const REPO_MAP_EXCLUDED_DIRS = new Set<string>([
    'node_modules', '.git', 'dist', 'build', 'out', '.next', '.cache',
    'coverage', '.nyc_output', '.turbo', '.vscode', '.idea',
]);
export const REPO_MAP_SOURCE_DIRS = new Set<string>(['src', 'app', 'components', 'pages', 'packages', 'server', 'api']);
export const AGENT_ENV_PREFS: readonly { readonly env: string; readonly pref: string }[] = [
    { env: 'ANTHROPIC_API_KEY', pref: 'anthropic-api-key' },
    { env: 'OPENAI_API_KEY', pref: 'openai-api-key' },
    { env: 'GEMINI_API_KEY', pref: 'gemini-api-key' },
    { env: 'GOOGLE_API_KEY', pref: 'google-api-key' },
    { env: 'OPENROUTER_API_KEY', pref: 'openrouter-api-key' },
    { env: 'NVIDIA_API_KEY', pref: 'nvidia-api-key' },
];
export const DEFAULT_MAX_CONCURRENT_AGENTS = 4;
export const MAX_CONCURRENT_AGENTS_ENV = 'QAAP_MAX_CONCURRENT_AGENTS';
export const DEFAULT_MAX_CONCURRENT_AGENTS_PER_USER = 2;
export const MAX_CONCURRENT_AGENTS_PER_USER_ENV = 'QAAP_MAX_CONCURRENT_AGENTS_PER_USER';

// ─── Fingerprint constants ───────────────────────────────────────────────────

export const WORKTREE_FINGERPRINT_MAX_BUFFER = 64 * 1024 * 1024;
export const WORKTREE_FINGERPRINT_MAX_UNTRACKED_BYTES = 512 * 1024 * 1024;
export const WORKTREE_FINGERPRINT_HASH_BATCH_SIZE = 128;

// ─── Custom agent parsing ────────────────────────────────────────────────────

export function parseCustomAgent(
    entry: unknown,
    index: number,
    agentCandidates: readonly AgentCandidate[],
    shellAgentId: string,
    envAgentId: string,
    customAgentsEnv: string,
): AgentCandidate[] {
    if (!entry || typeof entry !== 'object') {
        console.warn(`[qaap-agent-tasks] ignored ${customAgentsEnv}[${index}]: entry must be an object.`);
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
        || id === shellAgentId
        || id === envAgentId
        || id === QAIQ_AGENT_ID
        || agentCandidates.some(candidate => candidate.id === id)
    ) {
        console.warn(`[qaap-agent-tasks] ignored ${customAgentsEnv}[${index}]: invalid or reserved id "${id}".`);
        return [];
    }
    if (!template) {
        console.warn(`[qaap-agent-tasks] ignored ${customAgentsEnv}[${index}]: template is required.`);
        return [];
    }
    return [{ id, label: label || id, bin, template }];
}

// ─── Concurrency limits ──────────────────────────────────────────────────────

export function maxConcurrentAgents(): number {
    const raw = process.env[MAX_CONCURRENT_AGENTS_ENV]?.trim();
    if (!raw) {
        return DEFAULT_MAX_CONCURRENT_AGENTS;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_CONCURRENT_AGENTS;
}

export function maxConcurrentAgentsPerUser(): number {
    const raw = process.env[MAX_CONCURRENT_AGENTS_PER_USER_ENV]?.trim();
    if (!raw) {
        return DEFAULT_MAX_CONCURRENT_AGENTS_PER_USER;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_CONCURRENT_AGENTS_PER_USER;
}

// ─── Repo map builders ───────────────────────────────────────────────────────

export function buildRepoTree(cwd: string): string | undefined {
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
export function buildRecentlyChangedFiles(cwd: string): string | undefined {
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
export function readGitStatusSnapshot(cwd: string): string | undefined {
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

// ─── Worktree fingerprinting ─────────────────────────────────────────────────

export function captureWorktreeStatus(cwd: string): string | undefined {
    if (!fs.existsSync(path.join(cwd, '.git'))) {
        return undefined;
    }
    const result = spawnSync('git', ['-C', cwd, 'status', '--porcelain', '--untracked-files=all'], {
        cwd,
        encoding: 'utf8',
        maxBuffer: WORKTREE_FINGERPRINT_MAX_BUFFER,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.status !== 0 || result.error || typeof result.stdout !== 'string') {
        return undefined;
    }
    return result.stdout
        .split('\n')
        .map(line => line.trimEnd())
        .filter(Boolean)
        .sort()
        .join('\n');
}

/**
 * Hash the complete tracked diff plus the identity and contents of untracked files without
 * changing the index. Git streams untracked contents in bounded path batches; repositories
 * above the explicit byte budget return undefined so callers can use the porcelain baseline
 * instead of a bare "any dirty path" probe.
 */
export function captureWorktreeFingerprint(cwd: string): string | undefined {
    if (!fs.existsSync(path.join(cwd, '.git'))) {
        return undefined;
    }
    const runGit = (args: readonly string[]): string | undefined => {
        const result = spawnSync('git', ['-C', cwd, ...args], {
            cwd,
            encoding: 'utf8',
            maxBuffer: WORKTREE_FINGERPRINT_MAX_BUFFER,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        return result.status === 0 && !result.error && typeof result.stdout === 'string'
            ? result.stdout
            : undefined;
    };
    const head = runGit(['rev-parse', '--verify', 'HEAD']);
    const diff = runGit(['diff', '--no-ext-diff', '--binary', 'HEAD', '--']);
    const untracked = runGit(['ls-files', '--others', '--exclude-standard', '-z']);
    if (head === undefined || diff === undefined || untracked === undefined) {
        return undefined;
    }
    const root = path.resolve(cwd);
    const hash = createHash('sha256');
    hash.update('head\0').update(head).update('\0diff\0').update(diff).update('\0untracked\0');
    const regularUntrackedFiles: string[] = [];
    let untrackedBytes = 0n;
    try {
        for (const relativePath of untracked.split('\0')) {
            if (!relativePath) {
                continue;
            }
            const absolutePath = path.resolve(root, relativePath);
            const relativeToRoot = path.relative(root, absolutePath);
            if (relativeToRoot === '..' || relativeToRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToRoot)) {
                return undefined;
            }
            const stat = fs.lstatSync(absolutePath, { bigint: true });
            hash.update(relativePath).update('\0');
            hash.update(`${stat.mode}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`).update('\0');
            if (stat.isFile()) {
                untrackedBytes += stat.size;
                if (untrackedBytes > BigInt(WORKTREE_FINGERPRINT_MAX_UNTRACKED_BYTES)) {
                    return undefined;
                }
                regularUntrackedFiles.push(relativePath);
            } else if (stat.isSymbolicLink()) {
                hash.update(fs.readlinkSync(absolutePath)).update('\0');
            }
        }
    } catch {
        return undefined;
    }
    for (let offset = 0; offset < regularUntrackedFiles.length; offset += WORKTREE_FINGERPRINT_HASH_BATCH_SIZE) {
        const contentHashes = runGit([
            'hash-object',
            '--no-filters',
            '--',
            ...regularUntrackedFiles.slice(offset, offset + WORKTREE_FINGERPRINT_HASH_BATCH_SIZE),
        ]);
        if (contentHashes === undefined) {
            return undefined;
        }
        hash.update('content\0').update(contentHashes).update('\0');
    }
    return hash.digest('hex');
}

// ─── Verification scripts ────────────────────────────────────────────────────

export async function resolveVerificationScriptsForCwd(cwd: string): Promise<string[]> {
    try {
        const raw = await fsp.readFile(path.join(cwd, 'package.json'), 'utf8');
        return resolveQaapAgentVerificationScripts(JSON.parse(raw) as unknown);
    } catch {
        return [];
    }
}

// ─── Command output bounding ─────────────────────────────────────────────────

export function appendBoundedCommandOutput(current: string, chunk: string, maxChars: number | undefined): string {
    if (maxChars === undefined) {
        return `${current}${chunk}`;
    }
    if (!Number.isFinite(maxChars) || maxChars <= 0) {
        return '';
    }
    const boundedMax = Math.floor(maxChars);
    if (boundedMax <= GENERIC_COMMAND_TRUNCATED_PREFIX.length) {
        return `${current}${chunk}`.slice(-boundedMax);
    }
    const contentMax = boundedMax - GENERIC_COMMAND_TRUNCATED_PREFIX.length;
    const wasTruncated = current.startsWith(GENERIC_COMMAND_TRUNCATED_PREFIX);
    const currentContent = wasTruncated ? current.slice(GENERIC_COMMAND_TRUNCATED_PREFIX.length) : current;
    if (!wasTruncated && currentContent.length + chunk.length <= boundedMax) {
        return `${currentContent}${chunk}`;
    }
    if (chunk.length >= contentMax) {
        return `${GENERIC_COMMAND_TRUNCATED_PREFIX}${chunk.slice(-contentMax)}`;
    }
    const keepFromCurrent = Math.max(0, contentMax - chunk.length);
    return `${GENERIC_COMMAND_TRUNCATED_PREFIX}${currentContent.slice(-keepFromCurrent)}${chunk}`;
}

// ─── User settings ───────────────────────────────────────────────────────────

/** Fallback when the backend PreferenceService has no User provider (common in VPS containers).
 *  Authenticated `ownerLogin` reads ONLY `~/.qaap/users/{login}/settings.json` — never the shared
 *  `~/.theia/settings.json`, which would leak User A's BYOK keys into User B's spawn.
 *  Skip-auth / anonymous still fall back to the shared file for local single-user VPS. */
export function readUserSettingsFromDisk(ownerLogin?: string, homeDir: string = os.homedir()): Record<string, unknown> {
    try {
        const sharedSettingsPath = path.join(homeDir, '.theia', 'settings.json');
        const userSettingsPath = ownerLogin?.trim()
            ? resolveUserSettingsFilePath(ownerLogin, homeDir)
            : undefined;
        let settingsPath = sharedSettingsPath;
        if (userSettingsPath) {
            if (fs.existsSync(userSettingsPath)) {
                settingsPath = userSettingsPath;
            } else if (!usesSharedAiSettingsFallback(ownerLogin)) {
                return {};
            }
        }
        if (!fs.existsSync(settingsPath)) {
            return {};
        }
        return parseSettingsJsonFile(settingsPath);
    } catch (error) {
        console.warn('[qaap-agent-tasks] failed to read user settings from disk:', error instanceof Error ? error.message : String(error));
        return {};
    }
}

export function parseSettingsJsonFile(settingsPath: string): Record<string, unknown> {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    if (!raw.trim()) {
        return {};
    }
    return JSON.parse(raw) as Record<string, unknown>;
}

export function filterAiSettings(settings: Record<string, unknown>): Record<string, unknown> {
    const allowed = new Set(listQaapAiSettingsPrefKeys());
    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(settings)) {
        if (allowed.has(key) && value !== undefined) {
            filtered[key] = value;
        }
    }
    return filtered;
}

/** Merge AI preference keys into the per-user settings file. Unknown keys are ignored. */
export function writeUserSettingsToDisk(
    ownerLogin: string,
    patch: Record<string, unknown>,
    homeDir: string = os.homedir(),
): Record<string, unknown> {
    const filePath = resolveUserSettingsFilePath(ownerLogin, homeDir);
    const current = fs.existsSync(filePath) ? parseSettingsJsonFile(filePath) : {};
    const next = { ...current, ...filterAiSettings(patch) };
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined && key in next) {
            delete next[key];
        }
    }
    const dir = path.dirname(filePath);
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(tmpPath, `${JSON.stringify(next, undefined, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmpPath, filePath);
    try { fs.chmodSync(filePath, 0o600); } catch { /* best-effort */ }
    return filterAiSettings(next);
}

export function preferenceReaderForOwner(ctx: any, ownerLogin?: string): QaapPreferenceReader {
    const diskSettings = ctx.readUserSettingsFromDisk(ownerLogin);
    if (!usesSharedAiSettingsFallback(ownerLogin)) {
        return (key: string): unknown => diskSettings[key];
    }
    return (key: string): unknown => {
        const fromPref = ctx.preferenceService?.get(key);
        if (fromPref !== undefined && fromPref !== null && fromPref !== '') {
            return fromPref;
        }
        return diskSettings[key];
    };
}

// ─── Provider env stripping ──────────────────────────────────────────────────

export function stripSharedProviderEnv(env: NodeJS.ProcessEnv): void {
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
