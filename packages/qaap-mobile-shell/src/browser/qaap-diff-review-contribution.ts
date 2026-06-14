// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { nls } from '@theia/core/lib/common/nls';
import { inject, injectable } from '@theia/core/shared/inversify';
import { QaapWorkHubDiffService } from './qaap-work-hub-diff-service';
import { QaapWorkHubTranscriptDeepLinkService } from './qaap-work-hub-transcript-deeplink-service';

/** Opens the Work Hub diff-review surface (multi-project tabs when applicable). */
export const QAAP_OPEN_DIFF_REVIEW: Command = {
    id: 'qaap.diff.openReview',
    label: nls.localize('qaap/diff/openReview', 'Review Working Changes'),
};

const DIFF_REVIEW_ROUTE = 'diff-review';
const TRANSCRIPT_ROUTE = 'transcript';

@injectable()
export class QaapDiffReviewContribution implements CommandContribution, FrontendApplicationContribution {

    @inject(QaapWorkHubDiffService)
    protected readonly workHubDiff: QaapWorkHubDiffService;

    @inject(QaapWorkHubTranscriptDeepLinkService)
    protected readonly transcriptDeepLink: QaapWorkHubTranscriptDeepLinkService;

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(QAAP_OPEN_DIFF_REVIEW, {
            execute: () => this.workHubDiff.openDiffInWorkHub(),
        });
    }

    onStart(): void {
        this.consumeRouteFromUrl();
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.addEventListener('message', this.onServiceWorkerMessage);
        }
    }

    onStop(): void {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.removeEventListener('message', this.onServiceWorkerMessage);
        }
    }

    protected readonly onServiceWorkerMessage = (event: MessageEvent): void => {
        const data = event.data;
        if (!data || data.type !== 'qaap-notification-route') {
            return;
        }
        if (data.route === DIFF_REVIEW_ROUTE) {
            void this.workHubDiff.openDiffInWorkHub();
            return;
        }
        if (data.route === TRANSCRIPT_ROUTE && data.conversationId) {
            void this.transcriptDeepLink.openConversationById(String(data.conversationId));
        }
    };

    protected consumeRouteFromUrl(): void {
        const params = new URLSearchParams(window.location.search);
        const route = params.get('qaap_route');
        const conversationId = params.get('qaap_conversation');
        if (route === DIFF_REVIEW_ROUTE) {
            params.delete('qaap_route');
            const search = params.toString();
            window.history.replaceState({}, '', window.location.pathname + (search ? `?${search}` : '') + window.location.hash);
            void this.workHubDiff.openDiffInWorkHub();
            return;
        }
        if (route === TRANSCRIPT_ROUTE && conversationId) {
            params.delete('qaap_route');
            params.delete('qaap_conversation');
            const search = params.toString();
            window.history.replaceState({}, '', window.location.pathname + (search ? `?${search}` : '') + window.location.hash);
            void this.transcriptDeepLink.openConversationById(conversationId);
        }
    }
}
