// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    parseQaapIdentityPreviewRequestPath,
    type QaapDevPreviewClaimState,
} from '@theia/qaap-shared-core/lib/common/qaap-dev-preview';

/** Probes spent on one liveness assessment before giving up without a definitive answer. */
export const TRANSCRIPT_PREVIEW_LIVENESS_MAX_PROBES = 3;
/** Spacing between the probes of one liveness assessment. */
export const TRANSCRIPT_PREVIEW_LIVENESS_PROBE_SPACING_MS = 2500;
/**
 * Consecutive definitive failures (`stopped` / `gone`) needed before a page that is showing is
 * declared dead. A single failed probe never blanks a live page.
 */
export const TRANSCRIPT_PREVIEW_SHOWING_PAGE_FAILURES_TO_DEAD = 2;

/**
 * - `ready` — the claim answers; mount / keep it.
 * - `probe-again` — not decided yet; probe again after {@link TRANSCRIPT_PREVIEW_LIVENESS_PROBE_SPACING_MS}.
 * - `booting` — the claim exists and its dev server is still starting.
 * - `dead` — enough consecutive definitive failures: the claim is gone or its dev server stopped.
 * - `unreachable` — probes ran out without a definitive answer (network / 5xx): transient.
 */
export type TranscriptPreviewLivenessVerdict = 'ready' | 'probe-again' | 'booting' | 'dead' | 'unreachable';

export interface TranscriptPreviewLivenessOptions {
    /** Consecutive `stopped` / `gone` probes that make the claim dead (1 when nothing would be blanked). */
    readonly failuresToDead: number;
    /** Probe budget; `Infinity` for callers that accumulate states across their own timer ticks. */
    readonly maxProbes: number;
}

function isDefinitiveFailure(state: QaapDevPreviewClaimState): boolean {
    return state === 'stopped' || state === 'gone';
}

/**
 * Decides what a sequence of identity-probe states (oldest first) says about a preview claim.
 * Transient `unknown` probes (network errors, 5xx while a tenant backend cold-starts) never count
 * towards `dead` and break a run of definitive failures.
 */
export function decideTranscriptPreviewLiveness(
    states: readonly QaapDevPreviewClaimState[],
    options: TranscriptPreviewLivenessOptions,
): TranscriptPreviewLivenessVerdict {
    const last = states[states.length - 1];
    if (last === undefined) {
        return 'probe-again';
    }
    if (last === 'ready') {
        return 'ready';
    }
    if (last === 'booting') {
        return 'booting';
    }
    let trailingFailures = 0;
    for (let index = states.length - 1; index >= 0 && isDefinitiveFailure(states[index]); index--) {
        trailingFailures++;
    }
    if (trailingFailures >= Math.max(1, options.failuresToDead)) {
        return 'dead';
    }
    return states.length >= options.maxProbes ? 'unreachable' : 'probe-again';
}

/**
 * Why the stored preview is not showing, once its own claim did not answer:
 * - `superseded` — a newer live claim serves this project/section: swap to it silently.
 * - `starting` — a claim (this one or its successor) is still booting, or the backend could not be
 *   reached: show "Starting preview…" and keep probing.
 * - `stopped` — nothing is serving this project any more: offer to restart the dev server.
 */
export type TranscriptPreviewLossCause = 'superseded' | 'starting' | 'stopped';

export interface TranscriptPreviewLossInput {
    readonly verdict: Exclude<TranscriptPreviewLivenessVerdict, 'ready' | 'probe-again'>;
    /** Normalized URL of the stored (not answering) preview. */
    readonly staleUrl: string;
    /** Normalized URL of the project's current ready claim, when `/api/current` has one. */
    readonly currentClaimUrl?: string;
    /** `/api/current` has a claim for this section that is still within its start grace. */
    readonly currentClaimBooting: boolean;
}

function transcriptPreviewClaimKey(url: string): string {
    try {
        const parsed = new URL(url, 'http://localhost');
        return parseQaapIdentityPreviewRequestPath(parsed.pathname)?.previewId ?? parsed.href;
    } catch {
        return url;
    }
}

/** Two open URLs of the same identity claim (entry paths may differ) are the same preview. */
export function isSameTranscriptPreviewClaim(left: string, right: string): boolean {
    return transcriptPreviewClaimKey(left) === transcriptPreviewClaimKey(right);
}

export function classifyTranscriptPreviewLoss(input: TranscriptPreviewLossInput): TranscriptPreviewLossCause {
    if (input.currentClaimUrl && !isSameTranscriptPreviewClaim(input.currentClaimUrl, input.staleUrl)) {
        return 'superseded';
    }
    if (input.verdict !== 'dead') {
        return 'starting';
    }
    // The stored claim is dead. A successor still booting (or the same claim answering again on
    // `/api/current`, a probe race) is worth waiting for; otherwise the dev server stopped.
    return input.currentClaimBooting || !!input.currentClaimUrl ? 'starting' : 'stopped';
}
