// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { isShellToolName } from '@theia/qaap-mobile-shell/lib/common/qaap-transcript-preview-offer';
import type { QaapQaiqPendingControlRequest } from './qaap-qaiq-stdio-approvals';

/**
 * Guard against agents running destructive shell commands without an explicit user request.
 *
 * Mirrors `qaap-agent-dev-server-guard`: enforced on the QAIQ stdio `can_use_tool` control path,
 * so it is a hard denial whenever the CLI asks before running tools (`request-approval` /
 * `autoApprove === false`). Default headless runs (`--dangerously-skip-permissions`) never emit
 * control requests, so there the same policy rides the prompt as `[QAAP destructive commands]`.
 * TODO(qaiq): enforce these patterns inside the QAIQ CLI itself so headless runs get the hard
 * denial too (deny rules must win over bypassPermissions, Claude-Code-style).
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

/** `rm` invocations (optionally via sudo/env prefixes) — inspected further for -rf + dangerous targets. */
const RM_COMMAND_RE = /(?:^|&&|\|\||;|\|\s*|\(\s*|\b(?:sudo|nohup|exec)\s+)\s*rm\s+([^\n|&;]*)/gi;

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
    const text = command?.trim();
    if (!text) {
        return false;
    }
    if (
        GIT_FORCE_PUSH_RE.test(text)
        || GIT_REMOTE_DELETE_RE.test(text)
        || GIT_RESET_HARD_RE.test(text)
        || GIT_CLEAN_FORCE_RE.test(text)
        || GIT_BRANCH_FORCE_DELETE_RE.test(text)
        || GIT_HISTORY_REWRITE_RE.test(text)
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
    return 'Blocked by Qaap: this command is destructive (force push, remote/local branch force-delete, '
        + 'hard reset, forced clean, history rewrite, or rm -rf outside the workspace) and needs the user\'s '
        + 'explicit request. Do not retry it. Use the safe alternative (git stash, a normal push, a targeted rm '
        + 'inside the workspace), or state in your final message exactly which command you propose and why, '
        + 'so the user can run or approve it themselves.';
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
