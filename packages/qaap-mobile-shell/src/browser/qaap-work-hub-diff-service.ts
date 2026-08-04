// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';

export interface QaapWorkHubDiffDelegate {
    openDiffInWorkHub(projectId?: string): Promise<void>;
    /** Opens the Work Hub with the agent session that raised a push notification. */
    openConversationInWorkHub?(conversationId: string, cwd?: string): Promise<void>;
}

type QaapWorkHubOpenRequest =
    | { readonly kind: 'diff'; readonly projectId?: string }
    | { readonly kind: 'conversation'; readonly conversationId: string; readonly cwd?: string };

/** Bridges diff-review open requests (commands, push routes) to the mobile Work Hub panel. */
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

    async openDiffInWorkHub(projectId?: string): Promise<void> {
        if (!this.delegate) {
            this.pending = { kind: 'diff', projectId };
            return;
        }
        await this.delegate.openDiffInWorkHub(projectId);
    }

    /**
     * Notification deep-link: open the originating agent session in the Work Hub.
     * Falls back to the diff-review surface when the host cannot resolve conversations.
     */
    async openConversationInWorkHub(conversationId: string, cwd?: string): Promise<void> {
        if (!this.delegate) {
            this.pending = { kind: 'conversation', conversationId, cwd };
            return;
        }
        await this.dispatch(this.delegate, { kind: 'conversation', conversationId, cwd });
    }

    protected async dispatch(delegate: QaapWorkHubDiffDelegate, request: QaapWorkHubOpenRequest): Promise<void> {
        if (request.kind === 'conversation' && delegate.openConversationInWorkHub) {
            await delegate.openConversationInWorkHub(request.conversationId, request.cwd);
            return;
        }
        await delegate.openDiffInWorkHub(request.kind === 'diff' ? request.projectId : undefined);
    }
}
