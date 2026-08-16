// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { isShellToolName } from '@theia/qaap-mobile-shell/lib/common/qaap-transcript-preview-offer';
import type { QaapQaiqPendingControlRequest } from './qaap-qaiq-stdio-approvals';

/**
 * Guard against agents running destructive shell commands without an explicit user request.
 *
 * Mirrors `qaap-agent-dev-server-guard`: enforced on the QAIQ stdio `can_use_tool` control path,
 * so Qaap can decide before the shell starts. Qaap's default `approve-for-me` QAIQ policy uses
 * that control path: safe tools are answered automatically, while these patterns are queued for
 * an Allow/Deny card (never auto-approved). Full-access / bypassPermissions still hard-denies them.
 * The hosted QAIQ shell is additionally forced through the versioned shell boundary.
 */

/** `git push --force`, `-f`, `--force-with-lease`, or a `+refspec` force push. */
const GIT_FORCE_PUSH_RE = /\bgit\s+push\b[^\n|&;]*(?:--force(?:-with-lease)?\b|\s-[a-zA-Z]*f[a-zA-Z]*\b|\s\+\S+)/;
/** Remote branch deletion: `git push --delete origin foo` or `git push origin :foo`. */
const GIT_REMOTE_DELETE_RE = /\bgit\s+push\b[^\n|&;]*(?:--delete\b|\s:\S+)/;
/** `git reset --hard` (any target). */
const GIT_RESET_HARD_RE = /\bgit\s+reset\b[^\n|&;]*--hard\b/;
/** `git clean` with a force flag (`-f`, `-fd`, `-fx`, `--force`). */
const GIT_CLEAN_FORCE_RE = /\bgit\s+clean\b[^\n|&;]*(?:\s-[a-zA-Z]*f[a-zA-Z]*\b|--force\b)/;
/** Forced local branch deletion: `git branch -D` / `--delete --force`. */
const GIT_BRANCH_FORCE_DELETE_RE = /\bgit\s+branch\b[^\n|&;]*(?:\s-D\b|--delete\s+--force\b|-df\b|-fd\b)/;
/** History rewrites that affect every ref. */
const GIT_HISTORY_REWRITE_RE = /\bgit\s+(?:filter-branch|filter-repo)\b/;

/**
 * Global process selectors are never workspace-scoped. In the hosted runtime one tenant can own
 * several projects/previews, so `pkill -f vite`, `killall node`, or an arbitrary `kill PID` can terminate unrelated work even
 * though the OS uid boundary correctly prevents cross-tenant access. Qaap-managed processes are
 * stopped by their recorded pid/process-group through the preview/job APIs instead.
 */
const GLOBAL_PROCESS_KILL_RE = /(?:^|&&|\|\||;|\|\s*|\(\s*|\b(?:sudo|nohup|exec|command|builtin)\s+)\s*(?:pkill|killall|kill)\b/i;

/** `rm` invocations (optionally via sudo/env prefixes) — inspected further for -rf + dangerous targets. */
const RM_COMMAND_RE = /(?:^|&&|\|\||;|\|\s*|\(\s*|\b(?:sudo|nohup|exec)\s+)\s*rm\s+([^\n|&;]*)/gi;

/**
 * Nested shell payloads (`sh -c '…'`, `bash -lc "…"`) — the quoted command is re-scanned so the
 * guard is not bypassed by one level of indirection. This stays a DENYLIST defense-in-depth layer:
 * a determined adversary can still evade regexes (variables, eval, encoding); the primary controls
 * are the approval queue on the interactive path and the hosted QAIQ shell boundary.
 */
const NESTED_SHELL_RE = /\b(?:sh|bash|zsh|dash|ksh)\s+(?:-[a-zA-Z]+\s+)*-[a-zA-Z]*c[a-zA-Z]*\s+(?:'([^']*)'|"([^"]*)")/gi;
const NESTED_SHELL_MAX_DEPTH = 3;

/** True when the rm argument list combines recursive+force flags. */
function rmArgsAreRecursiveForce(args: string): boolean {
    let recursive = false;
    let force = false;
    for (const token of args.split(/\s+/)) {
        if (/^--?recursive$/.test(token) || /^-[a-zA-Z]*r[a-zA-Z]*$/i.test(token)) {
            recursive = true;
        }
        if (token === '--force' || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(token)) {
            force = true;
        }
    }
    return recursive && force;
}

/** rm targets that can reach outside the workspace or wipe it entirely. */
function rmTargetIsDangerous(args: string): boolean {
    for (const token of args.split(/\s+/)) {
        if (!token || token.startsWith('-')) {
            continue;
        }
        const target = token.replace(/^["']|["']$/g, '');
        if (
            target.startsWith('/')
            || target === '~' || target.startsWith('~/')
            || target === '..' || target.startsWith('../')
            || target === '.' || target === './' || target === '*' || target === './*'
            || target.startsWith('$HOME')
        ) {
            return true;
        }
    }
    return false;
}

/** True for shell commands that destroy git history/branches or delete files outside the workspace. */
export function isDestructiveShellCommand(command: string | undefined): boolean {
    return isDestructiveShellCommandAtDepth(command, 0);
}

function isDestructiveShellCommandAtDepth(command: string | undefined, depth: number): boolean {
    const text = command?.trim();
    if (!text) {
        return false;
    }
    if (depth < NESTED_SHELL_MAX_DEPTH) {
        NESTED_SHELL_RE.lastIndex = 0;
        // Collect payloads first: the recursion below also uses NESTED_SHELL_RE and would
        // otherwise clobber the shared lastIndex mid-iteration.
        const payloads: string[] = [];
        let nested: RegExpExecArray | null;
        while ((nested = NESTED_SHELL_RE.exec(text)) !== null) {
            const payload = nested[1] ?? nested[2];
            if (payload) {
                payloads.push(payload);
            }
        }
        if (payloads.some(payload => isDestructiveShellCommandAtDepth(payload, depth + 1))) {
            return true;
        }
    }
    if (
        GIT_FORCE_PUSH_RE.test(text)
        || GIT_REMOTE_DELETE_RE.test(text)
        || GIT_RESET_HARD_RE.test(text)
        || GIT_CLEAN_FORCE_RE.test(text)
        || GIT_BRANCH_FORCE_DELETE_RE.test(text)
        || GIT_HISTORY_REWRITE_RE.test(text)
        || GLOBAL_PROCESS_KILL_RE.test(text)
    ) {
        return true;
    }
    RM_COMMAND_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = RM_COMMAND_RE.exec(text)) !== null) {
        const args = match[1] ?? '';
        if (rmArgsAreRecursiveForce(args) && rmTargetIsDangerous(args)) {
            return true;
        }
    }
    return false;
}

/** Deny guidance sent back to the agent so it proposes a safe alternative instead of retrying. */
export function buildDestructiveCommandDenyMessage(): string {
    return nls.localize(
        'qaap/agent/destructiveCommandBlocked',
        'Blocked by Qaap: this command is destructive (force push, remote/local branch force-delete, '
        + 'hard reset, forced clean, history rewrite, global process kill, or rm -rf outside the workspace) and needs the user\'s '
        + 'explicit request. Do not retry it. Use the safe alternative (git stash, a normal push, a targeted rm '
        + 'inside the workspace, or the Qaap preview/job stop action for a recorded process), or state in your final message '
        + 'exactly which command you propose and why, '
        + 'so the user can run or approve it themselves.',
    );
}

/**
 * Returns the deny message when a pending QAIQ `can_use_tool` request is a shell tool running a
 * destructive command; `undefined` means the request should proceed through the normal approval flow.
 */
export function findQaiqDestructiveCommandGuardDenial(request: QaapQaiqPendingControlRequest): string | undefined {
    if (!isShellToolName(request.toolName)) {
        return undefined;
    }
    const command = typeof request.toolInput?.command === 'string' ? request.toolInput.command : undefined;
    return isDestructiveShellCommand(command) ? buildDestructiveCommandDenyMessage() : undefined;
}
