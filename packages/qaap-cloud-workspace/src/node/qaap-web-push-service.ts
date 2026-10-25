// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { isQaapTenantBackendMode } from '@theia/qaap-adapters/lib/common/qaap-tenant-backend-auth';
import type { QaapPushNotifyRequest } from '../common/qaap-cloud-api-types';
import { QaapPushSubscriptionStore, type StoredPushSubscription } from './qaap-push-subscription-store';
import { QaapPushOutbox } from './qaap-push-outbox';
import { sanitizeQaapPushRequest } from './qaap-push-payload';

@injectable()
export class QaapWebPushService {

    @inject(QaapPushSubscriptionStore)
    protected readonly subscriptions: QaapPushSubscriptionStore;

    @inject(QaapPushOutbox)
    protected readonly outbox: QaapPushOutbox;

    @postConstruct()
    protected init(): void {
        // Make the "silently disabled" state visible: without VAPID keys, every notify() is a no-op,
        // so "task finished" push notifications never arrive and nothing said why. (ONB-5)
        if (!this.isConfigured() && !isQaapTenantBackendMode()) {
            console.warn('[qaap-web-push] disabled: QAAP_VAPID_PUBLIC_KEY / QAAP_VAPID_PRIVATE_KEY not set — '
                + 'push notifications will not be delivered. Generate keys with `npx web-push generate-vapid-keys`.');
        }
    }

    isConfigured(): boolean {
        return Boolean(
            process.env.QAAP_VAPID_PUBLIC_KEY?.trim()
            && process.env.QAAP_VAPID_PRIVATE_KEY?.trim(),
        );
    }

    getPublicKey(): string {
        return process.env.QAAP_VAPID_PUBLIC_KEY?.trim() ?? '';
    }

    /**
     * Control plane (or a single-backend deployment): sends to the subscriptions of `userLogin`, or
     * to all of them when no login is given. A tenant backend holds no VAPID keys or subscriptions:
     * it queues the notification in its outbox and the control plane delivers it (pull model).
     */
    async notify(request: QaapPushNotifyRequest): Promise<{ sent: number; failed: number }> {
        const sanitized = sanitizeQaapPushRequest(request);
        if (!sanitized) {
            return { sent: 0, failed: 0 };
        }
        if (isQaapTenantBackendMode()) {
            this.outbox.enqueue(sanitized);
            return { sent: 0, failed: 0 };
        }
        if (!this.isConfigured()) {
            return { sent: 0, failed: 0 };
        }
        const targets = request.userLogin
            ? await this.subscriptions.listForUser(request.userLogin)
            : await this.subscriptions.listAll();
        let sent = 0;
        let failed = 0;
        const payload = JSON.stringify({
            title: sanitized.title,
            body: sanitized.body,
            tag: sanitized.tag,
            route: sanitized.route,
            conversationId: sanitized.conversationId,
            cwd: sanitized.cwd,
            url: sanitized.url,
        });
        for (const row of targets) {
            try {
                await this.deliver(row.subscription.endpoint, row.subscription.keys, payload);
                sent++;
            } catch (error) {
                failed++;
                await this.forgetIfGone(row, error);
            }
        }
        return { sent, failed };
    }

    /** Sends one payload with the VAPID keys of this process. Overridable so tests do not reach the push service. */
    protected async deliver(endpoint: string, keys: StoredPushSubscription['subscription']['keys'], payload: string): Promise<void> {
        const webpush = await import('web-push');
        webpush.setVapidDetails(
            process.env.QAAP_VAPID_SUBJECT?.trim() || 'mailto:qaap@localhost',
            this.getPublicKey(),
            process.env.QAAP_VAPID_PRIVATE_KEY!.trim(),
        );
        await webpush.sendNotification({ endpoint, keys }, payload);
    }

    /** A push service answers 404/410 for subscriptions that no longer exist: drop them. */
    protected async forgetIfGone(row: StoredPushSubscription, error: unknown): Promise<void> {
        const statusCode = (error as { statusCode?: unknown } | undefined)?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
            await this.subscriptions.remove(row.subscription.endpoint);
        }
    }
}
