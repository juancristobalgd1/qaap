// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Parses the formatted `previewFeedback` context body (produced by
 * `formatPreviewFeedbackAgentContext` in qaap-adapters) back into structured
 * annotations so the transcript can render a rich card instead of a flat chip.
 * The format is fork-controlled on both sides; unknown lines degrade gracefully.
 */

export interface PreviewFeedbackAnnotationDetail {
    /** 1-based marker number, matching the numbered markers painted on the preview. */
    readonly index: number;
    readonly comment: string;
    readonly route?: string;
    readonly viewport?: string;
    readonly selector?: string;
    readonly elementTag?: string;
    readonly elementText?: string;
    /** `path/to/file.tsx:42` (line optional). */
    readonly source?: string;
    readonly component?: string;
    /** Anchor could not be re-resolved against the live DOM. */
    readonly unresolved?: boolean;
}

const ANNOTATION_HEADER_PATTERN = /^Annotation (\d+):\s*$/;
const FIELD_LINE_PATTERN = /^- ([A-Za-z][A-Za-z ]*): ?(.*)$/;

interface MutableDetail {
    index: number;
    comment: string;
    route?: string;
    viewport?: string;
    selector?: string;
    elementTag?: string;
    elementText?: string;
    source?: string;
    component?: string;
    unresolved?: boolean;
    lastField?: 'comment' | 'elementText';
}

function finalize(detail: MutableDetail): PreviewFeedbackAnnotationDetail {
    const { lastField, ...rest } = detail;
    return { ...rest, comment: rest.comment.trim() };
}

/** Structured annotations from a previewFeedback context body; empty when nothing parses. */
export function parsePreviewFeedbackContextBody(body: string): PreviewFeedbackAnnotationDetail[] {
    const details: PreviewFeedbackAnnotationDetail[] = [];
    let current: MutableDetail | undefined;
    const flush = (): void => {
        if (current && current.comment.trim()) {
            details.push(finalize(current));
        }
        current = undefined;
    };
    for (const line of body.split('\n')) {
        const header = ANNOTATION_HEADER_PATTERN.exec(line);
        if (header) {
            flush();
            current = { index: Number(header[1]), comment: '' };
            continue;
        }
        if (!current) {
            continue;
        }
        const field = FIELD_LINE_PATTERN.exec(line);
        if (!field) {
            // Continuation of a multi-line free-text field (comments may contain newlines).
            if (current.lastField === 'comment' && line.trim()) {
                current.comment += `\n${line}`;
            } else if (current.lastField === 'elementText' && line.trim()) {
                current.elementText = `${current.elementText ?? ''}\n${line}`;
            }
            continue;
        }
        const key = field[1]!.trim();
        const value = field[2]!.trim();
        current.lastField = undefined;
        switch (key) {
            case 'Comment':
                current.comment = value;
                current.lastField = 'comment';
                break;
            case 'Route':
                current.route = value || undefined;
                break;
            case 'Viewport':
                current.viewport = value || undefined;
                break;
            case 'Selector':
                current.selector = value || undefined;
                break;
            case 'Element': {
                const tag = /^<(.+)>$/.exec(value);
                current.elementTag = (tag?.[1] ?? value) || undefined;
                break;
            }
            case 'Text':
                current.elementText = value || undefined;
                current.lastField = 'elementText';
                break;
            case 'Source':
                current.source = value || undefined;
                break;
            case 'Component':
                current.component = value || undefined;
                break;
            case 'Note':
                if (value.toLowerCase().includes('unresolved')) {
                    current.unresolved = true;
                }
                break;
            default:
                // Positions and future fields: kept in the agent context, not surfaced in the card.
                break;
        }
    }
    flush();
    return details;
}

/** Splits `path/to/file.tsx:42` into path + optional line for open-in-editor affordances. */
export function splitPreviewFeedbackSource(source: string): { readonly path: string; readonly line?: number } {
    const match = /^(.*?):(\d+)$/.exec(source.trim());
    if (match) {
        return { path: match[1]!, line: Number(match[2]) };
    }
    return { path: source.trim() };
}
