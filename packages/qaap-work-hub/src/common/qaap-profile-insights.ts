// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { parseQaapWorkspaceRepoPath } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';

/** The conversation fields the Profile insights read; a subset of `QaapAgentConversationSummaryDTO`. */
export interface QaapProfileInsightsConversation {
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly agentId: string;
    readonly cwd: string;
    /** The source project of a task that ran in its own worktree. */
    readonly parallelBaseCwd?: string;
    readonly messageCount: number;
    readonly archived?: boolean;
    readonly agentModel?: { readonly modelId: string };
    readonly qaiqModel?: { readonly modelId: string };
    readonly lastTurnAgentId?: string;
    readonly lastTurnAgentModel?: { readonly modelId: string };
}

/** One harness or model with how many tasks used it and its share of all tasks (0..1). */
export interface QaapProfileUsageShare {
    readonly agentId: string;
    /** Set for model rows only. */
    readonly modelId?: string;
    readonly tasks: number;
    readonly share: number;
}

/** What the Profile page shows about the user's own activity, computed from their task history. */
export interface QaapProfileInsights {
    readonly tasks: number;
    readonly messages: number;
    readonly projects: number;
    /** Consecutive active days ending today (or yesterday, so a streak is not lost before today's first task). */
    readonly currentStreakDays: number;
    readonly longestStreakDays: number;
    /** The day with the most activity, as a local midnight timestamp, and how many tasks were active that day. */
    readonly peakDay?: { readonly day: number; readonly tasks: number };
    /** Local hour (0-23) when most tasks were started. */
    readonly mostActiveHour?: number;
    /** Ordered by tasks, descending. */
    readonly harnesses: readonly QaapProfileUsageShare[];
    /** Ordered by tasks, descending; at most {@link QAAP_PROFILE_MAX_MODELS}. */
    readonly models: readonly QaapProfileUsageShare[];
}

/** How many models the Profile lists. */
export const QAAP_PROFILE_MAX_MODELS = 6;

const DAY_MS = 24 * 60 * 60 * 1000;

function localMidnight(timestamp: number): number {
    const date = new Date(timestamp);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** The day after `day` (local midnight), robust to daylight-saving shifts. */
function nextLocalDay(day: number): number {
    return localMidnight(day + DAY_MS + 2 * 60 * 60 * 1000);
}

function shares(counts: Map<string, { agentId: string; modelId?: string; tasks: number }>, total: number): QaapProfileUsageShare[] {
    return [...counts.values()]
        .sort((a, b) => b.tasks - a.tasks || a.agentId.localeCompare(b.agentId) || (a.modelId ?? '').localeCompare(b.modelId ?? ''))
        .map(entry => ({ ...entry, share: total > 0 ? entry.tasks / total : 0 }));
}

/**
 * Computes the Profile insights from the user's tasks. Archived tasks count (they are still the user's history).
 * A task is active on the day it was created and on the day it was last updated. Pure: no DOM, no clock but `now`.
 */
/**
 * One key per repository, the way the sessions sidebar groups cards: a task worktree counts as its source project,
 * and every clone of `owner/repo` (desktop clone, per-user or legacy server clone) is the same project.
 */
function qaapProfileProjectKey(conversation: QaapProfileInsightsConversation): string | undefined {
    // Casing never makes two projects (the sidebar compares identities case-insensitively too).
    const path = (conversation.parallelBaseCwd?.trim() || conversation.cwd?.trim())?.replace(/\/+$/, '').toLowerCase();
    if (!path) {
        return undefined;
    }
    const clone = parseQaapWorkspaceRepoPath(path);
    return clone ? `repo:${clone.owner}/${clone.repo}` : `path:${path}`;
}

export function computeQaapProfileInsights(conversations: ReadonlyArray<QaapProfileInsightsConversation>, now: Date): QaapProfileInsights {
    const valid = conversations.filter(conversation => Number.isFinite(conversation.createdAt));
    const projects = new Set<string>();
    const tasksPerDay = new Map<number, number>();
    const hourCounts = new Array<number>(24).fill(0);
    const harnessCounts = new Map<string, { agentId: string; tasks: number }>();
    const modelCounts = new Map<string, { agentId: string; modelId: string; tasks: number }>();
    let messages = 0;
    const today = localMidnight(now.getTime());

    for (const conversation of valid) {
        messages += Math.max(0, conversation.messageCount || 0);
        const project = qaapProfileProjectKey(conversation);
        if (project) {
            projects.add(project);
        }
        const days = new Set<number>([localMidnight(conversation.createdAt)]);
        if (Number.isFinite(conversation.updatedAt)) {
            days.add(localMidnight(conversation.updatedAt));
        }
        for (const day of days) {
            if (day <= today) {
                tasksPerDay.set(day, (tasksPerDay.get(day) ?? 0) + 1);
            }
        }
        hourCounts[new Date(conversation.createdAt).getHours()]++;

        const agentId = (conversation.lastTurnAgentId || conversation.agentId || '').trim().toLowerCase();
        if (agentId) {
            const harness = harnessCounts.get(agentId) ?? { agentId, tasks: 0 };
            harness.tasks++;
            harnessCounts.set(agentId, harness);
            const modelId = (conversation.lastTurnAgentModel ?? conversation.agentModel ?? conversation.qaiqModel)?.modelId?.trim();
            if (modelId) {
                const key = `${agentId}\u0000${modelId.toLowerCase()}`;
                const model = modelCounts.get(key) ?? { agentId, modelId, tasks: 0 };
                model.tasks++;
                modelCounts.set(key, model);
            }
        }
    }

    const activeDays = [...tasksPerDay.keys()].sort((a, b) => a - b);
    let longest = 0;
    let run = 0;
    let previous: number | undefined;
    for (const day of activeDays) {
        run = previous !== undefined && nextLocalDay(previous) === day ? run + 1 : 1;
        longest = Math.max(longest, run);
        previous = day;
    }
    const active = new Set(activeDays);
    let current = 0;
    // A streak still counts until the end of today, so start from yesterday when today has no activity yet.
    let cursor = active.has(today) ? today : localMidnight(today - 2 * 60 * 60 * 1000);
    while (active.has(cursor)) {
        current++;
        cursor = localMidnight(cursor - 2 * 60 * 60 * 1000);
    }

    let peakDay: QaapProfileInsights['peakDay'];
    for (const [day, tasks] of tasksPerDay) {
        if (!peakDay || tasks > peakDay.tasks || (tasks === peakDay.tasks && day > peakDay.day)) {
            peakDay = { day, tasks };
        }
    }
    const maxHourTasks = Math.max(...hourCounts);
    const modelTotal = [...modelCounts.values()].reduce((sum, model) => sum + model.tasks, 0);

    return {
        tasks: valid.length,
        messages,
        projects: projects.size,
        currentStreakDays: current,
        longestStreakDays: longest,
        peakDay,
        mostActiveHour: maxHourTasks > 0 ? hourCounts.indexOf(maxHourTasks) : undefined,
        harnesses: shares(harnessCounts, [...harnessCounts.values()].reduce((sum, harness) => sum + harness.tasks, 0)),
        models: shares(modelCounts, modelTotal).slice(0, QAAP_PROFILE_MAX_MODELS),
    };
}
