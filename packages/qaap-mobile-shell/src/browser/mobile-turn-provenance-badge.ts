// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// ─── Turn Provenance Badge (mobile) ──────────────────────────────────────────
//
// Adds, updates, or removes the turn-provenance badge (agent avatar, optionally
// with the provider's icon overlaid in the corner and the short model name as
// text) as the FIRST child of the turn's segments body. Extracted from
// qaap-execution-event-timeline.ts.

import { createAgentIdentityElement, resolveAgentDisplayLabel } from './qaap-agent-ui';
import { formatQaiqModelIdShortLabel, formatQaiqModelSelectionLabel } from '../common/qaap-qaiq-model-catalog';
import type { QaapCreateAgentTaskQaiqModel } from '../common/qaap-agent-task-client';

/**
 * Legacy class formerly used when provenance lived inside the accordion
 * `<summary>`. Kept exported so tests can assert it is never mounted; live
 * code only clears leftover nodes with this class.
 */
export const MOBILE_PROCESS_ACCORDION_PROVENANCE_CLASS = 'theia-mobile-process-accordion-provenance';

/**
 * Class of the turn-provenance badge (agent avatar + provider sub-icon + short
 * model label). Mounted as the FIRST child of the turn's segments body,
 * ABOVE the process accordion when tools exist — never inside the accordion
 * header. See {@link syncTranscriptStandaloneTurnProvenance}.
 */
export const MOBILE_TURN_PROVENANCE_STANDALONE_CLASS = 'theia-mobile-turn-provenance-standalone';

/**
 * The badge text/title pair for the turn-provenance badge. The VISIBLE text is only ever the
 * short model id (the provider is already conveyed by the avatar's corner sub-icon, see
 * {@link createAgentIdentityElement} -- showing "Provider · modelId" in text on top of that
 * icon would be the exact redundancy this design replaces) or, when no model is known, the
 * agent's own display label. `fullLabel` is the full, unambiguous "Agent · Provider · modelId"
 * string reserved for the `title` tooltip -- the only place that needs to fully disambiguate
 * once the visible text is just "free". Always skips inventing a model label when
 * `turnAgentModel` is unset -- some agent CLIs run their own default model without reporting
 * a pick.
 */
function resolveTranscriptProvenanceBadgeText(
    turnAgentId: string,
    turnAgentModel: QaapCreateAgentTaskQaiqModel | undefined,
): { readonly visibleLabel: string; readonly fullLabel: string } {
    const agentLabel = resolveAgentDisplayLabel(turnAgentId);
    const modelId = turnAgentModel?.modelId?.trim();
    if (!modelId) {
        return { visibleLabel: agentLabel, fullLabel: agentLabel };
    }
    return {
        visibleLabel: formatQaiqModelIdShortLabel(modelId),
        fullLabel: `${agentLabel} · ${formatQaiqModelSelectionLabel(turnAgentModel!)}`,
    };
}

/** Idempotency key for a provenance badge: the raw agent/vendor/modelId tuple, not the derived
 *  visible text -- two different picks that happen to format to the same short model id must
 *  still be recognized as a change (and refresh the title), and this must never collide with a
 *  falsy sentinel the way an empty string could. */
function transcriptProvenanceBadgeKey(
    turnAgentId: string,
    turnAgentModel: QaapCreateAgentTaskQaiqModel | undefined,
): string {
    return `${turnAgentId}::${turnAgentModel?.vendor ?? ''}::${turnAgentModel?.modelId ?? ''}`;
}

/**
 * Builds the turn-provenance badge element: the same agent-avatar + provider-sub-icon + short
 * model label visual as the composer's agent picker (see {@link createAgentIdentityElement}),
 * carrying the full unambiguous label as its `title` and the raw provenance tuple as its
 * idempotency dataset key. Used exclusively by {@link syncTranscriptStandaloneTurnProvenance}.
 */
function createTranscriptProvenanceBadgeElement(
    hostClass: string,
    turnAgentId: string,
    turnAgentModel: QaapCreateAgentTaskQaiqModel | undefined,
): HTMLElement {
    const { visibleLabel, fullLabel } = resolveTranscriptProvenanceBadgeText(turnAgentId, turnAgentModel);
    const badge = createAgentIdentityElement({
        agentId: turnAgentId,
        agentModel: turnAgentModel,
        label: visibleLabel,
    });
    badge.classList.add(hostClass);
    badge.dataset.qaapProvenanceKey = transcriptProvenanceBadgeKey(turnAgentId, turnAgentModel);
    badge.title = fullLabel;
    return badge;
}

/** Drops any leftover provenance badge that older builds mounted inside the accordion summary. */
function clearLegacyAccordionHeaderProvenance(header: HTMLElement): void {
    for (const existing of header.querySelectorAll<HTMLElement>(`.${MOBILE_PROCESS_ACCORDION_PROVENANCE_CLASS}`)) {
        existing.remove();
    }
}

/**
 * Adds, updates, or removes the turn-provenance badge (agent avatar, optionally with the
 * provider's icon overlaid in the corner and the short model name as text) as the FIRST child
 * of the turn's segments body — ABOVE the process accordion when tools exist, or above the
 * thought brief / text blocks when they do not. Never mounts inside the accordion header.
 *
 * Idempotent: re-running with the same `turnAgentId`/`turnAgentModel` is a no-op (dataset-key
 * compare), so calling it on every streaming sync tick never duplicates or flickers the badge.
 * An undefined `turnAgentId` (historical turns predating the field) removes any existing badge
 * and leaves no gap -- no reserved space, no layout shift.
 *
 * Always uses `prepend`, so repeated calls keep the badge in the same slot even after later
 * content (accordion, thought brief, text blocks) has been appended.
 */
export function syncTranscriptStandaloneTurnProvenance(
    body: HTMLElement,
    turnAgentId: string | undefined,
    turnAgentModel: QaapCreateAgentTaskQaiqModel | undefined,
): void {
    const existing = body.querySelector<HTMLElement>(`:scope > .${MOBILE_TURN_PROVENANCE_STANDALONE_CLASS}`);
    if (!turnAgentId) {
        existing?.remove();
        return;
    }
    const key = transcriptProvenanceBadgeKey(turnAgentId, turnAgentModel);
    if (existing) {
        if (existing.dataset.qaapProvenanceKey === key) {
            // Keep the badge first even when identity is unchanged (accordion may have been
            // rebuilt and prepended ahead of it).
            if (body.firstElementChild !== existing) {
                body.prepend(existing);
            }
            return;
        }
        existing.remove();
    }
    const badge = createTranscriptProvenanceBadgeElement(MOBILE_TURN_PROVENANCE_STANDALONE_CLASS, turnAgentId, turnAgentModel);
    body.prepend(badge);
}

// Exported for consumers that need to clear legacy provenance nodes (e.g. the
// process accordion wrapper). Not part of the public re-export surface.
export { clearLegacyAccordionHeaderProvenance };
