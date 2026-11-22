// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import {
    conversationToSummary,
    getConversation,
    type QaapAgentConversationSummaryDTO,
    type QaapAgentMessageSegmentDTO,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import {
    collectTranscriptDelegationChildren,
    formatTranscriptDelegationCost,
    formatTranscriptDelegationTokens,
    parseTranscriptDelegationChildren,
    resolveTranscriptDelegationChipState,
    resolveTranscriptDelegationTotals,
    resolveTranscriptDelegationToolKind,
    type TranscriptDelegationChild,
    type TranscriptDelegationChildState,
    type TranscriptDelegationLiveStatus,
    type TranscriptDelegationTotals,
    type TranscriptDelegationToolCall,
    type TranscriptDelegationToolLabel,
} from '../common/qaap-transcript-delegation-core';

/*
 * Transcript UI of agent delegation: one chip per child under the parent's `qaaq_delegate` tool call, and the
 * "N helpers · $X" summary. Chips read live state from the thread store (the same summary the transcript
 * already subscribes to), so a child's chip moves from running to done without a reload. Pure logic lives in
 * `../common/qaap-transcript-delegation-core.ts`.
 */

export const TRANSCRIPT_DELEGATION_CARD_CLASS = 'theia-mobile-agent-delegation';
export const TRANSCRIPT_DELEGATION_CHIP_ROW_CLASS = 'theia-mobile-agent-delegation-chips';
export const TRANSCRIPT_DELEGATION_CHIP_CLASS = 'theia-mobile-agent-delegation-chip';
export const TRANSCRIPT_DELEGATION_SUMMARY_CLASS = 'theia-mobile-agent-delegation-summary';

/** Host members the delegation UI reads. Structural, so the transcript layer never imports the Work Hub. */
export interface TranscriptDelegationOpenHost {
    readonly transcriptOpenProject?: MobileProjectEntry;
    openConversationSummary?(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): Promise<void>;
    readonly conversations?: { readonly threadStore: { getSummary(id: string): QaapAgentConversationSummaryDTO | undefined } };
}

/** Conversation-wide input of a delegation card. */
export interface TranscriptDelegationCardOptions {
    /** Every tool call of the open conversation, in order (the latest child snapshot wins). */
    readonly calls: readonly TranscriptDelegationToolCall[];
    /** Live status of a child conversation, if the thread store knows it. */
    readonly liveStatus?: (childId: string) => TranscriptDelegationLiveStatus | undefined;
    /** Opens a child conversation. Omit to render the chips as read-only. */
    readonly openChild?: (childId: string) => void;
    /** Shows the conversation summary. Defaults to true only on the conversation's first delegation call. */
    readonly showSummary?: boolean;
}

const STATE_LABELS: Readonly<Record<TranscriptDelegationChildState, { readonly key: string; readonly text: string }>> = {
    queued: { key: 'theia/qaap/delegation/stateQueued', text: 'Queued' },
    running: { key: 'theia/qaap/delegation/stateRunning', text: 'Running' },
    completed: { key: 'theia/qaap/delegation/stateCompleted', text: 'Done' },
    blocked: { key: 'theia/qaap/delegation/stateBlocked', text: 'Needs input' },
    failed: { key: 'theia/qaap/delegation/stateFailed', text: 'Failed' },
    cancelled: { key: 'theia/qaap/delegation/stateCancelled', text: 'Cancelled' },
};

/** Localized text of a friendly tool label (see `resolveTranscriptDelegationToolLabel`). */
export function localizeTranscriptDelegationLabel(label: TranscriptDelegationToolLabel): string {
    return nls.localize(label.key, label.defaultText, ...label.args);
}

/** Localized state name for a chip, e.g. `Running`. */
export function localizeTranscriptDelegationState(state: TranscriptDelegationChildState): string {
    const label = STATE_LABELS[state];
    return nls.localize(label.key, label.text);
}

/** "1 helper" / "3 helpers", with " · $X" appended when the total cost is known. */
export function formatTranscriptDelegationSummaryText(totals: TranscriptDelegationTotals): string {
    const count = totals.count === 1
        ? nls.localize('theia/qaap/delegation/summaryOne', '1 helper')
        : nls.localize('theia/qaap/delegation/summaryMany', '{0} helpers', String(totals.count));
    const cost = formatTranscriptDelegationCost(totals.costUsd);
    return cost ? `${count} · ${cost}` : count;
}

/** Summary line of the conversation's helpers ("N helpers · $X"). Undefined when there are none. */
export function createTranscriptDelegationSummary(doc: Document, children: Iterable<TranscriptDelegationChild>): HTMLElement | undefined {
    const totals = resolveTranscriptDelegationTotals(children);
    if (totals.count === 0) {
        return undefined;
    }
    const summary = doc.createElement('div');
    summary.className = TRANSCRIPT_DELEGATION_SUMMARY_CLASS;
    summary.setAttribute('aria-live', 'polite');
    summary.textContent = formatTranscriptDelegationSummaryText(totals);
    return summary;
}

/** One chip: title, harness/model, state, and the cost (or the tokens when no cost is known). */
export function createTranscriptDelegationChip(
    doc: Document,
    child: TranscriptDelegationChild,
    state: TranscriptDelegationChildState,
    openChild?: (childId: string) => void,
): HTMLButtonElement {
    const chip = doc.createElement('button');
    chip.type = 'button';
    chip.className = `${TRANSCRIPT_DELEGATION_CHIP_CLASS} ${TRANSCRIPT_DELEGATION_CHIP_CLASS}-${state}`;
    chip.dataset.childId = child.childId;
    chip.disabled = !openChild;
    if (state === 'running') {
        chip.setAttribute('aria-busy', 'true');
    }

    const title = doc.createElement('span');
    title.className = `${TRANSCRIPT_DELEGATION_CHIP_CLASS}-title`;
    title.textContent = child.title;

    const meta = doc.createElement('span');
    meta.className = `${TRANSCRIPT_DELEGATION_CHIP_CLASS}-meta`;
    meta.textContent = [child.agent, child.model].filter(Boolean).join(' · ');

    const stateText = localizeTranscriptDelegationState(state);
    const stateEl = doc.createElement('span');
    stateEl.className = `${TRANSCRIPT_DELEGATION_CHIP_CLASS}-state ${TRANSCRIPT_DELEGATION_CHIP_CLASS}-state-${state}`;
    stateEl.textContent = stateText;

    const usage = doc.createElement('span');
    usage.className = `${TRANSCRIPT_DELEGATION_CHIP_CLASS}-usage`;
    // A dollar amount only when the harness priced the child; tokens otherwise; nothing if neither is known.
    usage.textContent = formatTranscriptDelegationCost(child.costUsd) ?? formatTranscriptDelegationTokens(child) ?? '';

    chip.append(title, meta, stateEl, usage);
    if (openChild) {
        const chevron = doc.createElement('span');
        chevron.className = `${TRANSCRIPT_DELEGATION_CHIP_CLASS}-chevron codicon codicon-chevron-right`;
        chevron.setAttribute('aria-hidden', 'true');
        chip.append(chevron);
    }

    const label = [child.title, stateText, meta.textContent, usage.textContent].filter(Boolean).join(', ');
    chip.setAttribute('aria-label', label);
    chip.title = openChild
        ? nls.localize('theia/qaap/delegation/openHelper', 'Open helper: {0}', child.title)
        : child.title;
    if (openChild) {
        chip.addEventListener('click', event => {
            event.preventDefault();
            openChild(child.childId);
        });
    }
    return chip;
}

/**
 * The card under a `qaaq_delegate` tool call: one chip for the child it started. Returns undefined while the call
 * has no result yet (the caller keeps the normal pill) or when the call is not a delegation.
 */
export function createTranscriptDelegationToolCard(
    doc: Document,
    call: TranscriptDelegationToolCall,
    options: TranscriptDelegationCardOptions,
): HTMLElement | undefined {
    if (resolveTranscriptDelegationToolKind(call.name) !== 'delegate') {
        return undefined;
    }
    const own = parseTranscriptDelegationChildren('delegate', call.result);
    if (own.length === 0) {
        return undefined;
    }
    const latest = collectTranscriptDelegationChildren(options.calls);
    const card = doc.createElement('section');
    card.className = TRANSCRIPT_DELEGATION_CARD_CLASS;
    card.setAttribute('aria-label', nls.localize('theia/qaap/delegation/cardLabel', 'Helpers'));

    const firstDelegation = options.calls.find(candidate => resolveTranscriptDelegationToolKind(candidate.name) === 'delegate');
    const showSummary = options.showSummary ?? firstDelegation?.toolUseId === call.toolUseId;
    if (showSummary) {
        const summary = createTranscriptDelegationSummary(doc, latest.values());
        if (summary) {
            card.append(summary);
        }
    }

    const row = doc.createElement('div');
    row.className = TRANSCRIPT_DELEGATION_CHIP_ROW_CLASS;
    for (const ownChild of own) {
        const child = latest.get(ownChild.childId) ?? ownChild;
        const state = resolveTranscriptDelegationChipState(child, options.liveStatus?.(child.childId));
        row.append(createTranscriptDelegationChip(doc, child, state, options.openChild));
    }
    card.append(row);
    return card;
}

/** Every tool call of a conversation's messages, in order, as the delegation core reads them. */
export function listTranscriptDelegationCalls(
    messages: readonly { readonly segments?: readonly QaapAgentMessageSegmentDTO[] }[] | undefined,
): TranscriptDelegationToolCall[] {
    const calls: TranscriptDelegationToolCall[] = [];
    for (const message of messages ?? []) {
        for (const segment of message.segments ?? []) {
            if (segment.type === 'tool') {
                calls.push({ toolUseId: segment.toolUseId, name: segment.name, args: segment.args, result: segment.result });
            }
        }
    }
    return calls;
}

/**
 * Opens a child conversation the way a Work Hub row tap does. Resolves the child from the thread store, or from the
 * server when the store has not loaded it yet. Does nothing when the host cannot open conversations.
 */
export async function openTranscriptDelegationChild(host: TranscriptDelegationOpenHost, childId: string): Promise<void> {
    const project = host.transcriptOpenProject;
    if (!project || !host.openConversationSummary) {
        return;
    }
    const summary = host.conversations?.threadStore.getSummary(childId)
        ?? conversationToSummary(await getConversation(childId));
    await host.openConversationSummary(project, summary);
}
