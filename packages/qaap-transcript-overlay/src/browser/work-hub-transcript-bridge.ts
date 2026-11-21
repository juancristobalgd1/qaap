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

/** A GitHub pull request mentioned in the transcript (the repository it belongs to, its number and page). */
export interface WorkHubTranscriptPullRequestRef {
    readonly owner: string;
    readonly repo: string;
    readonly number: number;
    /** `https://github.com/<owner>/<repo>/pull/<number>`: the fallback when no Work Hub view can show it. */
    readonly url: string;
}

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
    createAgentsHubQuickActionsBlock(): HTMLElement;
    /** Discreet first-step suggestions shown under the empty-chat welcome line. */
    createEmptyWelcomeHints?(): HTMLElement | undefined;
    /**
     * Shows exactly this pull request (not the branch's one): the desktop right panel's "Pull request"
     * tab, or the Work Hub pull request detail on mobile. Returns `false` when nothing could show it, so
     * the caller opens the GitHub page instead.
     */
    openPullRequestInPanel?(ref: WorkHubTranscriptPullRequestRef): boolean;
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
