// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// JSDOM must be enabled BEFORE requiring DOM-dependent modules (AgentNotificationService →
// WindowBlinkService → @theia/core/lib/browser/window/* → @lumino/widgets, and
// MobileProjectsConversations → FileService → @theia/core/lib/browser/label-provider → @lumino).
// Use require() for runtime values so enableJSDOM() runs before any DOM-dependent module loads.
// `import type` is erased by TypeScript (no JS output, no DOM dependency).
const { enableJSDOM } = require('@theia/core/lib/browser/test/jsdom') as typeof import('@theia/core/lib/browser/test/jsdom');
// Enable JSDOM at module load so DOM-dependent requires below succeed. The `before()` hook
// re-enables it for the tests in case a prior test file disabled it in its `after()` hook.
enableJSDOM();
// Node 22+ ships a global CustomEvent that JSDOM's window.dispatchEvent does not recognize.
// Align the global with JSDOM's so `new CustomEvent(...)` produces an event JSDOM accepts.
(globalThis as unknown as { CustomEvent: typeof CustomEvent }).CustomEvent = window.CustomEvent;

const { Emitter } = require('@theia/core/lib/common/event') as typeof import('@theia/core/lib/common/event');
const { expect } = require('chai') as typeof import('chai');
const { QaapTurnSettleNotifyContribution } = require('./qaap-turn-settle-notify-contribution') as typeof import('./qaap-turn-settle-notify-contribution');
const { QAAP_NAVIGATE_TO_CONVERSATION_EVENT } = require('./qaap-turn-settle-notifier') as typeof import('./qaap-turn-settle-notifier');
const { AGENT_NOTIFICATION_KIND_COMPLETED } = require('@theia/ai-core/lib/common/notification-types') as typeof import('@theia/ai-core/lib/common/notification-types');
const { QaapMobileAgentNotificationService } = require('./qaap-mobile-agent-notification-service') as typeof import('./qaap-mobile-agent-notification-service');

import type { Emitter as EmitterType } from '@theia/core/lib/common/event';
import type { QaapTurnSettleNotifyContribution as QaapTurnSettleNotifyContributionType } from './qaap-turn-settle-notify-contribution';
import type { MobileProjectsConversations } from './mobile-projects-conversations';
import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import type { QaapConversationChangeEvent } from '../common/qaap-conversation-change';

/**
 * Verifies the two halves of the mobile notification routing change:
 *   1. The upstream AgentNotificationService (whose onActivate opened the classic-IDE chat panel)
 *      is suppressed on narrow mobile viewports by QaapMobileAgentNotificationService.
 *   2. The turn-settle notification dispatches QAAP_NAVIGATE_TO_CONVERSATION_EVENT with the
 *      originating conversationId when activated, so the Work Hub panel can open the session
 *      transcript instead of the IDE.
 */
describe('Mobile agent notification routing', () => {

    let disableJSDOM: (() => void) | undefined;

    before(() => {
        // Re-enable JSDOM for the tests — a prior test file's `after()` hook may have disabled it.
        disableJSDOM = enableJSDOM();
        (globalThis as unknown as { CustomEvent: typeof CustomEvent }).CustomEvent = window.CustomEvent;
    });

    after(() => {
        disableJSDOM?.();
    });

    // ─── Helpers ──────────────────────────────────────────────────────────────

    function setMobileNarrowViewport(isNarrow: boolean): () => void {
        const original = window.matchMedia;
        window.matchMedia = ((query: string) => ({
            matches: isNarrow && String(query).includes('max-width'),
            media: query,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
        })) as typeof window.matchMedia;
        return () => { window.matchMedia = original; };
    }

    function setVisible(state: 'visible' | 'hidden'): void {
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => state,
        });
    }

    class MockNotification {
        static permission: NotificationPermission = 'granted';
        static instances: MockNotification[] = [];
        readonly title: string;
        readonly body?: string;
        readonly tag?: string;
        onclick: (() => void) | null = null;
        closed = false;
        constructor(title: string, options?: { body?: string; tag?: string }) {
            this.title = title;
            this.body = options?.body;
            this.tag = options?.tag;
            MockNotification.instances.push(this);
        }
        close(): void { this.closed = true; }
        static requestPermission(): Promise<NotificationPermission> {
            return Promise.resolve(MockNotification.permission);
        }
    }

    function installMockNotification(): () => void {
        MockNotification.permission = 'granted';
        MockNotification.instances = [];
        (globalThis as unknown as { Notification: typeof MockNotification }).Notification = MockNotification;
        return () => {
            delete (globalThis as unknown as { Notification?: typeof MockNotification }).Notification;
        };
    }

    function makeSummary(id: string, status: QaapAgentConversationSummaryDTO['status']): QaapAgentConversationSummaryDTO {
        return {
            id,
            status,
            title: `Task ${id}`,
            cwd: '/srv/test',
            agentId: 'qaiq',
            createdAt: 1,
            updatedAt: 2,
            messageCount: 1,
        } as QaapAgentConversationSummaryDTO;
    }

    // ─── 1. QaapMobileAgentNotificationService suppresses on mobile ──────────

    describe('QaapMobileAgentNotificationService', () => {

        it('suppresses showNotification on a narrow mobile viewport (no upstream call)', async () => {
            const restoreMatchMedia = setMobileNarrowViewport(true);
            const service = new QaapMobileAgentNotificationService();
            // Spy on the parent method to prove it is NOT reached on mobile.
            const parentProto = Object.getPrototypeOf(Object.getPrototypeOf(service));
            let superReached = false;
            const original = parentProto.showNotification;
            parentProto.showNotification = function (..._args: unknown[]): Promise<void> {
                superReached = true;
                return Promise.resolve();
            };
            try {
                await service.showNotification('qaiq', AGENT_NOTIFICATION_KIND_COMPLETED, {
                    onActivate: () => { /* would open IDE chat panel */ },
                });
                expect(superReached).to.equal(false, 'upstream showNotification must not be reached on mobile');
            } finally {
                parentProto.showNotification = original;
                restoreMatchMedia();
            }
        });

        it('delegates to the upstream service on a wide (desktop) viewport', async () => {
            const restoreMatchMedia = setMobileNarrowViewport(false);
            const service = new QaapMobileAgentNotificationService();
            const parentProto = Object.getPrototypeOf(Object.getPrototypeOf(service));
            let superReached = false;
            const original = parentProto.showNotification;
            parentProto.showNotification = function (..._args: unknown[]): Promise<void> {
                superReached = true;
                return Promise.resolve();
            };
            try {
                await service.showNotification('qaiq', AGENT_NOTIFICATION_KIND_COMPLETED);
                expect(superReached).to.equal(true, 'upstream showNotification must be reached on desktop');
            } finally {
                parentProto.showNotification = original;
                restoreMatchMedia();
            }
        });
    });

    // ─── 2. Turn-settle notification dispatches navigation event on click ─────

    describe('QaapTurnSettleNotifyContribution navigation event', () => {

        let contribution: QaapTurnSettleNotifyContributionType;
        let conversations: MobileProjectsConversations;
        let changeEmitter: EmitterType<QaapConversationChangeEvent>;
        let summaries: Map<string, QaapAgentConversationSummaryDTO>;
        let restoreNotification: () => void;

        beforeEach(() => {
            setVisible('hidden');
            restoreNotification = installMockNotification();

            summaries = new Map();
            changeEmitter = new Emitter<QaapConversationChangeEvent>();
            conversations = {
                start: () => { /* no-op */ },
                onDidChangeDetail: changeEmitter.event,
                listAllSummaries: () => [...summaries.values()],
            } as unknown as MobileProjectsConversations;

            contribution = new QaapTurnSettleNotifyContribution();
            (contribution as unknown as { conversations: MobileProjectsConversations }).conversations = conversations;
            contribution.onStart();
        });

        afterEach(() => {
            restoreNotification();
        });

        it('dispatches QAAP_NAVIGATE_TO_CONVERSATION_EVENT with the conversationId when the notification is clicked', () => {
            // Seed a streaming conversation, then settle it to idle.
            summaries.set('conv-42', makeSummary('conv-42', 'streaming'));
            // First scan records the 'streaming' prior status.
            changeEmitter.fire({ kind: 'updated', conversationId: 'conv-42', changedFields: ['status'] as never });

            // Settle to idle and fire another change — the contribution schedules a 10s confirm
            // timeout. Rather than waiting, directly invoke confirmSettlement (the protected
            // method the timeout would call) to test the notification + activation path.
            summaries.set('conv-42', makeSummary('conv-42', 'idle'));
            (contribution as unknown as { confirmSettlement: (s: QaapAgentConversationSummaryDTO) => void })
                .confirmSettlement(summaries.get('conv-42')!);

            // A notification should have been created.
            expect(MockNotification.instances).to.have.lengthOf(1);
            const notification = MockNotification.instances[0];
            expect(notification.tag).to.equal('qaap-turn-settle-conv-42');

            // Listen for the navigation event, then simulate the click.
            let dispatchedConversationId: string | undefined;
            const handler = (e: Event): void => {
                dispatchedConversationId = (e as CustomEvent<{ conversationId?: string }>).detail?.conversationId;
            };
            window.addEventListener(QAAP_NAVIGATE_TO_CONVERSATION_EVENT, handler);
            try {
                notification.onclick!();
            } finally {
                window.removeEventListener(QAAP_NAVIGATE_TO_CONVERSATION_EVENT, handler);
            }

            expect(dispatchedConversationId).to.equal('conv-42');
            expect(notification.closed).to.equal(true);
        });

        it('does not create a notification for a conversation that is still streaming', () => {
            summaries.set('conv-99', makeSummary('conv-99', 'streaming'));
            changeEmitter.fire({ kind: 'updated', conversationId: 'conv-99', changedFields: ['status'] as never });
            // Still streaming — no notification should be created.
            expect(MockNotification.instances).to.have.lengthOf(0);
        });
    });
});
