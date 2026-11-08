// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapWorkHubNotificationSettings, QAAP_WORK_HUB_COMPLETION_SOUND_KEY, QAAP_WORK_HUB_SYSTEM_NOTIFICATIONS_KEY } from './qaap-work-hub-notification-settings';

describe('QaapWorkHubNotificationSettings', () => {
    const store = new Map<string, string>();
    let originalWindow: unknown;

    beforeEach(() => {
        originalWindow = (globalThis as { window?: unknown }).window;
        store.clear();
        (globalThis as { window?: unknown }).window = {
            localStorage: {
                getItem: (key: string): string | null => store.has(key) ? store.get(key)! : null,
                setItem: (key: string, value: string): void => { store.set(key, value); },
            },
            addEventListener: (): void => { /* no storage events in unit tests */ },
        };
    });

    afterEach(() => {
        (globalThis as { window?: unknown }).window = originalWindow;
    });

    it('system notifications default to ON when nothing is stored', () => {
        expect(new QaapWorkHubNotificationSettings().systemNotifications).to.equal(true);
    });

    it('completion sound defaults to OFF when nothing is stored', () => {
        expect(new QaapWorkHubNotificationSettings().completionSound).to.equal(false);
    });

    it('persists both flags as 1/0 and reads them back from a new instance', () => {
        const settings = new QaapWorkHubNotificationSettings();
        settings.setSystemNotifications(false);
        settings.setCompletionSound(true);
        expect(store.get(QAAP_WORK_HUB_SYSTEM_NOTIFICATIONS_KEY)).to.equal('0');
        expect(store.get(QAAP_WORK_HUB_COMPLETION_SOUND_KEY)).to.equal('1');
        const reread = new QaapWorkHubNotificationSettings();
        expect(reread.systemNotifications).to.equal(false);
        expect(reread.completionSound).to.equal(true);
    });

    it('fires onDidChange on every write', () => {
        const settings = new QaapWorkHubNotificationSettings();
        let fired = 0;
        settings.onDidChange(() => fired++);
        settings.setSystemNotifications(false);
        settings.setCompletionSound(true);
        expect(fired).to.equal(2);
    });
});
