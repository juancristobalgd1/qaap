// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { hashString } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';

/**
 * "Until done" composer toggle (agent goal loop). Persisted per project like the composer mode
 * (`qaap-sticky-composer-mode.ts`): a per-cwd localStorage preference.
 */
const UNTIL_DONE_STORAGE_KEY = 'qaap.mobile.projects.untilDone';

export function scopedUntilDoneStorageKey(cwd: string): string {
    return `${UNTIL_DONE_STORAGE_KEY}.${hashString(cwd)}`;
}

export function readStoredComposerUntilDone(cwd: string | undefined): boolean {
    if (!cwd) {
        return false;
    }
    try {
        return window.localStorage.getItem(scopedUntilDoneStorageKey(cwd)) === '1';
    } catch {
        return false;
    }
}

export function writeStoredComposerUntilDone(cwd: string | undefined, enabled: boolean): void {
    if (!cwd) {
        return;
    }
    try {
        if (enabled) {
            window.localStorage.setItem(scopedUntilDoneStorageKey(cwd), '1');
        } else {
            window.localStorage.removeItem(scopedUntilDoneStorageKey(cwd));
        }
    } catch {
        /* session-only */
    }
}

/**
 * Why the toggle is unavailable (tooltip), or `undefined` when it can be used. Mirrors the
 * backend start guard: the loop runs unattended, so manual approval and Plan mode rule it out.
 */
export function resolveUntilDoneDisabledReason(options: {
    readonly approvalPolicyId: string | undefined;
    readonly modeId: string | undefined;
}): string | undefined {
    if (options.approvalPolicyId === 'request-approval') {
        return nls.localize('theia/qaap/goalLoop/requiresAutoApprove', 'Requires auto-approve');
    }
    if (options.modeId === 'plan') {
        return nls.localize('theia/qaap/goalLoop/unavailableInPlan', 'Not available in Plan mode');
    }
    return undefined;
}

/** Whether a submit should start a goal loop: the stored toggle, when it is usable right now. */
export function resolveComposerUntilDoneForSubmit(options: {
    readonly cwd: string | undefined;
    readonly approvalPolicyId: string | undefined;
    readonly modeId: string | undefined;
}): boolean {
    return readStoredComposerUntilDone(options.cwd) && !resolveUntilDoneDisabledReason(options);
}
