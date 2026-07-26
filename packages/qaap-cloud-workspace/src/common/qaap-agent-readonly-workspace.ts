// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Read-only workspace enforcement for a dispatched agent turn.
 *
 * A workflow node that declares `isolation: 'cwd-readonly'` (an explorer, a judge) must not be able
 * to modify the repository it is reading. Before this module that constraint existed only as English
 * inside the prompt, and it was violated in practice: a judge turn emitted four `Write` calls, one of
 * them into `src/auth/session.ts`. A judge that can edit what it reviews does not produce an
 * independent verdict, it produces a self-certification.
 *
 * The guarantee is per backend, and this module is deliberately explicit about how strong it is:
 *
 * - `'sandbox'` — the CLI runs under an OS-level read-only sandbox (Codex `--sandbox read-only`).
 *   Every write path is closed, including writes attempted from a shell command. Complete.
 * - `'tool-deny'` — the CLI is launched without any workspace-mutating tool: the write tools are
 *   removed from the tool set (Claude-family `--disallowed-tools`, QAIQ `--tools` allowlist) AND the
 *   shell is removed with them, because leaving `Bash` in place makes the denial trivially
 *   bypassable with a `>` redirect and the "guarantee" fiction. Complete at the CLI layer, but it is
 *   the CLI enforcing its own contract rather than the kernel enforcing it on the CLI.
 * - `'none'` — the backend exposes no mechanism we can verify (Grok `--always-approve`, Copilot
 *   `--yolo`, Qwen `--approval-mode yolo`, Goose, Hermes, Cursor, Kimi, OpenClaw, Antigravity, and
 *   any operator-defined `QAAP_AGENT_COMMANDS` entry). Nothing is injected and nothing is claimed.
 *
 * Callers route AWAY from `'none'` backends for read-only nodes ({@link canEnforceReadOnlyWorkspace})
 * and record what they actually got, so a partial guarantee stays visible instead of being disguised
 * as a full one.
 */

import { QAAP_QAIQ_BLOCKED_HEADLESS_TOOLS, formatQaiqCoreToolsFlag } from './qaap-qaiq-tool-policy';

/** How strongly a backend can be held to "do not modify the workspace". */
export type QaapAgentReadOnlyEnforcement =
    /** OS-level sandbox: writes fail even from a shell command. */
    | 'sandbox'
    /** The CLI is launched without write tools and without a shell. */
    | 'tool-deny'
    /** No verified mechanism — the turn is unrestricted and must be reported as such. */
    | 'none';

const ENFORCEMENT_BY_AGENT: Readonly<Record<string, QaapAgentReadOnlyEnforcement>> = {
    codex: 'sandbox',
    claude: 'tool-deny',
    qaiq: 'tool-deny',
    // Legacy binary name for the same CLI, still accepted by the runner's detection.
    openclaude: 'tool-deny',
};

/** Codex enforces read-only in the kernel sandbox; `never` keeps the headless run from stalling. */
export const QAAP_READONLY_CODEX_FLAGS = '--sandbox read-only --ask-for-approval never';

/**
 * Claude Code: the write tools and the shell are denied outright, and the surviving read tools are
 * pre-approved so a `--print` run does not stall on a permission prompt it cannot answer.
 */
export const QAAP_READONLY_CLAUDE_FLAGS =
    '--permission-mode default'
    + ' --allowed-tools Read Grep Glob WebFetch WebSearch'
    + ' --disallowed-tools Edit Write MultiEdit NotebookEdit Bash';

/** Write / delegation tools removed from the QAIQ launch on a read-only turn. */
export const QAAP_QAIQ_READONLY_DENIED_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'Agent'] as const;

/**
 * QAIQ: the `--tools` allowlist is the restriction (the CLI never receives a write tool), the
 * `--disallowed-tools` list is the backstop, and `--dangerously-skip-permissions` only keeps the
 * surviving read tools from pausing for an approval nobody is there to give.
 */
export function formatQaiqReadOnlyFlags(): string {
    const denied = [...QAAP_QAIQ_BLOCKED_HEADLESS_TOOLS.split(','), ...QAAP_QAIQ_READONLY_DENIED_TOOLS];
    return '--dangerously-skip-permissions'
        + ` ${formatQaiqCoreToolsFlag({ shell: false, write: false })}`
        + ` --disallowed-tools ${[...new Set(denied)].join(',')}`;
}

export function resolveAgentReadOnlyEnforcement(agentId: string | undefined): QaapAgentReadOnlyEnforcement {
    const normalized = agentId?.trim().toLowerCase();
    return (normalized && ENFORCEMENT_BY_AGENT[normalized]) || 'none';
}

/** True when a read-only turn dispatched to this backend is actually restricted, not just asked to behave. */
export function canEnforceReadOnlyWorkspace(agentId: string | undefined): boolean {
    return resolveAgentReadOnlyEnforcement(agentId) !== 'none';
}

/**
 * The CLI flags that make a turn read-only for this backend, or `undefined` when the backend has no
 * mechanism. Returning `undefined` rather than a best-effort string is the point: the caller has to
 * decide what to do about an unenforceable turn instead of shipping a flag that proves nothing.
 */
export function formatReadOnlyFlagsForAgent(agentId: string | undefined): string | undefined {
    switch (resolveAgentReadOnlyEnforcement(agentId)) {
        case 'sandbox':
            return QAAP_READONLY_CODEX_FLAGS;
        case 'tool-deny':
            return agentId?.trim().toLowerCase() === 'claude'
                ? QAAP_READONLY_CLAUDE_FLAGS
                : formatQaiqReadOnlyFlags();
        default:
            return undefined;
    }
}
