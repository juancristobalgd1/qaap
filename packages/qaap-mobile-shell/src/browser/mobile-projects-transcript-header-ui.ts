// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { type QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import {
    type MobileProjectEntry,
} from './mobile-projects-types';

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

}
