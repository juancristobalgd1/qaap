// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { FrontendApplicationStateService } from '@theia/core/lib/browser/frontend-application-state';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { nls } from '@theia/core/lib/common/nls';
import { inject, injectable } from '@theia/core/shared/inversify';
import { QaapWorkHubDiffService } from './qaap-work-hub-diff-service';

/** Opens the Work Hub diff-review surface (multi-project tabs when applicable). */
export const QAAP_OPEN_DIFF_REVIEW: Command = {
    id: 'qaap.diff.openReview',
    label: nls.localize('qaap/diff/openReview', 'Review Working Changes'),
};

const DIFF_REVIEW_ROUTE = 'diff-review';

@injectable()
export class QaapDiffReviewContribution implements CommandContribution, FrontendApplicationContribution {

    @inject(QaapWorkHubDiffService)
    protected readonly workHubDiff: QaapWorkHubDiffService;

    @inject(FrontendApplicationStateService)
    protected readonly frontendState: FrontendApplicationStateService;

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(QAAP_OPEN_DIFF_REVIEW, {
            execute: () => this.workHubDiff.openDiffInWorkHub(),
        });
    }

    onStart(): void {
        // Defer until the shell is up: the Work Hub delegate registers in another
        // contribution's onStart, and mounting the hub before layout ready races the boot guard.
        void this.frontendState.reachedState('ready').then(() => this.consumeRouteFromUrl());
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
        if (data && data.type === 'qaap-notification-route' && data.route === DIFF_REVIEW_ROUTE) {
            this.openFromNotification(data.conversationId, data.cwd);
        }
    };

    protected consumeRouteFromUrl(): void {
        const params = new URLSearchParams(window.location.search);
        if (params.get('qaap_route') !== DIFF_REVIEW_ROUTE) {
            return;
        }
        const conversationId = params.get('qaap_conversation') ?? undefined;
        const cwd = params.get('qaap_cwd') ?? undefined;
        params.delete('qaap_route');
        params.delete('qaap_conversation');
        params.delete('qaap_cwd');
        const search = params.toString();
        window.history.replaceState({}, '', window.location.pathname + (search ? `?${search}` : '') + window.location.hash);
        this.openFromNotification(conversationId, cwd);
    }

    /** Notification deep-link: land on the agent session in the Work Hub, never the IDE panel. */
    protected openFromNotification(conversationId?: string, cwd?: string): void {
        if (conversationId) {
            void this.workHubDiff.openConversationInWorkHub(conversationId, cwd);
            return;
        }
        void this.workHubDiff.openDiffInWorkHub();
    }
}
