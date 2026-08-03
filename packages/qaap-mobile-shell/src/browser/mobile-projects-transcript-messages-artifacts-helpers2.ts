// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only With Classpath-exception-2.0
// *****************************************************************************

// Phase 12 extractions from MobileProjectsTranscriptMessagesArtifactsUi.
// Each function receives its dependencies explicitly — no instance state access.

import { nls } from '@theia/core/lib/common/nls';
import type { QaapAgentConversationDTO, QaapAgentMessageDTO, QaapAgentMessageSegmentDTO } from '../common/qaap-agent-conversation-client';
import type { TranscriptStreamTimeoutCause } from '../common/qaap-transcript-stream-health';
import type { TranscriptActivityNavigationItem, TranscriptActivityNavigateTarget, TranscriptActivityNavigationOptions } from '../common/qaap-transcript-activity-navigation';
import { reportQaapClientError } from '../common/qaap-client-error-report';
import { TranscriptActivityTimingStore } from '../common/qaap-transcript-activity-timing';
import { TRANSCRIPT_MESSAGE_ID_ATTR } from '../common/qaap-transcript-incremental-update';

// ─── DI-extracted: bindTranscriptActivityListActions (2 this. method calls) ──

export interface BindTranscriptActivityListActionsDeps {
    handleTranscriptActivityNavigation(item: TranscriptActivityNavigationItem, ownerRow: HTMLElement): void;
    handleTranscriptFileOpen(filePath: string): void;
}

export function bindTranscriptActivityListActions(
    list: HTMLElement,
    ownerRow: HTMLElement,
    deps: BindTranscriptActivityListActionsDeps,
): void {
    if (list.dataset.transcriptActivityListBound === '1') {
        return;
    }
    list.dataset.transcriptActivityListBound = '1';
    const activate = (li: HTMLElement): void => {
        const navigate = li.dataset.transcriptActivityAction as TranscriptActivityNavigateTarget | undefined;
        if (!navigate) {
            return;
        }
        const navigationItem: TranscriptActivityNavigationItem = {
            label: li.getAttribute('aria-label') ?? '',
            state: 'success',
            navigate,
            filePath: li.dataset.transcriptActivityFilePath,
            segmentIndex: li.dataset.transcriptActivitySegmentIndex
                ? Number(li.dataset.transcriptActivitySegmentIndex)
                : undefined,
        };
        deps.handleTranscriptActivityNavigation(navigationItem, ownerRow);
    };
    list.addEventListener('click', event => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }
        const chip = target.closest('.theia-mobile-agent-activity-file-chip');
        if (chip) {
            const li = chip.closest<HTMLElement>('li');
            const filePath = li?.dataset.transcriptActivityFilePath;
            if (filePath) {
                event.preventDefault();
                event.stopPropagation();
                deps.handleTranscriptFileOpen(filePath);
            }
            return;
        }
        if (target.closest('button,a')) {
            return;
        }
        if (target.closest('.theia-mobile-agent-activity-expand-summary, .theia-mobile-agent-activity-thinking-summary')) {
            return;
        }
        const li = target.closest<HTMLElement>('li.theia-mod-clickable[data-transcript-activity-action]');
        if (!li) {
            return;
        }
        if (li.classList.contains('theia-mod-expand-close-guarded')) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        activate(li);
    });
    list.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }
        const li = target.closest<HTMLElement>('li.theia-mod-clickable[data-transcript-activity-action]');
        if (!li) {
            return;
        }
        event.preventDefault();
        activate(li);
    });
}

// ─── Pure: appendFreeModelTimeoutHint (0 this. refs) ─────────────────────────

export function appendFreeModelTimeoutHint(detail: string | undefined, conv?: QaapAgentConversationDTO): string | undefined {
    const modelId = (conv?.agentModel?.modelId ?? conv?.qaiqModel?.modelId ?? '').toLowerCase();
    if (!modelId || !(modelId.endsWith(':free') || modelId.endsWith('/free'))) {
        return detail;
    }
    const hint = nls.localize(
        'qaap/mobileProjects/freeModelTimeoutHint',
        'Free models ({0}) can be slow or drop requests — if this repeats, try another model.',
        modelId,
    );
    return detail ? `${detail} ${hint}` : hint;
}

// ─── DI-extracted: syncTranscriptStreamTimeoutBanner (4 this. method calls) ──

export interface SyncTranscriptStreamTimeoutBannerDeps {
    createTranscriptStreamTimeoutBanner(cause?: TranscriptStreamTimeoutCause): HTMLElement;
    refreshTranscriptExecutionChrome(): void;
    resolveTranscriptStreamTimeoutDetail(cause?: TranscriptStreamTimeoutCause): string | undefined;
}

export function syncTranscriptStreamTimeoutBanner(
    segmentsBody: ParentNode,
    timedOut: boolean,
    cause: TranscriptStreamTimeoutCause | undefined,
    conv: QaapAgentConversationDTO | undefined,
    deps: SyncTranscriptStreamTimeoutBannerDeps,
): void {
    const attr = 'data-transcript-stream-timeout';
    let banner = segmentsBody.querySelector<HTMLElement>(`.theia-mobile-agent-stream-timeout-banner`);
    if (!timedOut) {
        banner?.remove();
        return;
    }
    if (!banner) {
        banner = deps.createTranscriptStreamTimeoutBanner(cause);
        banner.setAttribute(attr, 'true');
        segmentsBody.append(banner);
        deps.refreshTranscriptExecutionChrome();
        // First appearance of the "didn't respond in time" card: leave a server-side
        // breadcrumb. This card marks exactly the failures the backend cannot see on its
        // own (silent streams, client-only stalls) — production diagnosis repeatedly
        // depended on the user describing this screen.
        reportQaapClientError('transcript-stream-timeout', deps.resolveTranscriptStreamTimeoutDetail(cause) ?? 'no visible progress');
        return;
    }
    const message = banner.querySelector<HTMLElement>('.theia-mobile-agent-stream-timeout-message');
    const detail = banner.querySelector<HTMLElement>('.theia-mobile-agent-stream-timeout-detail');
    const detailText = appendFreeModelTimeoutHint(deps.resolveTranscriptStreamTimeoutDetail(cause), conv);
    if (message) {
        message.textContent = nls.localize(
            'qaap/mobileProjects/transcriptStreamTimedOut',
            'The agent didn’t respond in time',
        );
    }
    if (detailText) {
        if (!detail) {
            const detailEl = document.createElement('p');
            detailEl.className = 'theia-mobile-agent-stream-timeout-detail';
            detailEl.textContent = detailText;
            message?.after(detailEl);
        } else {
            detail.textContent = detailText;
        }
    } else {
        detail?.remove();
    }
}

// ─── DI-extracted: resolveTranscriptActivityRowContext (4 this. method calls) ─

export interface ResolveTranscriptActivityRowContextDeps {
    activityTiming: TranscriptActivityTimingStore;
    resolvePendingTranscriptToolUseIds(
        conv: QaapAgentConversationDTO | undefined,
        segments: readonly QaapAgentMessageSegmentDTO[],
    ): ReadonlySet<string> | undefined;
}

export function resolveTranscriptActivityRowContext(
    row: HTMLElement | undefined,
    segments: readonly QaapAgentMessageSegmentDTO[],
    conv: QaapAgentConversationDTO | undefined,
    options: { readonly stalled?: boolean; readonly streaming?: boolean } | undefined,
    deps: ResolveTranscriptActivityRowContextDeps,
): {
    readonly navigationOptions: TranscriptActivityNavigationOptions;
    readonly message: QaapAgentMessageDTO | undefined;
    readonly resolveDurationMs: (
        segmentIndex: number,
        segment: QaapAgentMessageSegmentDTO,
    ) => number | undefined;
    readonly resolveTimestamp: (
        segmentIndex: number,
        segment: QaapAgentMessageSegmentDTO,
    ) => number | undefined;
} {
    const messageId = row?.getAttribute(TRANSCRIPT_MESSAGE_ID_ATTR);
    const streaming = options?.streaming
        ?? row?.classList.contains('theia-mod-streaming')
        ?? conv?.status === 'streaming';
    if (messageId) {
        deps.activityTiming.observe(messageId, segments, Date.now(), { streaming });
    }
    const message = messageId
        ? conv?.messages.find(entry => entry.id === messageId)
        : [...(conv?.messages ?? [])].reverse().find(entry => entry.role === 'agent');
    const pendingToolUseIds = deps.resolvePendingTranscriptToolUseIds(conv, segments);
    return {
        message,
        navigationOptions: {
            streaming,
            stalled: options?.stalled,
            pendingToolUseIds,
            messageCancelled: !!message?.error
                || conv?.status === 'failed'
                || (message?.traceEvents?.some(event => event.type === 'run_cancelled') ?? false),
        },
        resolveDurationMs: (segmentIndex, segment) => messageId
            ? deps.activityTiming.resolveDurationMs(messageId, segmentIndex, segment)
            : undefined,
        resolveTimestamp: (segmentIndex, segment) => messageId
            ? deps.activityTiming.resolveTimestamp(messageId, segmentIndex, segment)
            : undefined,
    };
}
