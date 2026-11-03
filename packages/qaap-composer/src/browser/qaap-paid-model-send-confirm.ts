// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ConfirmDialog } from '@theia/core/lib/browser';
import { nls } from '@theia/core/lib/common/nls';
import { isFreeAgentModel } from '@theia/qaap-shared-core/lib/common/qaap-agent-model-selection';
import { hashString, type QaapCreateAgentTaskQaiqModel } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';

const PAID_SEND_CONFIRMED_STORAGE_PREFIX = 'qaap.paidModelSendConfirmed';

function paidSendStorageKey(cwd: string): string {
    return `${PAID_SEND_CONFIRMED_STORAGE_PREFIX}.${hashString(cwd)}`;
}

/** True when the owner already confirmed paid sends for this project in this browser session. */
export function hasConfirmedPaidSendForProject(cwd: string | undefined): boolean {
    if (!cwd) {
        return false;
    }
    try {
        return window.sessionStorage.getItem(paidSendStorageKey(cwd)) === 'true';
    } catch {
        // sessionStorage can be blocked: then the user is asked again, which is the safe direction.
        return false;
    }
}

function rememberPaidSendForProject(cwd: string | undefined): void {
    if (!cwd) {
        return;
    }
    try {
        window.sessionStorage.setItem(paidSendStorageKey(cwd), 'true');
    } catch {
        /* sessionStorage unavailable: the next send asks again */
    }
}

/**
 * Before the first send to a paid model in a project during this browser session, asks the user to
 * confirm (paid sends spend provider credits). Free models and already-confirmed projects pass through.
 * Resolves true when the send may proceed.
 */
export async function confirmPaidModelSend(
    cwd: string | undefined,
    model: QaapCreateAgentTaskQaiqModel | undefined,
): Promise<boolean> {
    if (!model || isFreeAgentModel(model) || hasConfirmedPaidSendForProject(cwd)) {
        return true;
    }
    const accepted = await new ConfirmDialog({
        title: nls.localize('qaap/composer/paidModelSendTitle', 'Send with a paid model?'),
        msg: nls.localize(
            'qaap/composer/paidModelSendMessage',
            'This model is paid and uses your provider credits. Send anyway?',
        ),
        ok: nls.localize('qaap/composer/paidModelSendConfirm', 'Send'),
        cancel: nls.localize('qaap/composer/paidModelSendCancel', 'Cancel'),
    }).open();
    if (accepted === true) {
        rememberPaidSendForProject(cwd);
        return true;
    }
    return false;
}
