// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// ─── Codex-style Execution Event Timeline (mobile) ───────────────────────────
//
// Replaces the old "tool log" rendering with an event-based tree:
//
//   AgentExecution
//     ExecutionEvent  (narrative + tool group)
//       Narrative     "I'm inspecting the project structure."
//       ToolGroup     (collapsed by default)
//         ToolSummary "3 searches ▶"
//         ToolDetails (hidden until expanded)
//     ExecutionEvent
//       Narrative     "I found the rendering pipeline."
//       ToolGroup     ...
//     DiffSummary     (the natural closing)
//
// Tools are CHILDREN of events, never siblings.
// The narrative is the primary element; tools are secondary.
// Only Terminal/Error/Diff get cards — everything else is text.
// ─────────────────────────────────────────────────────────────────────────────

import type { QaapAgentMessageSegmentDTO } from '../common/qaap-agent-conversation-client';

// ─── State (extracted to mobile-execution-timeline-state.ts) ─────────────────
export {
    timelineGroupOpenStateKey,
    timelineTerminalOpenStateKey,
    recordTimelineDetailsOpenState,
    resetTimelineDetailsOpenStateForTesting
} from './mobile-execution-timeline-state';
import {
    timelineEventCache,
    timelineEventSignatureCache
} from './mobile-execution-timeline-state';

// ─── Types (extracted to mobile-execution-event-types.ts) ────────────────────
export type {
    MobileEventKind,
    MobileExecutionTool,
    MobileExecutionEvent,
    MobileExecutionTimeline
} from './mobile-execution-event-types';
export { MOBILE_TOOL_FILE_OPEN_EVENT } from './mobile-execution-event-types';

// ─── Builder (extracted to mobile-execution-event-builder.ts) ────────────────
export { buildMobileExecutionEvents } from './mobile-execution-event-builder';
import { buildMobileExecutionEvents } from './mobile-execution-event-builder';

// ─── Summary formatting (extracted to mobile-execution-event-fingerprint.ts) ─
export {
    formatMobileEventSummary,
    resolveMobileActivityVerb,
    fingerprintMobileExecutionEvents
} from './mobile-execution-event-fingerprint';
import { fingerprintMobileExecutionEvents } from './mobile-execution-event-fingerprint';

// ─── DOM Rendering ───────────────────────────────────────────────────────────

/** CSS class on the top-level execution event timeline container. */
export const MOBILE_EXECUTION_TIMELINE_CLASS = 'theia-mobile-execution-timeline';

/**
 * Creates the Codex-style execution event timeline as a DOM element.
 * Replaces the old activity timeline + tool pills + diff/verification cards.
 *
 * Note: closing narrative (text after the last tool) is NOT rendered here.
 * The caller is responsible for rendering it as a rich content block so the
 * agent's final answer gets full markdown rendering.
 */
export function createMobileExecutionEventTimeline(
    segments: readonly QaapAgentMessageSegmentDTO[],
): HTMLElement {
    const timeline = buildMobileExecutionEvents(segments);
    const container = document.createElement('div');
    container.className = MOBILE_EXECUTION_TIMELINE_CLASS;

    const fragment = document.createDocumentFragment();
    for (const event of timeline.events) {
        fragment.append(createMobileExecutionEventElement(event));
    }
    container.append(fragment);

    timelineEventCache.set(container, timeline.events);
    timelineEventSignatureCache.set(container, fingerprintMobileExecutionEvents(timeline.events));
    return container;
}

/**
 * Returns true if the row already contains a Codex-style execution event timeline.
 * Used by streaming-patch methods to decide whether to rebuild the new timeline
 * instead of falling back to the legacy activity-timeline DOM.
 */
export function hasMobileExecutionEventTimeline(row: HTMLElement): boolean {
    return !!row.querySelector(`.${MOBILE_EXECUTION_TIMELINE_CLASS}`);
}

// ─── Process Accordion (extracted to mobile-process-accordion.ts) ────────────
export type { MobileProcessAccordionOptions } from './mobile-process-accordion';
export {
    MOBILE_PROCESS_ACCORDION_CLASS,
    MOBILE_PROCESS_ACCORDION_LOGO_CLASS,
    MOBILE_PROCESS_ACCORDION_RUN_STOP_CLASS,
    wrapMobileProcessAccordion,
    syncMobileProcessAccordionBrandLogo,
    syncMobileProcessAccordionState,
    hasMobileProcessAccordion,
    findMobileProcessAccordion
} from './mobile-process-accordion';
import {
    wrapMobileProcessAccordion
} from './mobile-process-accordion';
import type { MobileProcessAccordionOptions } from './mobile-process-accordion';

/**
 * Creates the process accordion `<details>` element that wraps the execution
 * event timeline. The timeline is rendered inside as a child.
 *
 * Bridge function: stays in this module to avoid a circular dependency
 * (the accordion module would otherwise need to import the timeline builder
 * from here). Delegates to {@link wrapMobileProcessAccordion}.
 */
export function createMobileProcessAccordion(
    segments: readonly QaapAgentMessageSegmentDTO[],
    options: MobileProcessAccordionOptions,
): HTMLElement {
    const timeline = createMobileExecutionEventTimeline(segments);
    return wrapMobileProcessAccordion(timeline, options);
}

// ─── Turn Provenance Badge (extracted to mobile-turn-provenance-badge.ts) ────
export {
    MOBILE_PROCESS_ACCORDION_PROVENANCE_CLASS,
    MOBILE_TURN_PROVENANCE_STANDALONE_CLASS,
    syncTranscriptStandaloneTurnProvenance
} from './mobile-turn-provenance-badge';

// ─── Timeline Patcher (extracted to mobile-execution-timeline-patcher.ts) ─────
export {
    tryPatchMobileExecutionEventTimeline,
    refreshMobileExecutionEventTimeline
} from './mobile-execution-timeline-patcher';

// ─── Element Creation (extracted to mobile-execution-event-renderer.ts) ──────
export {
    renderMobileTerminalOutput,
    flushMobileTerminalOutputIfPending,
    ensureMobileTerminalEmptyOutputState,
    attachMobileTerminalLazyOpenHandler,
    createMobileExecutionEventElement,
    createMobileToolGroupElement,
    createMobileToolDetailElement,
    isMobileFileDetailKind,
    createMobileToolFileDetailSpan,
    createMobileFileIconSpan,
    createMobileTerminalOutputElement,
    renderMobileShellCommandDetail
} from './mobile-execution-event-renderer';
import { createMobileExecutionEventElement } from './mobile-execution-event-renderer';

// ─── Closing Error Card (extracted to mobile-closing-error-card.ts) ──────────
export { MOBILE_CLOSING_ERROR_CARD_CLASS, createMobileClosingErrorCardElement } from './mobile-closing-error-card';

// ─── Diff Summary (extracted to mobile-diff-summary-renderer.ts) ─────────────
export type { MobileDiffFileEntry } from './mobile-diff-summary-renderer';
export {
    resolveMobileDiffFileLanguageBadge,
    createMobileDiffSummaryElement,
    createMobileLineDiffSummaryElement
} from './mobile-diff-summary-renderer';
