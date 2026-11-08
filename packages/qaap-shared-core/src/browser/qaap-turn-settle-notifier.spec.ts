// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapTurnSettleNotifier } from './qaap-turn-settle-notifier';
import { QAAP_WORK_HUB_SYSTEM_NOTIFICATIONS_KEY } from './qaap-work-hub-notification-settings';

describe('QaapTurnSettleNotifier', () => {
    const store = new Map<string, string>();
    const globals = globalThis as unknown as Record<string, unknown>;
    // Captured per test (not at load time): a stale JSDOM document restored later breaks other suites.
    let saved: { window: unknown; document: unknown; Notification: unknown } = { window: undefined, document: undefined, Notification: undefined };
    let constructed = 0;

    class FakeNotification {
        static permission = 'granted';
        static requestPermission(): Promise<string> {
            return Promise.resolve('granted');
        }
        onclick: (() => void) | null = null;
        constructor(_title: string, _options?: object) {
            constructed++;
        }
        close(): void { /* not needed */ }
    }

    beforeEach(() => {
        saved = { window: globals.window, document: globals.document, Notification: globals.Notification };
        store.clear();
        constructed = 0;
        globals.window = {
            localStorage: {
                getItem: (key: string): string | null => store.has(key) ? store.get(key)! : null,
                setItem: (key: string, value: string): void => { store.set(key, value); },
            },
            focus: (): void => { /* no-op */ },
        };
        globals.document = { visibilityState: 'hidden' };
        globals.Notification = FakeNotification;
    });

    afterEach(() => {
        globals.window = saved.window;
        globals.document = saved.document;
        globals.Notification = saved.Notification;
    });

    it('shows a notification for a hidden tab when System Notifications are ON', () => {
        new QaapTurnSettleNotifier().notifyTurnSettled('c1', { title: 'Task', outcome: 'completed' });
        expect(constructed).to.equal(1);
    });

    it('shows nothing when System Notifications are OFF', () => {
        store.set(QAAP_WORK_HUB_SYSTEM_NOTIFICATIONS_KEY, '0');
        new QaapTurnSettleNotifier().notifyTurnSettled('c2', { title: 'Task', outcome: 'completed' });
        expect(constructed).to.equal(0);
    });

    it('does not request permission when System Notifications are OFF', async () => {
        store.set(QAAP_WORK_HUB_SYSTEM_NOTIFICATIONS_KEY, '0');
        FakeNotification.permission = 'default';
        let requested = 0;
        FakeNotification.requestPermission = (): Promise<string> => {
            requested++;
            return Promise.resolve('granted');
        };
        try {
            await new QaapTurnSettleNotifier().maybeRequestPermission();
            expect(requested).to.equal(0);
        } finally {
            FakeNotification.permission = 'granted';
        }
    });
});
