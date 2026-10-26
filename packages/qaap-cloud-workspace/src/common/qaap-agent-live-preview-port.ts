// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { normalizeQaapPreviewConversationId } from '@theia/qaap-shared-core/lib/common/qaap-preview-identity';

/**
 * A live preview claim the task owner holds under the task's workspace root, reduced to what the
 * port pick needs. The node-side registry record is mapped to this shape by the task runner.
 */
export interface QaapAgentPreviewClaimCandidate {
    readonly port: number;
    /** Resolved absolute workspace root of the claim. */
    readonly root: string;
    /** Work Hub section that owns the claim. Absent on legacy claims (read as the default section). */
    readonly conversationId?: string;
}

/**
 * Picks the port of the preview claim that belongs to one agent task, or `undefined` when the
 * claims cannot be tied to the task. Preference order:
 *
 * 1. The claim of the task's own Work Hub section. The task links to its section through the
 *    conversation store (`taskToConversation`), and a section-scoped claim carries that section id.
 *    Sections of one project share a root but each own a preview, so this is the only signal that
 *    separates them. A task spawned outside any section has no link and skips this step.
 * 2. The claim whose root is exactly the task's cwd, among the section's claims when there are
 *    several, otherwise among all claims. Sub-roots are not matched: a child folder is not the app.
 * 3. Nothing else. A "most recent" claim is not a valid tie-breaker here: the registry keeps
 *    process-scoped records alive until their listener is reaped, so "the others are not live" never
 *    holds, and a guessed port would be reported as the app's address.
 *
 * `taskCwd` and the claim roots must be resolved the same way (absolute, no trailing separator).
 */
export function pickReservedDevPreviewPort(
    claims: readonly QaapAgentPreviewClaimCandidate[],
    taskCwd: string,
    taskConversationId: string | undefined,
): number | undefined {
    if (claims.length === 0) {
        return undefined;
    }
    if (claims.length === 1) {
        return claims[0].port;
    }
    if (taskConversationId !== undefined) {
        const section = normalizeQaapPreviewConversationId(taskConversationId);
        const owned = claims.filter(claim => normalizeQaapPreviewConversationId(claim.conversationId) === section);
        if (owned.length === 1) {
            return owned[0].port;
        }
        if (owned.length > 1) {
            return pickExactRootPort(owned, taskCwd);
        }
    }
    return pickExactRootPort(claims, taskCwd);
}

/** The only claim whose root is exactly `taskCwd`; several or none is ambiguous. */
function pickExactRootPort(claims: readonly QaapAgentPreviewClaimCandidate[], taskCwd: string): number | undefined {
    const exact = claims.filter(claim => claim.root === taskCwd);
    return exact.length === 1 ? exact[0].port : undefined;
}

/**
 * The preamble line that tells the agent where its live preview runs. Qaap's reserved port is the
 * only trustworthy address: `.qaap/preview.json` holds a preferred port the dev server may not take.
 * Without a reserved port the agent is only told not to trust that file and to refer to the Preview tab.
 */
export function buildLivePreviewPortHint(port: number | undefined): string {
    const preferredPortNote = 'The port in .qaap/preview.json is only the preferred port; never report it as the app\'s address.';
    const supervisionNote = 'Qaap already starts and supervises the dev server; never run dev/start/serve/preview commands yourself';
    return port === undefined
        ? `${preferredPortNote} Refer the user to the Preview tab for the live address. ${supervisionNote}.`
        : `Qaap's live preview for this project runs on port ${port} (see the Preview tab). ${preferredPortNote} `
            + `${supervisionNote}; verify with a one-shot HTTP check (e.g. curl) against the live port instead.`;
}
