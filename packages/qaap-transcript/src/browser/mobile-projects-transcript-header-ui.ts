// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { type QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import {
    type MobileProjectEntry,
} from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';

/** Panel surface for active-chat header chrome refresh. */
export interface MobileProjectsTranscriptHeaderHost {
    transcriptComposerSendRefresh: (() => void) | undefined;

}

/** Transcript execution header helpers (title + composer sync). */
export class MobileProjectsTranscriptHeaderUi {

    constructor(
        protected readonly host: MobileProjectsTranscriptHeaderHost,
    ) { }

    /** Keep composer send/stop controls in sync during live SSE. */
    refreshTranscriptExecutionChrome(): void {
        this.host.transcriptComposerSendRefresh?.();
    }

    isPendingNewChatSummary(summary: QaapAgentConversationSummaryDTO): boolean {
        return summary.id.startsWith('pending-new-chat-');
    }

    resolveTranscriptHeaderTitle(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): string {
        const title = summary.title?.trim();
        if (!title || title === project.name) {
            return project.name;
        }
        return nls.localize('qaap/mobileProjects/chatHeaderProjectTitle', '{0} · {1}', project.name, title);
    }

    renderTranscriptWorkspaceContext(
        target: HTMLElement,
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): void {
        const cwd = summary.cwd?.trim();
        if (!cwd) {
            target.hidden = true;
            target.replaceChildren();
            return;
        }

        const normalizedCwd = cwd.replace(/\\/g, '/');
        const workspaceName = normalizedCwd.split('/').filter(Boolean).pop() ?? cwd;
        const isTemporary = /^cloud-ws-/i.test(workspaceName);
        const contextLabel = document.createElement('span');
        contextLabel.className = 'qaap-transcript-workspace-context-label';
        contextLabel.textContent = isTemporary
            ? nls.localize('qaap/mobileProjects/transcriptTemporaryWorkspace', 'Temporary workspace')
            : nls.localize('qaap/mobileProjects/transcriptWorkspace', 'Workspace');
        const path = document.createElement('span');
        path.className = 'qaap-transcript-workspace-context-path';
        path.textContent = cwd;

        target.hidden = false;
        target.classList.toggle('theia-mod-temporary', isTemporary);
        target.replaceChildren(contextLabel, path);
        target.title = nls.localize(
            'qaap/mobileProjects/transcriptWorkspaceDetails',
            'Project: {0} · Working directory: {1}',
            project.name,
            cwd,
        );
        target.setAttribute('aria-label', target.title);
        target.dataset.workspaceCwd = cwd;
        target.dataset.projectName = project.name;
    }

}
