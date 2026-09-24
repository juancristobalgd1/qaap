// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();
const browserGlobals = globalThis as unknown as { DragEvent?: unknown };
if (!browserGlobals.DragEvent) {
    browserGlobals.DragEvent = class DragEvent { };
}

import { expect } from 'chai';
import type { QaapMessageDeliveryMode, QaapPendingUserMessageDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { MobileProjectsTranscriptMessagesUi } from './mobile-projects-transcript-messages-ui';

describe('MobileProjectsTranscriptMessagesUi queued-message delegation', () => {

    // The sticky composer reaches the server pending queue through `host.transcriptMessagesUi`
    // and feature-checks `cancelQueuedMessage` / `dispatchQueuedMessage` before calling them;
    // both must exist on this facade and forward to the render UI that owns the implementation.
    function createUiWithRenderStub(calls: unknown[][]): MobileProjectsTranscriptMessagesUi {
        const ui = Object.create(MobileProjectsTranscriptMessagesUi.prototype) as MobileProjectsTranscriptMessagesUi;
        const renderUi = {
            cancelQueuedMessage: async (...args: unknown[]): Promise<void> => {
                calls.push(['cancel', ...args]);
            },
            dispatchQueuedMessage: async (...args: unknown[]): Promise<void> => {
                calls.push(['dispatch', ...args]);
            },
        };
        Object.defineProperty(ui, 'renderUi', { value: renderUi });
        return ui;
    }

    it('forwards cancelQueuedMessage to the render UI', async () => {
        const calls: unknown[][] = [];
        const ui = createUiWithRenderStub(calls);
        await ui.cancelQueuedMessage('conv-1', 'pending-1');
        expect(calls).to.deep.equal([['cancel', 'conv-1', 'pending-1']]);
    });

    it('forwards dispatchQueuedMessage to the render UI', async () => {
        const calls: unknown[][] = [];
        const ui = createUiWithRenderStub(calls);
        const pending: QaapPendingUserMessageDTO = { id: 'pending-1', content: 'hi', createdAt: 1 };
        const mode: QaapMessageDeliveryMode = 'parallel';
        await ui.dispatchQueuedMessage('conv-1', pending, mode);
        expect(calls).to.deep.equal([['dispatch', 'conv-1', pending, 'parallel']]);
    });
});
