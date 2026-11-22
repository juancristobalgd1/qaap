// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Contract for agent-driven delegation: the LLM of a running task (the PARENT) delegates subtasks to
 * parallel CHILD agents through MCP tools, waits for them, reads their reports and integrates the
 * result itself. There is no deterministic scheduler; the parent decides. Qaap only enforces the
 * guardrails below (visible cost per child and in total, a concurrency cap, depth 1).
 *
 * Layers that implement this contract:
 * - `qaap-delegate-mcp.mjs` (stdio MCP shim, no dependencies): exposes {@link QAAP_AGENT_DELEGATION_TOOLS}
 *   to the harness and forwards each call as `POST {QAAP_DELEGATION_URL}{route}` with the token header.
 * - `qaap-agent-delegation-endpoint.ts`: authenticates the token (scope `delegate`), validates the body
 *   with the `parseQaap*Request` functions of this file and calls the service.
 * - `qaap-agent-delegation-service.ts`: creates child conversations, waits, cancels, applies.
 *
 * Security invariants every layer keeps:
 * - Nothing in a request names an owner, a tenant, a cwd or a path. The parent (and so the tenant and
 *   the workspace) comes ONLY from the token grant.
 * - A `childId` is accepted only when that child's `parentConversationId` is the grant's conversation.
 * - Children never receive the `delegate` scope (depth 1), so a child cannot delegate further.
 * - A child report is untrusted model output: it is truncated and wrapped in
 *   {@link QAAP_AGENT_DELEGATION_UNTRUSTED_OPEN}/{@link QAAP_AGENT_DELEGATION_UNTRUSTED_CLOSE}.
 *
 * Everything is behind {@link QAAP_AGENT_DELEGATION_ENV} (off by default).
 */

// ---------------------------------------------------------------------------------------------
// Feature flag
// ---------------------------------------------------------------------------------------------

/** Env flag that turns delegation on. Off unless set to `1`, `true`, `on` or `yes`. */
export const QAAP_AGENT_DELEGATION_ENV = 'QAAP_AGENT_DELEGATION';

/** Whether delegation is enabled in `env`. Takes `env` explicitly so it is usable from common code. */
export function isQaapAgentDelegationEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
    const value = env[QAAP_AGENT_DELEGATION_ENV]?.trim().toLowerCase();
    return value === '1' || value === 'true' || value === 'on' || value === 'yes';
}

// ---------------------------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------------------------

/** HTTP base path of the delegation API, served by the (tenant) backend. */
export const QAAP_AGENT_DELEGATION_API_PATH = '/qaap/api/agent-delegation';

/**
 * Header carrying the task token. Its value is the same per-task secret the tool gate issued, but the
 * delegation routes accept it only when the grant holds the `delegate` scope.
 */
export const QAAP_AGENT_DELEGATION_TOKEN_HEADER = 'x-qaap-delegation-token';

/** Env vars the runner sets for the MCP shim (parents only). */
export const QAAP_AGENT_DELEGATION_URL_ENV = 'QAAP_DELEGATION_URL';
export const QAAP_AGENT_DELEGATION_TOKEN_ENV = 'QAAP_DELEGATION_TOKEN';
/** Prefix of every delegation env var: a shell tool's environment must exclude `QAAP_DELEGATION_*`. */
export const QAAP_AGENT_DELEGATION_ENV_PREFIX = 'QAAP_DELEGATION_';
/** Env var naming a 0600 file that holds the token (OpenCode: the inline config must not carry it). */
export const QAAP_AGENT_DELEGATION_TOKEN_FILE_ENV = 'QAAP_DELEGATION_TOKEN_FILE';
/**
 * Env var naming the 0600 JSON file the Pi delegation extension reads (`{ serverName, config }`, the config being
 * an MCP server entry whose env holds the credentials). Only the path is in Pi's environment, and the extension
 * removes the variable once read, so Pi's shell tool never inherits it.
 */
export const QAAP_AGENT_DELEGATION_PI_CONFIG_ENV = 'QAAP_DELEGATION_PI_CONFIG';
/** Longest a single `qaaq_task_wait` may block for this harness (see {@link resolveQaapDelegationWaitSec}). */
export const QAAP_AGENT_DELEGATION_WAIT_CAP_ENV = 'QAAP_DELEGATION_WAIT_CAP_SEC';

/**
 * Name the shim reports in its MCP `serverInfo`, and the prefix of every per-task server name. The name a harness
 * shows (`mcp__<server>__<tool>`) is the per-task `qaaq_<nonce>` the runner configures, never this bare value.
 */
export const QAAP_AGENT_DELEGATION_MCP_SERVER_NAME = 'qaaq';

/** Route (relative to {@link QAAP_AGENT_DELEGATION_API_PATH}) per operation. All are `POST` with a JSON body. */
export const QAAP_AGENT_DELEGATION_ROUTES = {
    delegate: '/delegate',
    wait: '/wait',
    status: '/status',
    cancel: '/cancel',
    childApply: '/child-apply',
    listAgents: '/list-agents',
} as const;
export type QaapAgentDelegationOperation = keyof typeof QAAP_AGENT_DELEGATION_ROUTES;

/** MCP tool name → operation. The shim lists exactly these tools. */
export const QAAP_AGENT_DELEGATION_TOOLS: Readonly<Record<string, QaapAgentDelegationOperation>> = {
    'qaaq_delegate': 'delegate',
    'qaaq_task_wait': 'wait',
    'qaaq_task_status': 'status',
    'qaaq_task_cancel': 'cancel',
    'qaaq_child_apply': 'childApply',
    'qaaq_list_agents': 'listAgents',
};

/** Shape of a per-task delegation MCP server name: `qaaq_<16 hex>` (see {@link isQaapDelegationMcpServerName}). */
const SERVER_NAME_PATTERN = /^qaaq_[0-9a-f]{16}$/;

/**
 * True for a per-task delegation server name. Every task gets its own random name so a server of a repo or of the
 * user's config cannot pose as Qaap's: the auto-allow compares against the exact name issued with the task token.
 */
export function isQaapDelegationMcpServerName(name: string | undefined): boolean {
    return !!name && SERVER_NAME_PATTERN.test(name);
}

/**
 * True when `toolName` is one of the delegation tools of exactly `serverName`, as a harness names it:
 * `mcp__<server>__<tool>` (Claude Code, Codex) or `<server>_<tool>` (OpenCode). With no server name, nothing matches.
 */
export function isQaapDelegationMcpToolName(toolName: string | undefined, serverName: string | undefined): boolean {
    return qaapDelegationMcpOperation(toolName, serverName) !== undefined;
}

/** The operation of a delegation tool of exactly `serverName` (see {@link isQaapDelegationMcpToolName}), or undefined. */
export function qaapDelegationMcpOperation(toolName: string | undefined, serverName: string | undefined): QaapAgentDelegationOperation | undefined {
    const name = toolName?.trim() ?? '';
    if (!isQaapDelegationMcpServerName(serverName)) {
        return undefined;
    }
    for (const prefix of [`mcp__${serverName}__`, `${serverName}_`]) {
        if (name.startsWith(prefix) && Object.prototype.hasOwnProperty.call(QAAP_AGENT_DELEGATION_TOOLS, name.slice(prefix.length))) {
            return QAAP_AGENT_DELEGATION_TOOLS[name.slice(prefix.length)];
        }
    }
    return undefined;
}

/**
 * Whether a delegation tool call may skip the approval card. `childApply` changes the parent's workspace (it
 * is a merge), so under request-approval (`autoApprove === false`) it asks like any edit; the other tools
 * (delegate, wait, status, cancel, list-agents) never touch the workspace and are always allowed.
 */
export function isQaapDelegationToolAutoAllowed(toolName: string | undefined, serverName: string | undefined, autoApprove: boolean | undefined): boolean {
    const operation = qaapDelegationMcpOperation(toolName, serverName);
    return operation !== undefined && !(operation === 'childApply' && autoApprove === false);
}

/**
 * Breaks `@agent` mentions in text the delegation service writes into a conversation (a child's prompt, a
 * follow-up with reports): a mention would otherwise route that turn to another agent, `@shell` included.
 * A word joiner after `@` keeps the text readable and stops the mention parser.
 */
export function neutralizeQaapAgentMentions(text: string): string {
    return text.replace(/@(?=[A-Za-z])/g, '@\u2060');
}

// ---------------------------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------------------------

/** Children of one parent running at once; more delegations wait in state `queued`. */
export const QAAP_AGENT_DELEGATION_DEFAULT_MAX_CONCURRENT = 3;
export const QAAP_AGENT_DELEGATION_MAX_CONCURRENT_ENV = 'QAAP_DELEGATE_MAX_CONCURRENT';
/** Children one parent turn may create in total (running + queued + finished): a brake on runaway loops. */
export const QAAP_AGENT_DELEGATION_MAX_CHILDREN_PER_TURN = 12;
/**
 * Backend follow-up turns ("your children finished, here are their reports") per human turn of the parent.
 * Bounds the loop parent → children → follow-up → more children. Shares the turn's loop budget with
 * auto-continue (follow-ups are charged to the same root message).
 */
export const QAAP_AGENT_DELEGATION_MAX_FOLLOW_UPS = 4;
/** Depth of the delegation tree. 1 = a parent may delegate, a child may not. */
export const QAAP_AGENT_DELEGATION_MAX_DEPTH = 1;
/** Longest prompt a parent may hand a child. */
export const QAAP_AGENT_DELEGATION_PROMPT_MAX_CHARS = 20_000;
/** Longest title shown on the child chip. */
export const QAAP_AGENT_DELEGATION_TITLE_MAX_CHARS = 120;
/** Longest report summary returned to the parent (the full final message stays in the child conversation). */
export const QAAP_AGENT_DELEGATION_SUMMARY_MAX_CHARS = 8_000;
/** Longest child-derived `detail` (a blocked question, a failure message) returned to the parent, wrapped as untrusted. */
export const QAAP_AGENT_DELEGATION_DETAIL_MAX_CHARS = 1_000;
/** Longest `childIds` list a single wait/status call may name. */
export const QAAP_AGENT_DELEGATION_MAX_IDS_PER_CALL = QAAP_AGENT_DELEGATION_MAX_CHILDREN_PER_TURN;
/** Wait bounds in seconds. The effective cap is the harness tool-call timeout minus a margin. */
export const QAAP_AGENT_DELEGATION_WAIT_MIN_SEC = 1;
export const QAAP_AGENT_DELEGATION_WAIT_DEFAULT_SEC = 300;
export const QAAP_AGENT_DELEGATION_WAIT_MAX_SEC = 540;
/** Interval of the shim's MCP `notifications/progress` heartbeat while a wait blocks. */
export const QAAP_AGENT_DELEGATION_HEARTBEAT_SEC = 15;

/**
 * Effective wait in seconds: the request's value (or the default), clamped to
 * [{@link QAAP_AGENT_DELEGATION_WAIT_MIN_SEC}, min(harnessCapSec, {@link QAAP_AGENT_DELEGATION_WAIT_MAX_SEC})].
 * A non-finite or non-positive cap is ignored.
 */
export function resolveQaapDelegationWaitSec(requested: number | undefined, harnessCapSec?: number): number {
    const cap = typeof harnessCapSec === 'number' && Number.isFinite(harnessCapSec) && harnessCapSec > 0
        ? Math.min(harnessCapSec, QAAP_AGENT_DELEGATION_WAIT_MAX_SEC)
        : QAAP_AGENT_DELEGATION_WAIT_MAX_SEC;
    const wanted = typeof requested === 'number' && Number.isFinite(requested) ? requested : QAAP_AGENT_DELEGATION_WAIT_DEFAULT_SEC;
    return Math.max(QAAP_AGENT_DELEGATION_WAIT_MIN_SEC, Math.min(Math.floor(wanted), Math.floor(cap)));
}

// ---------------------------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------------------------

/**
 * Where a child works.
 * - `worktree`: its own git worktree on a fresh branch cut from the parent's HEAD (and so its own task
 *   sandbox when sandboxes are on). Its change comes back through {@link QaapChildApplyRequest}.
 * - `readonly`: the parent's workspace, read-only (explore, review, measure). It has no change to apply.
 */
export type QaapDelegationIsolation = 'worktree' | 'readonly';
export const QAAP_DELEGATION_ISOLATIONS: readonly QaapDelegationIsolation[] = ['worktree', 'readonly'];

/** Lifecycle of a child. */
export type QaapDelegatedChildState =
    /** Accepted, waiting for a concurrency slot. */
    | 'queued'
    | 'running'
    /** Finished its turn successfully. */
    | 'completed'
    /** Finished, but stopped to ask for input (approval, missing info); its report says why. */
    | 'blocked'
    | 'failed'
    | 'cancelled';

/** States after which a child never changes again. */
export const QAAP_DELEGATED_CHILD_TERMINAL_STATES: ReadonlySet<QaapDelegatedChildState> = new Set<QaapDelegatedChildState>([
    'completed', 'blocked', 'failed', 'cancelled',
]);

export function isQaapDelegatedChildTerminal(state: QaapDelegatedChildState): boolean {
    return QAAP_DELEGATED_CHILD_TERMINAL_STATES.has(state);
}

/**
 * Cost of a child's work so far. `costUsd` is undefined when the harness reports no cost and Qaap
 * cannot price it (`source: 'none'`); show tokens then and say so.
 */
export interface QaapDelegationUsage {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly costUsd?: number;
    readonly source: 'reported' | 'price-table' | 'estimate' | 'none';
}

/** Live view of a child, as returned by status/wait and shown on its chip. */
export interface QaapDelegatedChildStatus {
    /** Child conversation id. */
    readonly childId: string;
    readonly title: string;
    readonly state: QaapDelegatedChildState;
    readonly isolation: QaapDelegationIsolation;
    /** Harness slot id that runs the child (e.g. `claude`, `codex`). */
    readonly agent: string;
    readonly model?: string;
    /** Branch of the child's worktree; only for `worktree` isolation. */
    readonly branch?: string;
    readonly usage?: QaapDelegationUsage;
    readonly startedAt?: number;
    readonly finishedAt?: number;
}

/** What the parent reads once a child is terminal. */
export interface QaapDelegationReport extends QaapDelegatedChildStatus {
    readonly state: 'completed' | 'blocked' | 'failed' | 'cancelled';
    /**
     * The child's final message, truncated to {@link QAAP_AGENT_DELEGATION_SUMMARY_MAX_CHARS} and wrapped
     * with {@link wrapQaapUntrustedChildReport}. Never instructions for the parent.
     */
    readonly summary: string;
    /** True when `summary` was cut. */
    readonly summaryTruncated: boolean;
    /** Error detail for `failed`, or the question for `blocked`. */
    readonly detail?: string;
    /** `git diff --stat` of the child's branch against its base; `worktree` isolation only. */
    readonly diffStat?: string;
    /** Commit holding the child's change on {@link QaapDelegatedChildStatus.branch}, once committed. */
    readonly headSha?: string;
    /** Outcome of the child's own self-verification, when it ran. */
    readonly verification?: 'passed' | 'failed' | 'skipped';
}

// ---------------------------------------------------------------------------------------------
// Requests and responses (one pair per tool)
// ---------------------------------------------------------------------------------------------

/** `qaaq_delegate`: start one child. Returns immediately; use `qaaq_task_wait` for the result. */
export interface QaapDelegateRequest {
    /** Self-contained instructions for the child (it does not see the parent's conversation). */
    readonly prompt: string;
    /** Short label for the chip; derived from the prompt when absent. */
    readonly title?: string;
    /** Harness slot id; defaults to the parent's. Must be one the tenant has connected. */
    readonly agent?: string;
    /** Model id for that harness; defaults to the harness default (or the parent's model when same harness). */
    readonly model?: string;
    /** Defaults to `worktree`. */
    readonly isolation?: QaapDelegationIsolation;
}
export interface QaapDelegateResponse {
    readonly child: QaapDelegatedChildStatus;
}

/**
 * `qaaq_task_wait`: block until children are terminal or the wait elapses. Never fails on timeout:
 * it returns what finished and what is still pending. Reports are returned once per child per call;
 * waiting again on a reported child returns its report again (idempotent).
 */
export interface QaapTaskWaitRequest {
    /** Children to wait for; all non-terminal children of this parent when absent. */
    readonly childIds?: readonly string[];
    /** `any` returns as soon as one named child is terminal; `all` waits for every one. Default `any`. */
    readonly mode?: 'any' | 'all';
    /** Requested wait; clamped with {@link resolveQaapDelegationWaitSec}. */
    readonly timeoutSec?: number;
}
export interface QaapTaskWaitResponse {
    readonly finished: readonly QaapDelegationReport[];
    readonly pending: readonly QaapDelegatedChildStatus[];
    /** True when the call returned because the wait elapsed, not because the condition was met. */
    readonly timedOut: boolean;
    readonly totals: QaapDelegationTotals;
}

/** `qaaq_task_status`: one child, or all children of this parent when `childId` is absent. Never blocks. */
export interface QaapTaskStatusRequest {
    readonly childId?: string;
}
export interface QaapTaskStatusResponse {
    readonly children: readonly QaapDelegatedChildStatus[];
    readonly totals: QaapDelegationTotals;
}

/** `qaaq_task_cancel`: stop a child. Idempotent; cancelling a terminal child returns its state unchanged. */
export interface QaapTaskCancelRequest {
    readonly childId: string;
}
export interface QaapTaskCancelResponse {
    readonly child: QaapDelegatedChildStatus;
}

/**
 * `qaaq_child_apply`: bring a terminal `worktree` child's change into the parent's workspace.
 * - `apply` (default): commit the child's work on its branch, then 3-way apply its diff onto the
 *   parent's tree WITHOUT committing, so verification, review and the task PR see one change.
 *   Conflicts are left as markers in the listed files for the parent to resolve.
 * - `merge`: `--no-ff` merge of the child's branch via the safe merge; refused unless the parent's
 *   tree is clean. Never leaves a half-merged tree.
 */
export interface QaapChildApplyRequest {
    readonly childId: string;
    readonly mode?: 'apply' | 'merge';
}
export type QaapChildApplyResponse =
    | {
        readonly ok: true; readonly mode: 'apply' | 'merge'; readonly files: readonly string[]; readonly conflicts: readonly string[];
        /** Changed paths that can run code or change agent/CI behaviour (agent configs, hooks, workflows, package scripts): review them. */
        readonly sensitiveFiles?: readonly string[];
    }
    | {
        readonly ok: false; readonly reason: QaapChildApplyFailure; readonly error: string; readonly conflicts?: readonly string[];
        readonly sensitiveFiles?: readonly string[];
    };

/**
 * Why a child could not be applied. `not-terminal`: still queued or running. `not-completed`: finished as
 * blocked, failed or cancelled. `conflict` comes back from `merge` (an `apply` that conflicts leaves
 * markers, with the same reason and the conflicted files, and the parent must resolve them).
 */
export type QaapChildApplyFailure = 'not-terminal' | 'not-completed' | 'readonly-child' | 'no-changes' | 'dirty-parent' | 'conflict' | 'failed'
    /** Already applied, or applied with conflicts: applying again would duplicate hunks. */
    | 'already-applied'
    /** The parent turn is read-only (plan mode): it may not bring changes in. */
    | 'read-only-parent';

/** Paths whose change can run code or alter agent / CI behaviour; `qaaq_child_apply` lists them for review. */
const SENSITIVE_PATH_PATTERNS: readonly RegExp[] = [
    /(^|\/)\.claude\//, /(^|\/)\.mcp\.json$/, /(^|\/)\.codex\//, /(^|\/)opencode\.jsonc?$/, /(^|\/)\.opencode\//,
    /(^|\/)\.github\/workflows\//, /(^|\/)\.husky\//, /(^|\/)\.githooks\//, /(^|\/)\.git\/hooks\//, /(^|\/)package\.json$/,
    /(^|\/)AGENTS(\.override)?\.md$/, /(^|\/)CLAUDE\.md$/, /(^|\/)\.vscode\/tasks\.json$/,
];

/** The subset of `files` matching {@link SENSITIVE_PATH_PATTERNS}. */
export function qaapDelegationSensitiveFiles(files: readonly string[]): string[] {
    return files.filter(file => SENSITIVE_PATH_PATTERNS.some(pattern => pattern.test(file.replace(/\\/g, '/'))));
}

/** `qaaq_list_agents`: the harnesses and models a child may run with, for this account. Takes no arguments. */
export type QaapListAgentsRequest = Record<string, never>;

/** One harness a child could run with, and why it can or cannot be chosen now. */
export interface QaapDelegationAgentOption {
    /** Value for `qaaq_delegate.agent`. */
    readonly agent: string;
    readonly label: string;
    /** True when `qaaq_delegate` would accept it right now. */
    readonly selectable: boolean;
    /** Why it is not selectable: not installed / not signed in, cannot ask under your approval policy. */
    readonly reason?: 'not-connected' | 'cannot-ask';
    /** Whether it can run a `readonly` child (read-only is enforceable for it). */
    readonly readonly: boolean;
    /** Models for `qaaq_delegate.model`; empty when the harness picks its own. */
    readonly models: readonly { readonly model: string; readonly label: string }[];
    /** The harness you (the parent) run on. */
    readonly current: boolean;
}
export interface QaapListAgentsResponse {
    readonly agents: readonly QaapDelegationAgentOption[];
}

/** Cost and counts across every child of the parent turn, plus the parent itself when known. */
export interface QaapDelegationTotals {
    readonly children: number;
    readonly running: number;
    readonly queued: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    /** Undefined when no participant could be priced. */
    readonly costUsd?: number;
    /** True when at least one participant has no price, so `costUsd` is a lower bound. */
    readonly costIncomplete: boolean;
    /** Effective concurrency cap for this parent. */
    readonly maxConcurrent: number;
}

/** Error codes every route may return, with the HTTP status the endpoint uses. */
export type QaapAgentDelegationErrorCode =
    /** 401: missing, unknown, revoked or expired token. */
    | 'unauthorized'
    /** 403: valid token without the `delegate` scope, or a child of another parent/tenant. */
    | 'forbidden'
    /** 404: the feature flag is off (the routes behave as absent). */
    | 'disabled'
    /** 400: the body failed validation. */
    | 'invalid-request'
    /** 404: no such child under this parent. */
    | 'not-found'
    /** 429: {@link QAAP_AGENT_DELEGATION_MAX_CHILDREN_PER_TURN} reached. */
    | 'limit-reached'
    /** 422: the requested agent/model is not connected for this tenant or cannot run this isolation. */
    | 'unsupported-agent'
    /** 500. */
    | 'internal';

export const QAAP_AGENT_DELEGATION_ERROR_STATUS: Readonly<Record<QaapAgentDelegationErrorCode, number>> = {
    'unauthorized': 401,
    'forbidden': 403,
    'disabled': 404,
    'invalid-request': 400,
    'not-found': 404,
    'limit-reached': 429,
    'unsupported-agent': 422,
    'internal': 500,
};

export interface QaapAgentDelegationErrorResponse {
    readonly error: string;
    readonly code: QaapAgentDelegationErrorCode;
}

// ---------------------------------------------------------------------------------------------
// Untrusted report wrapping
// ---------------------------------------------------------------------------------------------

export const QAAP_AGENT_DELEGATION_UNTRUSTED_OPEN = '<untrusted-child-report>';
export const QAAP_AGENT_DELEGATION_UNTRUSTED_CLOSE = '</untrusted-child-report>';

/**
 * Truncates a child's final message and wraps it as data. Any occurrence of the wrapper tags inside
 * the text is neutralised first, so a child cannot close the wrapper early and speak as the system.
 */
export function wrapQaapUntrustedChildReport(text: string, maxChars: number = QAAP_AGENT_DELEGATION_SUMMARY_MAX_CHARS): {
    readonly summary: string;
    readonly truncated: boolean;
} {
    // Any spelling of the wrapper tag (spaces, attributes, case) is defused, and mentions cannot route the turn.
    const neutralised = neutralizeQaapAgentMentions(text.replace(/<\s*\/?\s*untrusted-child-report\b[^>]*>/gi, tag => tag.replace('<', '&lt;')));
    const truncated = neutralised.length > maxChars;
    const body = truncated ? `${neutralised.slice(0, maxChars)}\n[... truncated]` : neutralised;
    return { summary: `${QAAP_AGENT_DELEGATION_UNTRUSTED_OPEN}\n${body}\n${QAAP_AGENT_DELEGATION_UNTRUSTED_CLOSE}`, truncated };
}

/** Longest file name, title or error line of a child that reaches the parent unwrapped. */
export const QAAP_AGENT_DELEGATION_LABEL_MAX_CHARS = 200;

/**
 * Makes a short string that derives from a child (a file name it created, its title, a git error naming its
 * files) safe to hand to the parent: control characters (a newline in a file name could start a fake line) become
 * spaces, the wrapper tags and `@mentions` are defused like in {@link wrapQaapUntrustedChildReport}, and it is cut
 * at `maxChars`. Applied to every such string outside the wrapper.
 */
export function sanitizeQaapDelegationLabel(text: string, maxChars: number = QAAP_AGENT_DELEGATION_LABEL_MAX_CHARS): string {
    const cleaned = neutralizeQaapAgentMentions(text
        .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ')
        .replace(/<\s*\/?\s*untrusted-child-report\b[^>]*>/gi, tag => tag.replace('<', '&lt;')));
    return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars)}...` : cleaned;
}

// ---------------------------------------------------------------------------------------------
// Request validation (used by the endpoint; strict: unknown keys are rejected)
// ---------------------------------------------------------------------------------------------

export type QaapDelegationParseResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

/** Slot/model ids: conservative charset so nothing path- or shell-like reaches the runner. */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/;
/** Child ids are conversation ids. */
const CHILD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function parseQaapDelegateRequest(body: unknown): QaapDelegationParseResult<QaapDelegateRequest> {
    const record = asPlainObject(body, ['prompt', 'title', 'agent', 'model', 'isolation']);
    if (typeof record === 'string') {
        return fail(record);
    }
    const prompt = typeof record.prompt === 'string' ? record.prompt.trim() : '';
    if (!prompt) {
        return fail('"prompt" is required.');
    }
    if (prompt.length > QAAP_AGENT_DELEGATION_PROMPT_MAX_CHARS) {
        return fail(`"prompt" exceeds ${QAAP_AGENT_DELEGATION_PROMPT_MAX_CHARS} characters.`);
    }
    if (record.title !== undefined && (typeof record.title !== 'string' || record.title.length > QAAP_AGENT_DELEGATION_TITLE_MAX_CHARS)) {
        return fail(`"title" must be a string of at most ${QAAP_AGENT_DELEGATION_TITLE_MAX_CHARS} characters.`);
    }
    for (const key of ['agent', 'model'] as const) {
        const value = record[key];
        if (value !== undefined && (typeof value !== 'string' || !ID_PATTERN.test(value))) {
            return fail(`"${key}" is not a valid id.`);
        }
    }
    if (record.isolation !== undefined && !QAAP_DELEGATION_ISOLATIONS.includes(record.isolation as QaapDelegationIsolation)) {
        return fail('"isolation" must be "worktree" or "readonly".');
    }
    const title = typeof record.title === 'string' ? record.title.trim() : '';
    return {
        ok: true,
        value: {
            prompt,
            ...(title ? { title } : {}),
            ...(record.agent !== undefined ? { agent: record.agent as string } : {}),
            ...(record.model !== undefined ? { model: record.model as string } : {}),
            isolation: (record.isolation as QaapDelegationIsolation | undefined) ?? 'worktree',
        },
    };
}

export function parseQaapTaskWaitRequest(body: unknown): QaapDelegationParseResult<QaapTaskWaitRequest> {
    const record = asPlainObject(body ?? {}, ['childIds', 'mode', 'timeoutSec']);
    if (typeof record === 'string') {
        return fail(record);
    }
    let childIds: string[] | undefined;
    if (record.childIds !== undefined) {
        if (!Array.isArray(record.childIds) || record.childIds.length > QAAP_AGENT_DELEGATION_MAX_IDS_PER_CALL
            || !record.childIds.every(id => typeof id === 'string' && CHILD_ID_PATTERN.test(id))) {
            return fail(`"childIds" must be a list of at most ${QAAP_AGENT_DELEGATION_MAX_IDS_PER_CALL} child ids.`);
        }
        childIds = [...new Set(record.childIds as string[])];
    }
    if (record.mode !== undefined && record.mode !== 'any' && record.mode !== 'all') {
        return fail('"mode" must be "any" or "all".');
    }
    if (record.timeoutSec !== undefined && (typeof record.timeoutSec !== 'number' || !Number.isFinite(record.timeoutSec) || record.timeoutSec <= 0)) {
        return fail('"timeoutSec" must be a positive number.');
    }
    return {
        ok: true,
        value: {
            ...(childIds ? { childIds } : {}),
            mode: (record.mode as 'any' | 'all' | undefined) ?? 'any',
            ...(record.timeoutSec !== undefined ? { timeoutSec: record.timeoutSec as number } : {}),
        },
    };
}

export function parseQaapTaskStatusRequest(body: unknown): QaapDelegationParseResult<QaapTaskStatusRequest> {
    const record = asPlainObject(body ?? {}, ['childId']);
    if (typeof record === 'string') {
        return fail(record);
    }
    if (record.childId === undefined) {
        return { ok: true, value: {} };
    }
    return isChildId(record.childId) ? { ok: true, value: { childId: record.childId } } : fail('"childId" is not a valid child id.');
}

export function parseQaapTaskCancelRequest(body: unknown): QaapDelegationParseResult<QaapTaskCancelRequest> {
    const record = asPlainObject(body, ['childId']);
    if (typeof record === 'string') {
        return fail(record);
    }
    return isChildId(record.childId) ? { ok: true, value: { childId: record.childId } } : fail('"childId" is required.');
}

export function parseQaapListAgentsRequest(body: unknown): QaapDelegationParseResult<QaapListAgentsRequest> {
    const record = asPlainObject(body ?? {}, []);
    return typeof record === 'string' ? fail(record) : { ok: true, value: {} };
}

export function parseQaapChildApplyRequest(body: unknown): QaapDelegationParseResult<QaapChildApplyRequest> {
    const record = asPlainObject(body, ['childId', 'mode']);
    if (typeof record === 'string') {
        return fail(record);
    }
    if (!isChildId(record.childId)) {
        return fail('"childId" is required.');
    }
    if (record.mode !== undefined && record.mode !== 'apply' && record.mode !== 'merge') {
        return fail('"mode" must be "apply" or "merge".');
    }
    return { ok: true, value: { childId: record.childId, mode: (record.mode as 'apply' | 'merge' | undefined) ?? 'apply' } };
}

function isChildId(value: unknown): value is string {
    return typeof value === 'string' && CHILD_ID_PATTERN.test(value);
}

/** The body as a plain object with only `allowed` keys, or an error message. */
function asPlainObject(body: unknown, allowed: readonly string[]): Record<string, unknown> | string {
    if (typeof body !== 'object' || body === undefined || body === null || Array.isArray(body)) { // eslint-disable-line no-null/no-null
        return 'The request body must be a JSON object.';
    }
    const unknownKeys = Object.keys(body).filter(key => !allowed.includes(key));
    if (unknownKeys.length) {
        return `Unknown field(s): ${unknownKeys.map(key => `"${key}"`).join(', ')}.`;
    }
    return body as Record<string, unknown>;
}

function fail<T>(error: string): QaapDelegationParseResult<T> {
    return { ok: false, error };
}
