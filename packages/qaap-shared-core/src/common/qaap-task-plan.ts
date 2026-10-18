// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Editable task plan and its fan-out to parallel subtasks (roadmap H3.1, `doc/qaap-task-plan-fanout.md`).
 * Shared by the backend service that drives it and the Work Hub UI that shows and edits it.
 */

/**
 * - `drafting`: the read-only planning turn is running.
 * - `awaiting-approval`: the plan is shown; Run (or the auto-run timer) starts it.
 * - `running`: subtasks run in child conversations.
 * - `integrating`: the parent's integration turn merges and checks their results.
 * - `single`: the plan had fewer than two subtasks; the task continued as one turn, as before.
 */
export type QaapTaskPlanState = 'drafting' | 'awaiting-approval' | 'running' | 'integrating' | 'done' | 'single' | 'failed' | 'cancelled';

export type QaapTaskPlanSubtaskState = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

export interface QaapTaskPlanSubtask {
    readonly id: string;
    readonly title: string;
    readonly prompt: string;
    readonly state: QaapTaskPlanSubtaskState;
    /** Child conversation running this subtask in its own worktree. */
    readonly conversationId?: string;
    /** Worktree branch of the child conversation. */
    readonly branch?: string;
    /** Commit of the child's result on its branch, once it settled. */
    readonly headSha?: string;
    /** Its changes conflicted with earlier subtasks and were left out of the merged tree. */
    readonly conflict?: boolean;
    readonly error?: string;
}

export interface QaapTaskPlan {
    readonly id: string;
    readonly state: QaapTaskPlanState;
    /** User message the plan was drafted for (the conversation's first message). */
    readonly sourceMessageId?: string;
    readonly summary?: string;
    readonly subtasks: readonly QaapTaskPlanSubtask[];
    /** Run on its own at {@link autoRunAt} unless the user edits or decides first. */
    readonly autoRun: boolean;
    readonly autoRunAt?: number;
    /** The user edited the plan. */
    readonly edited?: boolean;
    /** Internal user message of the integration turn. */
    readonly integrationMessageId?: string;
    readonly error?: string;
    readonly createdAt: number;
    readonly updatedAt: number;
}

/** PATCH `/agent-conversations/:id/task-plan` body: the full edited list (ids keep existing rows). */
export interface QaapTaskPlanEditRequest {
    readonly summary?: string;
    readonly subtasks: ReadonlyArray<{ readonly id?: string; readonly title: string; readonly prompt?: string }>;
    /** `false` turns the auto-run timer off without other changes. */
    readonly autoRun?: boolean;
}

export const QAAP_TASK_PLAN_MAX_SUBTASKS = 6;
export const QAAP_TASK_PLAN_MAX_PROMPT_CHARS = 2_000;
export const QAAP_TASK_PLAN_MAX_TITLE_CHARS = 120;
/** Info string of the fenced block the planning turn ends with. */
export const QAAP_TASK_PLAN_FENCE = 'qaap-plan';

/** A parsed plan, before ids and states are assigned. */
export interface QaapTaskPlanDraft {
    readonly summary?: string;
    readonly subtasks: ReadonlyArray<{ readonly title: string; readonly prompt: string }>;
}

export namespace QaapTaskPlan {

    /** States in which the plan still drives the conversation (subtasks or integration pending). */
    export function isActive(plan: QaapTaskPlan | undefined): boolean {
        return !!plan && (plan.state === 'drafting' || plan.state === 'awaiting-approval' || plan.state === 'running' || plan.state === 'integrating');
    }

    export function isSubtaskSettled(subtask: QaapTaskPlanSubtask): boolean {
        return subtask.state === 'done' || subtask.state === 'failed' || subtask.state === 'cancelled';
    }

    /** Counts for chips: settled includes failed and cancelled subtasks. */
    export function progress(plan: QaapTaskPlan): { readonly total: number; readonly settled: number; readonly done: number; readonly failed: number; readonly running: number } {
        const total = plan.subtasks.length;
        const done = plan.subtasks.filter(subtask => subtask.state === 'done').length;
        const failed = plan.subtasks.filter(subtask => subtask.state === 'failed' || subtask.state === 'cancelled').length;
        const running = plan.subtasks.filter(subtask => subtask.state === 'running').length;
        return { total, settled: done + failed, done, failed, running };
    }

    /** Trims and caps a draft; drops empty rows. */
    export function normalizeDraft(draft: QaapTaskPlanDraft): QaapTaskPlanDraft {
        const subtasks = draft.subtasks
            .map(subtask => ({
                title: collapse(subtask.title).slice(0, QAAP_TASK_PLAN_MAX_TITLE_CHARS),
                prompt: (subtask.prompt ?? '').trim().slice(0, QAAP_TASK_PLAN_MAX_PROMPT_CHARS),
            }))
            .filter(subtask => subtask.title || subtask.prompt)
            .map(subtask => ({ title: subtask.title || subtask.prompt.split('\n')[0].slice(0, QAAP_TASK_PLAN_MAX_TITLE_CHARS), prompt: subtask.prompt || subtask.title }))
            .slice(0, QAAP_TASK_PLAN_MAX_SUBTASKS);
        const summary = draft.summary?.trim().slice(0, QAAP_TASK_PLAN_MAX_PROMPT_CHARS);
        return { ...(summary ? { summary } : {}), subtasks };
    }

    /**
     * The plan of a planning turn's reply: the last fenced `qaap-plan` JSON block, else the top-level
     * numbered list of the Markdown plan. `undefined` when neither is there.
     */
    export function parse(text: string | undefined): QaapTaskPlanDraft | undefined {
        if (!text?.trim()) {
            return undefined;
        }
        return parseFence(text) ?? parseNumberedList(text);
    }

    function parseFence(text: string): QaapTaskPlanDraft | undefined {
        const fence = new RegExp('```' + QAAP_TASK_PLAN_FENCE + '[^\\n]*\\n([\\s\\S]*?)```', 'g');
        let last: string | undefined;
        for (let match = fence.exec(text); match; match = fence.exec(text)) {
            last = match[1];
        }
        if (last === undefined) {
            return undefined;
        }
        try {
            const json = JSON.parse(last) as { summary?: unknown; subtasks?: unknown };
            if (!Array.isArray(json.subtasks)) {
                return undefined;
            }
            const subtasks = json.subtasks
                .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
                .map(row => ({
                    title: typeof row.title === 'string' ? row.title : '',
                    prompt: typeof row.prompt === 'string' ? row.prompt : typeof row.description === 'string' ? row.description : '',
                }));
            return normalizeDraft({ summary: typeof json.summary === 'string' ? json.summary : undefined, subtasks });
        } catch {
            return undefined;
        }
    }

    function parseNumberedList(text: string): QaapTaskPlanDraft | undefined {
        const items: { title: string; prompt: string }[] = [];
        for (const line of text.split('\n')) {
            const match = /^(\d+)[.)]\s+(.+)$/.exec(line);
            if (!match) {
                continue;
            }
            const body = match[2].trim();
            const bold = /^\*\*(.+?)\*\*\s*[:—–-]?\s*(.*)$/.exec(body);
            const title = (bold ? bold[1] : body.split(/[:—–]\s/)[0]).replace(/[*_`]/g, '');
            const rest = bold ? bold[2] : body;
            items.push({ title, prompt: rest || title });
        }
        return items.length ? normalizeDraft({ subtasks: items }) : undefined;
    }

    /**
     * A clearly multi-step request: at least `minItems` actionable list items (numbered or bulleted).
     * Deliberately strict, so ordinary one-step messages keep today's single turn.
     */
    export function isMultiStepCandidate(message: string | undefined, minItems: number = 3): boolean {
        if (!message) {
            return false;
        }
        const items = message.split('\n').filter(line => /^\s*(?:\d+[.)]|[-*•])\s+\S.{3,}/.test(line));
        return items.length >= minItems;
    }

    /** Hidden instruction appended to the planning turn (on top of the read-only Plan mode one). */
    export function planningInstruction(): string {
        return [
            'Plan this task so it can be split into independent subtasks that separate agents implement in parallel,',
            'each in its own copy of the repository. Subtasks must not edit the same files and must not depend on each other.',
            `Use between 2 and ${QAAP_TASK_PLAN_MAX_SUBTASKS} subtasks; use exactly 1 when the task cannot be split safely.`,
            `End your reply with one fenced block tagged ${QAAP_TASK_PLAN_FENCE} holding JSON:`,
            '```' + QAAP_TASK_PLAN_FENCE,
            '{"summary": "<one paragraph>", "subtasks": [{"title": "<short title>", "prompt": "<complete instructions for that agent, naming the files it owns>"}]}',
            '```',
        ].join('\n');
    }

    function collapse(value: string | undefined): string {
        return (value ?? '').replace(/\s+/g, ' ').trim();
    }
}
