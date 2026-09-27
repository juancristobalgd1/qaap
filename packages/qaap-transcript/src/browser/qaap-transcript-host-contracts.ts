// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentConversationDTO, QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { ExecutionSurfaceTabId } from '@theia/qaap-shared-core/lib/common/qaap-execution-surface-tabs';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';

/*
 * Structural contracts the transcript renderers use to reach UIs that live above them (the composer and the Work
 * Hub). The transcript hosts are typed with these instead of the concrete classes so the transcript layer never
 * imports upward; the concrete classes satisfy them structurally.
 */

/** Changed-file row shown in the composer Changes pill and the transcript activity. */
export interface StickyComposerChangedFileView {
    readonly path: string;
    readonly kind: 'edited' | 'created';
    readonly added?: number;
    readonly removed?: number;
    /** True once the change has been staged ("Accepted"). */
    readonly staged?: boolean;
}

/** Execution-surface tab strip (transcript / preview / files / terminal / review); implemented by `MobileProjectsExecutionSurfaceTabsUi`. */
export interface TranscriptExecutionSurfaceTabsApi {
    activeExecutionTab(project?: MobileProjectEntry): ExecutionSurfaceTabId;
    executionSurfaceTabForProject(project: MobileProjectEntry): ExecutionSurfaceTabId;
    setExecutionSurfaceTab(project: MobileProjectEntry, tab: ExecutionSurfaceTabId): void;
    syncExecutionSurfaceChrome(project: MobileProjectEntry): void;
    selectTranscriptTab(tab: ExecutionSurfaceTabId, project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): void;
    showOnlyExecutionSurfaceTab(tab: ExecutionSurfaceTabId): void;
    createTerminalAgentTuiSelect(): HTMLElement;
    mountTranscriptSurfaceTab(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, tab: ExecutionSurfaceTabId): void;
}

/** Sticky composer operations the transcript triggers; implemented by `MobileProjectsTranscriptStickyComposerUi`. */
export interface TranscriptStickyComposerApi {
    peekComposerGitChangedFiles(conversationId: string): readonly StickyComposerChangedFileView[] | undefined;
    refreshComposerActivityStack(): void;
    refreshComposerQuickActions(): void;
    refreshTranscriptComposerActivityIfNeeded(conv: QaapAgentConversationDTO): void;
    flushTranscriptFollowUpQueue(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): Promise<void>;
    applyTranscriptComposerPrefsFromConversation(conv: QaapAgentConversationDTO, project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): void;
    remountTranscriptStickyComposer(): void;
}

/** Project-row labels reused by the transcript and composer; implemented by `MobileProjectsProjectRowsUi`. */
export interface TranscriptProjectLabelsApi {
    localizeActivityLabel(label: string): string;
    resolveConversationAgentLabel(summary?: QaapAgentConversationSummaryDTO): string;
}

/** Result of creating a project chat session from the transcript submit path. */
export interface QaapProjectChatSessionCreated {
    readonly summary: QaapAgentConversationSummaryDTO;
    readonly outbound: string;
}
