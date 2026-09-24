// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';

export interface QaapWorkHubDiffDelegate {
    /** Opens the Work Hub with the agent session that raised a push notification. */
    openConversationInWorkHub(conversationId: string, cwd?: string): Promise<void>;
}

type QaapWorkHubOpenRequest = { readonly kind: 'conversation'; readonly conversationId: string; readonly cwd?: string };

/** Bridges notification deep-links to the mobile Work Hub panel. */
@injectable()
export class QaapWorkHubDiffService {

    protected delegate: QaapWorkHubDiffDelegate | undefined;

    /**
     * Request received before the shell registered its delegate (e.g. `qaap_route` consumed
     * at onStart). Flushed once the delegate arrives so early notification taps are not lost.
     */
    protected pending: QaapWorkHubOpenRequest | undefined;

    setDelegate(delegate: QaapWorkHubDiffDelegate | undefined): void {
        this.delegate = delegate;
        const pending = this.pending;
        this.pending = undefined;
        if (delegate && pending) {
            void this.dispatch(delegate, pending);
        }
    }

    /** Notification deep-link: open the originating agent session in the Work Hub. */
    async openConversationInWorkHub(conversationId: string, cwd?: string): Promise<void> {
        if (!this.delegate) {
            this.pending = { kind: 'conversation', conversationId, cwd };
            return;
        }
        await this.dispatch(this.delegate, { kind: 'conversation', conversationId, cwd });
    }

    protected async dispatch(delegate: QaapWorkHubDiffDelegate, request: QaapWorkHubOpenRequest): Promise<void> {
        await delegate.openConversationInWorkHub(request.conversationId, request.cwd);
    }
}
