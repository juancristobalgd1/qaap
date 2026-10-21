// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';

/** Longest message a toast, dialog or button label should carry; the full text stays in {@link QaapUserFacingError.details}. */
const MAX_USER_FACING_MESSAGE_LENGTH = 240;
const MAX_DETAILS_LENGTH = 4000;
/** A machine code such as `plan_repo_limit`: it is the error's identity, never something to show a person. */
const MACHINE_CODE = /^[a-z][a-z0-9_.:-]*$/;

/**
 * An HTTP / client failure whose {@link message} is safe to render as-is (no JSON, no HTTP noise, trimmed).
 * The structured fields stay available so UIs can still branch on `code` (`plan_limit`, …) or `status`, and
 * the raw response body is kept in {@link details} for a "Details" affordance or the console.
 */
export class QaapUserFacingError extends Error {
    constructor(
        message: string,
        readonly status?: number,
        readonly code?: string,
        readonly details?: string
    ) {
        super(message);
        this.name = 'QaapUserFacingError';
    }
}

export namespace QaapUserFacingErrors {

    export interface Parsed {
        message: string;
        code?: string;
    }

    /**
     * Turns a response body (JSON `{ error, message, code }`, plain text, HTML or empty) into a readable message
     * plus the machine code, if any.
     */
    export function parse(body: string | undefined, status?: number, statusText?: string, fallback?: string): Parsed {
        const text = (body ?? '').trim();
        let code: string | undefined;
        let candidate: string | undefined;
        const json = parseJsonObject(text);
        if (json) {
            const error = typeof json.error === 'string' ? json.error.trim() : undefined;
            const message = typeof json.message === 'string' ? json.message.trim() : undefined;
            const explicitCode = typeof json.code === 'string' ? json.code.trim() : undefined;
            if (explicitCode && MACHINE_CODE.test(explicitCode)) {
                code = explicitCode;
            } else if (error && MACHINE_CODE.test(error)) {
                code = error;
            }
            candidate = message || (error && !MACHINE_CODE.test(error) ? error : undefined);
        } else if (text && !looksLikeMarkup(text)) {
            candidate = text;
        }
        const message = clean(candidate)
            || clean(fallback)
            || clean(statusText)
            || genericMessage(status);
        return { message, code };
    }

    /** Reads a failed response and returns the typed, display-ready error (keeps `status`, `code` and the raw body). */
    export async function fromResponse(response: Response, fallback?: string): Promise<QaapUserFacingError> {
        let body = '';
        try {
            body = await response.text();
        } catch {
            // Unreadable body: the status line alone has to do.
        }
        return fromBody(body, response.status, response.statusText, fallback);
    }

    export function fromBody(body: string | undefined, status?: number, statusText?: string, fallback?: string): QaapUserFacingError {
        const { message, code } = parse(body, status, statusText, fallback);
        const details = body?.trim() ? body.trim().slice(0, MAX_DETAILS_LENGTH) : undefined;
        return new QaapUserFacingError(message, status, code, details);
    }

    /**
     * The text a UI may show for any caught value. Typed errors pass through; a plain `Error` whose message is
     * still a raw JSON body or carries HTTP noise (older call sites, third-party code) is cleaned the same way.
     */
    export function toMessage(error: unknown, fallback?: string): string {
        if (error instanceof QaapUserFacingError) {
            return error.message;
        }
        const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : undefined;
        if (raw === undefined) {
            return clean(fallback) || genericMessage();
        }
        return parse(raw, undefined, undefined, fallback).message;
    }

    /** Full text for a "Details" section / console, when {@link toMessage} dropped something. */
    export function toDetails(error: unknown): string | undefined {
        if (error instanceof QaapUserFacingError) {
            return error.details;
        }
        return error instanceof Error && error.message !== toMessage(error) ? error.message : undefined;
    }

    function parseJsonObject(text: string): Record<string, unknown> | undefined {
        if (!text.startsWith('{')) {
            return undefined;
        }
        try {
            const value: unknown = JSON.parse(text);
            return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
        } catch {
            return undefined;
        }
    }

    function looksLikeMarkup(text: string): boolean {
        return /^\s*(<!doctype|<html|<\?xml|<body|<head)/i.test(text);
    }

    function clean(value: string | undefined): string {
        let text = (value ?? '')
            .replace(/\s+/g, ' ')
            .trim()
            // A prefix added by Error#toString or an HTTP layer: "Error: …", "HTTP 502 Bad Gateway: …", "500 Internal Server Error - …".
            .replace(/^(?:[A-Za-z]*Error:\s*)+/, '')
            .replace(/^(?:HTTP\/?[\d.]*\s*)?\d{3}\s+[A-Za-z ]{2,40}?\s*[:-]\s+/, '')
            .trim();
        // Trailing runs of dots ("…again..") collapse to one; an ellipsis we add ourselves is kept apart below.
        text = text.replace(/\.{2,}$/, '.').replace(/\s+([.,;:])/g, '$1');
        if (text.length > MAX_USER_FACING_MESSAGE_LENGTH) {
            text = text.slice(0, MAX_USER_FACING_MESSAGE_LENGTH - 1).trimEnd() + '…';
        }
        return text;
    }

    function genericMessage(status?: number): string {
        return status
            ? nls.localize('qaap/error/requestFailedWithStatus', 'Something went wrong (error {0}). Please try again.', String(status))
            : nls.localize('qaap/error/requestFailed', 'Something went wrong. Please try again.');
    }
}
