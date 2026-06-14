// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Default GitHub label that triggers an agent task (overridable via env). */
export const QAAP_GITHUB_DEFAULT_TRIGGER_LABEL = 'qaap';

const QAAP_MENTION_PATTERN = /@qaap\b/i;

/** Label name from `QAAP_GITHUB_TRIGGER_LABEL` (defaults to {@link QAAP_GITHUB_DEFAULT_TRIGGER_LABEL}). */
export function readQaapGithubTriggerLabel(): string {
    return process.env.QAAP_GITHUB_TRIGGER_LABEL?.trim() || QAAP_GITHUB_DEFAULT_TRIGGER_LABEL;
}

export function bodyMentionsQaap(body: string | undefined): boolean {
    return !!body && QAAP_MENTION_PATTERN.test(body);
}

export function issueHasTriggerLabel(
    labels: ReadonlyArray<{ readonly name?: string }> | undefined,
    label = readQaapGithubTriggerLabel(),
): boolean {
    if (!label) {
        return false;
    }
    const needle = label.toLowerCase();
    return (labels ?? []).some(entry => entry.name?.trim().toLowerCase() === needle);
}

export function githubCommentTriggersAgent(input: {
    readonly body?: string;
    readonly issueLabels?: ReadonlyArray<{ readonly name?: string }>;
    readonly triggerLabel?: string;
}): boolean {
    if (bodyMentionsQaap(input.body)) {
        return true;
    }
    return issueHasTriggerLabel(input.issueLabels, input.triggerLabel);
}

/** Strip the @qaap mention and collapse whitespace for the agent prompt. */
export function stripQaapMentionFromPrompt(body: string): string {
    return body.replace(QAAP_MENTION_PATTERN, ' ').replace(/\s+/g, ' ').trim();
}

export function buildGithubIssueAgentPrompt(input: {
    readonly prompt: string;
    readonly issueNumber: number;
    readonly issueTitle?: string;
    readonly commentAuthor?: string;
    readonly htmlUrl?: string;
}): string {
    const header = [
        `[GitHub #${input.issueNumber}${input.issueTitle ? `: ${input.issueTitle}` : ''}]`,
        input.commentAuthor ? `Requested by @${input.commentAuthor}` : undefined,
        input.htmlUrl,
    ].filter(Boolean).join(' — ');
    const trimmed = input.prompt.trim();
    return trimmed ? `${header}\n\n${trimmed}` : header;
}

/** Ignore our own ack comments and obvious bot loops. */
export function isLikelyQaapAckComment(body: string | undefined, authorLogin?: string): boolean {
    if (authorLogin && /\[bot\]$/i.test(authorLogin)) {
        return true;
    }
    const text = body?.trim() ?? '';
    return text.startsWith('Qaap started a task')
        || text.startsWith('Qaap could not start a task')
        || text.startsWith('This repository is not linked to Qaap');
}
