// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { inject, injectable } from '@theia/core/shared/inversify';
import {
    getConversation,
    type QaapAgentConversationSummaryDTO,
} from '../common/qaap-agent-conversation-client';
import { conversationEverRequestedDevPreview } from '../common/qaap-transcript-preview-offer';
import { MobileProjectsConversations } from './mobile-projects-conversations';
import { QaapProjectBootstrapService } from './qaap-project-bootstrap-service';
import { ensureTranscriptDevPreview } from './qaap-transcript-preview-bootstrap';

/**
 * When a background agent turn settles after a preview-related request, refresh project bootstrap
 * and open the dev preview without requiring the user to open the transcript or tap Run app.
 */
@injectable()
export class QaapAgentDevPreviewAutopilotContribution implements FrontendApplicationContribution {

    @inject(MobileProjectsConversations)
    protected readonly conversations: MobileProjectsConversations;

    @inject(QaapProjectBootstrapService)
    protected readonly bootstrap: QaapProjectBootstrapService;

    protected readonly priorStatus = new Map<string, QaapAgentConversationSummaryDTO['status']>();
    protected readonly autopilotInFlight = new Set<string>();

    onStart(): void {
        this.conversations.start();
        this.conversations.onDidChange(() => {
            void this.scanConversationSettlements();
        });
    }

    protected async scanConversationSettlements(): Promise<void> {
        for (const summary of this.conversations.listAllSummaries()) {
            const previous = this.priorStatus.get(summary.id);
            this.priorStatus.set(summary.id, summary.status);
            if (previous !== 'streaming' || summary.status === 'streaming' || summary.status === 'failed') {
                continue;
            }
            if (this.autopilotInFlight.has(summary.id)) {
                continue;
            }
            this.autopilotInFlight.add(summary.id);
            try {
                await this.maybeAutopilotPreview(summary);
            } finally {
                this.autopilotInFlight.delete(summary.id);
            }
        }
    }

    protected async maybeAutopilotPreview(summary: QaapAgentConversationSummaryDTO): Promise<void> {
        let conversation;
        try {
            conversation = await getConversation(summary.id);
        } catch {
            return;
        }
        if (!conversationEverRequestedDevPreview(conversation)) {
            return;
        }
        await this.bootstrap.refreshFromCurrentWorkspace();
        const readyUrl = await ensureTranscriptDevPreview(this.bootstrap);
        if (readyUrl) {
            await this.bootstrap.focusPreview().catch(() => undefined);
        }
    }
}
