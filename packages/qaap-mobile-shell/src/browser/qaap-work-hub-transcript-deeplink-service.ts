// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';

export interface QaapWorkHubTranscriptDeepLinkDelegate {
    openConversationById(conversationId: string): Promise<void>;
}

/** Bridges push-notification transcript routes to the mobile Work Hub panel. */
@injectable()
export class QaapWorkHubTranscriptDeepLinkService {

    protected delegate: QaapWorkHubTranscriptDeepLinkDelegate | undefined;

    setDelegate(delegate: QaapWorkHubTranscriptDeepLinkDelegate | undefined): void {
        this.delegate = delegate;
    }

    async openConversationById(conversationId: string): Promise<void> {
        await this.delegate?.openConversationById(conversationId);
    }
}
