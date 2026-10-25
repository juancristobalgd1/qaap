// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import type { QaapPushNotifyRequest } from '../common/qaap-cloud-api-types';

/** Notifications held by a tenant backend until the control plane drains them. */
export const QAAP_PUSH_OUTBOX_CAPACITY = 50;
export const QAAP_PUSH_OUTBOX_TTL_MS = 60 * 60 * 1000;

/** The tenant never names a recipient: the control plane assigns the owner from the tenant it drains. */
export type QaapPushOutboxRequest = Omit<QaapPushNotifyRequest, 'userLogin'>;

interface QaapPushOutboxEntry {
    readonly at: number;
    readonly request: QaapPushOutboxRequest;
}

/**
 * In-memory, bounded queue of push notifications in a tenant backend (no VAPID keys and no
 * subscriptions live here). Oldest entries are dropped beyond the capacity and entries expire
 * after the TTL. Delivery is at-most-once: a drain empties the queue.
 */
@injectable()
export class QaapPushOutbox {

    protected entries: QaapPushOutboxEntry[] = [];

    enqueue(request: QaapPushNotifyRequest, now = Date.now()): void {
        this.prune(now);
        const copy: QaapPushOutboxRequest = {
            title: request.title,
            body: request.body,
            tag: request.tag,
            route: request.route,
            conversationId: request.conversationId,
            cwd: request.cwd,
            url: request.url,
        };
        this.entries.push({ at: now, request: copy });
        if (this.entries.length > QAAP_PUSH_OUTBOX_CAPACITY) {
            this.entries.splice(0, this.entries.length - QAAP_PUSH_OUTBOX_CAPACITY);
        }
    }

    /** Returns the live entries and empties the queue. */
    drain(now = Date.now()): QaapPushOutboxRequest[] {
        this.prune(now);
        const drained = this.entries.map(entry => entry.request);
        this.entries = [];
        return drained;
    }

    size(): number {
        return this.entries.length;
    }

    protected prune(now: number): void {
        this.entries = this.entries.filter(entry => now - entry.at <= QAAP_PUSH_OUTBOX_TTL_MS);
    }
}
