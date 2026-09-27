// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// Types extracted from qaap-agent-task-runner.ts.

/** Built-in coding agents the runner can auto-detect on the server's PATH. */
export interface AgentCandidate {
    readonly id: string;
    readonly label: string;
    /** Executable name to look up on PATH (`which <bin>`). */
    readonly bin?: string;
    /** Template applied to the user prompt; `{prompt}` is replaced with a shell-quoted value. */
    readonly template: string;
    /** Whether this detected Codex CLI supports its current automatic approval flag. */
    readonly codexSupportsApproveForMe?: boolean;
}

/** Persisted task index format (versioned). */
export interface PersistedAgentTaskIndex {
    readonly version: number;
    readonly tasks: ReadonlyArray<import('../common/qaap-agent-task').QaapAgentTask>;
    readonly queuedRequests: Readonly<Record<string, import('../common/qaap-agent-task').QaapCreateAgentTaskRequest>>;
}
