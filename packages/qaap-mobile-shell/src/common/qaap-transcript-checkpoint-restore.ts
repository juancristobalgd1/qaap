// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentConversationDTO, QaapConversationCheckpointDTO } from './qaap-agent-conversation-client';

/** Latest git snapshot that can roll the workspace back (newest checkpoint with a commit). */
export function resolveLatestRestorableCheckpoint(
    conv: Pick<QaapAgentConversationDTO, 'checkpoints' | 'status'> | undefined,
): QaapConversationCheckpointDTO | undefined {
    if (!conv || conv.status === 'streaming') {
        return undefined;
    }
    const checkpoints = conv.checkpoints ?? [];
    if (!checkpoints.length) {
        return undefined;
    }
    return [...checkpoints].reverse().find(checkpoint => !!checkpoint.id && !!checkpoint.commit?.trim());
}

export function canRestoreConversationCheckpoint(
    conv: Pick<QaapAgentConversationDTO, 'checkpoints' | 'status'> | undefined,
    checkpointId: string,
): boolean {
    if (!conv || conv.status === 'streaming' || !checkpointId.trim()) {
        return false;
    }
    return (conv.checkpoints ?? []).some(
        checkpoint => checkpoint.id === checkpointId && !!checkpoint.commit?.trim(),
    );
}

export interface TranscriptActivityCheckpointAnnotatable {
    readonly state: string;
    readonly errorSummary?: string;
    readonly checkpointId?: string;
    readonly timestamp?: number;
}

function resolveRestorableCheckpointBeforeTimestamp(
    checkpoints: readonly QaapConversationCheckpointDTO[],
    timestamp: number | undefined,
): string | undefined {
    if (timestamp === undefined) {
        return undefined;
    }
    let match: QaapConversationCheckpointDTO | undefined;
    for (const checkpoint of checkpoints) {
        if (!checkpoint.id || !checkpoint.commit?.trim()) {
            continue;
        }
        if (checkpoint.capturedAt <= timestamp) {
            match = checkpoint;
        }
    }
    return match?.id;
}

/** Attach the latest prior git snapshot to error rows so restore is available at the failure point. */
export function annotateTranscriptActivityCheckpointIds<T extends TranscriptActivityCheckpointAnnotatable>(
    items: readonly T[],
    conv: Pick<QaapAgentConversationDTO, 'checkpoints' | 'status'> | undefined,
): T[] {
    if (!items.length) {
        return [...items];
    }
    const restorableCheckpoints = (conv?.checkpoints ?? []).filter(checkpoint => !!checkpoint.id && !!checkpoint.commit?.trim());
    let lastCheckpointId: string | undefined;
    return items.map(item => {
        if (item.checkpointId && canRestoreConversationCheckpoint(conv, item.checkpointId)) {
            lastCheckpointId = item.checkpointId;
            return item;
        }
        if (item.state !== 'error' || item.checkpointId || !item.errorSummary) {
            return item;
        }
        const checkpointId = lastCheckpointId
            ?? resolveRestorableCheckpointBeforeTimestamp(restorableCheckpoints, item.timestamp)
            ?? resolveLatestRestorableCheckpoint(conv)?.id;
        if (!checkpointId || !canRestoreConversationCheckpoint(conv, checkpointId)) {
            return item;
        }
        return { ...item, checkpointId };
    });
}
