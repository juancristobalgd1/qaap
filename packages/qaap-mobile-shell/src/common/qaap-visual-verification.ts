// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export const QAAP_VISUAL_VERIFICATION_MARKER = '[QAAP visual verification]';

export interface QaapPreviewVisualValidationResult {
    readonly status: 'passed' | 'warning';
    readonly summary: string;
    readonly issues: readonly string[];
}

const VISUAL_REQUEST_REGEX = /\b(?:ui|ux|frontend|page|screen|layout|responsive|css|style|component|landing|dashboard|interfaz|pantalla|página|diseño|visual|componente|responsive)\b/i;
const VISUAL_FILE_REGEX = /\.(?:html?|css|scss|sass|less|tsx|jsx|vue|svelte)(?:["'\s,}]|$)/i;

/** True when the turn requested UI work or edited a file that normally changes rendered output. */
export function conversationLikelyNeedsVisualVerification(conversation: {
    readonly messages?: readonly {
        readonly role?: string;
        readonly content?: string;
        readonly segments?: readonly { readonly type?: string; readonly name?: string; readonly args?: string }[];
    }[];
}): boolean {
    const messages = conversation.messages ?? [];
    const lastUser = [...messages].reverse().find(message => message.role === 'user');
    if (VISUAL_REQUEST_REGEX.test(lastUser?.content ?? '')) {
        return true;
    }
    return messages.some(message => (message.segments ?? []).some(segment =>
        segment.type === 'tool'
        && /write|edit|patch/i.test(segment.name ?? '')
        && VISUAL_FILE_REGEX.test(segment.args ?? '')
    ));
}

/** True when the message already carries visual evidence (or a capture-failure note). */
export function agentMessageHasVisualVerificationMarker(message: {
    readonly content?: string;
    readonly segments?: readonly { readonly type?: string; readonly content?: string }[];
}): boolean {
    return !!message.content?.includes(QAAP_VISUAL_VERIFICATION_MARKER)
        || !!message.segments?.some(segment => segment.type === 'text'
            && !!segment.content?.includes(QAAP_VISUAL_VERIFICATION_MARKER));
}

/**
 * Note attached when every capture attempt failed. Carries the marker on purpose: it settles
 * the turn's evidence slot (stops retries on every tab) and makes the failure visible instead
 * of dying in a console.warn nobody reads on the VPS.
 */
export function buildQaapVisualVerificationFailureMarkdown(reason: string): string {
    return [
        QAAP_VISUAL_VERIFICATION_MARKER,
        '**Visual verification · Screenshot unavailable**  ',
        reason.trim(),
    ].join('\n');
}

export function buildQaapVisualVerificationMarkdown(
    imageUrl: string,
    result: QaapPreviewVisualValidationResult,
): string {
    const outcome = result.status === 'passed' ? 'Passed' : 'Review recommended';
    const issueLines = result.issues.length > 0
        ? `\n\n${result.issues.map(issue => `- ${issue}`).join('\n')}`
        : '';
    return [
        QAAP_VISUAL_VERIFICATION_MARKER,
        `**Visual verification · ${outcome}**  `,
        `${result.summary}${issueLines}`,
        '',
        `![QAAP preview evidence](${imageUrl})`,
    ].join('\n');
}
