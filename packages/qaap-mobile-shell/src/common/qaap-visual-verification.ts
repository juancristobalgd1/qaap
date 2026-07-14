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

const VISUAL_FILE_REGEX = /\.(?:html?|css|scss|sass|less|tsx|jsx|vue|svelte)(?:["'\s,}]|$)/i;

/**
 * Text-protocol capture tool. The AGENT (any CLI, any language) decides when visual evidence
 * is wanted — user intent is interpreted by the LLM, not by keyword regexes — and invokes the
 * capture by ending its reply with `[QAAP capture]`, optionally with routes:
 * `[QAAP capture: / /pricing]`. The contract is stated in the shared agent prompt preamble.
 */
const QAAP_CAPTURE_DIRECTIVE_REGEX = /\[qaap\s*capture(?::([^\]]*))?\]/i;
const DIRECTIVE_ROUTE_REGEX = /^\/[\w\-/]*$/;
const MAX_DIRECTIVE_ROUTES = 3;

export interface QaapCaptureDirective {
    readonly requested: boolean;
    /** Routes the agent asked to walk (validated, ≤3); empty means "derive them". */
    readonly routes: readonly string[];
}

/** Parses the agent's `[QAAP capture]` invocation out of a settled reply. */
export function parseQaapCaptureDirective(message: {
    readonly content?: string;
    readonly segments?: readonly { readonly type?: string; readonly content?: string }[];
} | undefined): QaapCaptureDirective {
    const texts = [
        message?.content ?? '',
        ...(message?.segments ?? [])
            .filter(segment => segment.type === 'text')
            .map(segment => segment.content ?? ''),
    ];
    for (const text of texts) {
        const match = QAAP_CAPTURE_DIRECTIVE_REGEX.exec(text);
        if (match) {
            const routes = (match[1] ?? '')
                .split(/[\s,]+/)
                .map(route => route.trim().toLowerCase())
                .filter(route => DIRECTIVE_ROUTE_REGEX.test(route))
                .slice(0, MAX_DIRECTIVE_ROUTES);
            return { requested: true, routes };
        }
    }
    return { requested: false, routes: [] };
}

/**
 * True when the settled turn should get visual evidence. Two triggers, neither of which
 * guesses over natural language:
 * - the agent invoked the `[QAAP capture]` directive (the LLM interpreted the user's intent), or
 * - the turn mechanically edited a file that changes rendered output (belt for agents that
 *   forget the directive after UI work).
 */
export function conversationLikelyNeedsVisualVerification(conversation: {
    readonly messages?: readonly {
        readonly role?: string;
        readonly content?: string;
        readonly segments?: readonly { readonly type?: string; readonly name?: string; readonly args?: string; readonly content?: string }[];
    }[];
}): boolean {
    const messages = conversation.messages ?? [];
    const lastAgent = [...messages].reverse().find(message => message.role === 'agent');
    if (!lastAgent) {
        return false;
    }
    if (parseQaapCaptureDirective(lastAgent).requested) {
        return true;
    }
    return (lastAgent.segments ?? []).some(segment =>
        segment.type === 'tool'
        && /write|edit|patch/i.test(segment.name ?? '')
        && VISUAL_FILE_REGEX.test(segment.args ?? ''));
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
