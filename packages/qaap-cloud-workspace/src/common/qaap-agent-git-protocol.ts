// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Protocol shared between the `qaaq-git` agent CLI (`resources/qaaq-git.mjs`) and the backend
 * `QaapAgentGitEndpoint`. Agents never receive the user's GitHub OAuth token; they present a
 * per-task `git`-scoped token (0600 file) to request a sealed backend push or PR creation on a
 * non-default branch of the current project repository.
 */

export const QAAP_AGENT_GIT_API_PATH = '/qaap/api/agent-git';
export const QAAP_AGENT_GIT_TOKEN_HEADER = 'x-qaap-git-token';
export const QAAP_AGENT_GIT_URL_ENV = 'QAAP_GIT_URL';
export const QAAP_AGENT_GIT_TOKEN_FILE_ENV = 'QAAP_GIT_TOKEN_FILE';

export const QAAP_AGENT_GIT_ROUTES = {
    push: '/push',
    pr: '/pr',
} as const;

export type QaapAgentGitOperation = keyof typeof QAAP_AGENT_GIT_ROUTES;

/** Opt out with `QAAP_AGENT_GIT_CLI=0|false|off|no`. Default on. */
export function isQaapAgentGitCliEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return !/^(0|false|off|no)$/i.test(env.QAAP_AGENT_GIT_CLI?.trim() ?? '');
}

const PROTECTED_BRANCH_NAMES = new Set(['main', 'master']);

/** True when `branch` is detached, empty, `main`/`master`, or the repository's default branch. */
export function isProtectedDefaultBranch(branch: string | undefined, repoDefaultBranch?: string): boolean {
    const trimmed = branch?.trim() ?? '';
    if (!trimmed || trimmed === 'HEAD') {
        return true;
    }
    const lower = trimmed.toLowerCase();
    if (PROTECTED_BRANCH_NAMES.has(lower)) {
        return true;
    }
    const normalizedDefault = repoDefaultBranch?.trim().toLowerCase();
    return !!normalizedDefault && lower === normalizedDefault;
}

export interface QaapAgentGitPushResponse {
    readonly ok: true;
    readonly owner: string;
    readonly repo: string;
    readonly branch: string;
    readonly sha: string;
    readonly remoteUrl: string;
    readonly pushedTo: string;
}

export interface QaapAgentGitPrRequest {
    readonly title: string;
    readonly body: string;
    readonly base?: string;
    readonly draft: boolean;
    readonly push: boolean;
}

export interface QaapAgentGitPrResponse {
    readonly ok: true;
    readonly owner: string;
    readonly repo: string;
    readonly branch: string;
    readonly base: string;
    readonly number: number;
    readonly url: string;
    readonly title: string;
    readonly draft: boolean;
}

const MAX_PR_TITLE_CHARS = 256;
const MAX_PR_BODY_CHARS = 65_536;
const BRANCH_NAME_PATTERN = /^(?!-)(?!.*(?:\.\.|@\{|\/\.|\/\/|\.lock(?:\/|$)|\.$|\/$))[A-Za-z0-9._/+-]{1,200}$/;

export type QaapAgentGitParseResult<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly message: string };

export function parseQaapAgentGitPrRequest(raw: unknown): QaapAgentGitParseResult<QaapAgentGitPrRequest> {
    if (!raw || typeof raw !== 'object') {
        return { ok: false, message: 'Request body must be a JSON object.' };
    }
    const record = raw as Record<string, unknown>;
    const title = typeof record.title === 'string' ? record.title.trim() : '';
    if (!title) {
        return { ok: false, message: 'Pull request title is required (--title).' };
    }
    if (title.length > MAX_PR_TITLE_CHARS) {
        return { ok: false, message: `Pull request title must be at most ${MAX_PR_TITLE_CHARS} characters.` };
    }
    const body = typeof record.body === 'string' ? record.body : '';
    if (body.length > MAX_PR_BODY_CHARS) {
        return { ok: false, message: `Pull request body must be at most ${MAX_PR_BODY_CHARS} characters.` };
    }
    let base: string | undefined;
    if (record.base !== undefined && record.base !== '') {
        if (typeof record.base !== 'string' || !BRANCH_NAME_PATTERN.test(record.base.trim())) {
            return { ok: false, message: 'Invalid base branch name.' };
        }
        base = record.base.trim();
    }
    const draft = record.draft === true;
    const push = record.push !== false;
    return { ok: true, value: { title, body, ...(base ? { base } : {}), draft, push } };
}
