// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** One verified GitHub webhook delivery (signature checked over the raw body). */
export interface QaapGithubWebhookDelivery {
    /** `X-GitHub-Event`, e.g. `issues`, `issue_comment`, `pull_request`. */
    readonly event: string;
    /** `X-GitHub-Delivery`: unique per delivery, the same on a redelivery. */
    readonly deliveryId: string;
    /** The parsed JSON payload. Signed, but still only a trigger: listeners confirm facts with the GitHub API. */
    readonly payload: unknown;
}

export const QaapGithubWebhookListener = Symbol('QaapGithubWebhookListener');

/**
 * Receives every verified delivery of `POST /qaap/api/github/webhook` on the control plane. Called after the
 * response was sent; a listener must not throw (errors are logged) and must not block for long.
 */
export interface QaapGithubWebhookListener {
    onGithubWebhook(delivery: QaapGithubWebhookDelivery): Promise<void> | void;
}
