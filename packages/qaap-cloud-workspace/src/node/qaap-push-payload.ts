// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapPushNotifyRequest } from '../common/qaap-cloud-api-types';

export const QAAP_PUSH_TITLE_MAX_LENGTH = 120;
export const QAAP_PUSH_BODY_MAX_LENGTH = 500;
const QAAP_PUSH_FIELD_MAX_LENGTH = 1024;
const QAAP_PUSH_URL_MAX_LENGTH = 500;

/**
 * Normalizes a notification received from a tenant or a browser before it is sent. Text is cut to
 * the limits, `route`/`url` are validated, and any recipient field is discarded: the caller sets
 * `userLogin` itself. Returns `undefined` when there is no usable title or body.
 */
export function sanitizeQaapPushRequest(raw: unknown): QaapPushNotifyRequest | undefined {
    if (!raw || typeof raw !== 'object') {
        return undefined;
    }
    const candidate = raw as Partial<Record<keyof QaapPushNotifyRequest, unknown>>;
    if (typeof candidate.title !== 'string' || typeof candidate.body !== 'string') {
        return undefined;
    }
    const title = candidate.title.trim().slice(0, QAAP_PUSH_TITLE_MAX_LENGTH);
    const body = candidate.body.trim().slice(0, QAAP_PUSH_BODY_MAX_LENGTH);
    if (!title || !body) {
        return undefined;
    }
    return {
        title,
        body,
        tag: boundedString(candidate.tag, QAAP_PUSH_FIELD_MAX_LENGTH),
        route: candidate.route === 'conversation' ? 'conversation' : undefined,
        conversationId: boundedString(candidate.conversationId, QAAP_PUSH_FIELD_MAX_LENGTH),
        cwd: boundedString(candidate.cwd, QAAP_PUSH_FIELD_MAX_LENGTH),
        url: sanitizeQaapPushUrl(candidate.url),
    };
}

/** Accepts only a same-origin relative path such as `/conversation/42`; everything else is dropped. */
export function sanitizeQaapPushUrl(value: unknown): string | undefined {
    if (typeof value !== 'string' || value.length > QAAP_PUSH_URL_MAX_LENGTH) {
        return undefined;
    }
    if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) {
        return undefined;
    }
    return value;
}

function boundedString(value: unknown, maxLength: number): string | undefined {
    return typeof value === 'string' ? value.slice(0, maxLength) : undefined;
}
