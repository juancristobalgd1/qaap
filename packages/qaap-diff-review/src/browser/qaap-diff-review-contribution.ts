// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { FrontendApplicationStateService } from '@theia/core/lib/browser/frontend-application-state';
import { inject, injectable } from '@theia/core/shared/inversify';
import { QaapWorkHubDiffService } from './qaap-work-hub-diff-service';

@injectable()
export class QaapDiffReviewContribution implements FrontendApplicationContribution {

    @inject(QaapWorkHubDiffService)
    protected readonly workHubDiff: QaapWorkHubDiffService;

    @inject(FrontendApplicationStateService)
    protected readonly frontendState: FrontendApplicationStateService;

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
        if (data && data.type === 'qaap-notification-route' && data.conversationId) {
            this.openFromNotification(data.conversationId, data.cwd);
        }
    };

    protected consumeRouteFromUrl(): void {
        const params = new URLSearchParams(window.location.search);
        const route = params.get('qaap_route');
        const conversationId = params.get('qaap_conversation') ?? undefined;
        if (!route && !conversationId) {
            return;
        }
        const cwd = params.get('qaap_cwd') ?? undefined;
        params.delete('qaap_route');
        params.delete('qaap_conversation');
        params.delete('qaap_cwd');
        const search = params.toString();
        window.history.replaceState({}, '', window.location.pathname + (search ? `?${search}` : '') + window.location.hash);
        if (conversationId) {
            this.openFromNotification(conversationId, cwd);
        }
    }

    /** Notification deep-link: land on the originating agent session in the Work Hub. */
    protected openFromNotification(conversationId: string, cwd?: string): void {
        void this.workHubDiff.openConversationInWorkHub(conversationId, cwd);
    }
}
