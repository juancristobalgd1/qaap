// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only With Classpath-exception-2.0
// *****************************************************************************

// Pure + DI helpers extracted from QaapAgentTaskRunner (batch 3).

import { spawnSync, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
    extractRetrievalKeywords,
    formatRelevantFilesHint,
} from '../common/qaap-agent-retrieval';
import {
    QAAP_BUILTIN_AGENT_DEFINITIONS,
    isUiHiddenVpsAgent,
} from '@theia/qaap-mobile-shell/lib/common/qaap-builtin-agents';
import type { QaapTurnLatencyMark } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-stream-metrics';
import type { QaapAgentTask, QaapAgentDescriptor } from '../common/qaap-agent-task';
import type { AgentCandidate } from './qaap-agent-task-runner-types';

const AGENT_CANDIDATES: readonly AgentCandidate[] = QAAP_BUILTIN_AGENT_DEFINITIONS;
const QAAP_AGENT_RETRIEVAL_ENABLED = !/^(0|false|off)$/i.test(process.env.QAAP_AGENT_RETRIEVAL?.trim() ?? '');
const RETRIEVAL_MAX_FILES = 5;
const RETRIEVAL_HINT_MAX_CHARS = 400;
const REPO_MAP_EXCLUDED_DIRS = new Set<string>([
    'node_modules', '.git', 'dist', 'build', 'out',
    '.next', '.nuxt', '.output', '.svelte-kit',
    'coverage', '.nyc_output', '.cache', '.turbo',
]);
const SHELL_AGENT_ID = 'shell';
const ENV_AGENT_ID = 'env';

// ─── Pure: readRelevantFiles ─────────────────────────────────────────────────

export function readRelevantFiles(cwd: string, userQuery: string | undefined): string | undefined {
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

// ─── Pure: reapAgentProcessGroupAfterExit ────────────────────────────────────

export function reapAgentProcessGroupAfterExit(child: ChildProcess): void {
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

// ─── DI: resolveProjectName ──────────────────────────────────────────────────

export function resolveProjectName(cwd: string, projectNameCache: Map<string, string>): string {
    const cached = projectNameCache.get(cwd);
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
    projectNameCache.set(cwd, name);
    return name;
}

// ─── DI: listAgents ──────────────────────────────────────────────────────────

export function listAgents(detectedAgents: Map<string, AgentCandidate>): QaapAgentDescriptor[] {
    const result: QaapAgentDescriptor[] = [];
    for (const candidate of AGENT_CANDIDATES) {
        if (detectedAgents.has(candidate.id)) {
            result.push({ id: candidate.id, label: candidate.label, available: true });
        }
    }
    for (const [, candidate] of detectedAgents) {
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

// ─── DI: probeAgentBinOnce ───────────────────────────────────────────────────

export function probeAgentBinOnce(
    agentId: string,
    resolveBin: () => string | undefined,
    probedAgentBins: Set<string>,
): boolean {
    if (probedAgentBins.has(agentId)) {
        return true;
    }
    const bin = resolveBin();
    if (!bin) {
        return false;
    }
    try {
        spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 8000 });
        probedAgentBins.add(agentId);
        return true;
    } catch {
        return false;
    }
}

// ─── DI: recordTaskLatencyMark ───────────────────────────────────────────────

export function recordTaskLatencyMark(
    taskId: string,
    mark: QaapTurnLatencyMark,
    tasks: Map<string, QaapAgentTask>,
    at = Date.now(),
): void {
    const task = tasks.get(taskId);
    if (!task || task.latencyMarks?.[mark] !== undefined) {
        return;
    }
    tasks.set(taskId, {
        ...task,
        latencyMarks: {
            ...task.latencyMarks,
            [mark]: at,
        },
    });
}
