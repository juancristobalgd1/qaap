// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { Disposable } from '@theia/core/lib/common/disposable';
import { Emitter } from '@theia/core/lib/common/event';
import { QaapThreadStore } from '@theia/qaap-shared-core/lib/common/qaap-thread-store';
import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

/**
 * Every composer (re)mount binds the context-usage ring (thread store ×2 or `onDidChangeDetail`).
 * Both remount paths dispose the previous binding first (`renderStickyComposer` and the transcript
 * composer mount); this pins that N remounts leave the listener count flat, so a regression shows up
 * here instead of as an Emitter leak warning in the console.
 */
describe('sticky composer context usage listeners', () => {

    useSuiteJSDOM();

    // The render UI pulls @lumino/widgets, which reads `document` at load time.
    let renderModule: typeof import('./mobile-projects-sticky-composer-render-ui');

    before(() => {
        const globals = globalThis as unknown as { DragEvent?: unknown };
        if (!globals.DragEvent) {
            globals.DragEvent = class DragEvent {};
        }
        renderModule = require('./mobile-projects-sticky-composer-render-ui');
    });

    const REMOUNTS = 50;

    interface Harness {
        readonly ui: InstanceType<typeof renderModule.MobileProjectsStickyComposerRenderUi>;
        readonly host: { stickyComposerContextUsageDispose: Disposable };
        readonly threadStore: QaapThreadStore;
        readonly detailEmitter: Emitter<{ kind: string; conversationId?: string }>;
    }

    function createHarness(): Harness {
        const threadStore = new QaapThreadStore();
        const detailEmitter = new Emitter<{ kind: string; conversationId?: string }>();
        const host = {
            stickyComposerContextUsageDispose: Disposable.NULL,
            readPreference: (): unknown => undefined,
            conversations: { threadStore, onDidChangeDetail: detailEmitter.event },
        };
        const ui = new renderModule.MobileProjectsStickyComposerRenderUi(
            host as unknown as ConstructorParameters<typeof renderModule.MobileProjectsStickyComposerRenderUi>[0],
        );
        return { ui, host, threadStore, detailEmitter };
    }

    function threadSubscriberCount(store: QaapThreadStore, conversationId: string): number {
        const buckets = (store as unknown as { threadSubscribers: Map<string, Set<unknown>> }).threadSubscribers;
        return buckets.get(conversationId)?.size ?? 0;
    }

    function detailListenerCount(emitter: Emitter<unknown>): number {
        return (emitter as unknown as { _callbacks?: { length: number } })._callbacks?.length ?? 0;
    }

    /** What both composer remount paths do: drop the previous binding, wipe, mount a new badge. */
    function remount(harness: Harness, resolveTarget: () => { summary?: QaapAgentConversationSummaryDTO } | undefined): void {
        harness.host.stickyComposerContextUsageDispose.dispose();
        const badge = document.createElement('button');
        harness.host.stickyComposerContextUsageDispose = harness.ui.mountStickyComposerContextUsage(badge, resolveTarget);
    }

    it('keeps thread-store subscribers constant across remounts of a VPS conversation composer', () => {
        const harness = createHarness();
        const summary = { id: 'conv-1' } as QaapAgentConversationSummaryDTO;
        remount(harness, () => ({ summary }));
        const afterFirst = threadSubscriberCount(harness.threadStore, 'conv-1');
        expect(afterFirst).to.equal(2);
        for (let i = 0; i < REMOUNTS; i++) {
            remount(harness, () => ({ summary }));
        }
        expect(threadSubscriberCount(harness.threadStore, 'conv-1')).to.equal(afterFirst);
        harness.host.stickyComposerContextUsageDispose.dispose();
        expect(threadSubscriberCount(harness.threadStore, 'conv-1')).to.equal(0);
    });

    it('keeps onDidChangeDetail listeners constant across remounts of the new-task composer', () => {
        const harness = createHarness();
        remount(harness, () => undefined);
        const afterFirst = detailListenerCount(harness.detailEmitter);
        expect(afterFirst).to.equal(1);
        for (let i = 0; i < REMOUNTS; i++) {
            remount(harness, () => undefined);
        }
        expect(detailListenerCount(harness.detailEmitter)).to.equal(afterFirst);
        harness.host.stickyComposerContextUsageDispose.dispose();
        expect(detailListenerCount(harness.detailEmitter)).to.equal(0);
    });
});
