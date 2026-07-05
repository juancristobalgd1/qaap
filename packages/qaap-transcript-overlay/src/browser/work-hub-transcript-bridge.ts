// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type {
    QaapAgentConversationDTO,
    QaapAgentConversationSummaryDTO,
    QaapTranscriptUserImagePreview,
} from '../common/qaap-transcript-agent-types';
import type { MobileProjectEntry } from '../common/qaap-transcript-project-entry';

/**
 * Explicit Work Hub surface used by the transcript overlay cluster (Phase 3).
 * Replaces ad-hoc `this.host.renderList()` / agents-hub calls from transcript `*Ui` modules.
 */
export interface WorkHubTranscriptBridge {
    isAgentsHubLanding(): boolean;
    isProjectDetailView(): boolean;
    shouldEmbedAgentsHubRecentsInWorkspaceTranscript(): boolean;
    openInlineTranscript(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): Promise<void>;
    refreshHubChrome(): void;
    refreshHubSubtitle(): void;
    closeAgentsHubSession(): void;
    teardownAgentsHubShell(): void;
    refreshHubBottomBar(): void;
    renderTeamSectionInTranscript(host: HTMLElement, conv: QaapAgentConversationDTO): void;
    renderInlineApproval(host: HTMLElement, conv: QaapAgentConversationDTO): void;
    createAgentsHubRecentsBlock(project: MobileProjectEntry): HTMLElement;
    createAgentsHubLandingHeroBlock(): HTMLElement;
    createAgentsHubQuickActionsBlock(): HTMLElement;
    /** Freshest hub shell project (agents-hub landing), if any — used for submit-time re-resolution. */
    resolveShellProject(): MobileProjectEntry | undefined;
    /** Idle shell summary for the given hub project, if one exists. */
    resolveShellSummary(project: MobileProjectEntry): QaapAgentConversationSummaryDTO | undefined;
    renderIdleSubmitOptimistic(
        chatHost: HTMLElement,
        summary: QaapAgentConversationSummaryDTO,
        draft: string,
        selectedAgentId: string,
        imagePreviews?: readonly QaapTranscriptUserImagePreview[],
    ): void;
}
