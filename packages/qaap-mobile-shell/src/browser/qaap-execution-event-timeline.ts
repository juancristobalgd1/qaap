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
import { canPatchToolSegmentGrowth, TRANSCRIPT_TOOL_USE_ID_ATTR } from '../common/qaap-transcript-incremental-update';
import { recordTranscriptRenderMetric } from '../common/qaap-transcript-render-metrics';
import { getFileIconClass } from '../common/qaap-file-icon-utils';
import {
    isTranscriptWebSearchTool,
    resolveTranscriptWebSearchPayload,
} from '../common/qaap-transcript-web-search-core';
import {
    patchTranscriptWebSearchCard,
    TRANSCRIPT_WEB_SEARCH_CARD_CLASS,
} from './qaap-transcript-web-search-ui';
import { syncActivityToolIconMotion } from './qaap-activity-tool-icon-motion';

// ─── State (extracted to mobile-execution-timeline-state.ts) ─────────────────
export {
    timelineGroupOpenStateKey,
    timelineTerminalOpenStateKey,
    recordTimelineDetailsOpenState,
    resetTimelineDetailsOpenStateForTesting
} from './mobile-execution-timeline-state';
import {
    MOBILE_EVENT_ID_ATTR,
    timelineEventCache,
    pendingTerminalOutputResult,
    timelineDetailsOpenState,
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
import type {
    MobileExecutionTool,
    MobileExecutionEvent
} from './mobile-execution-event-types';

// ─── Builder (extracted to mobile-execution-event-builder.ts) ────────────────
export { buildMobileExecutionEvents } from './mobile-execution-event-builder';
import { buildMobileExecutionEvents } from './mobile-execution-event-builder';

// ─── Summary formatting (extracted to mobile-execution-event-fingerprint.ts) ─
export {
    formatMobileEventSummary,
    resolveMobileActivityVerb,
    fingerprintMobileExecutionEvents
} from './mobile-execution-event-fingerprint';
import {
    formatMobileEventSummary,
    fingerprintMobileExecutionEvent,
    fingerprintMobileExecutionEvents
} from './mobile-execution-event-fingerprint';

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
    MOBILE_PROCESS_ACCORDION_CLASS,
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

export function tryPatchMobileExecutionEventTimeline(
    container: HTMLElement,
    prevEvents: readonly MobileExecutionEvent[],
    nextEvents: readonly MobileExecutionEvent[],
): boolean {
    if (nextEvents.length < prevEvents.length) {
        return false;
    }
    for (let i = 0; i < prevEvents.length; i++) {
        const prevEvent = prevEvents[i];
        const nextEvent = nextEvents[i];
        if (prevEvent.id !== nextEvent.id) {
            return false;
        }
        // Event `kind` can flip while args stream in (e.g. a `run` command
        // turning out to be a `verification` command once the full args are
        // in), and a synthetic narrative can be replaced by agent-authored
        // text. Both used to force a full rebuild here, which recreated every
        // node and visibly restarted the shimmer/spinner animations mid-edit.
        // patchMobileExecutionEventSection now patches the kind-derived chrome
        // (section class, group icon/verb, tool rows) and inserts/removes the
        // narrative <p> in place instead. Tool-row `kind` can flip the same way
        // (run → verification); patchMobileToolDetail replaces that one row.
        if (nextEvent.tools.length < prevEvent.tools.length) {
            return false;
        }
        for (let j = 0; j < prevEvent.tools.length; j++) {
            const prevTool = prevEvent.tools[j];
            const nextTool = nextEvent.tools[j];
            const p = prevTool.segment;
            const n = nextTool.segment;
            if (p.toolUseId !== n.toolUseId) {
                return false;
            }
            if (p.finished && !n.finished) {
                return false;
            }
            if ((p.finished !== n.finished || p.args !== n.args || p.result !== n.result) && !canPatchToolSegmentGrowth(p, n)) {
                return false;
            }
        }
    }

    // Structural validation — every section that patching would touch must
    // already have the exact DOM shape createMobileExecutionEventElement
    // produces. This must run to completion BEFORE any mutation below: either
    // every check passes and the whole patch proceeds, or one fails and we
    // return false having written nothing, so the caller's full-rebuild
    // fallback never has to reconcile a half-patched DOM.
    const sections = container.querySelectorAll<HTMLElement>(':scope > section.theia-mobile-execution-event');
    if (sections.length !== prevEvents.length) {
        return false;
    }
    for (let i = 0; i < prevEvents.length; i++) {
        const group = sections[i].querySelector<HTMLDetailsElement>(':scope > details.theia-mobile-tool-group');
        if (!group) {
            return false;
        }
        const detailsContainer = group.querySelector<HTMLElement>(':scope > div.theia-mobile-tool-group-details');
        if (!detailsContainer || detailsContainer.children.length !== prevEvents[i].tools.length) {
            return false;
        }
    }

    for (let i = 0; i < prevEvents.length; i++) {
        if (fingerprintMobileExecutionEvent(prevEvents[i]) === fingerprintMobileExecutionEvent(nextEvents[i])) {
            recordTranscriptRenderMetric('timeline_event_item_sync_skipped');
            continue;
        }
        patchMobileExecutionEventSection(sections[i], prevEvents[i], nextEvents[i]);
    }
    const fragment = document.createDocumentFragment();
    for (let i = prevEvents.length; i < nextEvents.length; i++) {
        fragment.append(createMobileExecutionEventElement(nextEvents[i]));
    }
    if (fragment.childNodes.length > 0) {
        container.append(fragment);
    }
    return true;
}

/** Patches a single `section.theia-mobile-execution-event` element in place. */
function patchMobileExecutionEventSection(
    section: HTMLElement,
    prev: MobileExecutionEvent,
    next: MobileExecutionEvent,
): void {
    // A synthetic narrative renders no <p> at all (see
    // createMobileExecutionEventElement), so a synthetic↔agent transition
    // inserts or removes the narrative element in place.
    const existingNarrative = section.querySelector<HTMLElement>(':scope > p.theia-mobile-execution-event-narrative');
    if (next.narrativeSource === 'synthetic') {
        existingNarrative?.remove();
    } else {
        let narrativeEl = existingNarrative;
        if (!narrativeEl) {
            narrativeEl = document.createElement('p');
            narrativeEl.className = 'theia-mobile-execution-event-narrative theia-mod-agent';
            narrativeEl.textContent = next.narrative;
            section.prepend(narrativeEl);
        } else if (prev.narrative !== next.narrative) {
            narrativeEl.textContent = next.narrative;
        }
    }

    if (prev.kind !== next.kind) {
        section.classList.remove(`theia-mod-${prev.kind}`);
        section.classList.add(`theia-mod-${next.kind}`);
    }
    section.classList.toggle('theia-mod-error', next.hasError);
    section.classList.toggle('theia-mod-running', next.hasPending);

    const group = section.querySelector<HTMLDetailsElement>(':scope > details.theia-mobile-tool-group');
    if (!group) {
        // Unreachable: tryPatchMobileExecutionEventTimeline validates that
        // every section it patches already has a tool group before this
        // function is ever called.
        throw new Error('patchMobileExecutionEventSection: missing tool group despite passing validation');
    }
    group.classList.toggle('failed', next.hasError);
    group.classList.toggle('running', next.hasPending);
    group.classList.toggle('finished', !next.hasPending);
    // Preserve classes added at create time (e.g. theia-mod-web-search).

    const icon = group.querySelector<HTMLElement>('.theia-mobile-tool-group-icon');
    if (icon && prev.icon !== next.icon) {
        icon.className = `codicon ${next.icon} theia-mobile-tool-group-icon`;
    }
    if (icon) {
        syncActivityToolIconMotion(icon, next.hasPending && !next.hasError, next.kind);
    }
    const meta = group.querySelector<HTMLElement>('.theia-mobile-tool-group-meta');
    if (meta) {
        meta.classList.toggle('theia-mod-shimmer', next.hasPending);
        const summaryText = formatMobileEventSummary(next);
        if (meta.textContent !== summaryText) {
            meta.textContent = summaryText;
        }
    }
    const verb = group.querySelector<HTMLElement>('.theia-mobile-tool-group-verb');
    if (verb) {
        verb.classList.toggle('theia-mod-shimmer', next.hasPending);
        if (prev.verb !== next.verb) {
            verb.textContent = next.verb;
        }
    }

    const state = group.querySelector<HTMLElement>('.theia-mobile-tool-group-state');
    if (state && (prev.hasPending !== next.hasPending || prev.hasError !== next.hasError)) {
        state.classList.toggle('failed', next.hasError);
        state.classList.toggle('running', next.hasPending && !next.hasError);
        state.classList.toggle('complete', !next.hasPending && !next.hasError);
        const stateIcon = state.querySelector<HTMLElement>('.codicon');
        if (stateIcon) {
            stateIcon.className = `codicon ${next.hasError ? 'codicon-error' : next.hasPending ? 'codicon-loading theia-animation-spin' : 'codicon-check'}`;
        }
    }

    const detailsContainer = group.querySelector<HTMLElement>(':scope > div.theia-mobile-tool-group-details');
    if (!detailsContainer) {
        // Unreachable: validated alongside the tool group above.
        throw new Error('patchMobileExecutionEventSection: missing tool group details container despite passing validation');
    }
    for (let j = 0; j < prev.tools.length; j++) {
        const el = detailsContainer.children.item(j) as HTMLElement | null;
        if (el) {
            patchMobileToolDetail(el, prev.tools[j], next.tools[j], prev, next, j);
        }
    }
    for (let j = prev.tools.length; j < next.tools.length; j++) {
        detailsContainer.append(createMobileToolDetailElement(next, next.tools[j], j));
    }
}

/**
 * Builds (or refreshes) the terminal output from `result`, replacing the
 * pending placeholder if present. Shared by the eager render path (terminal
 * created/patched while open) and the lazy first-open handler below.
 */
// ─── Terminal Output + Element Creation (extracted to mobile-execution-event-renderer.ts) ─
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
import {
    renderMobileTerminalOutput,
    flushMobileTerminalOutputIfPending,
    ensureMobileTerminalEmptyOutputState,
    createMobileToolDetailElement,
    renderMobileShellCommandDetail,
    isMobileFileDetailKind,
    createMobileFileIconSpan,
    createMobileToolFileDetailSpan,
    createMobileExecutionEventElement
} from './mobile-execution-event-renderer';

function patchMobileToolDetail(
    el: HTMLElement,
    prevTool: MobileExecutionTool,
    nextTool: MobileExecutionTool,
    prevEvent: MobileExecutionEvent,
    event: MobileExecutionEvent,
    index: number,
): void {
    if (el instanceof HTMLDetailsElement && el.classList.contains('theia-mobile-terminal-output')) {
        el.classList.toggle('failed', nextTool.isError);
        el.classList.toggle('complete', nextTool.isFinished && !nextTool.isError);
        el.classList.toggle('running', !nextTool.isFinished);

        if (prevTool.isError !== nextTool.isError || prevTool.isFinished !== nextTool.isFinished) {
            const stateIcon = el.querySelector<HTMLElement>('.theia-mobile-terminal-output-state');
            if (stateIcon) {
                stateIcon.className =
                    `codicon ${nextTool.isError ? 'codicon-error' : nextTool.isFinished ? 'codicon-check' : 'codicon-loading theia-animation-spin'} theia-mobile-terminal-output-state`;
            }
        }

        if (prevTool.detail !== nextTool.detail) {
            const detailEl = el.querySelector<HTMLElement>('.theia-mobile-terminal-output-detail');
            if (detailEl) {
                renderMobileShellCommandDetail(detailEl, nextTool.detail);
            }
        }

        const content = el.querySelector<HTMLElement>('.theia-mobile-terminal-output-content');
        if (content) {
            const nextResult = nextTool.segment.result;
            // Always remember the latest result so a deferred (lazy) open
            // later picks up fresh content, even if it streamed in while
            // the card was collapsed.
            if (nextResult) {
                pendingTerminalOutputResult.set(el, nextResult);
            }
            const latestResult = nextResult || pendingTerminalOutputResult.get(el);
            if (!el.open) {
                // Collapsed: skip the stripAnsiEscapes + code-view DOM work
                // entirely — the lazy open handler attached at creation
                // covers it once the user expands the card. Still clear a
                // stale pending placeholder so a later open doesn't show
                // "Running…" for a tool that already finished empty.
                if (!latestResult && nextTool.isFinished) {
                    const placeholder = content.querySelector('.theia-mobile-terminal-output-pending');
                    if (placeholder) {
                        placeholder.remove();
                    }
                }
            } else if (latestResult) {
                renderMobileTerminalOutput(content, latestResult);
            } else if (nextTool.isFinished) {
                ensureMobileTerminalEmptyOutputState(content);
            }
        }
        return;
    }

    if (el.classList.contains(TRANSCRIPT_WEB_SEARCH_CARD_CLASS)
        || isTranscriptWebSearchTool(nextTool.segment.name)) {
        const payload = resolveTranscriptWebSearchPayload(nextTool.segment);
        if (el.classList.contains(TRANSCRIPT_WEB_SEARCH_CARD_CLASS)
            && patchTranscriptWebSearchCard(el, payload)) {
            return;
        }
        el.replaceWith(createMobileToolDetailElement(event, nextTool, index));
        return;
    }

    // Structural transitions (error flip adds an error icon, a kind flip
    // changes icon/link semantics) are rare one-shot changes and plain rows
    // carry no animations, so a targeted row replace is safe there.
    if (prevTool.isError !== nextTool.isError
        || prevEvent.kind !== event.kind
        || prevTool.kind !== nextTool.kind) {
        el.replaceWith(createMobileToolDetailElement(event, nextTool, index));
        return;
    }
    if (prevTool.detail === nextTool.detail && prevTool.filePath === nextTool.filePath) {
        return;
    }

    // Hot path — the detail (usually a file path) keeps changing while args
    // stream in. Mutate the row in place instead of replacing it so nothing
    // repaints beyond the changed text.
    const kindIsFile = isMobileFileDetailKind(event.kind);
    const shouldHaveIcon = kindIsFile && !!nextTool.detail;
    const existingIcon = el.querySelector<HTMLElement>(':scope > .theia-mobile-tool-detail-file-icon');
    if (!shouldHaveIcon) {
        existingIcon?.remove();
    } else if (existingIcon) {
        const iconClass = `codicon ${getFileIconClass(nextTool.detail)} theia-mobile-tool-detail-file-icon`;
        if (existingIcon.className !== iconClass) {
            existingIcon.className = iconClass;
        }
    } else {
        el.prepend(createMobileFileIconSpan(nextTool.detail));
    }

    const detailSpan = el.querySelector<HTMLElement>(':scope > .theia-mobile-tool-detail-detail');
    if (!detailSpan) {
        el.replaceWith(createMobileToolDetailElement(event, nextTool, index));
        return;
    }
    const canOpenFile = kindIsFile && event.kind !== 'delete' && !!nextTool.filePath;
    const couldOpenFile = kindIsFile && event.kind !== 'delete' && !!prevTool.filePath;
    if (canOpenFile !== couldOpenFile || prevTool.filePath !== nextTool.filePath) {
        // The file-link wiring captures `filePath` in its listeners — swap
        // just the span (no animations attached) instead of the whole row.
        detailSpan.replaceWith(createMobileToolFileDetailSpan(nextTool, canOpenFile));
    } else if (prevTool.detail !== nextTool.detail) {
        detailSpan.textContent = nextTool.detail;
    }
    el.classList.toggle('theia-mod-clickable', canOpenFile);
}

/** Open/closed `<details>` state captured before a fallback full rebuild, keyed
 *  by stable ids so a rebuild that shifts DOM indices doesn't lose state. */
interface MobileTimelineOpenState {
    readonly groups: Map<string, boolean>;
    readonly terminals: Map<string, boolean>;
}

/**
 * Key used to remember a tool group's open state across a full rebuild.
 * `m-event-<index>` ids are positional — an insertion or split upstream can
 * shift them onto a different event — so prefer the (globally stable)
 * `toolUseId` of the group's first tool row, falling back to the section's
 * event id only when no tool row is present yet.
 */
function resolveTimelineGroupStateKey(section: HTMLElement, group: HTMLDetailsElement): string | undefined {
    const detailsContainer = group.querySelector<HTMLElement>(':scope > div.theia-mobile-tool-group-details');
    const firstToolUseId = detailsContainer?.firstElementChild?.getAttribute(TRANSCRIPT_TOOL_USE_ID_ATTR);
    if (firstToolUseId) {
        return firstToolUseId;
    }
    return section.getAttribute(MOBILE_EVENT_ID_ATTR) ?? undefined;
}

/**
 * Same key derivation as {@link resolveTimelineGroupStateKey} (first tool
 * row's stable `toolUseId`, falling back to the event id), but computed at
 * element-creation time directly from the `detailsContainer` being built
 * rather than by querying an already-mounted `section` — used by
 * {@link timelineDetailsOpenState} lookups/records, which run before the
 * group is ever attached to a section. The event-id fallback is positional
 * per-timeline (stable within one render, not across renders with a
 * different event shape), which is acceptable here for the same reason it is
 * acceptable for {@link resolveTimelineGroupStateKey}.
 */

function captureTimelineOpenStateById(existing: HTMLElement): MobileTimelineOpenState {
    const groups = new Map<string, boolean>();
    const terminals = new Map<string, boolean>();
    existing.querySelectorAll<HTMLElement>(`section[${MOBILE_EVENT_ID_ATTR}]`).forEach(section => {
        const group = section.querySelector<HTMLDetailsElement>(':scope > details.theia-mobile-tool-group');
        if (group) {
            const key = resolveTimelineGroupStateKey(section, group);
            if (key) {
                groups.set(key, group.open);
            }
        }
    });
    existing.querySelectorAll<HTMLDetailsElement>('details.theia-mobile-terminal-output').forEach(details => {
        const toolUseId = details.getAttribute(TRANSCRIPT_TOOL_USE_ID_ATTR);
        if (toolUseId) {
            terminals.set(toolUseId, details.open);
        }
    });
    return { groups, terminals };
}

function restoreTimelineOpenStateById(fresh: HTMLElement, captured: MobileTimelineOpenState): void {
    fresh.querySelectorAll<HTMLElement>(`section[${MOBILE_EVENT_ID_ATTR}]`).forEach(section => {
        const group = section.querySelector<HTMLDetailsElement>(':scope > details.theia-mobile-tool-group');
        if (group) {
            const key = resolveTimelineGroupStateKey(section, group);
            if (key && captured.groups.get(key)) {
                group.open = true;
            }
        }
    });
    fresh.querySelectorAll<HTMLDetailsElement>('details.theia-mobile-terminal-output').forEach(details => {
        const toolUseId = details.getAttribute(TRANSCRIPT_TOOL_USE_ID_ATTR);
        if (toolUseId && captured.terminals.get(toolUseId)) {
            details.open = true;
            // Programmatic `open` does not fire `toggle` synchronously, so the
            // lazy first-open handler will not run here — render the deferred
            // output eagerly to avoid an open-but-empty terminal card.
            const content = details.querySelector<HTMLElement>('.theia-mobile-terminal-output-content');
            if (content) {
                flushMobileTerminalOutputIfPending(details, content);
            }
        }
    });
}

/**
 * Replaces the existing execution event timeline inside `segmentsBody` with a
 * fresh one built from `segments`.
 *
 * First tries {@link tryPatchMobileExecutionEventTimeline} to patch the
 * existing DOM in place — the common streaming case where events/tools only
 * grow — which avoids losing scroll position, focus, and `<details>` open
 * state. If that isn't safe (structure diverged too much), falls back to a
 * full rebuild, preserving open/closed `<details>` state by event id / tool
 * id rather than DOM position.
 *
 * If the timeline is wrapped in a process accordion, the accordion itself is
 * preserved — only the inner timeline is swapped.
 */
export function refreshMobileExecutionEventTimeline(
    segmentsBody: HTMLElement,
    segments: readonly QaapAgentMessageSegmentDTO[],
): HTMLElement {
    const existing = segmentsBody.querySelector<HTMLElement>(`.${MOBILE_EXECUTION_TIMELINE_CLASS}`);
    const nextEvents = buildMobileExecutionEvents(segments).events;
    const nextSignature = fingerprintMobileExecutionEvents(nextEvents);

    if (existing) {
        if (timelineEventSignatureCache.get(existing) === nextSignature) {
            recordTranscriptRenderMetric('timeline_event_sync_skipped');
            return existing;
        }
        const prevEvents = timelineEventCache.get(existing);
        if (prevEvents && tryPatchMobileExecutionEventTimeline(existing, prevEvents, nextEvents)) {
            timelineEventCache.set(existing, nextEvents);
            timelineEventSignatureCache.set(existing, nextSignature);
            recordTranscriptRenderMetric('timeline_event_patch');
            return existing;
        }
    }

    // Fallback: full rebuild.
    recordTranscriptRenderMetric('timeline_event_rebuild');
    const captured = existing ? captureTimelineOpenStateById(existing) : undefined;
    const fresh = createMobileExecutionEventTimeline(segments);
    timelineEventSignatureCache.set(fresh, nextSignature);
    if (captured) {
        restoreTimelineOpenStateById(fresh, captured);
    }
    if (existing) {
        // If the timeline is inside a process accordion, replace only the
        // timeline and keep the accordion wrapper intact.
        const accordion = existing.closest(`.${MOBILE_PROCESS_ACCORDION_CLASS}`);
        if (accordion) {
            const content = accordion.querySelector(`.${MOBILE_EXECUTION_TIMELINE_CLASS}`);
            if (content) {
                content.replaceWith(fresh);
                return fresh;
            }
        }
        existing.replaceWith(fresh);
    } else {
        segmentsBody.append(fresh);
    }
    return fresh;
}


// ─── Closing Error Card (extracted to mobile-closing-error-card.ts) ──────────
export { MOBILE_CLOSING_ERROR_CARD_CLASS, createMobileClosingErrorCardElement } from './mobile-closing-error-card';

// ─── Diff Summary (extracted to mobile-diff-summary-renderer.ts) ─────────────
export type { MobileDiffFileEntry } from './mobile-diff-summary-renderer';
export {
    resolveMobileDiffFileLanguageBadge,
    createMobileDiffSummaryElement,
    createMobileLineDiffSummaryElement
} from './mobile-diff-summary-renderer';
