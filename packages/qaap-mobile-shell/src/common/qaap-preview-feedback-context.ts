// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { AIVariableResolutionRequest, ResolvedAIContextVariable } from '@theia/ai-core';
import { ImageContextVariable } from '@theia/ai-chat/lib/common/image-context-variable';
import type { StickyComposerContextEntry } from './qaap-composer-context-entry';

export const QAAP_PREVIEW_FEEDBACK_VARIABLE_NAME = 'previewFeedback';

/** Attach preview feedback to the Work Hub composer; optional {@link QaapAttachComposerContextArgs.submit} also sends. */
export const QAAP_WORK_HUB_ATTACH_COMPOSER_CONTEXT_COMMAND = 'qaap.workHub.attachComposerContext';

const MAX_BODY_LENGTH = 24_000;

/** Inline PNG/JPEG (etc.) from annotate-toolbar screenshot; base64 payload for imageContext. */
export interface QaapAttachComposerImageAttachment {
    readonly name: string;
    readonly mimeType: string;
    readonly data: string;
}

export interface QaapAttachComposerContextArgs {
    readonly chipTitle: string;
    readonly contextBody: string;
    readonly dedupeKey: string;
    /**
     * When true, attach the chip then submit a message that includes this context
     * to the current Work Hub chat (transcript if open, else sticky / new task).
     * Does not clear unrelated composer draft text.
     */
    readonly submit?: boolean;
    /** Optional screenshots / images sent with the feedback as imageContext attachments. */
    readonly images?: readonly QaapAttachComposerImageAttachment[];
}

interface PreviewFeedbackArgPayload {
    readonly k: string;
    readonly b: string;
    /** Human-readable chip title for composer + transcript display. */
    readonly t?: string;
}

export function buildPreviewFeedbackAttachmentRequest(
    args: QaapAttachComposerContextArgs,
): AIVariableResolutionRequest {
    const body = args.contextBody.slice(0, MAX_BODY_LENGTH);
    const title = args.chipTitle.trim();
    const payload: PreviewFeedbackArgPayload = title
        ? { k: args.dedupeKey, b: body, t: title }
        : { k: args.dedupeKey, b: body };
    return {
        variable: {
            id: QAAP_PREVIEW_FEEDBACK_VARIABLE_NAME,
            name: QAAP_PREVIEW_FEEDBACK_VARIABLE_NAME,
            label: 'PreviewFeedback',
            description: 'Confirmed preview annotations',
            iconClasses: ['codicon', 'codicon-comment'],
        },
        arg: JSON.stringify(payload),
    };
}

export function isPreviewFeedbackRequest(request: AIVariableResolutionRequest | undefined): boolean {
    return request?.variable.name === QAAP_PREVIEW_FEEDBACK_VARIABLE_NAME;
}

export function parsePreviewFeedbackArg(arg: string | undefined): PreviewFeedbackArgPayload | undefined {
    if (!arg?.trim()) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(arg) as Partial<PreviewFeedbackArgPayload>;
        if (typeof parsed.k === 'string' && typeof parsed.b === 'string') {
            const title = typeof parsed.t === 'string' ? parsed.t.trim() : undefined;
            return title
                ? { k: parsed.k, b: parsed.b, t: title }
                : { k: parsed.k, b: parsed.b };
        }
    } catch {
        /* legacy plain body */
        return { k: arg, b: arg };
    }
    return undefined;
}

export function resolvePreviewFeedbackVariable(
    request: AIVariableResolutionRequest,
): ResolvedAIContextVariable | undefined {
    if (!isPreviewFeedbackRequest(request)) {
        return undefined;
    }
    const parsed = parsePreviewFeedbackArg(request.arg);
    if (!parsed?.b.trim()) {
        return undefined;
    }
    // Prefer the chip title so attachment headers / transcript chips stay human-readable.
    // Dedupe still uses `k` inside the serialized arg.
    return {
        variable: request.variable,
        arg: request.arg,
        value: parsed.t?.trim() || parsed.k,
        contextValue: parsed.b,
    };
}

export function findPreviewFeedbackEntryIndex(
    entries: readonly StickyComposerContextEntry[],
    dedupeKey: string,
): number {
    return entries.findIndex(entry => {
        if (!isPreviewFeedbackRequest(entry.request)) {
            return false;
        }
        const parsed = parsePreviewFeedbackArg(entry.request.arg);
        return parsed?.k === dedupeKey;
    });
}

export function isQaapAttachComposerImageAttachment(value: unknown): value is QaapAttachComposerImageAttachment {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const record = value as Partial<QaapAttachComposerImageAttachment>;
    return typeof record.name === 'string'
        && typeof record.mimeType === 'string'
        && typeof record.data === 'string'
        && !!record.mimeType.trim()
        && !!record.data.trim();
}

export function normalizeAttachComposerImages(
    images: readonly QaapAttachComposerImageAttachment[] | undefined,
): QaapAttachComposerImageAttachment[] {
    if (!images?.length) {
        return [];
    }
    return images.filter(isQaapAttachComposerImageAttachment);
}

export function buildAttachComposerImageRequests(
    images: readonly QaapAttachComposerImageAttachment[] | undefined,
): AIVariableResolutionRequest[] {
    return normalizeAttachComposerImages(images).map(image => ImageContextVariable.createRequest({
        data: image.data,
        mimeType: image.mimeType.trim() || 'image/png',
        name: image.name.trim() || 'preview-screenshot.png',
    }));
}

export function isQaapAttachComposerContextArgs(value: unknown): value is QaapAttachComposerContextArgs {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const record = value as Partial<QaapAttachComposerContextArgs>;
    if (!(typeof record.chipTitle === 'string'
        && typeof record.contextBody === 'string'
        && typeof record.dedupeKey === 'string'
        && !!record.dedupeKey.trim()
        && !!record.contextBody.trim())) {
        return false;
    }
    if (record.images !== undefined) {
        if (!Array.isArray(record.images)) {
            return false;
        }
        for (const image of record.images) {
            if (!isQaapAttachComposerImageAttachment(image)) {
                return false;
            }
        }
    }
    return true;
}
