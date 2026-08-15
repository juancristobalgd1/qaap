// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { AIVariable, AIVariableResolutionRequest, ResolvedAIContextVariable } from '@theia/ai-core';
import { nls } from '@theia/core/lib/common/nls';

/**
 * Variable name for quoted-text context entries created by dragging selected
 * text from the transcript (or any other source) onto the composer.
 */
export const QAAP_QUOTED_TEXT_VARIABLE_NAME = 'qaap-quoted-text';

/** Max chars stored in the `arg` — longer text is truncated with an ellipsis. */
const QAAP_QUOTED_TEXT_ARG_MAX = 500;

/** Max chars shown in the chip subtitle. */
const QAAP_QUOTED_TEXT_SUBTITLE_MAX = 80;

/**
 * The ad-hoc variable definition. It is not registered as a contribution
 * (no resolver) — the variable is always created as an already-resolved
 * `ResolvedAIContextVariable` so no async resolution is needed.
 */
export const QAAP_QUOTED_TEXT_VARIABLE: AIVariable = {
    id: QAAP_QUOTED_TEXT_VARIABLE_NAME,
    name: QAAP_QUOTED_TEXT_VARIABLE_NAME,
    label: nls.localize('qaap/mobileProjects/quotedText', 'Quoted text'),
    description: nls.localize(
        'qaap/mobileProjects/quotedTextVariableDescription',
        'Text dragged from the transcript or other sources',
    ),
    isContextVariable: true,
    iconClasses: ['codicon', 'codicon-quote'],
};

/**
 * Create a resolved context variable from a plain-text string. The text is
 * stored both in `arg` (truncated for the chip) and in `contextValue` (full
 * text, used by the agent when the context is submitted).
 */
export function createQuotedTextContextVariable(text: string): ResolvedAIContextVariable {
    const truncated = truncateForArg(text);
    return {
        variable: QAAP_QUOTED_TEXT_VARIABLE,
        arg: truncated,
        value: text,
        contextValue: text,
    };
}

/**
 * Create an `AIVariableResolutionRequest` from quoted text. Used when pushing
 * the entry onto the composer context stack (which expects a request, not a
 * resolved variable).
 */
export function createQuotedTextRequest(text: string): AIVariableResolutionRequest {
    return {
        variable: QAAP_QUOTED_TEXT_VARIABLE,
        arg: truncateForArg(text),
    };
}

/** Check whether a request targets the quoted-text variable. */
export function isQuotedTextRequest(request: AIVariableResolutionRequest): boolean {
    return request.variable.name === QAAP_QUOTED_TEXT_VARIABLE_NAME;
}

/** Truncate text for the `arg` field (keeps the chip label short). */
function truncateForArg(text: string): string {
    const single = text.replace(/\s+/g, ' ').trim();
    if (single.length <= QAAP_QUOTED_TEXT_ARG_MAX) {
        return single;
    }
    return `${single.slice(0, QAAP_QUOTED_TEXT_ARG_MAX)}…`;
}

/** Truncate text for the chip subtitle (even shorter). */
export function truncateQuotedTextForSubtitle(text: string): string {
    const single = text.replace(/\s+/g, ' ').trim();
    if (single.length <= QAAP_QUOTED_TEXT_SUBTITLE_MAX) {
        return single;
    }
    return `${single.slice(0, QAAP_QUOTED_TEXT_SUBTITLE_MAX)}…`;
}
