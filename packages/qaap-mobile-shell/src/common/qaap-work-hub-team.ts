// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { groupAgentTasksByParent } from './qaap-agent-task-tree';

/** Minimal VPS task shape for Team aggregation (mirrors {@link MobileProjectTaskView}). */
export interface WorkHubTeamTaskInput {
    readonly id: string;
    readonly title: string;
    readonly command: string;
    readonly agentId?: string;
    readonly cwd: string;
    readonly state: string;
    readonly createdAt: number;
    readonly finishedAt?: number;
    readonly parentId?: string;
}

export type WorkHubTeamMemberKind = 'conversation' | 'leader-task' | 'subtask';

/** One row in the Work Hub Team dashboard — leader conversation, VPS task, or subtask. */
export interface WorkHubTeamMember {
    readonly id: string;
    readonly kind: WorkHubTeamMemberKind;
    readonly title: string;
    readonly projectName: string;
    readonly cwd: string;
    readonly agentId: string;
    readonly state: string;
    readonly parentId?: string;
    readonly childCount: number;
    readonly progressCurrent?: number;
    readonly progressTotal?: number;
    readonly activityLabel?: string;
    readonly linesAdded?: number;
    readonly linesRemoved?: number;
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly conversationId?: string;
    readonly projectId?: string;
    /** VPS background task id — set for leader-task and subtask rows. */
    readonly taskId?: string;
    /** Shell/agent command for VPS tasks (e.g. `npm run test`) — DETAIL activity fallback. */
    readonly command?: string;
}

export interface WorkHubTeamConversationInput {
    readonly projectId: string;
    readonly projectName: string;
    readonly cwd: string;
    readonly id: string;
    readonly agentId: string;
    readonly title: string;
    readonly status: 'idle' | 'streaming' | 'settled' | 'failed';
    readonly paused?: boolean;
    /** When set, this conversation is a fork/subagent of another conversation. */
    readonly forkedFromId?: string;
    readonly activityLabel?: string;
    readonly turnProgressCurrent?: number;
    readonly turnProgressTotal?: number;
    readonly linesAdded?: number;
    readonly linesRemoved?: number;
    readonly createdAt: number;
    readonly updatedAt: number;
}

export interface CollectAgentMembersInput {
    readonly tasks: readonly WorkHubTeamTaskInput[];
    readonly conversations: readonly WorkHubTeamConversationInput[];
}

export interface WorkHubTeamTree {
    readonly roots: readonly WorkHubTeamMember[];
    readonly childrenByParent: ReadonlyMap<string, readonly WorkHubTeamMember[]>;
}

/** Aggregate streaming conversations and VPS tasks into Team dashboard rows. */
export function collectAgentMembers(input: CollectAgentMembersInput): WorkHubTeamMember[] {
    const convIdByCwd = new Map<string, string>();
    const streamingCwds = new Set<string>();
    const members: WorkHubTeamMember[] = [];
    const hiddenLeaderToConv = new Map<string, string>();

    for (const conv of input.conversations) {
        if (conv.status !== 'streaming' || conv.paused) {
            continue;
        }
        const cwd = normalizeTeamCwd(conv.cwd);
        streamingCwds.add(cwd);
        convIdByCwd.set(cwd, conv.id);
        members.push({
            id: conv.id,
            kind: 'conversation',
            title: conv.title,
            projectName: conv.projectName,
            cwd,
            agentId: conv.agentId,
            state: 'streaming',
            parentId: conv.forkedFromId,
            childCount: 0,
            progressCurrent: conv.turnProgressCurrent,
            progressTotal: conv.turnProgressTotal,
            activityLabel: conv.activityLabel,
            linesAdded: conv.linesAdded,
            linesRemoved: conv.linesRemoved,
            createdAt: conv.createdAt,
            updatedAt: conv.updatedAt,
            conversationId: conv.id,
            projectId: conv.projectId,
        });
    }
    for (const task of input.tasks) {
        if (task.state === 'queued') {
            const cwd = normalizeTeamCwd(task.cwd);
            members.push({
                id: task.id,
                kind: task.parentId ? 'subtask' : 'leader-task',
                title: task.title,
                projectName: basenameFromCwd(cwd),
                cwd,
                agentId: task.agentId ?? inferAgentIdFromCommand(task.command),
                state: 'queued',
                parentId: task.parentId,
                childCount: 0,
                createdAt: task.createdAt,
                updatedAt: task.createdAt,
                taskId: task.id,
                command: task.agentId && task.agentId !== 'shell' ? undefined : task.command?.trim() || undefined,
                activityLabel: resolveTaskMemberActivityLabel(task),
            });
            continue;
        }
        if (task.state !== 'running') {
            continue;
        }
        const cwd = normalizeTeamCwd(task.cwd);
        if (!task.parentId && streamingCwds.has(cwd)) {
            const convId = convIdByCwd.get(cwd);
            if (convId) {
                hiddenLeaderToConv.set(task.id, convId);
            }
            continue;
        }
        members.push({
            id: task.id,
            kind: task.parentId ? 'subtask' : 'leader-task',
            title: task.title,
            projectName: basenameFromCwd(task.cwd),
            cwd,
            agentId: task.agentId ?? inferAgentIdFromCommand(task.command),
            state: task.state,
            parentId: task.parentId,
            childCount: 0,
            createdAt: task.createdAt,
            updatedAt: task.finishedAt ?? task.createdAt,
            taskId: task.id,
            command: task.agentId && task.agentId !== 'shell' ? undefined : task.command?.trim() || undefined,
            activityLabel: resolveTaskMemberActivityLabel(task),
        });
    }
    const remapped = members.map(member => {
        if (member.kind !== 'subtask' || !member.parentId) {
            return member;
        }
        const convId = hiddenLeaderToConv.get(member.parentId);
        return convId ? { ...member, parentId: convId } : member;
    });
    return attachChildCounts(remapped);
}

export function buildTeamTree(members: readonly WorkHubTeamMember[]): WorkHubTeamTree {
    const grouped = groupAgentTasksByParent(members);
    return { roots: sortTeamMembers(grouped.roots), childrenByParent: grouped.childrenByParent };
}

export function filterTeamMembers(members: readonly WorkHubTeamMember[], query: string): WorkHubTeamMember[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
        return [...members];
    }
    return members.filter(member =>
        member.title.toLowerCase().includes(normalized)
        || member.projectName.toLowerCase().includes(normalized)
        || member.agentId.toLowerCase().includes(normalized)
        || member.activityLabel?.toLowerCase().includes(normalized),
    );
}

/** Keep parent/child rows visible together when search matches either side. */
export function filterTeamMembersForDisplay(members: readonly WorkHubTeamMember[], query: string): WorkHubTeamMember[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
        return [...members];
    }
    const matched = filterTeamMembers(members, query);
    const included = new Set(matched.map(member => member.id));
    for (const member of matched) {
        if (member.parentId) {
            included.add(member.parentId);
        }
    }
    let expanded = true;
    while (expanded) {
        expanded = false;
        for (const member of members) {
            if (member.parentId && included.has(member.parentId) && !included.has(member.id)) {
                included.add(member.id);
                expanded = true;
            }
        }
    }
    return members.filter(member => included.has(member.id));
}

export function countRunningTeamMembers(members: readonly WorkHubTeamMember[]): number {
    return members.filter(member => member.state === 'running' || member.state === 'streaming').length;
}

export function countQueuedTeamMembers(members: readonly WorkHubTeamMember[]): number {
    return members.filter(member => member.state === 'queued').length;
}

function attachChildCounts(members: WorkHubTeamMember[]): WorkHubTeamMember[] {
    const childCounts = new Map<string, number>();
    for (const member of members) {
        if (!member.parentId) {
            continue;
        }
        childCounts.set(member.parentId, (childCounts.get(member.parentId) ?? 0) + 1);
    }
    return members.map(member => ({
        ...member,
        childCount: childCounts.get(member.id) ?? member.childCount,
    }));
}

function sortTeamMembers(members: readonly WorkHubTeamMember[]): WorkHubTeamMember[] {
    return [...members].sort((a, b) => {
        const aActive = a.state === 'running' || a.state === 'streaming' ? 1 : 0;
        const bActive = b.state === 'running' || b.state === 'streaming' ? 1 : 0;
        if (aActive !== bActive) {
            return bActive - aActive;
        }
        return b.updatedAt - a.updatedAt;
    });
}

function basenameFromCwd(cwd: string): string {
    const normalized = normalizeTeamCwd(cwd);
    const parts = normalized.split('/');
    return parts[parts.length - 1] || normalized;
}

function normalizeTeamCwd(cwd: string): string {
    let normalized = cwd.replace(/\\/g, '/');
    while (normalized.length > 1 && normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
    }
    return normalized;
}

/** Live status text for VPS task rows (list + DETAIL fallback seed). */
function resolveTaskMemberActivityLabel(task: WorkHubTeamTaskInput): string | undefined {
    const command = task.command?.trim() || task.title?.trim();
    if (!command) {
        return undefined;
    }
    // Prefer the concrete command over a generic "Working" label.
    return command.length > 80 ? `${command.slice(0, 77)}…` : command;
}

/**
 * Agent brand for Working/Team rows — match the CLI argv0 only.
 * Scanning the full command (incl. `-p` prompt) false-positives on injected
 * context that mentions other agents (e.g. "QAIQ is a Claude Code…" inside an `agy` run).
 */
function extractLeadingCliBin(command: string): string {
    const trimmed = command.trim().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, '');
    const token = /^([^\s]+)/.exec(trimmed)?.[1] ?? '';
    const base = token.includes('/') ? token.slice(token.lastIndexOf('/') + 1) : token;
    return base.toLowerCase();
}

/** @internal Exported for unit tests. */
export function inferAgentIdFromCommand(command: string): string {
    const bin = extractLeadingCliBin(command);
    if (bin === 'qaiq') {
        return 'qaiq';
    }
    if (bin === 'openclaude') {
        return 'openclaude';
    }
    if (bin === 'codex') {
        return 'codex';
    }
    if (bin === 'claude') {
        return 'claude';
    }
    if (bin === 'grok') {
        return 'grok';
    }
    if (bin === 'opencode') {
        return 'opencode';
    }
    if (bin === 'goose') {
        return 'goose';
    }
    if (bin === 'hermes') {
        return 'hermes';
    }
    if (bin === 'openclaw') {
        return 'openclaw';
    }
    if (bin === 'cursor-agent' || bin === 'cursor') {
        return 'cursor';
    }
    // Google Antigravity CLI prefers `agy`; also accept `antigravity` / legacy `gemini`.
    if (bin === 'agy' || bin === 'antigravity' || bin === 'gemini' || bin === 'ag') {
        return 'antigravity';
    }
    if (bin === 'copilot') {
        return 'copilot';
    }
    if (bin === 'qwen') {
        return 'qwen';
    }
    if (bin === 'kimi') {
        return 'kimi';
    }
    return 'shell';
}
