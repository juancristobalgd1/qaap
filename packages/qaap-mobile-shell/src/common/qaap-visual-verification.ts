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
/** Explicit ask for a screenshot / visual proof of the app — triggers capture even with no edits. */
const EXPLICIT_VISUAL_EVIDENCE_REGEX = new RegExp([
    'evidencia\\s+visual',
    'captura\\s+de\\s+pantalla',
    'pantallazo',
    'screenshot',
    'visual\\s+(?:evidence|proof)',
    'mu[eé]stra(?:me)?\\s+(?:la\\s+)?(?:app|aplicaci[oó]n|p[aá]gina|interfaz|c[oó]mo\\s+se\\s+ve)',
    'ens[eé][ñn]ame\\s+(?:la\\s+)?(?:app|aplicaci[oó]n|p[aá]gina|interfaz|c[oó]mo\\s+se\\s+ve)',
    'c[oó]mo\\s+se\\s+ve\\s+(?:la\\s+)?(?:app|aplicaci[oó]n|p[aá]gina|interfaz)',
    'show\\s+me\\s+(?:the\\s+)?(?:app|page|ui)\\b',
    'how\\s+(?:the\\s+)?(?:app|page|ui)\\s+looks',
].join('|'), 'i');

/** True when the user literally asked for a screenshot / visual evidence of the app. */
export function messageRequestsVisualEvidence(text: string | undefined): boolean {
    return !!text?.trim() && EXPLICIT_VISUAL_EVIDENCE_REGEX.test(text);
}

/**
 * True when the LAST turn actually changed something renderable: either it edited a visual
 * file, or the user asked for UI work and the reply edited any file at all. A reply that
 * only asked clarifying questions (no edits) must not trigger evidence — screenshotting an
 * unchanged app and attaching "screenshot unavailable" notes to it is pure noise.
 *
 * Exception: when the user LITERALLY asked for a screenshot / visual evidence, capture the
 * current app state even though nothing was edited — that request is the whole turn.
 */
export function conversationLikelyNeedsVisualVerification(conversation: {
    readonly messages?: readonly {
        readonly role?: string;
        readonly content?: string;
        readonly segments?: readonly { readonly type?: string; readonly name?: string; readonly args?: string }[];
    }[];
}): boolean {
    const messages = conversation.messages ?? [];
    const lastUser = [...messages].reverse().find(message => message.role === 'user');
    if (messageRequestsVisualEvidence(lastUser?.content)) {
        return true;
    }
    const lastAgent = [...messages].reverse().find(message => message.role === 'agent');
    const editSegments = (lastAgent?.segments ?? []).filter(segment =>
        segment.type === 'tool' && /write|edit|patch/i.test(segment.name ?? ''));
    if (editSegments.some(segment => VISUAL_FILE_REGEX.test(segment.args ?? ''))) {
        return true;
    }
    return editSegments.length > 0 && VISUAL_REQUEST_REGEX.test(lastUser?.content ?? '');
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

/** One walked page of the verified flow: the route, its screenshot, and its DOM smoke check. */
export interface QaapVisualFlowStepEvidence {
    readonly label: string;
    readonly imageUrl: string;
    readonly result: QaapPreviewVisualValidationResult;
}

/** Multi-step twin of {@link buildQaapVisualVerificationMarkdown} — one image per walked route. */
export function buildQaapVisualFlowMarkdown(steps: readonly QaapVisualFlowStepEvidence[]): string {
    const failing = steps.filter(step => step.result.status !== 'passed').length;
    const outcome = failing === 0 ? 'Passed' : 'Review recommended';
    const blocks = steps.map(step => {
        const issueLines = step.result.issues.length > 0
            ? `\n${step.result.issues.map(issue => `- ${issue}`).join('\n')}`
            : '';
        return `**\`${step.label}\`** — ${step.result.summary}${issueLines}\n\n`
            + `![QAAP preview evidence ${step.label}](${step.imageUrl})`;
    });
    return [
        QAAP_VISUAL_VERIFICATION_MARKER,
        `**Visual verification · ${outcome}**  `,
        `Walked ${steps.length} page${steps.length === 1 ? '' : 's'} of the app flow.`,
        '',
        blocks.join('\n\n'),
    ].join('\n');
}
