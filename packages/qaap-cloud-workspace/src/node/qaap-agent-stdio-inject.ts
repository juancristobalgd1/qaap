// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { ChildProcess } from 'child_process';
import { buildQaiqStdioPromptLine } from '../common/qaap-qaiq-stdio-approvals';

export interface QaapStdioInjectHost {
    readonly qaiqStdioTasks: Set<string>;
    readonly processes: Map<string, ChildProcess>;
    readonly pendingQaiqControlRequests: {
        get(taskId: string): ReadonlyArray<unknown> | undefined;
    };
}

/**
 * Write a follow-up user message into a live `--input-format stream-json` agent.
 * Returns false when stdin is not a QAIQ/stream-json pipe (the queue waits for end of turn).
 */
export function injectStdioUserMessageExtracted(
    ctx: QaapStdioInjectHost,
    taskId: string,
    content: string,
): boolean {
    const prompt = content.trim();
    if (!prompt || !ctx.qaiqStdioTasks.has(taskId)) {
        return false;
    }
    if (ctx.pendingQaiqControlRequests.get(taskId)?.length) {
        return false;
    }
    const stdin = ctx.processes.get(taskId)?.stdin;
    if (!stdin || stdin.destroyed || !stdin.writable) {
        return false;
    }
    try {
        stdin.write(buildQaiqStdioPromptLine(prompt));
        return true;
    } catch {
        return false;
    }
}
