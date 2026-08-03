// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// ─── Process Accordion (mobile) ──────────────────────────────────────────────
//
// The single collapsible container for all agent process steps. Wraps the
// execution event timeline. The header shows "Processed in Xm Ys".
// Auto-expands while working, auto-collapses on success, stays open on error.
// A manual user toggle persists for the rest of the turn — the accordion
// never auto-expands during that active turn after that. Successful final
// settlement is the only automatic collapse and it also closes a manually
// expanded accordion.
// Extracted from qaap-execution-event-timeline.ts.

import { nls } from '@theia/core/lib/common/nls';
import { destroyThinkingOrbIndicator } from './qaap-thinking-orb-indicator';
import { sharedElapsedTicker } from './qaap-shared-elapsed-ticker';
import { clearLegacyAccordionHeaderProvenance } from './mobile-turn-provenance-badge';
import type { QaapCreateAgentTaskQaiqModel } from '../common/qaap-agent-task-client';

/** CSS class on the process accordion that wraps the timeline. */
export const MOBILE_PROCESS_ACCORDION_CLASS = 'theia-mobile-process-accordion';

/** Legacy ThinkingOrb host class — no longer mounted; kept for strip/cleanup. */
export const MOBILE_PROCESS_ACCORDION_LOGO_CLASS = 'theia-mobile-process-accordion-logo';

/** Data attribute: whether the user manually toggled the accordion. */
const PROCESS_ACCORDION_USER_TOGGLED_ATTR = 'data-user-toggled';

export interface MobileProcessAccordionOptions {
    /** Whether the agent is currently working (streaming/incomplete). */
    readonly isWorking: boolean;
    /** Whether the agent ended in an error state. */
    readonly isError: boolean;
    /**
     * Codex-style live activity verb (e.g. `'Read'`, `'Run'`, `'Explore'`),
     * taken verbatim from the {@link MobileExecutionEvent.verb} of the LAST
     * event that still has pending tools. Only meaningful while `isWorking`
     * is true; ignored otherwise. When undefined (nothing pending yet, or
     * the caller couldn't resolve one), the label falls back to the generic
     * "Processing…" text.
     */
    readonly activityVerb?: string;
    /**
     * True when the turn was manually stopped by the user rather than ending
     * in a genuine failure (e.g. a `run_cancelled` AG-UI trace event). Takes
     * precedence over `isError` for the header label ("Stopped after {0}"
     * instead of "Processed in {0}") but is treated the same as `isError` for
     * expand/collapse — a stopped turn stays expanded so the partial work is
     * still visible, matching the "leave evidence visible" rule.
     */
    readonly isCancelled?: boolean;
    /**
     * Stops THIS run only. A session can hold several agents at once, so the composer's
     * session-wide Stop is not enough: each working turn carries its own stop in its header.
     * Omitted (or with `isWorking` false) the header renders without one.
     */
    readonly onStopRun?: () => void;
    /** Elapsed execution time in milliseconds, or undefined if unknown. */
    readonly elapsedMs?: number;
    /**
     * Start timestamp (ms epoch) of the current turn, if known. When set and
     * `isWorking` is true, the header label ticks live (updated every 500ms
     * via {@link sharedElapsedTicker}) instead of only updating when a patch
     * happens to re-render it.
     */
    readonly turnStartMs?: number;
    /**
     * True only when the turn has definitively finished and the final content
     * is being committed. Auto-collapse happens exclusively with this flag; a
     * transient `isWorking === false` between tools must never collapse the
     * accordion, otherwise it visibly oscillates open/closed during the stream.
     */
    readonly settled?: boolean;
    /**
     * @deprecated Provenance (agent/model) is no longer rendered inside the
     * accordion header — callers mount {@link syncTranscriptStandaloneTurnProvenance}
     * above the accordion. Fields remain accepted so existing call sites keep
     * compiling until they stop passing them.
     */
    readonly turnAgentId?: string;
    readonly turnAgentModel?: QaapCreateAgentTaskQaiqModel;
}

/**
 * Wraps an existing timeline element in a process accordion `<details>`.
 * Extracted so callers that already have a timeline (e.g. from
 * `createMobileExecutionEventTimeline`) can wrap it without rebuilding.
 */
export function wrapMobileProcessAccordion(
    timeline: HTMLElement,
    options: MobileProcessAccordionOptions,
): HTMLElement {
    const { isWorking, isError, isCancelled, elapsedMs, turnStartMs, settled } = options;
    const details = document.createElement('details');
    details.className =
        `${MOBILE_PROCESS_ACCORDION_CLASS} ${isWorking ? 'theia-mod-working' : ''} ${isError ? 'theia-mod-error' : ''}` +
        ` ${isCancelled ? 'theia-mod-cancelled' : ''} ${!isWorking && !isError && !isCancelled ? 'theia-mod-complete' : ''}`;
    // Auto-expand while working, on error, or when stopped by the user. When
    // this turn already rendered an accordion before (row rebuilt mid-stream
    // by a full re-render or a patch fallback), restore the previous element's
    // open/user-toggled state instead of recomputing it — a transient
    // `isWorking === false` snapshot at rebuild time must not create the new
    // accordion collapsed. A successful final settle starts collapsed unless
    // this turn has a remembered manual choice.
    const remembered = turnStartMs !== undefined ? processAccordionTurnState.get(turnStartMs) : undefined;
    if (remembered?.userToggled) {
        details.open = remembered.open;
        details.setAttribute(PROCESS_ACCORDION_USER_TOGGLED_ATTR, '1');
    } else if (settled === true && !isError && !isCancelled) {
        details.open = false;
    } else if (remembered) {
        // Keep mid-stream rebuilds expanded while the agent is active unless
        // the user explicitly collapsed — a detach-fired toggle can poison
        // remembered.open to false and flash the accordion closed.
        const autoShouldOpen = isWorking || isError || !!isCancelled;
        if (autoShouldOpen && !remembered.userToggled) {
            details.open = true;
        } else {
            details.open = remembered.open;
        }
    } else {
        details.open = isWorking || isError || !!isCancelled;
    }

    const header = document.createElement('summary');
    header.className = 'theia-mobile-process-accordion-header';

    const label = document.createElement('span');
    label.className = 'theia-mobile-process-accordion-label';
    label.textContent = formatMobileProcessLabel(elapsedMs, resolveMobileProcessOutcome(options));
    syncMobileProcessAccordionLabelTicker(label, isWorking, turnStartMs);

    const chevron = document.createElement('span');
    chevron.className = 'codicon codicon-chevron-down theia-mobile-process-accordion-chevron';
    chevron.setAttribute('aria-hidden', 'true');

    header.append(label);
    // Provenance (agent avatar + model) lives ABOVE the accordion via
    // syncTranscriptStandaloneTurnProvenance — never inside this summary.
    clearLegacyAccordionHeaderProvenance(header);
    syncMobileProcessAccordionRunStop(header, isWorking, options.onStopRun);
    header.append(chevron);
    // Orb lives in the pinned stream footer — never in the accordion header.
    syncMobileProcessAccordionBrandLogo(header, false);
    details.append(header);

    // Content wrapper — children are only rendered when open (lazy).
    const content = document.createElement('div');
    content.className = 'theia-mobile-process-accordion-content';
    content.append(timeline);
    details.append(content);

    // Track user manual toggles — only on summary (header) clicks, not on
    // clicks inside the content (tool details, terminal output, etc.).
    header.addEventListener('click', () => {
        details.setAttribute(PROCESS_ACCORDION_USER_TOGGLED_ATTR, '1');
    });

    // Keep the per-turn sticky state in sync with EVERY open change (user
    // click, auto expand/collapse, deferred rAF collapse) so a rebuilt
    // accordion always starts from the freshest state.
    if (turnStartMs !== undefined) {
        details.addEventListener('toggle', () => {
            // Detaching an open <details> can fire toggle(open=false) while
            // disconnected — ignore that synthetic close so sticky state stays
            // stable across remounts.
            if (!details.isConnected && !details.open) {
                return;
            }
            recordProcessAccordionTurnState(turnStartMs, details);
        });
        recordProcessAccordionTurnState(turnStartMs, details);
    }

    return details;
}

/**
 * Per-turn sticky accordion state, keyed by the turn's start timestamp.
 * Survives full row rebuilds (re-render after refetch, patch fallback), which
 * create a brand-new `<details>` element — without this, each rebuild
 * recomputed the open state from a possibly-flickering `isWorking` snapshot
 * and the accordion visibly oscillated open/closed mid-stream.
 */
const processAccordionTurnState = new Map<number, { open: boolean; userToggled: boolean }>();
const PROCESS_ACCORDION_TURN_STATE_MAX = 32;

function recordProcessAccordionTurnState(turnStartMs: number, details: HTMLDetailsElement): void {
    processAccordionTurnState.delete(turnStartMs);
    processAccordionTurnState.set(turnStartMs, {
        open: details.open,
        userToggled: details.getAttribute(PROCESS_ACCORDION_USER_TOGGLED_ATTR) === '1',
    });
    while (processAccordionTurnState.size > PROCESS_ACCORDION_TURN_STATE_MAX) {
        const oldest = processAccordionTurnState.keys().next().value;
        if (oldest === undefined) {
            break;
        }
        processAccordionTurnState.delete(oldest);
    }
}

/**
 * Strips any ThinkingOrb from the process accordion header. The orb belongs
 * only in the pinned stream footer above the composer.
 */
export function syncMobileProcessAccordionBrandLogo(
    header: HTMLElement,
    _show?: boolean,
    _activity?: {
        readonly activityVerb?: string;
        readonly isWorking?: boolean;
        readonly isError?: boolean;
        readonly isCancelled?: boolean;
    },
): void {
    for (const existing of header.querySelectorAll<HTMLElement>(`.${MOBILE_PROCESS_ACCORDION_LOGO_CLASS}`)) {
        destroyThinkingOrbIndicator(existing);
        existing.remove();
    }
}

/**
 * Registers (or unregisters) the shared elapsed-time ticker for a process
 * accordion's header label, so the "Processing… Xs" / "<Verb>… Xs" label
 * keeps ticking even during quiet stretches with no tool-segment patches.
 * Only active while `isWorking` is true and a `turnStartMs` is known;
 * unregistered otherwise (settled, error, or when the caller doesn't know the
 * turn start).
 *
 * `activityVerb` is captured in the render closure, so calling this again
 * with a different verb (as the caller does on every sync tick, re-deriving
 * it from the latest pending event) transparently re-registers with the new
 * label text — {@link QaapSharedElapsedTicker.register} keys its targets map
 * by `element`, so the previous closure for this label is simply replaced.
 */
function syncMobileProcessAccordionLabelTicker(
    label: HTMLElement,
    isWorking: boolean,
    turnStartMs: number | undefined,
): void {
    const nextKey = isWorking && turnStartMs !== undefined
        ? `${turnStartMs}`
        : '';
    const prevKey = label.dataset.qaapProcessTickerKey ?? '';
    if (nextKey === prevKey) {
        return;
    }
    label.dataset.qaapProcessTickerKey = nextKey;
    sharedElapsedTicker.unregister(label);
    if (isWorking && turnStartMs !== undefined) {
        sharedElapsedTicker.register({
            element: label,
            render: now => {
                label.textContent = formatMobileProcessLabel(Math.max(0, now - turnStartMs), 'processing');
            },
        });
    }
}

/**
 * Updates the process accordion's auto-expand/collapse state and header label
 * based on the current agent status. Called during streaming patches and
 * finalization.
 *
 * Rules:
 * - If the user has manually toggled (`data-user-toggled="1"`), the auto
 *   expansion logic below is skipped for the remainder of the turn — the flag
 *   is never cleared by this function, so the user's choice also wins at final
 *   settlement. A new turn renders a fresh accordion element/state key, so the
 *   flag naturally starts clear again.
 * - Working or error → expanded. Completed successfully → collapsed, but only
 *   on a `settled` sync. A transient `isWorking === false` during streaming
 *   leaves the accordion exactly as-is, so it never oscillates mid-stream.
 * - The header label is always updated to reflect the current elapsed time,
 *   even when the user has manually toggled the accordion.
 */
export function syncMobileProcessAccordionState(
    accordion: HTMLElement,
    options: MobileProcessAccordionOptions,
): void {
    if (!accordion.classList.contains(MOBILE_PROCESS_ACCORDION_CLASS)) {
        return;
    }
    const details = accordion as HTMLDetailsElement;
    const { isWorking, isError, isCancelled, elapsedMs, turnStartMs } = options;

    // Update the label regardless of toggle state.
    const label = details.querySelector<HTMLElement>('.theia-mobile-process-accordion-label');
    if (label) {
        if (!(isWorking && turnStartMs !== undefined)) {
            // While working with a known turn start, registering on the ticker
            // below renders immediately — skip the redundant direct write.
            label.textContent = formatMobileProcessLabel(elapsedMs, resolveMobileProcessOutcome(options));
        }
        syncMobileProcessAccordionLabelTicker(label, isWorking, turnStartMs);
    }

    const header = details.querySelector<HTMLElement>('.theia-mobile-process-accordion-header');
    if (header) {
        clearLegacyAccordionHeaderProvenance(header);
        syncMobileProcessAccordionRunStop(header, isWorking, options.onStopRun);
        syncMobileProcessAccordionBrandLogo(header, false);
    }

    // Update modifier classes.
    details.classList.toggle('theia-mod-working', isWorking);
    details.classList.toggle('theia-mod-error', isError);
    details.classList.toggle('theia-mod-cancelled', !!isCancelled);
    details.classList.toggle('theia-mod-complete', !isWorking && !isError && !isCancelled);

    const finalSuccessfulSettle = options.settled === true && !isError && !isCancelled;

    // A manual choice owns this turn, including the final settlement.
    if (details.getAttribute(PROCESS_ACCORDION_USER_TOGGLED_ATTR) === '1') {
        return;
    }

    // Auto-expand/collapse.
    //
    // Expansion happens whenever the agent is working, errored, or was
    // stopped by the user. Collapse only happens on final successful settle.
    // Any other `!isWorking` sync (streaming flicker, quiet pause between
    // tools, finalizing transition before the response is committed) leaves
    // the current open state unchanged.
    const shouldOpen = isWorking || isError || !!isCancelled;
    if (shouldOpen) {
        if (!details.open) {
            details.open = true;
            if (turnStartMs !== undefined) {
                recordProcessAccordionTurnState(turnStartMs, details);
            }
        }
        return;
    }
    if (finalSuccessfulSettle && details.open) {
        details.open = false;
        if (turnStartMs !== undefined) {
            recordProcessAccordionTurnState(turnStartMs, details);
        }
    }
}

/**
 * Returns true if the row contains a process accordion.
 */
export function hasMobileProcessAccordion(row: HTMLElement): boolean {
    return !!row.querySelector(`.${MOBILE_PROCESS_ACCORDION_CLASS}`);
}

/**
 * Finds the process accordion element within a segments body, if present.
 */
export function findMobileProcessAccordion(segmentsBody: HTMLElement): HTMLDetailsElement | undefined {
    return segmentsBody.querySelector<HTMLDetailsElement>(`.${MOBILE_PROCESS_ACCORDION_CLASS}`) ?? undefined;
}

/**
 * The process accordion header conveys one of four outcomes for the turn.
 * `processing` while streaming; once settled, exactly one of `processed`
 * (success), `stopped` (user cancelled), or `failed` (genuine error) — never
 * "Processed" for a turn the user manually stopped.
 */
type MobileProcessOutcome = 'processing' | 'processed' | 'stopped' | 'failed';

function resolveMobileProcessOutcome(
    options: Pick<MobileProcessAccordionOptions, 'isWorking' | 'isError' | 'isCancelled'>,
): MobileProcessOutcome {
    if (options.isWorking) {
        return 'processing';
    }
    if (options.isCancelled) {
        return 'stopped';
    }
    if (options.isError) {
        return 'failed';
    }
    return 'processed';
}

export const MOBILE_PROCESS_ACCORDION_RUN_STOP_CLASS = 'theia-mobile-process-accordion-run-stop';

/**
 * Adds (or removes) the per-run stop button in the accordion header. It lives in the `<summary>`,
 * so the click must not bubble into the native toggle — pressing stop must never also collapse
 * the turn the user is watching.
 */
function syncMobileProcessAccordionRunStop(
    header: HTMLElement,
    isWorking: boolean,
    onStopRun: (() => void) | undefined,
): void {
    const existing = header.querySelector<HTMLButtonElement>(`.${MOBILE_PROCESS_ACCORDION_RUN_STOP_CLASS}`);
    if (!isWorking || !onStopRun) {
        existing?.remove();
        return;
    }
    const attach = (button: HTMLButtonElement): void => {
        button.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            onStopRun();
        };
    };
    if (existing) {
        attach(existing);
        return;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = MOBILE_PROCESS_ACCORDION_RUN_STOP_CLASS;
    const label = nls.localize('theia/qaap-mobile-shell/processTimeline/stopThisRun', 'Stop this agent');
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = '<span class="codicon codicon-primitive-square" aria-hidden="true"></span>';
    attach(button);
    const chevron = header.querySelector('.theia-mobile-process-accordion-chevron');
    if (chevron) {
        header.insertBefore(button, chevron);
    } else {
        header.append(button);
    }
}

function formatMobileProcessLabel(elapsedMs: number | undefined, outcome: MobileProcessOutcome): string {
    if (elapsedMs === undefined) {
        switch (outcome) {
            case 'processing':
                return nls.localize('theia/qaap-mobile-shell/processTimeline/processing', 'Processing…');
            case 'stopped':
                return nls.localize('theia/qaap-mobile-shell/processTimeline/stopped', 'Stopped');
            case 'failed':
                return nls.localize('theia/qaap-mobile-shell/processTimeline/failed', 'Failed');
            default:
                return nls.localize('theia/qaap-mobile-shell/processTimeline/processed', 'Processed');
        }
    }
    const formatted = formatMobileElapsed(elapsedMs);
    switch (outcome) {
        case 'processing':
            return nls.localize('theia/qaap-mobile-shell/processTimeline/processingFor', 'Processing for {0}', formatted);
        case 'stopped':
            return nls.localize('theia/qaap-mobile-shell/processTimeline/stoppedAfter', 'Stopped after {0}', formatted);
        case 'failed':
            return nls.localize('theia/qaap-mobile-shell/processTimeline/failedAfter', 'Failed after {0}', formatted);
        default:
            return nls.localize('theia/qaap-mobile-shell/processTimeline/processedIn', 'Processed in {0}', formatted);
    }
}

function formatMobileElapsed(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    if (totalSeconds < 60) {
        return `${totalSeconds}s`;
    }
    const totalMinutes = Math.floor(totalSeconds / 60);
    if (totalMinutes < 60) {
        return `${totalMinutes}m ${totalSeconds % 60}s`;
    }
    return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
}
