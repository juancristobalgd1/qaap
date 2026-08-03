// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// ─── Execution Event Timeline state (mobile) ─────────────────────────────────
//
// Module-level mutable state shared across the execution event timeline
// rendering and patching modules: DOM caches, the global per-tool open/closed
// state map (with LRU eviction), and the stable content signature cache.
// Extracted from qaap-execution-event-timeline.ts so the state contract is
// decoupled from the rendering logic. ES module singletons — the maps live for
// the process lifetime, which is intentional (see doc comments below).

import type { MobileExecutionEvent } from './mobile-execution-event-types';

/** Data attribute: stable id of the execution event a `section` element renders. */
export const MOBILE_EVENT_ID_ATTR = 'data-mobile-event-id';

/** Caches the last-rendered event list for a timeline container so streaming
 *  patches can diff against it without re-parsing the DOM. */
export const timelineEventCache = new WeakMap<HTMLElement, readonly MobileExecutionEvent[]>();

/** Latest raw (un-stripped) terminal result for a collapsed terminal `<details>`
 *  card, keyed by the details element. Terminal cards are collapsed by
 *  default, so building the highlighted output (which requires
 *  stripAnsiEscapes over the full — possibly large — result) is deferred
 *  until the card is first opened; this map lets the deferred render pick up
 *  whatever the latest streamed result was by then. */
export const pendingTerminalOutputResult = new WeakMap<HTMLDetailsElement, string>();

/**
 * Global per-tool `<details>` open/closed state, keyed by a stable id: a
 * terminal card's `TRANSCRIPT_TOOL_USE_ID_ATTR` value, or a tool group's key
 * as derived by `resolveTimelineGroupStateKey` /
 * `resolveTimelineGroupCreationKey`. This is deliberately global and
 * long-lived (unlike `processAccordionTurnState`, scoped to a turn, or
 * `captureTimelineOpenStateById`, scoped to a single in-place rebuild):
 * a long transcript's virtual list fully removes rows that scroll out of
 * view (`row.remove()`) and builds a brand-new row from scratch when the
 * user scrolls back — there is no "existing" element to capture state from
 * at that point, only the stable tool-use id to look up. Capped with a
 * simple LRU eviction so a very long session doesn't grow this unbounded.
 *
 * Keys are namespaced with a `group:`/`terminal:` prefix (see
 * {@link timelineGroupOpenStateKey} / {@link timelineTerminalOpenStateKey}):
 * a tool group's derived key falls back to its *first tool row's* toolUseId,
 * which — for an event with exactly one terminal tool — is the very same
 * toolUseId as that terminal card itself. Without the prefix, toggling the
 * outer group would silently overwrite the independent remembered state of
 * the inner terminal card (and vice versa).
 */
export const timelineDetailsOpenState = new Map<string, boolean>();
export const TIMELINE_DETAILS_OPEN_STATE_MAX = 256;

export const TIMELINE_GROUP_OPEN_STATE_PREFIX = 'group:';
export const TIMELINE_TERMINAL_OPEN_STATE_PREFIX = 'terminal:';

export function timelineGroupOpenStateKey(key: string): string {
    return TIMELINE_GROUP_OPEN_STATE_PREFIX + key;
}

export function timelineTerminalOpenStateKey(toolUseId: string): string {
    return TIMELINE_TERMINAL_OPEN_STATE_PREFIX + toolUseId;
}

/** Records the latest user/programmatic open state for `key`, evicting the
 *  least-recently-touched entry once the cap is exceeded. */
export function recordTimelineDetailsOpenState(key: string, open: boolean): void {
    timelineDetailsOpenState.delete(key);
    timelineDetailsOpenState.set(key, open);
    while (timelineDetailsOpenState.size > TIMELINE_DETAILS_OPEN_STATE_MAX) {
        const oldest = timelineDetailsOpenState.keys().next().value;
        if (oldest === undefined) {
            break;
        }
        timelineDetailsOpenState.delete(oldest);
    }
}

/**
 * Test-only helper: clears {@link timelineDetailsOpenState}. This module-level
 * map is deliberately process-lifetime-scoped in production (see the doc
 * comment above), but that means specs that reuse tool-use ids (e.g.
 * `tool-read-page`) across `it()` blocks leak open/closed state between them.
 * Call this from `beforeEach()` in specs that assert default collapsed/open
 * state for a tool group or terminal card. Not for production use.
 */
export function resetTimelineDetailsOpenStateForTesting(): void {
    timelineDetailsOpenState.clear();
}

/** Stable content signature for the whole rendered event list. Used to avoid
 *  touching DOM at all on duplicate SSE frames. */
export const timelineEventSignatureCache = new WeakMap<HTMLElement, string>();
