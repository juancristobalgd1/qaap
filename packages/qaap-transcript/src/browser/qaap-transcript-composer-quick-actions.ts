// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentConversationDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import {
    resolveTranscriptComposerQuickActionsMode,
    type TranscriptComposerQuickActionsMode,
} from '@theia/qaap-shared-core/lib/common/qaap-transcript-turn-status';

/** Host fields the quick-actions sync reads; the transcript host satisfies this structurally. */
export interface TranscriptComposerQuickActionsSource {
    readonly transcriptComposerHost?: HTMLElement;
    readonly transcriptPreviewRequestRunning?: boolean;
    readonly transcriptPreviewRequestPending?: boolean;
}

/** Writes the composer quick-actions mode onto the composer host as CSS state classes. */
export function applyTranscriptComposerQuickActionsMode(
    composerHost: HTMLElement | undefined,
    mode: TranscriptComposerQuickActionsMode,
): void {
    composerHost?.classList.toggle('theia-mod-show-quick-actions', mode !== 'hidden');
    composerHost?.classList.toggle('theia-mod-quick-actions-preview-only', mode === 'preview-only');
}

/** Recomputes the quick-actions mode for `conv` from the transcript host state and applies it. */
export function syncTranscriptComposerQuickActions(
    source: TranscriptComposerQuickActionsSource,
    conv: QaapAgentConversationDTO,
    cached?: Pick<QaapAgentConversationDTO, 'id' | 'messages'>,
): void {
    const previewStarting = !!source.transcriptPreviewRequestRunning || !!source.transcriptPreviewRequestPending;
    applyTranscriptComposerQuickActionsMode(
        source.transcriptComposerHost,
        resolveTranscriptComposerQuickActionsMode(conv, cached, previewStarting),
    );
}
