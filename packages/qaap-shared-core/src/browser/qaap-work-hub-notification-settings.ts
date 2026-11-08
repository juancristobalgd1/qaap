// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';

/** localStorage key for the System Notifications toggle ('1' / '0'). Absent means ON. */
export const QAAP_WORK_HUB_SYSTEM_NOTIFICATIONS_KEY = 'qaap.workHub.settings.systemNotifications';
/** localStorage key for the Completion Sound toggle ('1' / '0'). Absent means OFF. */
export const QAAP_WORK_HUB_COMPLETION_SOUND_KEY = 'qaap.workHub.settings.completionSound';

/**
 * Work Hub notification preferences (System Notifications, Completion Sound). Backed by
 * localStorage so notifiers that are host-instantiated (no DI) can read the same values via
 * `new QaapWorkHubNotificationSettings()`. Changes made in other tabs are re-emitted through
 * `onDidChange`.
 */
@injectable()
export class QaapWorkHubNotificationSettings {

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    @postConstruct()
    protected init(): void {
        if (typeof window === 'undefined') {
            return;
        }
        window.addEventListener('storage', this.onStorage);
    }

    /** Whether Work Hub may show OS (Web) notifications. Defaults to true. */
    get systemNotifications(): boolean {
        return readFlag(QAAP_WORK_HUB_SYSTEM_NOTIFICATIONS_KEY, true);
    }

    setSystemNotifications(on: boolean): void {
        writeFlag(QAAP_WORK_HUB_SYSTEM_NOTIFICATIONS_KEY, on);
        this.onDidChangeEmitter.fire(undefined);
    }

    /** Whether a short sound plays when a turn completes or needs attention. Defaults to false. */
    get completionSound(): boolean {
        return readFlag(QAAP_WORK_HUB_COMPLETION_SOUND_KEY, false);
    }

    setCompletionSound(on: boolean): void {
        writeFlag(QAAP_WORK_HUB_COMPLETION_SOUND_KEY, on);
        this.onDidChangeEmitter.fire(undefined);
    }

    protected readonly onStorage = (event: StorageEvent): void => {
        if (event.key === QAAP_WORK_HUB_SYSTEM_NOTIFICATIONS_KEY || event.key === QAAP_WORK_HUB_COMPLETION_SOUND_KEY || event.key === null) {
            this.onDidChangeEmitter.fire(undefined);
        }
    };
}

function readFlag(key: string, fallback: boolean): boolean {
    try {
        const raw = window.localStorage.getItem(key);
        if (raw === null) {
            return fallback;
        }
        return raw === '1';
    } catch {
        return fallback;
    }
}

function writeFlag(key: string, on: boolean): void {
    try {
        window.localStorage.setItem(key, on ? '1' : '0');
    } catch {
        /* storage blocked: the in-memory value is unchanged, the event still reports the attempt */
    }
}
