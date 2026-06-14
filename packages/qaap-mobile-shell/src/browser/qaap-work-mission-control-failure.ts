// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import {
    detectAgentFailureKind,
    formatStoredAgentFailureMessage,
    localizeAgentFailureMessage,
    type QaapAgentFailureKind,
} from '../common/qaap-agent-failure-message';

export interface MissionControlFailureResolution {
    readonly kind?: QaapAgentFailureKind;
    readonly preview?: string;
}

/** Derive mission-control failure hints from a conversation summary row. */
export function resolveMissionControlFailure(
    summary: QaapAgentConversationSummaryDTO,
): MissionControlFailureResolution | undefined {
    if (summary.status !== 'failed') {
        return undefined;
    }
    const sample = [
        summary.lastMessagePreview,
        summary.title,
        summary.activityLabel,
    ].filter(part => !!part?.trim()).join('\n');
    const kind = detectAgentFailureKind(sample);
    if (kind) {
        return {
            kind,
            preview: localizeAgentFailureMessage(kind),
        };
    }
    const stored = formatStoredAgentFailureMessage(summary.lastMessagePreview);
    if (stored) {
        return { preview: stored };
    }
    return undefined;
}
