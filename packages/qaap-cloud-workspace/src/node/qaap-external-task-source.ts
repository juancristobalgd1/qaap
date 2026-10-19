// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type {
    QaapExternalTaskOrigin,
    QaapExternalTaskRefusal,
    QaapExternalTaskSourceId,
    QaapExternalTaskStatus,
    QaapExternalTaskTriggerEvent,
} from '../common/qaap-external-task';

/** The outcome of confirming a trigger against the source's own API with the requester's credentials. */
export type QaapExternalTaskVerification =
    | { readonly ok: true }
    | { readonly ok: false; readonly reason: QaapExternalTaskRefusal; readonly detail?: string };

export const QaapExternalTaskSource = Symbol('QaapExternalTaskSource');

/**
 * One place tasks can come from (GitHub issues now; Slack and Linear later). The intake, launcher and
 * notifier only talk to this interface (doc/qaap-external-task-inputs.md).
 */
export interface QaapExternalTaskSource {
    readonly id: QaapExternalTaskSourceId;
    /**
     * Confirms with the source's API, as the requester, that the requester really made this request and that
     * the quoted text is what the event says. A signed delivery is only a trigger, never the source of truth.
     */
    verify(event: QaapExternalTaskTriggerEvent, token: string): Promise<QaapExternalTaskVerification>;
    /** Tells the origin (issue comment, thread reply) how the task is going. Never carries agent output. */
    postStatus(origin: QaapExternalTaskOrigin, token: string, status: QaapExternalTaskStatus): Promise<void>;
}
