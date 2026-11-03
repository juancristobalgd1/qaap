// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';

/**
 * Where a composer submit goes, decided from the composer's live target versus the summary its
 * mount closure captured:
 * - `closure`: the closure summary is the target (normal follow-up, idle shell, legacy/pending).
 * - `live`: the composer now targets another summary (for example the isolated parallel child the
 *   backend just created, or a task adopted after mount); send there.
 * - `newTask`: the live target was cleared (the "New task" reset) while the closure still holds a
 *   real conversation; the prompt starts a new task instead of landing in the previous one.
 */
export type ComposerSubmitTarget = 'closure' | 'live' | 'newTask';

export function resolveComposerSubmitTarget(
    closureSummary: QaapAgentConversationSummaryDTO,
    liveSummary: QaapAgentConversationSummaryDTO | undefined,
): ComposerSubmitTarget {
    if (closureSummary.source === 'theia-chat' || closureSummary.id.startsWith('pending-new-chat-')) {
        return 'closure';
    }
    if (liveSummary === undefined) {
        return 'newTask';
    }
    return liveSummary.id === closureSummary.id ? 'closure' : 'live';
}
