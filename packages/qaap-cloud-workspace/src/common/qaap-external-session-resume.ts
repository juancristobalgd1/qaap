// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    QAAP_EXTERNAL_SESSION_NATIVE_RESUME_SOURCES,
    type QaapExternalSessionSource,
} from '@theia/qaap-shared-core/lib/common/qaap-external-session-protocol';
import type { QaapAgentConversation } from './qaap-agent-conversation';

/** A turn that continues the imported CLI session natively instead of replaying the history in the prompt. */
export interface QaapExternalNativeResume {
    readonly source: QaapExternalSessionSource;
    readonly sessionId: string;
}

/**
 * Whether the turn of `turnUserMessageId` (default: the last message) can resume the CLI session the
 * conversation was imported from: the turn runs on that same CLI, and so did every user turn posted since
 * the import — otherwise the CLI session is missing part of the thread and the history replay is used.
 * See `doc/qaap-external-session-import.md`.
 */
export function resolveQaapExternalNativeResume(
    conv: Pick<QaapAgentConversation, 'externalSession' | 'messages'>,
    turnAgentId: string,
    turnUserMessageId?: string,
): QaapExternalNativeResume | undefined {
    const origin = conv.externalSession;
    const agent = turnAgentId.trim().toLowerCase();
    if (!origin || origin.source !== agent || !QAAP_EXTERNAL_SESSION_NATIVE_RESUME_SOURCES.has(origin.source)) {
        return undefined;
    }
    const currentId = turnUserMessageId ?? conv.messages[conv.messages.length - 1]?.id;
    const sinceImport = conv.messages.slice(origin.importedMessageCount);
    const allOnSameCli = sinceImport.every(message => message.role !== 'user'
        || message.id === currentId
        || message.turnAgentId?.trim().toLowerCase() === origin.source);
    return allOnSameCli ? { source: origin.source, sessionId: origin.sessionId } : undefined;
}

/**
 * Rewrites a built agent command so the CLI resumes `sessionId`. Returns the command unchanged when the
 * agent cannot resume natively or the command does not have the expected shape.
 *
 * - Claude Code: `claude --resume <id> …` (the session keeps its id).
 * - Codex: `codex [global flags] exec [exec flags] resume <id> -` — exec flags must come before `resume`,
 *   whose own parser rejects most of them; the prompt stays on stdin.
 */
export function applyQaapNativeResumeToCommand(command: string, agentId: string, sessionId: string): string {
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(sessionId)) {
        return command;
    }
    const agent = agentId.trim().toLowerCase();
    if (agent === 'claude') {
        const claude = /^(\s*(?:\S*\/)?claude)(?=\s|$)/;
        return claude.test(command) && !/\s--resume\s/.test(command)
            ? command.replace(claude, `$1 --resume ${sessionId}`)
            : command;
    }
    if (agent === 'codex') {
        if (!/^\s*(?:\S*\/)?codex\b.*\sexec\s/.test(command) || /\sresume\s/.test(command)) {
            return command;
        }
        return /\s-\s*$/.test(command)
            ? command.replace(/\s-\s*$/, ` resume ${sessionId} -`)
            : `${command} resume ${sessionId}`;
    }
    return command;
}
