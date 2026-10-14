// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { MaybePromise } from '@theia/core/lib/common/types';
import { matchesMobileOneColumnLayout } from '@theia/core/lib/browser/shell/mobile-layout-state';

/** Html class the login gate sets while a phone boots into the Work Hub (see qaap-login-gate.js). */
const MOBILE_WORK_HUB_BOOT_CLASS = 'theia-mobile-workhub-boot';
const WAIT_FOR_BACKEND_KEY = 'qaap.boot.waitForBackend';

/**
 * Keeps the mobile Work Hub boot from waiting on the backend. Several startup hooks (preload and
 * frontend contributions) await a backend round trip; on a waking tenant each of them stalls for
 * seconds while the Work Hub, which renders from client caches, could already be used. While a
 * phone boots into the Work Hub from the `bundle-mobile` entry, a hook that has not settled
 * within {@link QaapMobileBootBudget.hookBudgetMs} keeps running in the background and boot moves
 * on. With a warm backend every hook settles in time, so startup order is unchanged.
 */
@injectable()
export class QaapMobileBootBudget {

    readonly hookBudgetMs: number = 200;

    protected readonly detachedHooks: string[] = [];

    /** Whether this page is a phone booting into the Work Hub from the mobile entry. */
    applies(): boolean {
        if (typeof window === 'undefined' || typeof document === 'undefined') {
            return false;
        }
        const entry = (window as { __qaapEntry?: string }).__qaapEntry;
        return entry === 'mobile'
            && !this.waitForBackendRequested()
            && document.documentElement.classList.contains(MOBILE_WORK_HUB_BOOT_CLASS)
            && matchesMobileOneColumnLayout();
    }

    /** Diagnostics switch: `sessionStorage['qaap.boot.waitForBackend'] = '1'` restores upstream waiting. */
    protected waitForBackendRequested(): boolean {
        try {
            return window.sessionStorage.getItem(WAIT_FOR_BACKEND_KEY) === '1';
        } catch {
            return false;
        }
    }

    /**
     * Run `fn`; if it returns a promise that does not settle within the budget, resolve with
     * `undefined` and let it finish in the background (failures are logged, never thrown).
     */
    async settleWithinBudget<T>(label: string, fn: () => MaybePromise<T>): Promise<T | undefined> {
        const result = fn();
        if (!(result instanceof Promise)) {
            return result;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const budget = new Promise<typeof DETACHED>(resolve => {
            timer = setTimeout(() => resolve(DETACHED), this.hookBudgetMs);
        });
        try {
            const outcome = await Promise.race([result, budget]);
            if (outcome !== DETACHED) {
                return outcome as T;
            }
        } finally {
            clearTimeout(timer);
        }
        this.detachedHooks.push(label);
        console.info(`[qaap-boot] continuing without waiting for ${label}`);
        result.catch(error => console.error(`[qaap-boot] ${label} failed after boot continued`, error));
        return undefined;
    }

    /** Hooks that boot did not wait for, in order (diagnostics and tests). */
    getDetachedHooks(): readonly string[] {
        return this.detachedHooks;
    }
}

const DETACHED = Symbol('QaapMobileBootBudget.detached');
