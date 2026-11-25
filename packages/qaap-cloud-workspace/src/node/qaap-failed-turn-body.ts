// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { resolveAgentLogDisplayText } from '@theia/qaap-shared-core/lib/common/qaap-cli-transcript-stream';
import { structuredLogResidueText } from '@theia/qaap-shared-core/lib/common/qaap-structured-log-residue';
import { isOpencodeAgent } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import { detectAgentFailureKind, type QaapAgentFailureKind } from '@theia/qaap-shared-core/lib/common/qaap-agent-failure-message';
import { resolveAgentMessageSegments } from '@theia/qaap-shared-core/lib/common/qaap-transcript-trace-model';
import type { QaapAgentMessageDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';

/** An OpenCode `--format json` event line. */
const OPENCODE_JSON_EVENT_LINE = /^\s*\{\s*"type"\s*:/m;

/** The runner's note that the OpenCode gate probe failed (`qaap-agent-task-runner-timeline2.ts`). */
const OPENCODE_GATE_UNAVAILABLE_LINE = /^\[qaap\] OpenCode tool gate unavailable: .*(?:\r?\n|$)/gm;

/**
 * Failures the provider (or its account) decided before the agent could do anything: no tool was refused by the
 * gate, so the gate note would only read as the cause.
 */
const PROVIDER_SIDE_FAILURE_KINDS: ReadonlySet<QaapAgentFailureKind> = new Set<QaapAgentFailureKind>([
    'credits_exhausted',
    'model_access_disabled',
    'quota',
    'rate_limit',
    'auth',
    'model_unavailable',
    'tool_unsupported',
    'network',
    'provider_key_rejected',
    'provider_credits',
    'provider_data_policy',
    'provider_free_limit',
    'provider_rejected',
]);

function agentRequestedTool(message: Pick<QaapAgentMessageDTO, 'segments' | 'traceEvents' | 'role' | 'content'> | undefined): boolean {
    return !!message && resolveAgentMessageSegments(message).some(segment => segment.type === 'tool');
}

/**
 * Body stored on a failed turn's agent message (shown in the failure card's details). The OpenCode gate note is
 * dropped when the provider refused the turn before the agent requested any tool: the gate played no part, and
 * "never called tool.execute.before" read as the reason the turn failed. The full task log keeps the note.
 */
export function resolveFailedTurnBody(
    agentId: string,
    log: string | undefined,
    agentMessage?: Pick<QaapAgentMessageDTO, 'segments' | 'traceEvents' | 'role' | 'content'>,
): string {
    if (!log) {
        return '';
    }
    const kind = detectAgentFailureKind(log);
    let body = resolveAgentLogDisplayText(agentId, log);
    // An OpenCode run without a JSON event stream only printed diagnostics (`--print-logs`, runner notes): the
    // transcript never draws those as reply text, so the failed message keeps them whole for the card's details.
    if (!kind && isOpencodeAgent(agentId) && !OPENCODE_JSON_EVENT_LINE.test(log)) {
        body = structuredLogResidueText(log) || body;
    }
    OPENCODE_GATE_UNAVAILABLE_LINE.lastIndex = 0;
    if (!OPENCODE_GATE_UNAVAILABLE_LINE.test(body)) {
        return body;
    }
    if (!kind || !PROVIDER_SIDE_FAILURE_KINDS.has(kind) || agentRequestedTool(agentMessage)) {
        return body;
    }
    return body.replace(OPENCODE_GATE_UNAVAILABLE_LINE, '').trim();
}
