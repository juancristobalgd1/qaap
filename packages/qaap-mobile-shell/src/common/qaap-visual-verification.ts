// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export const QAAP_VISUAL_VERIFICATION_MARKER = '[QAAP visual verification]';
export const QAAP_VISUAL_REPAIR_REQUIRED_MARKER = '[QAAP repair required]';

export interface QaapPreviewVisualValidationResult {
    readonly status: 'passed' | 'warning' | 'failed';
    /**
     * Backwards-compatible readiness truth. Only a clean render is `render_ready`; warnings and
     * runtime/render failures remain non-ready even when the HTTP transport answered.
     */
    readonly readiness?: 'render_ready' | 'failed';
    readonly summary: string;
    readonly issues: readonly string[];
}

const VISUAL_FILE_REGEX = /\.(?:html?|css|scss|sass|less|tsx|jsx|vue|svelte)(?:["'\s,}]|$)/i;

/**
 * Text-protocol visual-evidence tools. The AGENT (any CLI, any language) decides when evidence
 * is wanted — user intent is interpreted by the LLM, not by keyword regexes — and invokes a
 * tool by ending its reply with a directive line:
 * - `[QAAP capture]` — screenshots of the walked routes; optionally `[QAAP capture: / /pricing]`.
 * - `[QAAP record]` — a video tour (scrolling walkthrough) when motion matters; same route syntax.
 * The contract is stated in the shared agent prompt preamble.
 */
export const QAAP_CAPTURE_DIRECTIVE_PATTERN = String.raw`\[qaap\s*(capture|record)(?::([^\]]*))?\]`;
const QAAP_CAPTURE_DIRECTIVE_REGEX = new RegExp(QAAP_CAPTURE_DIRECTIVE_PATTERN, 'i');
const DIRECTIVE_ROUTE_REGEX = /^\/[\w\-/]*$/;
const MAX_DIRECTIVE_ROUTES = 3;

function parseQaapCaptureDirectiveRoutes(rawRoutes: string | undefined): readonly string[] {
    return (rawRoutes ?? '')
        .split(/[\s,]+/)
        .map(route => route.trim().toLowerCase())
        .filter(route => DIRECTIVE_ROUTE_REGEX.test(route))
        .slice(0, MAX_DIRECTIVE_ROUTES);
}

function parseQaapCaptureDirectiveMatch(match: RegExpExecArray): QaapCaptureDirective & { readonly match: string } {
    return {
        requested: true,
        mode: match[1].toLowerCase() === 'record' ? 'video' : 'image',
        routes: parseQaapCaptureDirectiveRoutes(match[2]),
        match: match[0],
    };
}

export interface QaapCaptureDirective {
    readonly requested: boolean;
    /** `video` when the agent invoked `[QAAP record]`; screenshots otherwise. */
    readonly mode: 'image' | 'video';
    /** Routes the agent asked to walk (validated, ≤3); empty means "derive them". */
    readonly routes: readonly string[];
}

/** Parses the agent's `[QAAP capture]` / `[QAAP record]` invocation out of a settled reply. */
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
            const parsed = parseQaapCaptureDirectiveMatch(match);
            return { requested: parsed.requested, mode: parsed.mode, routes: parsed.routes };
        }
    }
    return { requested: false, mode: 'image', routes: [] };
}

/** Every capture/record directive in a transcript text block (for pending UI placement). */
export function findQaapCaptureDirectivesInText(text: string): readonly (QaapCaptureDirective & { readonly match: string })[] {
    const directives: Array<QaapCaptureDirective & { readonly match: string }> = [];
    const regex = new RegExp(QAAP_CAPTURE_DIRECTIVE_PATTERN, 'gi');
    for (let match = regex.exec(text); match; match = regex.exec(text)) {
        directives.push(parseQaapCaptureDirectiveMatch(match));
    }
    return directives;
}

export function textContainsQaapCaptureDirective(text: string): boolean {
    return new RegExp(QAAP_CAPTURE_DIRECTIVE_PATTERN, 'i').test(text);
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
 * Failed evidence attached when every capture attempt failed. The verification marker settles
 * duplicate capture attempts; the repair marker makes the backend re-enter its bounded repair
 * loop instead of treating "no screenshot" as an acceptable terminal result.
 */
export function buildQaapVisualVerificationFailureMarkdown(reason: string): string {
    return [
        QAAP_VISUAL_VERIFICATION_MARKER,
        '**Visual verification · Screenshot unavailable**  ',
        reason.trim(),
        '',
        QAAP_VISUAL_REPAIR_REQUIRED_MARKER,
        nls.localize(
            'qaap/visualVerification/repairAfterCaptureFailure',
            'The app could not produce verifiable visual evidence. Re-enter the repair loop, make the preview capturable, then validate it again.',
        ),
    ].join('\n');
}

export function buildQaapVisualVerificationMarkdown(
    imageUrl: string,
    result: QaapPreviewVisualValidationResult,
): string {
    const outcome = result.status === 'passed'
        ? nls.localize('qaap/visualVerification/passed', 'Passed')
        : result.status === 'failed'
            ? nls.localize('qaap/visualVerification/failed', 'Failed')
            : nls.localize('qaap/visualVerification/needsFixes', 'Needs fixes');
    const issueLines = result.issues.length > 0
        ? `\n\n${result.issues.map(issue => `- ${issue}`).join('\n')}`
        : '';
    const repair = result.status === 'failed'
        ? ['', QAAP_VISUAL_REPAIR_REQUIRED_MARKER, nls.localize(
            'qaap/visualVerification/repairAndCapture',
            'The app is not render-ready. Re-enter the repair loop with these findings, then capture it again.',
        )]
        : [];
    return [
        QAAP_VISUAL_VERIFICATION_MARKER,
        `**Visual verification · ${outcome}**  `,
        `${result.summary}${issueLines}`,
        '',
        `![QAAP preview evidence](${imageUrl})`,
        ...repair,
    ].join('\n');
}

/** One walked page of the verified flow: the route, its screenshot, and its DOM smoke check. */
export interface QaapVisualFlowStepEvidence {
    readonly label: string;
    readonly imageUrl: string;
    readonly result: QaapPreviewVisualValidationResult;
}

/**
 * Video-evidence block: one recorded tour of the walked routes plus the per-route smoke
 * findings. The link is rendered as an inline player by the transcript frontend (it targets
 * `/visual-verifications/<id>.webm` URLs) — markdown itself has no video syntax.
 */
export function buildQaapVisualVideoMarkdown(
    videoUrl: string,
    steps: readonly { readonly label: string; readonly result: QaapPreviewVisualValidationResult }[],
): string {
    const failures = steps.filter(step => step.result.status === 'failed').length;
    const warnings = steps.filter(step => step.result.status === 'warning').length;
    const outcome = failures > 0
        ? nls.localize('qaap/visualVerification/failed', 'Failed')
        : warnings > 0
            ? nls.localize('qaap/visualVerification/needsFixes', 'Needs fixes')
            : nls.localize('qaap/visualVerification/passed', 'Passed');
    const findings = steps.flatMap(step => step.result.issues.map(issue => `- \`${step.label}\`: ${issue}`));
    return [
        QAAP_VISUAL_VERIFICATION_MARKER,
        `**Visual verification · ${outcome}**  `,
        `Recorded a video tour of ${steps.length} page${steps.length === 1 ? '' : 's'}.`,
        ...(findings.length > 0 ? ['', ...findings] : []),
        '',
        `[QAAP preview video](${videoUrl})`,
        ...(failures > 0 ? ['', QAAP_VISUAL_REPAIR_REQUIRED_MARKER, nls.localize(
            'qaap/visualVerification/repairAndRecord',
            'The app is not render-ready. Re-enter the repair loop with these findings, then record it again.',
        )] : []),
    ].join('\n');
}

/** Multi-step twin of {@link buildQaapVisualVerificationMarkdown} — one image per walked route. */
export function buildQaapVisualFlowMarkdown(steps: readonly QaapVisualFlowStepEvidence[]): string {
    const failures = steps.filter(step => step.result.status === 'failed').length;
    const warnings = steps.filter(step => step.result.status === 'warning').length;
    const outcome = failures > 0
        ? nls.localize('qaap/visualVerification/failed', 'Failed')
        : warnings > 0
            ? nls.localize('qaap/visualVerification/needsFixes', 'Needs fixes')
            : nls.localize('qaap/visualVerification/passed', 'Passed');
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
        ...(failures > 0 ? ['', QAAP_VISUAL_REPAIR_REQUIRED_MARKER, nls.localize(
            'qaap/visualVerification/repairAndCapture',
            'The app is not render-ready. Re-enter the repair loop with these findings, then capture it again.',
        )] : []),
    ].join('\n');
}
