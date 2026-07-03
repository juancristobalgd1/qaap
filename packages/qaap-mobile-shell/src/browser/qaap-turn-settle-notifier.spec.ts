// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { expect } from 'chai';
import { QaapTurnSettleNotifier } from './qaap-turn-settle-notifier';

class MockNotification {

    static permission: NotificationPermission = 'granted';
    static requestPermissionCalls = 0;
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

    close(): void {
        this.closed = true;
    }

    static requestPermission(): Promise<NotificationPermission> {
        MockNotification.requestPermissionCalls++;
        return Promise.resolve(MockNotification.permission);
    }
}

function setVisibility(state: 'visible' | 'hidden'): void {
    Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => state,
    });
}

describe('QaapTurnSettleNotifier', () => {

    let disableJSDOM: (() => void) | undefined;

    beforeEach(() => {
        disableJSDOM?.();
        disableJSDOM = enableJSDOM();
        MockNotification.permission = 'granted';
        MockNotification.requestPermissionCalls = 0;
        MockNotification.instances = [];
        (globalThis as unknown as { Notification: typeof MockNotification }).Notification = MockNotification;
        setVisibility('hidden');
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    it('fires a notification when hidden, Notification exists and permission is granted', () => {
        const notifier = new QaapTurnSettleNotifier();
        notifier.notifyTurnSettled('conv-1', { title: 'Fix the login bug', outcome: 'completed' });

        expect(MockNotification.instances).to.have.lengthOf(1);
        expect(MockNotification.instances[0].title).to.equal('Fix the login bug');
        expect(MockNotification.instances[0].tag).to.equal('qaap-turn-settle-conv-1');
    });

    it('does not fire when the document is visible', () => {
        setVisibility('visible');
        const notifier = new QaapTurnSettleNotifier();
        notifier.notifyTurnSettled('conv-1', { title: 'Fix the login bug', outcome: 'completed' });

        expect(MockNotification.instances).to.have.lengthOf(0);
    });

    it('does not fire when permission is not granted', () => {
        MockNotification.permission = 'default';
        const notifier = new QaapTurnSettleNotifier();
        notifier.notifyTurnSettled('conv-1', { title: 'Fix the login bug', outcome: 'completed' });

        expect(MockNotification.instances).to.have.lengthOf(0);
    });

    it('does not fire when the Notification API is unavailable', () => {
        delete (globalThis as unknown as { Notification?: typeof MockNotification }).Notification;
        const notifier = new QaapTurnSettleNotifier();
        notifier.notifyTurnSettled('conv-1', { title: 'Fix the login bug', outcome: 'completed' });

        expect(MockNotification.instances).to.have.lengthOf(0);
    });

    it('dedupes per conversation id — only announces a given turn once per session', () => {
        const notifier = new QaapTurnSettleNotifier();
        notifier.notifyTurnSettled('conv-1', { title: 'Fix the login bug', outcome: 'completed' });
        notifier.notifyTurnSettled('conv-1', { title: 'Fix the login bug', outcome: 'completed' });
        notifier.notifyTurnSettled('conv-2', { title: 'Add dark mode', outcome: 'completed' });

        expect(MockNotification.instances).to.have.lengthOf(2);
        expect(MockNotification.instances.map(n => n.title)).to.deep.equal(['Fix the login bug', 'Add dark mode']);
    });

    it('maps outcome to the expected localized body text', () => {
        const notifier = new QaapTurnSettleNotifier();
        notifier.notifyTurnSettled('conv-completed', { title: 'A', outcome: 'completed' });
        notifier.notifyTurnSettled('conv-failed', { title: 'B', outcome: 'failed' });
        notifier.notifyTurnSettled('conv-stopped', { title: 'C', outcome: 'stopped' });

        const byTitle = new Map(MockNotification.instances.map(n => [n.title, n.body]));
        expect(byTitle.get('A')).to.equal('Task completed');
        expect(byTitle.get('B')).to.equal('Task failed');
        expect(byTitle.get('C')).to.equal('Task stopped');
    });

    it('onclick focuses the window, invokes onActivate and closes the notification', () => {
        let focused = false;
        (window as unknown as { focus: () => void }).focus = () => {
            focused = true;
        };
        let activated = false;
        const notifier = new QaapTurnSettleNotifier();
        notifier.notifyTurnSettled('conv-1', {
            title: 'Fix the login bug',
            outcome: 'completed',
            onActivate: () => {
                activated = true;
            },
        });

        const notification = MockNotification.instances[0];
        expect(notification.onclick).to.be.a('function');
        notification.onclick!();

        expect(focused).to.equal(true);
        expect(activated).to.equal(true);
        expect(notification.closed).to.equal(true);
    });

    describe('maybeRequestPermission', () => {

        it('requests permission when default', async () => {
            MockNotification.permission = 'default';
            const notifier = new QaapTurnSettleNotifier();

            await notifier.maybeRequestPermission();

            expect(MockNotification.requestPermissionCalls).to.equal(1);
        });

        it('never requests again once denied', async () => {
            MockNotification.permission = 'denied';
            const notifier = new QaapTurnSettleNotifier();

            await notifier.maybeRequestPermission();
            await notifier.maybeRequestPermission();

            expect(MockNotification.requestPermissionCalls).to.equal(0);
        });

        it('does not request when already granted', async () => {
            MockNotification.permission = 'granted';
            const notifier = new QaapTurnSettleNotifier();

            await notifier.maybeRequestPermission();

            expect(MockNotification.requestPermissionCalls).to.equal(0);
        });

        it('does not throw when the Notification API is unavailable', async () => {
            delete (globalThis as unknown as { Notification?: typeof MockNotification }).Notification;
            const notifier = new QaapTurnSettleNotifier();

            await notifier.maybeRequestPermission();
        });
    });
});
