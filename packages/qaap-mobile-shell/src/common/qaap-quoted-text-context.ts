// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { AIVariableResolutionRequest } from '@theia/ai-core';

/**
 * Variable name for quoted-text context entries created by dragging selected
 * text from the transcript (or any other source) onto the composer.
 */
export const QAAP_QUOTED_TEXT_VARIABLE_NAME = 'qaap-quoted-text';

/** Max chars shown in the chip subtitle. */
const QAAP_QUOTED_TEXT_SUBTITLE_MAX = 80;

/** Check whether a request targets the quoted-text variable. */
export function isQuotedTextRequest(request: AIVariableResolutionRequest): boolean {
    return request.variable.name === QAAP_QUOTED_TEXT_VARIABLE_NAME;
}

/** Truncate text for the chip subtitle (even shorter). */
export function truncateQuotedTextForSubtitle(text: string): string {
    const single = text.replace(/\s+/g, ' ').trim();
    if (single.length <= QAAP_QUOTED_TEXT_SUBTITLE_MAX) {
        return single;
    }
    return `${single.slice(0, QAAP_QUOTED_TEXT_SUBTITLE_MAX)}…`;
}
