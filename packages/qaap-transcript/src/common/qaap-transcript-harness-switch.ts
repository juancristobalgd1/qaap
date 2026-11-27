// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// ─── Harness switch points (pure) ─────────────────────────────────────────────
//
// A conversation can change harness (agent CLI) between turns: Claude Code → Codex,
// OpenCode → Antigravity, ... The user message that triggered a turn carries the
// harness that actually ran it (`turnAgentId`, sealed by the backend), so the switch
// points are the user turns whose harness differs from the previous sealed turn.
// A model-only change inside the same harness is NOT a switch.

import type { QaapAgentMessageDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { QaapCreateAgentTaskQaiqModel } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import { normalizeAgentBrandId } from '@theia/qaap-shared-core/lib/common/qaap-agent-branding';

/** The harness (and, when reported, the model) a turn ran on or will run on. */
export interface TranscriptHarnessTurnRef {
    readonly agentId: string;
    readonly model?: QaapCreateAgentTaskQaiqModel;
}

/** A harness change between two turns of one conversation. */
export interface TranscriptHarnessSwitch {
    readonly from: TranscriptHarnessTurnRef;
    readonly to: TranscriptHarnessTurnRef;
}

/** The message fields the switch computation reads. */
export type TranscriptHarnessMessage = Pick<QaapAgentMessageDTO, 'role' | 'turnAgentId' | 'turnAgentModel'>;

/** Composer selections that are not a harness (legacy task runner, empty). */
const NON_HARNESS_SELECTIONS = new Set(['', 'task']);

/** Canonical harness id for comparisons: aliases (`cursor-agent` → `cursor`, `gemini` → `antigravity`) collapse. */
export function normalizeTranscriptHarnessId(agentId: string | undefined): string | undefined {
    const normalized = normalizeAgentBrandId(agentId);
    return normalized && !NON_HARNESS_SELECTIONS.has(normalized) ? normalized : undefined;
}

function sealedTurnRef(message: TranscriptHarnessMessage): TranscriptHarnessTurnRef | undefined {
    if (message.role !== 'user' || !normalizeTranscriptHarnessId(message.turnAgentId)) {
        return undefined;
    }
    return { agentId: message.turnAgentId!.trim(), model: message.turnAgentModel };
}

/**
 * Index of each user message whose turn ran on a different harness than the previous sealed turn,
 * mapped to that switch. Turns without provenance (historical rows, a turn not sealed yet) are
 * skipped: they neither create a switch nor reset the previous harness.
 */
export function resolveTranscriptHarnessSwitches(
    messages: readonly TranscriptHarnessMessage[],
): ReadonlyMap<number, TranscriptHarnessSwitch> {
    const switches = new Map<number, TranscriptHarnessSwitch>();
    let previous: TranscriptHarnessTurnRef | undefined;
    messages.forEach((message, index) => {
        const turn = sealedTurnRef(message);
        if (!turn) {
            return;
        }
        if (previous && normalizeTranscriptHarnessId(previous.agentId) !== normalizeTranscriptHarnessId(turn.agentId)) {
            switches.set(index, { from: previous, to: turn });
        }
        previous = turn;
    });
    return switches;
}

/**
 * The switch the composer has queued for the next turn: the harness selected in the composer differs
 * from the harness of the last sealed turn. Undefined when the conversation has no sealed turn yet
 * (nothing to hand off from), when the selection is the same harness (a model-only change), while
 * the latest user turn is still unsealed — that turn is already on its way and its own divider appears
 * once the backend records which harness ran it — or when a turn failed after the conversation already
 * switched to the selected harness.
 */
export function resolveTranscriptPendingHarnessSwitch(
    messages: readonly TranscriptHarnessMessage[],
    selection: TranscriptHarnessTurnRef | undefined,
    options?: {
        readonly conversationStatus?: string;
        readonly conversationAgentId?: string;
    },
): TranscriptHarnessSwitch | undefined {
    const selectedId = normalizeTranscriptHarnessId(selection?.agentId);
    if (!selection || !selectedId) {
        return undefined;
    }
    if (
        options?.conversationStatus === 'failed'
        && normalizeTranscriptHarnessId(options.conversationAgentId) === selectedId
    ) {
        return undefined;
    }
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index];
        if (message.role !== 'user') {
            continue;
        }
        const turn = sealedTurnRef(message);
        if (!turn) {
            // The latest user turn has no provenance yet: it is in flight (or predates provenance).
            return undefined;
        }
        return normalizeTranscriptHarnessId(turn.agentId) === selectedId
            ? undefined
            : { from: turn, to: { agentId: selection.agentId.trim(), model: selection.model } };
    }
    return undefined;
}

/** Idempotency key for a rendered switch row (harness + model of both ends, and the pending state). */
export function transcriptHarnessSwitchKey(harnessSwitch: TranscriptHarnessSwitch, pending: boolean): string {
    const ref = (turn: TranscriptHarnessTurnRef): string => `${turn.agentId}/${turn.model?.vendor ?? ''}/${turn.model?.modelId ?? ''}`;
    return `${pending ? 'pending' : 'settled'}::${ref(harnessSwitch.from)}::${ref(harnessSwitch.to)}`;
}
