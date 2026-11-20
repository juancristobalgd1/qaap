// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// ─── Harness switch divider (DOM) ────────────────────────────────────────────
//
// A compact centred row between two turns that ran on different harnesses
// ("⇄ Switched harness · [logo] Claude Code → [logo] Codex"), and its pending
// variant at the transcript tail while the composer has a different harness
// selected for the next turn ("⇄ Handoff pending · …").

import { nls } from '@theia/core/lib/common/nls';
import type { QaapAgentConversationDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { SHELL_AGENT_ID, type QaapCreateAgentTaskQaiqModel } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import { createAgentBrandIcon, resolveAgentBrand } from '@theia/qaap-shared-core/lib/common/qaap-agent-branding';
import { formatFriendlyModelLabel } from '@theia/qaap-shared-core/lib/common/qaap-qaiq-model-catalog';
import {
    normalizeTranscriptHarnessId,
    resolveTranscriptHarnessSwitches,
    resolveTranscriptPendingHarnessSwitch,
    transcriptHarnessSwitchKey,
    type TranscriptHarnessSwitch,
    type TranscriptHarnessTurnRef,
} from '../common/qaap-transcript-harness-switch';
import { appendBeforeTranscriptLiveStatus } from '../common/qaap-transcript-live-status';

/** Class of the harness switch row (settled divider and pending marker). */
export const TRANSCRIPT_HARNESS_SWITCH_CLASS = 'theia-mobile-agent-transcript-harness-switch';
/** Wrapper that glues a settled divider to the top of the user turn that ran on the new harness. */
export const TRANSCRIPT_HARNESS_SWITCH_SEAM_CLASS = 'theia-mobile-agent-transcript-harness-switch-seam';
const PENDING_CLASS = 'theia-mod-pending';
const OPEN_CLASS = 'theia-mod-open';

let tooltipIdCounter = 0;

/** Composer host fields that say which harness the next turn of a conversation will use. */
export interface TranscriptComposerHarnessSelectionSource {
    readonly transcriptComposerPinnedAgentId?: string;
    readonly transcriptComposerPrefsConvId?: string;
    readonly transcriptComposerAgentModel?: QaapCreateAgentTaskQaiqModel;
}

/**
 * The harness the composer has selected for the next turn of `conversationId`. Only an explicit selection
 * for this conversation counts (the prefs restored on open name the last turn's harness, so they never look
 * like a switch); a selection belonging to another conversation is ignored.
 */
export function resolveTranscriptComposerHarnessSelection(
    source: TranscriptComposerHarnessSelectionSource,
    conversationId: string,
): TranscriptHarnessTurnRef | undefined {
    const agentId = source.transcriptComposerPinnedAgentId?.trim();
    if (!agentId || source.transcriptComposerPrefsConvId !== conversationId) {
        return undefined;
    }
    return { agentId, model: source.transcriptComposerAgentModel };
}

function harnessLabel(agentId: string): string {
    return resolveAgentBrand(agentId)?.label ?? agentId;
}

function modelLabel(model: QaapCreateAgentTaskQaiqModel | undefined): string | undefined {
    const modelId = model?.modelId?.trim();
    return modelId ? formatFriendlyModelLabel(modelId) : undefined;
}

function harnessWithModelLabel(turn: TranscriptHarnessTurnRef): string {
    const model = modelLabel(turn.model);
    return model ? `${harnessLabel(turn.agentId)} (${model})` : harnessLabel(turn.agentId);
}

function createHarnessEnd(turn: TranscriptHarnessTurnRef, end: 'from' | 'to'): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = `${TRANSCRIPT_HARNESS_SWITCH_CLASS}-agent theia-mod-${end}`;
    const icon = createAgentBrandIcon(turn.agentId, 'sm');
    if (icon) {
        wrap.append(icon);
    } else {
        const fallback = document.createElement('span');
        fallback.className = `codicon codicon-hubot ${TRANSCRIPT_HARNESS_SWITCH_CLASS}-agent-fallback-icon`;
        fallback.setAttribute('aria-hidden', 'true');
        wrap.append(fallback);
    }
    const label = document.createElement('span');
    label.className = `${TRANSCRIPT_HARNESS_SWITCH_CLASS}-agent-label`;
    label.textContent = harnessLabel(turn.agentId);
    wrap.append(label);
    const model = modelLabel(turn.model);
    if (model) {
        const modelEl = document.createElement('span');
        modelEl.className = `${TRANSCRIPT_HARNESS_SWITCH_CLASS}-model`;
        modelEl.textContent = model;
        wrap.append(modelEl);
    }
    return wrap;
}

/**
 * What the new harness actually receives. Every agent turn is a fresh one-shot run whose prompt embeds
 * the conversation transcript (older turns compressed, or replaced by the compaction summary, near the
 * context limit); the shell harness only runs the message as a command.
 */
export function formatTranscriptHarnessSwitchExplanation(harnessSwitch: TranscriptHarnessSwitch, pending: boolean): string {
    const to = harnessLabel(harnessSwitch.to.agentId);
    if (normalizeTranscriptHarnessId(harnessSwitch.to.agentId) === SHELL_AGENT_ID) {
        return pending
            ? nls.localize('theia/qaap/transcript/harnessSwitchPendingShell',
                'Your next message runs on {0} as a command. The shell gets no conversation context.', to)
            : nls.localize('theia/qaap/transcript/harnessSwitchShell',
                '{0} ran the message as a command. The shell gets no conversation context.', to);
    }
    return pending
        ? nls.localize('theia/qaap/transcript/harnessSwitchPendingExplanation',
            'Your next message runs on {0}. Qaap includes this conversation\'s transcript in its prompt '
            + '(older turns may be compressed or summarized), so it continues with the same context.', to)
        : nls.localize('theia/qaap/transcript/harnessSwitchExplanation',
            'From here on this conversation ran on {0}. Each turn includes the conversation\'s transcript in the prompt '
            + '(older turns may be compressed or summarized), so {0} continued with the same context.', to);
}

/** Accessible name of the divider, e.g. "Switched harness from Claude Code (Opus 5.5) to Codex". */
export function formatTranscriptHarnessSwitchAriaLabel(harnessSwitch: TranscriptHarnessSwitch, pending: boolean): string {
    const from = harnessWithModelLabel(harnessSwitch.from);
    const to = harnessWithModelLabel(harnessSwitch.to);
    return pending
        ? nls.localize('theia/qaap/transcript/harnessSwitchPendingAria', 'Handoff pending from {0} to {1}', from, to)
        : nls.localize('theia/qaap/transcript/harnessSwitchAria', 'Switched harness from {0} to {1}', from, to);
}

/**
 * Builds the divider row. The left rule carries `role="separator"` and the accessible name; the chip is a
 * button that toggles a short explanation (also shown on hover and keyboard focus).
 */
export function createTranscriptHarnessSwitchElement(harnessSwitch: TranscriptHarnessSwitch, options: { readonly pending: boolean }): HTMLElement {
    const { pending } = options;
    const row = document.createElement('div');
    row.className = TRANSCRIPT_HARNESS_SWITCH_CLASS;
    row.classList.toggle(PENDING_CLASS, pending);
    row.dataset.qaapHarnessSwitchKey = transcriptHarnessSwitchKey(harnessSwitch, pending);

    const leadingRule = document.createElement('span');
    leadingRule.className = `${TRANSCRIPT_HARNESS_SWITCH_CLASS}-rule`;
    leadingRule.setAttribute('role', 'separator');
    leadingRule.setAttribute('aria-orientation', 'horizontal');
    leadingRule.setAttribute('aria-label', formatTranscriptHarnessSwitchAriaLabel(harnessSwitch, pending));

    const tooltip = document.createElement('span');
    tooltip.className = `${TRANSCRIPT_HARNESS_SWITCH_CLASS}-tooltip`;
    tooltip.id = `qaap-harness-switch-tooltip-${++tooltipIdCounter}`;
    tooltip.setAttribute('role', 'tooltip');
    tooltip.textContent = formatTranscriptHarnessSwitchExplanation(harnessSwitch, pending);

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `${TRANSCRIPT_HARNESS_SWITCH_CLASS}-chip`;
    chip.setAttribute('aria-expanded', 'false');
    chip.setAttribute('aria-describedby', tooltip.id);
    const swap = document.createElement('span');
    swap.className = `codicon codicon-arrow-swap ${TRANSCRIPT_HARNESS_SWITCH_CLASS}-glyph`;
    swap.setAttribute('aria-hidden', 'true');
    const title = document.createElement('span');
    title.className = `${TRANSCRIPT_HARNESS_SWITCH_CLASS}-title`;
    title.textContent = pending
        ? nls.localize('theia/qaap/transcript/harnessSwitchPending', 'Handoff pending')
        : nls.localize('theia/qaap/transcript/harnessSwitchSettled', 'Switched harness');
    const dot = document.createElement('span');
    dot.className = `${TRANSCRIPT_HARNESS_SWITCH_CLASS}-dot`;
    dot.setAttribute('aria-hidden', 'true');
    dot.textContent = '·';
    const arrow = document.createElement('span');
    arrow.className = `codicon codicon-arrow-right ${TRANSCRIPT_HARNESS_SWITCH_CLASS}-arrow`;
    arrow.setAttribute('aria-hidden', 'true');
    chip.append(swap, title, dot, createHarnessEnd(harnessSwitch.from, 'from'), arrow, createHarnessEnd(harnessSwitch.to, 'to'));

    const setOpen = (open: boolean): void => {
        row.classList.toggle(OPEN_CLASS, open);
        chip.setAttribute('aria-expanded', String(open));
    };
    chip.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        setOpen(!row.classList.contains(OPEN_CLASS));
    });
    chip.addEventListener('keydown', event => {
        if (event.key === 'Escape' && row.classList.contains(OPEN_CLASS)) {
            event.stopPropagation();
            setOpen(false);
        }
    });
    chip.addEventListener('blur', () => setOpen(false));

    const chipWrap = document.createElement('span');
    chipWrap.className = `${TRANSCRIPT_HARNESS_SWITCH_CLASS}-chip-wrap`;
    chipWrap.append(chip, tooltip);

    const trailingRule = document.createElement('span');
    trailingRule.className = `${TRANSCRIPT_HARNESS_SWITCH_CLASS}-rule`;
    trailingRule.setAttribute('aria-hidden', 'true');

    row.append(leadingRule, chipWrap, trailingRule);
    return row;
}

/** Switch points per messages snapshot: snapshots are immutable per tick, so the full rebuild stays O(N). */
const switchesBySnapshot = new WeakMap<readonly object[], ReturnType<typeof resolveTranscriptHarnessSwitches>>();

/** The settled switch that lands on the message at `index`, if its turn changed harness. */
export function resolveTranscriptHarnessSwitchAt(
    conv: Pick<QaapAgentConversationDTO, 'messages'>,
    index: number,
): TranscriptHarnessSwitch | undefined {
    let switches = switchesBySnapshot.get(conv.messages);
    if (!switches) {
        switches = resolveTranscriptHarnessSwitches(conv.messages);
        switchesBySnapshot.set(conv.messages, switches);
    }
    return switches.get(index);
}

/** Glues a settled divider on top of the user turn row that ran on the new harness. */
export function wrapTranscriptRowWithHarnessSwitch(row: HTMLElement, harnessSwitch: TranscriptHarnessSwitch): HTMLElement {
    const seam = document.createElement('div');
    seam.className = TRANSCRIPT_HARNESS_SWITCH_SEAM_CLASS;
    seam.append(createTranscriptHarnessSwitchElement(harnessSwitch, { pending: false }), row);
    return seam;
}

/** One cached pending row, so footer refreshes keep the same node (no replace/measure churn per tick). */
let cachedPendingRow: { readonly conversationId: string; readonly key: string; readonly element: HTMLElement } | undefined;

/**
 * The pending marker for `conv`, or undefined when no switch is queued. Returns the same element while the
 * switch is unchanged so the virtual footer's identity check keeps it mounted.
 */
export function resolveTranscriptPendingHarnessSwitchRow(
    conv: Pick<QaapAgentConversationDTO, 'id' | 'messages'>,
    selection: TranscriptHarnessTurnRef | undefined,
): HTMLElement | undefined {
    const harnessSwitch = resolveTranscriptPendingHarnessSwitch(conv.messages, selection);
    if (!harnessSwitch) {
        return undefined;
    }
    const key = transcriptHarnessSwitchKey(harnessSwitch, true);
    if (cachedPendingRow?.conversationId === conv.id && cachedPendingRow.key === key) {
        return cachedPendingRow.element;
    }
    const element = createTranscriptHarnessSwitchElement(harnessSwitch, { pending: true });
    cachedPendingRow = { conversationId: conv.id, key, element };
    return element;
}

function resolveScroller(chatHost: HTMLElement): HTMLElement {
    if (chatHost.classList.contains('theia-mobile-agent-transcript')) {
        return chatHost;
    }
    return chatHost.querySelector<HTMLElement>(':scope > .theia-mobile-agent-transcript') ?? chatHost;
}

/**
 * Adds, moves or removes the pending marker so it is the last row of the transcript (above the live
 * status): inside the virtual footer when the list is virtualized, else at the scroller tail. Idempotent;
 * called after every transcript render/patch and whenever the composer harness selection changes.
 */
export function syncTranscriptPendingHarnessSwitchRow(
    chatHost: HTMLElement | undefined,
    conv: Pick<QaapAgentConversationDTO, 'id' | 'messages'> | undefined,
    selection: TranscriptHarnessTurnRef | undefined,
): void {
    if (!chatHost) {
        return;
    }
    const scroller = resolveScroller(chatHost);
    const next = conv ? resolveTranscriptPendingHarnessSwitchRow(conv, selection) : undefined;
    for (const stale of scroller.querySelectorAll<HTMLElement>(`.${TRANSCRIPT_HARNESS_SWITCH_CLASS}.${PENDING_CLASS}`)) {
        if (stale !== next) {
            stale.remove();
        }
    }
    if (!next) {
        return;
    }
    const footer = scroller.querySelector<HTMLElement>('.theia-transcript-virtual-footer');
    if (footer) {
        if (footer.lastElementChild !== next) {
            footer.append(next);
        }
        return;
    }
    if (next.parentElement === scroller) {
        // Already at the tail when every later sibling is the live status.
        let sibling = next.nextElementSibling;
        while (sibling && sibling.classList.contains('theia-mobile-agent-live-status')) {
            sibling = sibling.nextElementSibling;
        }
        if (!sibling) {
            return;
        }
    }
    appendBeforeTranscriptLiveStatus(scroller, next);
}
