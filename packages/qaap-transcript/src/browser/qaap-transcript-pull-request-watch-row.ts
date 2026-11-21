// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { MobileSnackbar } from '@theia/qaap-mobile-shell/lib/browser/mobile-snackbar';
import {
    stopPullRequestWatch,
    type QaapAgentConversationDTO,
    type QaapAgentConversationSummaryDTO,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import {
    pullRequestWatchUrl,
    type QaapPullRequestWatchSummary,
} from '@theia/qaap-shared-core/lib/common/qaap-pull-request-watch';
import type { WorkHubTranscriptPullRequestRef } from '@theia/qaap-transcript-overlay/lib/browser/work-hub-transcript-bridge';

/*
 * Compact status row shown at the end of the open conversation's transcript while it is watching a
 * GitHub pull request (`Waiting · Watching pull request #N · Details · Stop`). Mounted as a sibling
 * of `.theia-mobile-agent-transcript` inside `.theia-mobile-agent-transcript-real-chat` (same seam
 * as `qaap-transcript-task-plan-card.ts`) so message re-renders never wipe it.
 */

export const TRANSCRIPT_PR_WATCH_ROW_CLASS = 'theia-mobile-transcript-pr-watch';
const REAL_CHAT_CLASS = 'theia-mobile-agent-transcript-real-chat';

export interface TranscriptPullRequestWatchSource {
    readonly id: string;
    readonly pullRequestWatch?: QaapPullRequestWatchSummary;
}

export interface TranscriptPullRequestWatchRowDeps {
    readonly stopWatch?: (conversationId: string) => Promise<QaapAgentConversationDTO>;
    readonly openDetails?: (watch: QaapPullRequestWatchSummary) => void;
    readonly showError?: (message: string) => void;
}

export interface TranscriptPullRequestWatchHost {
    readonly transcriptOpenSummary?: QaapAgentConversationSummaryDTO;
    readonly conversations?: { readonly threadStore: { getSummary(id: string): QaapAgentConversationSummaryDTO | undefined } };
    openPullRequestInPanel?(ref: WorkHubTranscriptPullRequestRef): boolean;
    openExternal?(url: string): void;
}

interface WatchRowState {
    conversationId: string;
    watch: QaapPullRequestWatchSummary;
    deps: TranscriptPullRequestWatchRowDeps;
    stopping: boolean;
}

const rowStates = new WeakMap<HTMLElement, WatchRowState>();
/** Key `${conversationId}:${owner}/${repo}#${number}` optimistically hidden while DELETE is in flight. */
const optimisticallyStopped = new WeakMap<HTMLElement, string>();
const deferredMountHosts = new WeakSet<HTMLElement>();

function watchKey(conversationId: string, watch: QaapPullRequestWatchSummary): string {
    return `${conversationId}:${watch.owner}/${watch.repo}#${watch.number}`;
}

/**
 * Shows, updates or removes the PR watch status row in `chatHost`. Renders only while
 * `source.pullRequestWatch.state === 'watching'`.
 */
export function syncTranscriptPullRequestWatchRow(
    chatHost: HTMLElement | undefined,
    source: TranscriptPullRequestWatchSource | undefined,
    deps: TranscriptPullRequestWatchRowDeps = {},
): void {
    const mountHost = resolveMountHost(chatHost);
    if (!mountHost) {
        return;
    }
    const existing = findRow(mountHost);
    const watch = source?.pullRequestWatch;
    if (!source || !watch || watch.state !== 'watching') {
        optimisticallyStopped.delete(mountHost);
        if (existing) {
            rowStates.delete(existing);
            existing.remove();
        }
        return;
    }
    const key = watchKey(source.id, watch);
    if (optimisticallyStopped.get(mountHost) === key) {
        if (existing) {
            existing.hidden = true;
        }
        return;
    }

    let row = existing;
    let state = row ? rowStates.get(row) : undefined;
    if (!row || !state) {
        row = createWatchRow(mountHost.ownerDocument);
        state = { conversationId: source.id, watch, deps, stopping: false };
        rowStates.set(row, state);
        wireWatchRowHandlers(mountHost, row);
    }
    state.conversationId = source.id;
    state.watch = watch;
    state.deps = deps;
    row.hidden = false;
    row.dataset.prWatchNumber = String(watch.number);
    const label = row.querySelector<HTMLElement>(`.${TRANSCRIPT_PR_WATCH_ROW_CLASS}-label`);
    const text = nls.localize('qaap/prWatch/waitingLabel', 'Waiting · Watching pull request #{0}', String(watch.number));
    if (label && label.textContent !== text) {
        label.textContent = text;
    }
    if (row.parentElement !== mountHost) {
        mountHost.append(row);
    }
}

/** Syncs the PR watch row of the conversation open in `chatHost` from the live summary. */
export function syncOpenTranscriptPullRequestWatchRow(host: TranscriptPullRequestWatchHost, chatHost: HTMLElement | undefined): void {
    const openId = host.transcriptOpenSummary?.id;
    const source = openId ? host.conversations?.threadStore.getSummary(openId) ?? host.transcriptOpenSummary : undefined;
    const mountHost = resolveMountHost(chatHost);
    if (!mountHost || (source?.pullRequestWatch?.state !== 'watching' && !findRow(mountHost))) {
        return;
    }
    if (!mountHost.querySelector(':scope > .theia-mobile-agent-transcript')) {
        if (!deferredMountHosts.has(mountHost)) {
            deferredMountHosts.add(mountHost);
            mountHost.ownerDocument.defaultView?.setTimeout(() => {
                deferredMountHosts.delete(mountHost);
                if (mountHost.isConnected && mountHost.querySelector(':scope > .theia-mobile-agent-transcript')) {
                    syncOpenTranscriptPullRequestWatchRow(host, mountHost);
                }
            }, 0);
        }
        return;
    }
    syncTranscriptPullRequestWatchRow(mountHost, source, {
        openDetails: watch => openPullRequestWatchDetails(host, watch),
    });
}

function openPullRequestWatchDetails(host: TranscriptPullRequestWatchHost, watch: QaapPullRequestWatchSummary): void {
    const url = pullRequestWatchUrl(watch);
    const ref: WorkHubTranscriptPullRequestRef = {
        owner: watch.owner,
        repo: watch.repo,
        number: watch.number,
        url,
    };
    if (host.openPullRequestInPanel?.(ref) === true) {
        return;
    }
    if (host.openExternal) {
        host.openExternal(url);
        return;
    }
    if (typeof window !== 'undefined') {
        window.open(url, '_blank', 'noopener,noreferrer');
    }
}

function createWatchRow(doc: Document): HTMLElement {
    const row = doc.createElement('div');
    row.className = TRANSCRIPT_PR_WATCH_ROW_CLASS;
    row.setAttribute('role', 'status');
    row.setAttribute('aria-live', 'polite');

    const icon = doc.createElement('span');
    icon.className = `codicon codicon-eye ${TRANSCRIPT_PR_WATCH_ROW_CLASS}-icon`;
    icon.setAttribute('aria-hidden', 'true');

    const label = doc.createElement('span');
    label.className = `${TRANSCRIPT_PR_WATCH_ROW_CLASS}-label`;

    const actions = doc.createElement('div');
    actions.className = `${TRANSCRIPT_PR_WATCH_ROW_CLASS}-actions`;

    const details = doc.createElement('button');
    details.type = 'button';
    details.className = `${TRANSCRIPT_PR_WATCH_ROW_CLASS}-action theia-mod-details`;
    details.textContent = nls.localizeByDefault('Details');

    const stop = doc.createElement('button');
    stop.type = 'button';
    stop.className = `${TRANSCRIPT_PR_WATCH_ROW_CLASS}-action theia-mod-stop`;
    stop.textContent = nls.localizeByDefault('Stop');

    actions.append(details, stop);
    row.append(icon, label, actions);
    return row;
}

function wireWatchRowHandlers(mountHost: HTMLElement, row: HTMLElement): void {
    const details = row.querySelector<HTMLButtonElement>('.theia-mod-details');
    const stop = row.querySelector<HTMLButtonElement>('.theia-mod-stop');
    details?.addEventListener('click', () => {
        const state = rowStates.get(row);
        if (!state) {
            return;
        }
        if (state.deps.openDetails) {
            state.deps.openDetails(state.watch);
        } else if (typeof window !== 'undefined') {
            window.open(pullRequestWatchUrl(state.watch), '_blank', 'noopener,noreferrer');
        }
    });
    stop?.addEventListener('click', () => {
        const state = rowStates.get(row);
        if (!state || state.stopping) {
            return;
        }
        const { conversationId, watch, deps } = state;
        const key = watchKey(conversationId, watch);
        state.stopping = true;
        optimisticallyStopped.set(mountHost, key);
        row.hidden = true;
        const stopFn = deps.stopWatch ?? stopPullRequestWatch;
        void stopFn(conversationId).then(() => {
            if (rowStates.get(row) === state) {
                state.stopping = false;
            }
        }, (error: unknown) => {
            if (optimisticallyStopped.get(mountHost) === key) {
                optimisticallyStopped.delete(mountHost);
            }
            if (rowStates.get(row) === state) {
                state.stopping = false;
                if (row.isConnected) {
                    row.hidden = false;
                }
            }
            const detail = error instanceof Error && error.message ? error.message : String(error);
            const message = nls.localize('qaap/prWatch/stopFailed', 'Could not stop watching pull request #{0}: {1}', String(watch.number), detail);
            if (deps.showError) {
                deps.showError(message);
            } else {
                MobileSnackbar.show(message, { kind: 'warning' });
            }
        });
    });
}

function findRow(mountHost: HTMLElement): HTMLElement | undefined {
    return mountHost.querySelector<HTMLElement>(`:scope > .${TRANSCRIPT_PR_WATCH_ROW_CLASS}`) ?? undefined;
}

function resolveMountHost(chatHost: HTMLElement | undefined): HTMLElement | undefined {
    if (!chatHost) {
        return undefined;
    }
    if (chatHost.classList.contains(REAL_CHAT_CLASS)) {
        return chatHost;
    }
    return chatHost.closest<HTMLElement>(`.${REAL_CHAT_CLASS}`) ?? undefined;
}
