// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// Qaap-level agent lifecycle hooks: configuration model, parsing, matching and result semantics.
// The format is compatible with Claude Code's `hooks` JSON so existing hook files can be reused.
// Portions adapted from ZCode (Apache-2.0): matcher semantics and the exit-code contract.

/** REST base path for hook status and workspace trust review. */
export const QAAP_AGENT_HOOKS_API_PATH = '/api/qaap/agent-hooks';

/** Workspace-level declaration file, relative to the repository root. */
export const QAAP_WORKSPACE_HOOKS_RELATIVE_PATH = '.qaap/hooks.json';

/** User-settings key holding the user-level declaration (same JSON shape as the workspace file). */
export const QAAP_USER_AGENT_HOOKS_SETTING = 'qaap.agentHooks';

export const QAAP_AGENT_HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'] as const;
export type QaapAgentHookEventName = typeof QAAP_AGENT_HOOK_EVENTS[number];

/** Claude Code's default per-command timeout, in seconds. */
export const QAAP_AGENT_HOOK_DEFAULT_TIMEOUT_SEC = 60;
export const QAAP_AGENT_HOOK_MAX_TIMEOUT_SEC = 600;
/** Exit code that blocks the action (prompt submission / tool use), with stderr as the reason. */
export const QAAP_AGENT_HOOK_BLOCKING_EXIT_CODE = 2;

export interface QaapAgentHookCommand {
    readonly type: 'command';
    readonly command: string;
    /** Seconds; always set after parsing. */
    readonly timeoutSec: number;
}

export interface QaapAgentHookMatcherGroup {
    /** Tool name matcher (`Bash`, `Edit|Write`, a regex, `*` or empty = all). */
    readonly matcher?: string;
    readonly hooks: readonly QaapAgentHookCommand[];
}

export type QaapAgentHookDeclaration = Partial<Record<QaapAgentHookEventName, readonly QaapAgentHookMatcherGroup[]>>;

export interface QaapAgentHookParseResult {
    readonly declaration: QaapAgentHookDeclaration;
    /** Non-fatal problems (unknown events, invalid entries). Invalid entries are dropped. */
    readonly errors: readonly string[];
}

/** One flattened command, as shown to the user in a trust review. */
export interface QaapAgentHookSummaryEntry {
    readonly event: QaapAgentHookEventName;
    readonly matcher?: string;
    readonly command: string;
    readonly timeoutSec: number;
}

export type QaapAgentHookSource = 'user' | 'workspace';

export interface QaapAgentHookWarning {
    readonly at: number;
    readonly source: QaapAgentHookSource;
    readonly event: QaapAgentHookEventName;
    readonly command?: string;
    readonly message: string;
}

/**
 * `none`: no workspace hooks; `pending`: declared but not reviewed for this digest;
 * `trusted`: approved for this digest; `ignored`: the user chose not to run this digest.
 */
export type QaapAgentWorkspaceHookTrustState = 'none' | 'pending' | 'trusted' | 'ignored';

export interface QaapAgentWorkspaceHooksStatus {
    readonly state: QaapAgentWorkspaceHookTrustState;
    /** Repository root holding `.qaap/hooks.json`. */
    readonly root?: string;
    /**
     * sha256 of the normalized declaration plus the content of {@link coveredFiles}; trust and ignore
     * requests must echo it.
     */
    readonly digest?: string;
    readonly hooks: readonly QaapAgentHookSummaryEntry[];
    /**
     * Repository-relative files whose content is part of {@link digest}: everything under `.qaap/`
     * and project files the commands name (`./scripts/x.sh`, `$CLAUDE_PROJECT_DIR/…`). Editing any of
     * them returns the workspace to review.
     */
    readonly coveredFiles?: readonly string[];
    readonly errors: readonly string[];
}

/** Project-dir variables hooks receive; a `$VAR/…` argument names a file inside the repository. */
const QAAP_AGENT_HOOK_PROJECT_DIR_PREFIX_RE = /^(?:\$\{?(?:CLAUDE_PROJECT_DIR|QAAP_PROJECT_DIR)\}?\/)+/;

/**
 * Words of a hook command that may name a repository file, as repository-relative paths (quotes and
 * project-dir prefixes removed; absolute, home-relative and `..` paths skipped). Callers keep only the
 * candidates that exist, so over-matching (a word that is not a path) is harmless.
 */
export function extractQaapAgentHookFileCandidates(command: string): string[] {
    const candidates = new Set<string>();
    for (const rawWord of command.split(/[\s;&|()<>`]+/)) {
        let word = rawWord.replace(/["']/g, '');
        const eq = word.indexOf('=');
        if (eq >= 0) {
            word = word.slice(eq + 1);
        }
        word = word.replace(QAAP_AGENT_HOOK_PROJECT_DIR_PREFIX_RE, '').replace(/^(?:\.\/)+/, '');
        if (!word || word.startsWith('/') || word.startsWith('~') || word.startsWith('$') || /^[A-Za-z]:/.test(word)
            || word.split('/').includes('..') || !/[./]/.test(word)) {
            continue;
        }
        candidates.add(word);
    }
    return [...candidates];
}

/** A workspace whose hooks an agent turn skipped because they still await review, with the turn's cwd. */
export interface QaapAgentPendingWorkspaceHooks extends QaapAgentWorkspaceHooksStatus {
    readonly cwd: string;
}

/** `GET {QAAP_AGENT_HOOKS_API_PATH}/pending`: workspaces (any project, not only the IDE root) to review. */
export interface QaapAgentHooksPendingResponse {
    readonly workspaces: readonly QaapAgentPendingWorkspaceHooks[];
}

export interface QaapAgentHooksStatusResponse {
    readonly workspace: QaapAgentWorkspaceHooksStatus;
    readonly user: { readonly hooks: readonly QaapAgentHookSummaryEntry[]; readonly errors: readonly string[] };
    readonly warnings: readonly QaapAgentHookWarning[];
}

export interface QaapAgentHookTrustRequest {
    readonly cwd: string;
    readonly digest: string;
}

export interface QaapAgentHookTrustResponse {
    readonly ok: boolean;
    readonly error?: string;
    readonly status?: QaapAgentWorkspaceHooksStatus;
}

export function isQaapAgentHookEventName(value: unknown): value is QaapAgentHookEventName {
    return typeof value === 'string' && (QAAP_AGENT_HOOK_EVENTS as readonly string[]).includes(value);
}

function clampTimeoutSec(raw: unknown): number {
    const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : QAAP_AGENT_HOOK_DEFAULT_TIMEOUT_SEC;
    return Math.min(QAAP_AGENT_HOOK_MAX_TIMEOUT_SEC, Math.max(1, Math.round(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Parses a Claude Code compatible hooks object. Accepts `{ "hooks": { ... } }` (settings/file form)
 * or the bare `{ "PreToolUse": [...] }` map. Unknown events and malformed entries are reported in
 * `errors` and dropped; the result only contains runnable `command` hooks.
 */
export function parseQaapAgentHooksConfig(raw: unknown): QaapAgentHookParseResult {
    const errors: string[] = [];
    // eslint-disable-next-line no-null/no-null
    if (raw === undefined || raw === null) {
        return { declaration: {}, errors };
    }
    if (!isRecord(raw)) {
        return { declaration: {}, errors: ['Hooks configuration must be a JSON object.'] };
    }
    const map = isRecord(raw.hooks) ? raw.hooks : ('hooks' in raw ? undefined : raw);
    if (!map) {
        return { declaration: {}, errors: ['"hooks" must be an object keyed by event name.'] };
    }
    const declaration: Partial<Record<QaapAgentHookEventName, QaapAgentHookMatcherGroup[]>> = {};
    for (const [eventName, groups] of Object.entries(map)) {
        if (!isQaapAgentHookEventName(eventName)) {
            errors.push(`Unsupported hook event "${eventName}" ignored.`);
            continue;
        }
        if (!Array.isArray(groups)) {
            errors.push(`${eventName}: expected an array of matcher groups.`);
            continue;
        }
        const parsedGroups: QaapAgentHookMatcherGroup[] = [];
        groups.forEach((group, groupIndex) => {
            if (!isRecord(group)) {
                errors.push(`${eventName}[${groupIndex}]: expected an object.`);
                return;
            }
            let matcher: string | undefined;
            if (group.matcher !== undefined) {
                if (typeof group.matcher !== 'string') {
                    errors.push(`${eventName}[${groupIndex}]: "matcher" must be a string.`);
                    return;
                }
                matcher = group.matcher.trim() || undefined;
                if (matcher && !isValidQaapAgentHookMatcher(matcher)) {
                    errors.push(`${eventName}[${groupIndex}]: invalid matcher regex "${matcher}".`);
                    return;
                }
            }
            if (!Array.isArray(group.hooks)) {
                errors.push(`${eventName}[${groupIndex}]: "hooks" must be an array.`);
                return;
            }
            const hooks: QaapAgentHookCommand[] = [];
            group.hooks.forEach((hook, hookIndex) => {
                const where = `${eventName}[${groupIndex}].hooks[${hookIndex}]`;
                if (!isRecord(hook)) {
                    errors.push(`${where}: expected an object.`);
                    return;
                }
                if (hook.type !== undefined && hook.type !== 'command') {
                    errors.push(`${where}: only "command" hooks are supported.`);
                    return;
                }
                if (typeof hook.command !== 'string' || !hook.command.trim()) {
                    errors.push(`${where}: "command" must be a non-empty string.`);
                    return;
                }
                hooks.push({ type: 'command', command: hook.command.trim(), timeoutSec: clampTimeoutSec(hook.timeout) });
            });
            if (hooks.length > 0) {
                parsedGroups.push(matcher ? { matcher, hooks } : { hooks });
            }
        });
        if (parsedGroups.length > 0) {
            declaration[eventName] = parsedGroups;
        }
    }
    return { declaration, errors };
}

export function isValidQaapAgentHookMatcher(matcher: string): boolean {
    if (matcher === '*' || /^[A-Za-z0-9_|]+$/.test(matcher)) {
        return true;
    }
    try {
        // eslint-disable-next-line no-new
        new RegExp(matcher);
        return true;
    } catch {
        return false;
    }
}

/**
 * Claude Code matcher semantics: empty or `*` matches everything; a plain `A|B` list matches tool
 * names exactly; anything else is a regular expression tested against the value.
 */
export function matchesQaapAgentHookMatcher(matcher: string | undefined, value: string | undefined): boolean {
    if (!matcher || matcher === '*') {
        return true;
    }
    if (value === undefined) {
        return false;
    }
    if (/^[A-Za-z0-9_|]+$/.test(matcher)) {
        return matcher.split('|').includes(value);
    }
    try {
        return new RegExp(matcher).test(value);
    } catch {
        return false;
    }
}

/** Events whose matcher is meaningful (tool name, or session source for SessionStart). */
function eventUsesMatcher(event: QaapAgentHookEventName): boolean {
    return event === 'PreToolUse' || event === 'PostToolUse' || event === 'SessionStart';
}

export function selectQaapAgentHookCommands(
    declaration: QaapAgentHookDeclaration,
    event: QaapAgentHookEventName,
    matchValue?: string,
): QaapAgentHookCommand[] {
    const groups = declaration[event] ?? [];
    const selected: QaapAgentHookCommand[] = [];
    const seen = new Set<string>();
    for (const group of groups) {
        if (eventUsesMatcher(event) && !matchesQaapAgentHookMatcher(group.matcher, matchValue)) {
            continue;
        }
        for (const hook of group.hooks) {
            // Claude Code deduplicates identical commands within one event.
            if (!seen.has(hook.command)) {
                seen.add(hook.command);
                selected.push(hook);
            }
        }
    }
    return selected;
}

export function isQaapAgentHookDeclarationEmpty(declaration: QaapAgentHookDeclaration): boolean {
    return QAAP_AGENT_HOOK_EVENTS.every(event => !(declaration[event]?.length));
}

export function flattenQaapAgentHookDeclaration(declaration: QaapAgentHookDeclaration): QaapAgentHookSummaryEntry[] {
    const entries: QaapAgentHookSummaryEntry[] = [];
    for (const event of QAAP_AGENT_HOOK_EVENTS) {
        for (const group of declaration[event] ?? []) {
            for (const hook of group.hooks) {
                entries.push({
                    event,
                    ...(group.matcher ? { matcher: group.matcher } : {}),
                    command: hook.command,
                    timeoutSec: hook.timeoutSec,
                });
            }
        }
    }
    return entries;
}

/**
 * Canonical JSON of a parsed declaration: events in fixed order, groups and commands in declaration
 * order (order is semantic), keys sorted. Formatting, comments-free whitespace and dropped invalid
 * entries do not change it; any change to an event, matcher, command or timeout does.
 */
export function normalizeQaapAgentHookDeclaration(declaration: QaapAgentHookDeclaration): string {
    const canonical: Array<[string, Array<{ matcher: string; hooks: Array<{ command: string; timeoutSec: number; type: string }> }>]> = [];
    for (const event of QAAP_AGENT_HOOK_EVENTS) {
        const groups = declaration[event];
        if (!groups?.length) {
            continue;
        }
        canonical.push([event, groups.map(group => ({
            matcher: group.matcher ?? '',
            hooks: group.hooks.map(hook => ({ command: hook.command, timeoutSec: hook.timeoutSec, type: hook.type })),
        }))]);
    }
    return JSON.stringify({ version: 1, events: canonical });
}

/** Outcome of one hook command, independent of how it was spawned. */
export interface QaapAgentHookProcessResult {
    readonly exitCode?: number;
    readonly stdout: string;
    readonly stderr: string;
    readonly timedOut: boolean;
    /** Spawn failure or other runner error. */
    readonly error?: string;
}

export type QaapAgentHookPermissionDecision = 'allow' | 'deny' | 'ask';

export interface QaapAgentHookInterpretation {
    /** `block`: exit 2 or JSON `continue:false`/`decision:block|deny`; `error`: non-blocking failure. */
    readonly outcome: 'success' | 'block' | 'error';
    readonly reason?: string;
    readonly additionalContext?: string;
    readonly permissionDecision?: QaapAgentHookPermissionDecision;
}

function normalizePermissionDecision(value: unknown): QaapAgentHookPermissionDecision | undefined {
    switch (value) {
        case 'allow':
        case 'approve':
            return 'allow';
        case 'deny':
        case 'block':
            return 'deny';
        case 'ask':
            return 'ask';
        default:
            return undefined;
    }
}

function nonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * Applies the Claude Code exit-code contract:
 * - exit 0: success. Stdout may be JSON (`decision`, `reason`, `continue`, `stopReason`,
 *   `hookSpecificOutput.permissionDecision`/`permissionDecisionReason`/`additionalContext`);
 *   for SessionStart / UserPromptSubmit plain stdout is extra context.
 * - exit 2: blocking; stderr is the reason (deny for PreToolUse, block for UserPromptSubmit).
 * - anything else, timeout or spawn error: non-blocking error.
 */
export function interpretQaapAgentHookResult(event: QaapAgentHookEventName, result: QaapAgentHookProcessResult): QaapAgentHookInterpretation {
    if (result.error) {
        return { outcome: 'error', reason: result.error };
    }
    if (result.timedOut) {
        return { outcome: 'error', reason: 'Hook timed out.' };
    }
    if (result.exitCode === QAAP_AGENT_HOOK_BLOCKING_EXIT_CODE) {
        const blockReason = result.stderr.trim() || 'Blocked by hook.';
        return event === 'PreToolUse'
            ? { outcome: 'block', reason: blockReason, permissionDecision: 'deny' }
            : { outcome: 'block', reason: blockReason };
    }
    if (result.exitCode !== 0) {
        return { outcome: 'error', reason: result.stderr.trim() || `Hook exited with code ${result.exitCode ?? 'unknown'}.` };
    }
    const stdout = result.stdout.trim();
    let json: Record<string, unknown> | undefined;
    if (stdout.startsWith('{')) {
        try {
            const parsed = JSON.parse(stdout);
            json = isRecord(parsed) ? parsed : undefined;
        } catch {
            json = undefined;
        }
    }
    const contextEvent = event === 'SessionStart' || event === 'UserPromptSubmit';
    if (!json) {
        return contextEvent && stdout ? { outcome: 'success', additionalContext: stdout } : { outcome: 'success' };
    }
    const specific = isRecord(json.hookSpecificOutput) ? json.hookSpecificOutput : {};
    const additionalContext = contextEvent ? nonEmptyString(specific.additionalContext) : undefined;
    if (json.continue === false) {
        return {
            outcome: 'block',
            reason: nonEmptyString(json.stopReason) ?? nonEmptyString(json.reason) ?? 'Stopped by hook.',
            ...(event === 'PreToolUse' ? { permissionDecision: 'deny' as const } : {}),
        };
    }
    const decision = normalizePermissionDecision(specific.permissionDecision) ?? normalizePermissionDecision(json.decision);
    const reason = nonEmptyString(specific.permissionDecisionReason) ?? nonEmptyString(json.reason);
    if (event === 'PreToolUse') {
        if (decision === 'deny') {
            return { outcome: 'block', permissionDecision: 'deny', reason: reason ?? 'Denied by hook.' };
        }
        return {
            outcome: 'success',
            ...(decision ? { permissionDecision: decision } : {}),
            ...(reason ? { reason } : {}),
        };
    }
    if (event === 'UserPromptSubmit' && decision === 'deny') {
        return { outcome: 'block', reason: reason ?? 'Prompt blocked by hook.' };
    }
    return { outcome: 'success', ...(additionalContext ? { additionalContext } : {}) };
}
