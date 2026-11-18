// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// Pure parts of the sessions sidebar task hover card: which lines the card shows for a task
// (built from the conversation summary) and where the card goes next to its row. The DOM side
// lives in `qaap-task-hover-card.ts`.

import { nls } from '@theia/core/lib/common/nls';
import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { resolveAgentBrand } from '@theia/qaap-shared-core/lib/common/qaap-agent-branding';
import { QaapLiveTaskDiff } from '@theia/qaap-shared-core/lib/common/qaap-live-task-diff';
import { formatFriendlyModelLabel } from '@theia/qaap-shared-core/lib/common/qaap-qaiq-model-catalog';
import {
    formatQaapWorktreeLabel,
    isQaapWorktreeConversation,
    qaapWorktreeProjectName,
} from '@theia/qaap-shared-core/lib/common/qaap-worktree-label';

export type QaapTaskHoverCardLineKind =
    | 'project'
    | 'worktree'
    | 'branch'
    | 'agent'
    | 'status'
    | 'failure'
    | 'activity'
    | 'diff'
    | 'pull-request';

/** One compact icon + text line of the card. */
export interface QaapTaskHoverCardLine {
    readonly kind: QaapTaskHoverCardLineKind;
    /** Codicon class(es) of the leading glyph, e.g. `codicon-repo`. */
    readonly iconClass: string;
    readonly text: string;
    /** Extra modifier class for the line (status color, pull request state). */
    readonly modifierClass?: string;
    /** `agent` lines only: the harnesses whose brand logos lead the line (codicon when none has a logo). */
    readonly agentIds?: readonly string[];
    /** `diff` lines only: the counts the renderer colors separately. */
    readonly added?: number;
    readonly removed?: number;
    /** `diff` lines only: the task baseline whose live total keeps the counts current while the card is shown. */
    readonly baselineCommit?: string;
}

export interface QaapTaskHoverCardModel {
    readonly title: string;
    readonly lines: readonly QaapTaskHoverCardLine[];
}

/** The row's status, already resolved the way the row resolves it (same glyph, same label). */
export interface QaapTaskHoverCardStatus {
    readonly id: string;
    /** Localized label, e.g. "running". */
    readonly label: string;
    /** Status modifier class shared with the row's dot (`theia-mod-failed`, …). */
    readonly className: string;
    readonly iconClass?: string;
}

export interface QaapTaskHoverCardInput {
    readonly title: string;
    readonly projectName?: string;
    /** Branch the project checkout is on; used only for tasks that run in that checkout. */
    readonly projectBranch?: string;
    readonly summary?: QaapAgentConversationSummaryDTO;
    readonly status?: QaapTaskHoverCardStatus;
    /** Short failure reason the row would show for a failed run. */
    readonly failureReason?: string;
    /** Clock used for the "last activity" line. */
    readonly now: number;
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** "just now", "5 min ago", "3 h ago", "2 d ago" for the card's last activity line. */
export function formatQaapTaskHoverCardActivity(at: number, now: number): string {
    const diff = Math.max(0, now - at);
    if (diff < 45 * 1000) {
        return nls.localize('qaap/taskHoverCard/activityJustNow', 'Last activity just now');
    }
    let amount: string;
    if (diff < HOUR_MS) {
        amount = nls.localize('qaap/mobileProjects/taskSinceMinutes', '{0} min', String(Math.max(1, Math.round(diff / MINUTE_MS))));
    } else if (diff < DAY_MS) {
        amount = nls.localize('qaap/mobileProjects/taskSinceHours', '{0} h', String(Math.round(diff / HOUR_MS)));
    } else {
        amount = nls.localize('qaap/mobileProjects/taskSinceDays', '{0} d', String(Math.round(diff / DAY_MS)));
    }
    return nls.localize('qaap/taskHoverCard/activityAgo', 'Last activity {0} ago', amount);
}

function capitalize(text: string): string {
    return text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : text;
}

function lastPathSegment(path: string): string {
    const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
    return normalized.slice(normalized.lastIndexOf('/') + 1) || normalized;
}

function resolveWorktreeLabel(summary: QaapAgentConversationSummaryDTO): string | undefined {
    if (!isQaapWorktreeConversation(summary)) {
        return undefined;
    }
    if (summary.worktreeOrdinal && summary.parallelBaseCwd) {
        return formatQaapWorktreeLabel(qaapWorktreeProjectName(summary.parallelBaseCwd), summary.worktreeOrdinal);
    }
    return lastPathSegment(summary.cwd) || undefined;
}

function resolveBranch(input: QaapTaskHoverCardInput, inWorktree: boolean): string | undefined {
    const summary = input.summary;
    const candidates = [
        summary?.worktreeBranch,
        summary?.taskPullRequest?.branch,
        summary?.linkedPullRequest?.branch,
        // The project's checkout branch says nothing about a task that runs in its own worktree.
        inWorktree ? undefined : input.projectBranch,
    ];
    return candidates.map(candidate => candidate?.trim()).find(candidate => !!candidate);
}

/**
 * Harnesses that worked on the task: the conversation's agent and, when another one ran the latest turn,
 * that one too (the summary records no fuller history). Distinct, conversation agent first.
 */
export function resolveQaapTaskHoverCardAgentIds(summary: QaapAgentConversationSummaryDTO): string[] {
    const ids: string[] = [];
    for (const candidate of [summary.agentId, summary.lastTurnAgentId]) {
        const id = candidate?.trim();
        if (id && !ids.some(existing => existing.toLowerCase() === id.toLowerCase())) {
            ids.push(id);
        }
    }
    return ids;
}

/** "OpenCode · beam-free" (or "Claude, OpenCode · beam-free" when two harnesses worked on the task). */
export function formatQaapTaskHoverCardAgent(summary: QaapAgentConversationSummaryDTO): string | undefined {
    const modelId = (summary.lastTurnAgentModel ?? summary.agentModel ?? summary.qaiqModel)?.modelId?.trim();
    const agentIds = resolveQaapTaskHoverCardAgentIds(summary);
    const agentLabel = agentIds.length > 0
        ? agentIds.map(id => resolveAgentBrand(id)?.label ?? id).join(', ')
        : undefined;
    const modelLabel = modelId ? formatFriendlyModelLabel(modelId) : undefined;
    if (agentLabel && modelLabel) {
        return `${agentLabel} · ${modelLabel}`;
    }
    return agentLabel ?? modelLabel;
}

function pullRequestLines(summary: QaapAgentConversationSummaryDTO): QaapTaskHoverCardLine[] {
    const lines: QaapTaskHoverCardLine[] = [];
    const seen = new Set<string>();
    const linked = summary.linkedPullRequest;
    if (linked?.number) {
        seen.add(`${linked.owner}/${linked.repo}#${linked.number}`);
        const state = linked.state === 'merged' ? 'merged'
            : linked.state === 'closed' ? 'closed'
                : linked.draft ? 'draft' : 'open';
        const iconClass = state === 'merged' ? 'codicon-git-merge'
            : state === 'closed' ? 'codicon-git-pull-request-closed'
                : state === 'draft' ? 'codicon-git-pull-request-draft'
                    : 'codicon-git-pull-request';
        const title = linked.title?.trim();
        lines.push({
            kind: 'pull-request',
            iconClass,
            text: title ? `#${linked.number} ${title}` : `${linked.owner}/${linked.repo}#${linked.number}`,
            modifierClass: `theia-mod-pr-${state}`,
        });
    }
    const task = summary.taskPullRequest;
    if (task?.number && !seen.has(`${task.owner}/${task.repo}#${task.number}`)) {
        const draft = task.state === 'draft-needs-attention';
        lines.push({
            kind: 'pull-request',
            iconClass: draft ? 'codicon-git-pull-request-draft' : 'codicon-git-pull-request',
            text: `${task.owner}/${task.repo}#${task.number}`,
            modifierClass: draft ? 'theia-mod-pr-draft' : 'theia-mod-pr-open',
        });
    }
    return lines;
}

/**
 * The card's content for one task: the full title, then one line per fact the data actually has
 * (project, worktree, branch, agent · model, status, failure reason, last activity, diff stats,
 * pull requests). A line whose data is missing is left out.
 */
export function buildQaapTaskHoverCardModel(input: QaapTaskHoverCardInput): QaapTaskHoverCardModel {
    const summary = input.summary;
    const lines: QaapTaskHoverCardLine[] = [];
    const projectName = input.projectName?.trim();
    if (projectName) {
        lines.push({ kind: 'project', iconClass: 'codicon-repo', text: projectName });
    }
    const worktreeLabel = summary ? resolveWorktreeLabel(summary) : undefined;
    if (worktreeLabel) {
        lines.push({
            kind: 'worktree',
            iconClass: 'codicon-folder-library',
            text: nls.localize('qaap/taskHoverCard/worktree', 'Worktree {0}', worktreeLabel),
        });
    }
    const branch = resolveBranch(input, !!worktreeLabel || !!summary?.parallelBaseCwd);
    if (branch) {
        lines.push({ kind: 'branch', iconClass: 'codicon-git-branch', text: branch });
    }
    const agent = summary ? formatQaapTaskHoverCardAgent(summary) : undefined;
    if (agent) {
        lines.push({ kind: 'agent', iconClass: 'codicon-hubot', text: agent, agentIds: resolveQaapTaskHoverCardAgentIds(summary!) });
    }
    const status = input.status;
    if (status && status.id !== 'idle' && status.label.trim()) {
        const running = status.id === 'running';
        lines.push({
            kind: 'status',
            iconClass: running ? 'codicon-loading codicon-modifier-spin' : (status.iconClass ?? 'codicon-circle-small-filled'),
            text: capitalize(status.label.trim()),
            modifierClass: status.className,
        });
    }
    const failureReason = input.failureReason?.trim();
    if (failureReason) {
        lines.push({ kind: 'failure', iconClass: 'codicon-info', text: failureReason });
    }
    const activityAt = summary?.lastAgentActivityAt ?? summary?.updatedAt;
    if (activityAt) {
        lines.push({ kind: 'activity', iconClass: 'codicon-history', text: formatQaapTaskHoverCardActivity(activityAt, input.now) });
    }
    const totals = QaapLiveTaskDiff.resolve(summary);
    const added = Math.max(0, totals.added);
    const removed = Math.max(0, totals.removed);
    if (added > 0 || removed > 0) {
        lines.push({
            kind: 'diff',
            iconClass: 'codicon-diff',
            text: nls.localize('qaap/taskHoverCard/diffStats', '{0} lines added, {1} removed', String(added), String(removed)),
            added,
            removed,
            baselineCommit: summary?.baselineCommit,
        });
    }
    if (summary) {
        lines.push(...pullRequestLines(summary));
    }
    const title = (summary?.title?.trim() || input.title.trim());
    return { title, lines };
}

export interface QaapTaskHoverCardRect {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
}

export interface QaapTaskHoverCardSize {
    readonly width: number;
    readonly height: number;
}

export interface QaapTaskHoverCardPosition {
    readonly left: number;
    readonly top: number;
    readonly side: 'right' | 'left';
}

/**
 * Where the card goes: to the right of the row, top-aligned with it; on the left when the right
 * side has no room; always clamped inside the viewport (`margin` px from every edge).
 */
export function computeQaapTaskHoverCardPosition(
    anchor: QaapTaskHoverCardRect,
    card: QaapTaskHoverCardSize,
    viewport: QaapTaskHoverCardSize,
    gap = 8,
    margin = 8,
): QaapTaskHoverCardPosition {
    const maxLeft = Math.max(margin, viewport.width - margin - card.width);
    const maxTop = Math.max(margin, viewport.height - margin - card.height);
    let side: 'right' | 'left' = 'right';
    let left = anchor.right + gap;
    if (left > maxLeft) {
        const leftSide = anchor.left - gap - card.width;
        if (leftSide >= margin) {
            side = 'left';
            left = leftSide;
        } else {
            left = maxLeft;
        }
    }
    const top = Math.min(Math.max(anchor.top, margin), maxTop);
    return { left: Math.round(left), top: Math.round(top), side };
}
