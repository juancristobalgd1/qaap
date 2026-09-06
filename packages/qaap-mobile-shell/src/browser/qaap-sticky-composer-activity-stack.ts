// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import type { TranscriptFollowUpEntry } from '../common/qaap-transcript-follow-up-queue';
import type { QaapGitCommitWorkflowAction } from '../common/qaap-git-review';
import { createStickyComposerSendIcon } from './mobile-projects-sticky-composer-send-icon';
import { ensureQueueControlInPillRow } from './qaap-sticky-composer-queue-position';

export interface StickyComposerChangedFileView {
    readonly path: string;
    readonly kind: 'edited' | 'created';
    readonly added?: number;
    readonly removed?: number;
    /** True once the change has been staged ("Accepted"). */
    readonly staged?: boolean;
}

/** Outcome of {@link selectComposerPillChanges}. */
export interface ComposerPillChangesSelection {
    /** When true, no Changes pill should render (clean tree or latched resolved state without a git snapshot). */
    readonly hidden: boolean;
    /** The files the Changes pill should represent, when a git snapshot is available and non-empty. */
    readonly files?: StickyComposerChangedFileView[];
    /** Whether this conversation's changes are now considered resolved (Accepted/Discarded). */
    readonly resolved: boolean;
    /** Whether the working tree is clean (nothing to commit) — drives the Commit button. */
    readonly clean: boolean;
}

/**
 * Decides what the composer Changes pill should show, given the latest git
 * snapshot (or `undefined` if it hasn't been fetched / was just invalidated),
 * whether the user already resolved this conversation's review, and whether
 * the tree was last known clean.
 *
 * A non-empty git snapshot means there are still real files to review, whether
 * staged or unstaged, so the Changes pill stays visible and can still expose
 * Accept/Discard. A clean tree hides the review pill and latches `resolved` so
 * a later snapshot gap doesn't let the permanent transcript evidence resurrect
 * it. `clean` is a separate latch for the Commit button: after Accept the tree
 * is dirty (staged files are committable) so `clean` is false; after Discard it
 * is truly clean so `clean` is true and Commit drops off. Both latches survive
 * a momentarily-absent snapshot. `hidden: false` with no `files` means "no
 * snapshot yet, not resolved" — the caller falls back to its transcript-derived
 * view.
 */
export function selectComposerPillChanges(
    gitFiles: readonly StickyComposerChangedFileView[] | undefined,
    alreadyResolved: boolean,
    alreadyClean: boolean,
): ComposerPillChangesSelection {
    if (gitFiles) {
        const clean = gitFiles.length === 0;
        // The review "Changes" pill (Accept/Discard) is for UNRESOLVED work only. Once every change is
        // staged (Accept all) or the tree is clean (Discard all), the review is resolved: hide the pill.
        // Any staged/committable changes are carried by the separate Commit button (driven by `clean`),
        // which stays after Accept and drops after Discard.
        const hasUnresolved = gitFiles.some(file => !file.staged);
        if (!hasUnresolved) {
            return { hidden: true, resolved: true, clean };
        }
        return { hidden: false, files: [...gitFiles], resolved: false, clean };
    }
    if (alreadyResolved) {
        return { hidden: true, resolved: true, clean: alreadyClean };
    }
    return { hidden: false, resolved: false, clean: alreadyClean };
}

export interface StickyComposerActivityStackOptions {
    queueEntries?: readonly TranscriptFollowUpEntry[];
    queueExpanded?: boolean;
    onQueueExpandedChange?: (expanded: boolean) => void;
    onQueueEdit?: (index: number, entry: TranscriptFollowUpEntry) => void;
    /** Send a queued follow-up immediately as a parallel peer run (multitask). */
    onQueueSendNow?: (index: number) => void;
    /** Interrupt the running agent and process this queued message immediately. */
    onQueueInterrupt?: (index: number) => void;
    /** Remove a queued follow-up from the list. */
    onQueueRemove?: (index: number) => void;
    /** Close/dismiss a queued follow-up (same as remove but with a different UI affordance). */
    onQueueClose?: (index: number) => void;
    /** Reorder queue entries (drag-to-reorder). */
    onQueueReorder?: (fromIndex: number, toIndex: number) => void;
    changedFiles?: readonly StickyComposerChangedFileView[];
    /** Display count for the Changes pill when transcript evidence has more files than the git snapshot. */
    changedFileCount?: number;
    diffStats?: { readonly added: number; readonly removed: number };
    /**
     * True once the agent has edited files in this conversation, even if the
     * changes were since Accepted/Discarded. Keeps the preview/run controls in
     * the row after the review-only "Changes" group drops off.
     */
    hasFileActivity?: boolean;
    /**
     * True when the working tree has something to commit (staged or unstaged).
     * Gates the Commit split-button: it stays after Accept (staged files are
     * committable) but drops off after a Discard that leaves the tree clean.
     */
    hasCommittableChanges?: boolean;
    filesExpanded?: boolean;
    onFilesExpandedChange?: (expanded: boolean) => void;
    agentWorking?: boolean;
    /** Discard all pending changes — surfaced as "Discard" in the Changes split-button menu. */
    onUndoAll?: () => void;
    /** Keep (stage) all pending changes — surfaced as "Accept" in the Changes split-button menu. */
    onKeepAll?: () => void;
    changedFilesBulkBusy?: boolean;
    onReview?: () => void;
    onRunApp?: () => void;
    onOpenPreview?: () => void;
    /** When set, a commit split-button (primary action + options menu) renders beside the Changes pill. */
    onCommitAction?: (action: QaapGitCommitWorkflowAction) => void;
    commitBusy?: boolean;
}

interface StickyComposerCommitMenuOption {
    readonly action: QaapGitCommitWorkflowAction;
    readonly label: string;
}

function stickyComposerCommitMenuOptions(): StickyComposerCommitMenuOption[] {
    return [
        {
            action: 'create-branch-commit',
            label: nls.localize('qaap/mobileProjects/createBranchAndCommit', 'Create Branch & Commit'),
        },
        {
            action: 'create-branch-commit-push',
            label: nls.localize('qaap/mobileProjects/createBranchCommitPush', 'Create Branch, Commit & Push'),
        },
        {
            action: 'commit-push',
            label: nls.localize('qaap/mobileProjects/commitPush', 'Commit & Push'),
        },
        {
            action: 'commit-create-pr',
            label: nls.localize('qaap/mobileProjects/commitCreatePr', 'Commit & Create PR'),
        },
    ];
}

export function buildStickyComposerActivityStackFingerprint(options: StickyComposerActivityStackOptions): string {
    const entries = options.queueEntries ?? [];
    const drafts = entries.map(entry => entry.draft).join('\x00');
    return [
        entries.length,
        options.queueExpanded ? 1 : 0,
        // Drives the send action label ("Run in parallel" vs "Send now").
        options.agentWorking ? 1 : 0,
        drafts,
        // Reorder support changes the drag handle visibility.
        options.onQueueReorder ? 1 : 0,
        options.onQueueInterrupt ? 1 : 0,
    ].join('|');
}

/** In-place queue stack refresh — avoids replaceWith flicker during SSE ticks. */
export function patchStickyComposerActivityStack(
    stack: HTMLElement,
    options: StickyComposerActivityStackOptions,
): boolean {
    if (!stack.classList.contains('theia-mobile-sticky-composer-activity-stack')) {
        return false;
    }
    const entries = options.queueEntries ?? [];
    if (!entries.length) {
        return false;
    }
    // The queue control is a unified DOM (pill + clip). Update the label and
    // the items inside the clip in-place when the count matches.
    const label = stack.querySelector<HTMLElement>('.theia-mobile-sticky-composer-queue-collapsed-label');
    if (label) {
        const newText = entries.length === 1
            ? nls.localize('qaap/mobileProjects/stickyComposerQueueOne', '1 Queued')
            : nls.localize('qaap/mobileProjects/stickyComposerQueueMany', '{0} Queued', String(entries.length));
        if (label.textContent !== newText) {
            label.textContent = newText;
        }
    }
    const body = stack.querySelector<HTMLElement>('.theia-mobile-sticky-composer-activity-body.theia-mobile-sticky-composer-queue-list');
    if (!body) {
        // No clip body — structural mismatch, force full re-render.
        return false;
    }
    const items = Array.from(body.querySelectorAll<HTMLElement>(':scope > .theia-mobile-sticky-composer-queue-item'));
    if (items.length !== entries.length) {
        return false;
    }
    // If any item's text doesn't match the entry at that position, the order or
    // content has changed. Return false to force a full re-render (replaceWith)
    // instead of patching text in-place — which would leave DOM elements in the
    // old physical order on reorder, or break per-item event bindings on edit.
    // This makes the patch self-contained: it doesn't rely on callers clearing
    // the fingerprint after a reorder.
    for (let index = 0; index < entries.length; index++) {
        const textEl = items[index]?.querySelector<HTMLElement>('.theia-mobile-sticky-composer-queue-text');
        if (!textEl || textEl.textContent !== entries[index].draft) {
            return false;
        }
    }
    const sendLabel = stickyComposerQueueSendNowLabel(options);
    for (let index = 0; index < entries.length; index++) {
        // The send button uses the composer's paper-plane SVG icon (not codicon-send),
        // so look it up by its dedicated class.
        const sendBtn = items[index]?.querySelector<HTMLButtonElement>(
            'button.theia-mobile-sticky-composer-queue-action.theia-mobile-sticky-composer-queue-send',
        );
        if (sendBtn && sendBtn.title !== sendLabel) {
            sendBtn.title = sendLabel;
            sendBtn.setAttribute('aria-label', sendLabel);
        }
    }
    return true;
}

/** True when there are unresolved (pending-review) changes worth a "Changes" pill. */
function stickyComposerHasChangesToReview(options: StickyComposerActivityStackOptions): boolean {
    const hasFiles = (options.changedFiles?.length ?? 0) > 0;
    const stats = options.diffStats;
    const hasStats = !!stats && ((stats.added ?? 0) > 0 || (stats.removed ?? 0) > 0);
    return hasFiles || hasStats;
}

/**
 * True when the activity row should render at all.
 *
 * The row is shown when one of the following is true:
 * - There are unresolved changes to review (`stickyComposerHasChangesToReview`).
 * - There is something to commit (`hasCommittableChanges`) — e.g. staged files after Accept.
 * - The agent edited files (`hasFileActivity`) AND the project has a live preview or run action,
 *   so the preview/run button stays accessible even after the review is resolved and the tree
 *   is committed clean.
 *
 * Note: bare `hasFileActivity` with a clean tree and no next actions must NOT keep the row
 * visible — that would leave an empty pill host after a commit (BUG). Fresh agent edits cause
 * the git snapshot to become non-empty, which then satisfies `stickyComposerHasChangesToReview`
 * and naturally shows the row again.
 */
function stickyComposerHasActivityRow(options: StickyComposerActivityStackOptions): boolean {
    return stickyComposerHasChangesToReview(options)
        || !!options.hasCommittableChanges
        // A ready preview is an actionable state on its own: the user asked "levanta la app" and
        // must always get the clickable "Open preview" affordance, even when the turn produced no
        // reviewable file activity (e.g. deps-only install before serving).
        || !!options.onOpenPreview
        || !!(options.hasFileActivity && !!options.onRunApp);
}

export function buildStickyComposerChangesPillFingerprint(options: StickyComposerActivityStackOptions): string {
    const files = options.changedFiles ?? [];
    const stats = options.diffStats;
    const paths = files.map(file => file.path).sort().join('\n');
    return [
        files.length,
        options.changedFileCount ?? '',
        stats?.added ?? 0,
        stats?.removed ?? 0,
        paths,
        stickyComposerHasChangesToReview(options) ? 1 : 0,
        options.hasFileActivity ? 1 : 0,
        options.hasCommittableChanges ? 1 : 0,
        options.agentWorking ? 1 : 0,
        options.commitBusy ? 1 : 0,
        options.onCommitAction ? 1 : 0,
        options.onRunApp ? 1 : 0,
        options.onOpenPreview ? 1 : 0,
        options.onKeepAll ? 1 : 0,
        options.onUndoAll ? 1 : 0,
        options.changedFilesBulkBusy ? 1 : 0,
    ].join('|');
}

/** In-place Changes pill refresh — avoids replaceWith flicker during SSE/git snapshot ticks. */
export function patchStickyComposerChangesPillHost(
    host: HTMLElement,
    options: StickyComposerActivityStackOptions,
): boolean {
    if (!host.classList.contains('theia-mobile-sticky-composer-changes-pill-host')) {
        return false;
    }
    const section = host.querySelector(':scope > .theia-mobile-sticky-composer-activity-section.theia-mod-changes-pill');
    const row = section?.querySelector(':scope > .theia-mobile-sticky-composer-changes-pill-row');
    if (!(row instanceof HTMLElement)) {
        return false;
    }
    const files = options.changedFiles ?? [];
    const stats = options.diffStats;
    const fileCount = options.changedFileCount ?? (files.length > 0
        ? files.length
        : ((stats?.added ?? 0) > 0 || (stats?.removed ?? 0) > 0 ? 1 : 0));
    const hasCommitAction = !!options.onCommitAction && !!options.hasCommittableChanges;
    const hasNextActions = !!options.onRunApp || !!options.onOpenPreview;
    const hasChangesMenu = buildChangesMenuItems(options).length > 0;
    const existingCommitGroup = row.querySelector(':scope > .theia-mobile-sticky-composer-commit-group');
    if (!!existingCommitGroup !== hasCommitAction) {
        return false;
    }
    const existingNextActions = row.querySelector(':scope > .theia-mobile-sticky-composer-next-actions');
    if (!!existingNextActions !== hasNextActions) {
        return false;
    }

    const changesGroup = row.querySelector<HTMLElement>(':scope > .theia-mobile-sticky-composer-changes-group');
    // A changed review state (present ↔ absent as Accept/Discard resolve changes) is a
    // structural change — bail to a full re-render so the group is added or removed.
    if (!!changesGroup !== (!!options.onReview && stickyComposerHasChangesToReview(options))) {
        return false;
    }
    if (changesGroup) {
        const pill = changesGroup.querySelector<HTMLButtonElement>(':scope > .theia-mobile-sticky-composer-changes-pill');
        if (!pill) {
            return false;
        }
        const changesMenuBtn = changesGroup.querySelector<HTMLButtonElement>('.theia-mobile-sticky-composer-commit-menu');
        if (!!changesMenuBtn !== hasChangesMenu) {
            return false;
        }
        pill.setAttribute('aria-label', buildChangesPillAriaLabel(fileCount, stats));
        let count = pill.querySelector<HTMLElement>(':scope > .theia-mobile-sticky-composer-changes-pill-count');
        if (fileCount > 0) {
            if (!count) {
                count = document.createElement('span');
                count.className = 'theia-mobile-sticky-composer-changes-pill-count';
                const label = pill.querySelector(':scope > .theia-mobile-sticky-composer-changes-pill-label');
                label?.after(count);
            }
            count.textContent = fileCount === 1
                ? nls.localize('qaap/mobileProjects/stickyComposerChangesOneFileShort', '1 file')
                : nls.localize('qaap/mobileProjects/stickyComposerChangesManyFilesShort', '{0} files', String(fileCount));
        } else {
            count?.remove();
        }
        let statsInline = pill.querySelector<HTMLElement>(':scope > .theia-mobile-sticky-composer-activity-inline-stats');
        if (!statsInline) {
            statsInline = document.createElement('span');
            statsInline.className = 'theia-mobile-sticky-composer-activity-inline-stats';
            pill.append(statsInline);
        }
        statsInline.replaceChildren();
        appendDiffStatsInline(statsInline, stats);
        if (changesMenuBtn) {
            // Accept/Discard act on changes already written to disk, so they must stay reachable once
            // the changes exist. Gating on agentWorking wedged the menu disabled whenever that
            // client-derived signal went stale after a turn finished (backend idle, but the composer
            // summary/DOM lagged) — only a running bulk Accept/Discard should disable it.
            changesMenuBtn.disabled = !!options.changedFilesBulkBusy;
        }
    }

    if (hasCommitAction && existingCommitGroup instanceof HTMLElement) {
        existingCommitGroup.classList.toggle('theia-mod-busy', !!options.commitBusy);
        const commitBtn = existingCommitGroup.querySelector<HTMLButtonElement>('.theia-mobile-sticky-composer-commit-btn');
        const menuBtn = existingCommitGroup.querySelector<HTMLButtonElement>('.theia-mobile-sticky-composer-commit-menu');
        if (commitBtn) {
            commitBtn.disabled = !!options.commitBusy;
        }
        if (menuBtn) {
            menuBtn.disabled = !!options.commitBusy;
        }
    }

    if (hasNextActions && existingNextActions instanceof HTMLElement) {
        patchChangesNextActions(existingNextActions, options);
    }

    return true;
}

export function renderStickyComposerChangesPill(options: StickyComposerActivityStackOptions): HTMLElement | undefined {
    // The row survives after the git review controls are gone so the user can still
    // Commit remaining work or open the preview. It hides entirely once the agent
    // has no file activity.
    if (!stickyComposerHasActivityRow(options)) {
        return undefined;
    }
    const host = document.createElement('div');
    host.className = 'theia-mobile-sticky-composer-changes-pill-host';
    host.append(renderStickyComposerChangedFilesSection(options));
    return host;
}

export function renderStickyComposerActivityStack(options: StickyComposerActivityStackOptions): HTMLElement | undefined {
    const entries = options.queueEntries ?? [];
    if (!entries.length) {
        return undefined;
    }
    // The queue is always rendered as an expandable control that lives inside the
    // changes-pill-row (left of the Working pill), exactly like the Working pill.
    // When expanded, a clip grows from 0fr → 1fr showing the full queue list.
    // When collapsed, only the compact "N Queued" pill button is visible.
    return renderStickyComposerQueueControl(options);
}

/**
 * Queue control — a compact pill button that expands in-place with a clip
 * animation (grid-template-rows: 0fr → 1fr), mirroring the Working pill pattern.
 * Lives inside the changes-pill-row. Clicking the pill toggles expand/collapse.
 */
function renderStickyComposerQueueControl(options: StickyComposerActivityStackOptions): HTMLElement {
    const entries = options.queueEntries ?? [];
    const expanded = options.queueExpanded ?? false;

    const stack = document.createElement('div');
    stack.className = 'theia-mobile-sticky-composer-activity-stack theia-mod-queue-popover theia-mod-queue-control';
    stack.classList.toggle('theia-mod-collapsed', !expanded);
    stack.classList.toggle('theia-mod-expanded', expanded);
    const normalizeQueuePosition = (): void => {
        const wrap = stack.closest<HTMLElement>('.theia-mobile-projects-sticky-composer-inner');
        if (wrap) {
            ensureQueueControlInPillRow(wrap);
        }
    };

    const section = document.createElement('div');
    section.className = 'theia-mobile-sticky-composer-activity-section theia-mod-queue theia-mod-queue-control-section';

    // Pill button (always visible — the anchor that toggles the clip)
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'theia-mobile-sticky-composer-queue-collapsed-pill';
    pill.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    const label = document.createElement('span');
    label.className = 'theia-mobile-sticky-composer-queue-collapsed-label';
    label.textContent = entries.length === 1
        ? nls.localize('qaap/mobileProjects/stickyComposerQueueOne', '1 Queued')
        : nls.localize('qaap/mobileProjects/stickyComposerQueueMany', '{0} Queued', String(entries.length));
    pill.append(label);
    pill.title = nls.localize(
        'qaap/mobileProjects/queueCollapsedHint',
        '{0} queued message(s) — click to expand',
        String(entries.length),
    );

    // Clip — grows from 0fr to 1fr when expanded (same pattern as Working pill)
    const clip = document.createElement('div');
    clip.className = 'qaap-queue-expand-clip';
    clip.setAttribute('role', 'dialog');
    clip.setAttribute('aria-label', label.textContent ?? 'Queued messages');

    const clipInner = document.createElement('div');
    clipInner.className = 'qaap-queue-expand-inner';

    // Panel — mirrors the Working expand panel structure (header + body)
    const panel = document.createElement('div');
    panel.className = 'qaap-queue-expand-panel';

    // Header with title and close button (same layout as working-agents-popover-header)
    const header = document.createElement('div');
    header.className = 'qaap-queue-expand-header';
    const headerTitle = document.createElement('span');
    headerTitle.className = 'qaap-queue-expand-title';
    headerTitle.textContent = entries.length === 1
        ? nls.localize('qaap/mobileProjects/stickyComposerQueueOne', '1 Queued')
        : nls.localize('qaap/mobileProjects/stickyComposerQueueMany', '{0} Queued', String(entries.length));
    const headerActions = document.createElement('div');
    headerActions.className = 'qaap-queue-expand-actions';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'qaap-queue-expand-close';
    closeBtn.setAttribute('aria-label', nls.localize('qaap/mobileProjects/queueMinimize', 'Minimize queue'));
    const closeIcon = document.createElement('span');
    closeIcon.className = 'codicon codicon-chevron-down';
    closeIcon.setAttribute('aria-hidden', 'true');
    closeBtn.append(closeIcon);
    closeBtn.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        if (!isOpen) {
            return;
        }
        isOpen = false;
        pill.setAttribute('aria-expanded', 'false');
        // Start the clip collapse animation (grid-template-rows: 1fr → 0fr).
        clip.classList.remove('theia-mod-open');
        // Keep theia-mod-expanded until the clip finishes collapsing so the
        // panel width stays full during the animation — removing it early
        // would snap the width back to auto instantly (no transition).
        const finishClose = (): void => {
            stack.classList.remove('theia-mod-expanded');
            stack.classList.add('theia-mod-collapsed');
            normalizeQueuePosition();
        };
        clip.addEventListener('transitionend', function onEnd(e: TransitionEvent): void {
            if (e.target !== clip || (e.propertyName !== 'grid-template-rows' && e.propertyName !== 'opacity')) {
                return;
            }
            clip.removeEventListener('transitionend', onEnd);
            finishClose();
        });
        // Fallback in case transitionend doesn't fire.
        window.setTimeout(finishClose, 360);
        options.onQueueExpandedChange?.(false);
    });
    headerActions.append(closeBtn);
    header.append(headerTitle, headerActions);

    // Queue list body
    const body = document.createElement('div');
    body.className = 'theia-mobile-sticky-composer-activity-body theia-mobile-sticky-composer-queue-list';
    entries.forEach((entry, index) => {
        body.append(renderQueueItem(entry, index, entries.length, options));
    });
    panel.append(header, body);
    clipInner.append(panel);
    clip.append(clipInner);

    // Toggle expand/collapse on pill click
    let isOpen = expanded;
    pill.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        isOpen = !isOpen;
        pill.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        if (isOpen) {
            stack.classList.remove('theia-mod-collapsed');
            stack.classList.add('theia-mod-expanded');
            normalizeQueuePosition();
            // Double rAF for the expand animation (same as Working pill)
            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => {
                    clip.classList.add('theia-mod-open');
                });
            });
        } else {
            // Start the clip collapse animation. Keep theia-mod-expanded until
            // the clip finishes collapsing so the panel width stays full during
            // the animation (same pattern as the close button).
            clip.classList.remove('theia-mod-open');
            const finishClose = (): void => {
                stack.classList.remove('theia-mod-expanded');
                stack.classList.add('theia-mod-collapsed');
                normalizeQueuePosition();
            };
            clip.addEventListener('transitionend', function onEnd(e: TransitionEvent): void {
                if (e.target !== clip || (e.propertyName !== 'grid-template-rows' && e.propertyName !== 'opacity')) {
                    return;
                }
                clip.removeEventListener('transitionend', onEnd);
                finishClose();
            });
            window.setTimeout(finishClose, 360);
        }
        options.onQueueExpandedChange?.(isOpen);
    });

    // If restoring an already-expanded state, paint open immediately (no flash)
    if (expanded) {
        clip.classList.add('theia-mod-open');
    }

    section.append(pill, clip);
    stack.append(section);
    return stack;
}

/**
 * While the agent is working, the queue send action starts a second agent run beside the open
 * turn instead of interrupting it — the label says so, so nobody expects a cancel.
 */
function stickyComposerQueueSendNowLabel(options: StickyComposerActivityStackOptions): string {
    return options.agentWorking
        ? nls.localize('qaap/mobileProjects/stickyComposerQueueRunParallel', 'Run in parallel')
        : nls.localize('qaap/mobileProjects/stickyComposerQueueSendNow', 'Send now');
}

function renderQueueItem(
    entry: TranscriptFollowUpEntry,
    index: number,
    total: number,
    options: StickyComposerActivityStackOptions,
): HTMLElement {
    const row = document.createElement('div');
    row.className = 'theia-mobile-sticky-composer-queue-item';
    row.dataset.queueIndex = String(index);

    // Drag handle (⠿) — only if reorder is enabled. Uses pointer events so it works on
    // touch devices (HTML5 drag-and-drop API does not fire on touch / pointer:coarse).
    if (options.onQueueReorder) {
        const dragHandle = document.createElement('span');
        dragHandle.className = 'theia-mobile-sticky-composer-queue-drag-handle codicon codicon-gripper';
        dragHandle.setAttribute('aria-hidden', 'true');
        dragHandle.title = nls.localize('qaap/mobileProjects/queueDragHandle', 'Drag to reorder');
        dragHandle.style.touchAction = 'none';
        bindQueueItemPointerDrag(dragHandle, row, index, options);
        row.append(dragHandle);
    }

    // Order label — shows "1-", "2-", "3-" so the user always sees which message
    // runs first, second, third, etc. Updates on reorder.
    const marker = document.createElement('span');
    marker.className = 'theia-mobile-sticky-composer-queue-marker';
    marker.setAttribute('aria-hidden', 'true');
    marker.textContent = `${index + 1}-`;

    const text = document.createElement('span');
    text.className = 'theia-mobile-sticky-composer-queue-text';
    text.textContent = entry.draft;

    row.append(marker, text);

    const actions = document.createElement('div');
    actions.className = 'theia-mobile-sticky-composer-queue-actions';

    // Edit button
    actions.append(createQueueActionButton(
        'codicon-edit',
        nls.localize('qaap/mobileProjects/stickyComposerQueueEdit', 'Edit queued message'),
        () => options.onQueueEdit?.(index, entry),
    ));

    // Send now (parallel multitask) button — uses the same paper-plane icon
    // as the composer's send button for visual consistency.
    const sendNowBtn = document.createElement('button');
    sendNowBtn.type = 'button';
    sendNowBtn.className = 'theia-mobile-sticky-composer-queue-action theia-mobile-sticky-composer-queue-send';
    sendNowBtn.title = stickyComposerQueueSendNowLabel(options);
    sendNowBtn.setAttribute('aria-label', stickyComposerQueueSendNowLabel(options));
    sendNowBtn.replaceChildren(createStickyComposerSendIcon());
    sendNowBtn.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        options.onQueueSendNow?.(index);
    });
    actions.append(sendNowBtn);

    // Close (X) button — the only dismiss action
    if (options.onQueueClose) {
        actions.append(createQueueActionButton(
            'codicon-close',
            nls.localize('qaap/mobileProjects/queueClose', 'Close'),
            () => options.onQueueClose?.(index),
        ));
    }

    row.append(actions);
    row.title = total > 1
        ? nls.localize('qaap/mobileProjects/stickyComposerQueueItemHint', 'Queued message {0} of {1}', String(index + 1), String(total))
        : '';

    return row;
}

// ─── Pointer-based drag-to-reorder (touch + mouse) ───────────────────────────
//
// HTML5 drag-and-drop events (dragstart/dragover/drop) do not fire on touch
// devices or when pointer:coarse is active. The mobile shell must use pointer
// events to support dragging queue items by the gripper handle.

interface QueueDragSibling {
    readonly el: HTMLElement;
    /** Original vertical midpoint (viewport coords) measured when the drag started. */
    readonly midY: number;
}

interface QueueDragSession {
    readonly handle: HTMLElement;
    readonly item: HTMLElement;
    readonly fromIndex: number;
    readonly options: StickyComposerActivityStackOptions;
    started: boolean;
    activePointerId: number;
    /** Y coordinate of the initial pointerdown — used for the drag threshold. */
    startY: number;
    /** Offset between the pointer Y and the item's top edge (for visual follow). */
    itemOffsetY: number;
    /** Viewport top edge of the dragged item before any transform was applied. */
    itemTop: number;
    /** Outer height of the dragged item — the distance siblings shift by. */
    itemHeight: number;
    /** Sibling rows (DOM order) with their original midpoints. */
    siblings: QueueDragSibling[];
    /** Index the item would occupy in the list if dropped right now. */
    insertionIndex: number;
}

let activeQueueDrag: QueueDragSession | undefined;

/** Minimum pixel distance before a drag is recognized (avoids scroll conflicts). */
const QUEUE_DRAG_THRESHOLD_PX = 8;

/** Pixels from the top/bottom edge of the scrollable list that trigger auto-scroll. */
const QUEUE_DRAG_AUTOSCROLL_EDGE_PX = 40;

/** Maximum auto-scroll speed (px per frame). */
const QUEUE_DRAG_AUTOSCROLL_SPEED = 6;

/** Settle animation before the reorder commit re-renders the list. */
const QUEUE_DRAG_SETTLE_MS = 140;

function clearQueueDragTransforms(list: HTMLElement): void {
    list.classList.remove('theia-mod-queue-reordering');
    list.querySelectorAll<HTMLElement>('.theia-mobile-sticky-composer-queue-item')
        .forEach(el => {
            el.classList.remove('theia-mod-dragging', 'theia-mod-drag-settling');
            el.style.transform = '';
        });
}

/**
 * Shift siblings out of the dragged item's way so the landing slot opens up live.
 * A sibling moves up one slot to close the dragged item's original position, and
 * moves down one slot when the insertion point sits before it — both cancel out
 * for rows that should stay put.
 */
function shiftSiblingsForInsertion(session: QueueDragSession, insertion: number): void {
    session.siblings.forEach((sibling, order) => {
        const originalIndex = order < session.fromIndex ? order : order + 1;
        const closeOldSlot = originalIndex > session.fromIndex ? -1 : 0;
        const openNewSlot = order >= insertion ? 1 : 0;
        const offset = (closeOldSlot + openNewSlot) * session.itemHeight;
        sibling.el.style.transform = offset === 0 ? '' : `translateY(${offset}px)`;
    });
}

/** Auto-scroll the list when the pointer is near its top/bottom edges during drag. */
function autoScrollList(list: HTMLElement, pointerY: number): void {
    const scrollable = list.closest<HTMLElement>('[data-theia-mobile-scroll-y]')
        ?? (list.scrollHeight > list.clientHeight ? list : undefined);
    if (!scrollable) {
        return;
    }
    const rect = scrollable.getBoundingClientRect();
    if (pointerY < rect.top + QUEUE_DRAG_AUTOSCROLL_EDGE_PX) {
        scrollable.scrollTop -= QUEUE_DRAG_AUTOSCROLL_SPEED;
    } else if (pointerY > rect.bottom - QUEUE_DRAG_AUTOSCROLL_EDGE_PX) {
        scrollable.scrollTop += QUEUE_DRAG_AUTOSCROLL_SPEED;
    }
}

function bindQueueItemPointerDrag(
    handle: HTMLElement,
    item: HTMLElement,
    index: number,
    options: StickyComposerActivityStackOptions,
): void {
    handle.addEventListener('pointerdown', ev => {
        if (activeQueueDrag || !options.onQueueReorder) {
            return;
        }
        ev.preventDefault();
        ev.stopPropagation();
        const itemRect = item.getBoundingClientRect();
        activeQueueDrag = {
            handle,
            item,
            fromIndex: index,
            options,
            started: false,
            activePointerId: ev.pointerId,
            startY: ev.clientY,
            itemOffsetY: ev.clientY - itemRect.top,
            itemTop: itemRect.top,
            itemHeight: itemRect.height,
            siblings: [],
            insertionIndex: index,
        };
        // Capture on the handle so we keep receiving events even if the finger
        // slides off the small gripper icon. Some mobile browsers (iOS Safari)
        // drop pointer events without capture, so we also bind window-level
        // listeners as a fallback below.
        try {
            handle.setPointerCapture(ev.pointerId);
        } catch {
            // setPointerCapture can throw on some browsers — window listeners cover it.
        }
        window.addEventListener('pointermove', onMove, { passive: false });
        window.addEventListener('pointerup', onEnd);
        window.addEventListener('pointercancel', onEnd);
    });

    // Window-level fallback listeners (bound only during an active drag). These
    // guarantee we keep tracking the finger even if pointer capture is lost or
    // the finger leaves the handle's hit area — critical for touch devices.
    const onMove = (ev: PointerEvent): void => {
        const session = activeQueueDrag;
        if (!session || session.activePointerId !== ev.pointerId) {
            return;
        }
        ev.preventDefault();
        const list = item.parentElement;
        if (!list) {
            return;
        }

        // Drag threshold: only start the drag after moving past QUEUE_DRAG_THRESHOLD_PX
        // so that a tap-and-scroll on the handle doesn't trigger a reorder.
        if (!session.started) {
            if (Math.abs(ev.clientY - session.startY) < QUEUE_DRAG_THRESHOLD_PX) {
                return;
            }
            session.started = true;
            // Measure once at drag start (before any transform) — the lifted item
            // follows the finger while siblings slide around the opening slot.
            const rect = item.getBoundingClientRect();
            session.itemTop = rect.top;
            session.itemHeight = rect.height;
            session.siblings = Array.from(
                list.querySelectorAll<HTMLElement>(':scope > .theia-mobile-sticky-composer-queue-item'),
            )
                .filter(el => el !== item)
                .map(el => {
                    const siblingRect = el.getBoundingClientRect();
                    return { el, midY: siblingRect.top + siblingRect.height / 2 };
                });
            session.insertionIndex = session.fromIndex;
            list.classList.add('theia-mod-queue-reordering');
            item.classList.add('theia-mod-dragging');
            handle.classList.add('theia-mod-grabbing');
        }

        // Auto-scroll when near the edges of the scrollable list.
        autoScrollList(list, ev.clientY);

        // The lifted item tracks the finger, clamped inside the list viewport.
        const listRect = list.getBoundingClientRect();
        const dy = Math.min(
            Math.max(ev.clientY - session.startY, listRect.top - session.itemTop),
            listRect.bottom - (session.itemTop + session.itemHeight),
        );
        item.style.transform = `translateY(${dy}px)`;

        // Insertion index = how many sibling midpoints sit above the pointer.
        const insertion = session.siblings.reduce(
            (count, sibling) => count + (ev.clientY > sibling.midY ? 1 : 0),
            0,
        );
        if (insertion !== session.insertionIndex) {
            session.insertionIndex = insertion;
        }
        shiftSiblingsForInsertion(session, insertion);
    };

    const onEnd = (ev: PointerEvent): void => {
        const session = activeQueueDrag;
        if (!session || session.activePointerId !== ev.pointerId) {
            return;
        }
        activeQueueDrag = undefined;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
        try {
            handle.releasePointerCapture(ev.pointerId);
        } catch {
            // Pointer capture may already be released — ignore.
        }
        handle.classList.remove('theia-mod-grabbing');
        const list = item.parentElement;
        if (!list) {
            return;
        }
        const toIndex = session.insertionIndex;
        if (session.started && toIndex !== session.fromIndex) {
            // Settle: glide the lifted item into its new slot, then commit the
            // reorder — the re-render replaces the row already in place.
            item.classList.remove('theia-mod-dragging');
            item.classList.add('theia-mod-drag-settling');
            item.style.transform = `translateY(${(toIndex - session.fromIndex) * session.itemHeight}px)`;
            window.setTimeout(() => {
                clearQueueDragTransforms(list);
                session.options.onQueueReorder?.(session.fromIndex, toIndex);
            }, QUEUE_DRAG_SETTLE_MS);
            return;
        }
        // Cancel / no-op drop: let every row glide back before dropping the
        // reordering class that keeps the transform transition alive.
        item.classList.remove('theia-mod-dragging');
        list.querySelectorAll<HTMLElement>('.theia-mobile-sticky-composer-queue-item')
            .forEach(el => { el.style.transform = ''; });
        window.setTimeout(() => clearQueueDragTransforms(list), QUEUE_DRAG_SETTLE_MS + 60);
    };
}

function appendDiffStatsInline(
    host: HTMLElement,
    stats: { readonly added?: number; readonly removed?: number } | undefined,
): void {
    if (!stats || ((stats.added ?? 0) <= 0 && (stats.removed ?? 0) <= 0)) {
        return;
    }
    const statsInline = document.createElement('span');
    statsInline.className = 'theia-mobile-sticky-composer-activity-inline-stats';
    if ((stats.added ?? 0) > 0) {
        const added = document.createElement('span');
        added.className = 'theia-mobile-agent-diff-stat theia-mod-added';
        added.textContent = `+${stats.added}`;
        statsInline.append(added);
    }
    if ((stats.added ?? 0) > 0 || (stats.removed ?? 0) > 0) {
        const removed = document.createElement('span');
        removed.className = 'theia-mobile-agent-diff-stat theia-mod-removed';
        removed.textContent = `-${stats.removed ?? 0}`;
        statsInline.append(removed);
    }
    host.append(statsInline);
}

function buildChangesPillAriaLabel(
    fileCount: number,
    stats: { readonly added?: number; readonly removed?: number } | undefined,
): string {
    const added = stats?.added ?? 0;
    const removed = stats?.removed ?? 0;
    if (fileCount === 1) {
        return nls.localize(
            'qaap/mobileProjects/stickyComposerChangesPillOne',
            'Review 1 changed file (+{0} −{1})',
            String(added),
            String(removed),
        );
    }
    return nls.localize(
        'qaap/mobileProjects/stickyComposerChangesPillMany',
        'Review {0} changed files (+{1} −{2})',
        String(fileCount),
        String(added),
        String(removed),
    );
}

function renderStickyComposerChangedFilesSection(options: StickyComposerActivityStackOptions): HTMLElement {
    const files = options.changedFiles ?? [];
    const stats = options.diffStats;
    const fileCount = options.changedFileCount ?? (files.length > 0
        ? files.length
        : ((stats?.added ?? 0) > 0 || (stats?.removed ?? 0) > 0 ? 1 : 0));

    const section = document.createElement('div');
    section.className = 'theia-mobile-sticky-composer-activity-section theia-mod-files theia-mod-changes-pill';

    const row = document.createElement('div');
    row.className = 'theia-mobile-sticky-composer-changes-pill-row';

    // The review "Changes" group only appears while there are unresolved changes;
    // Accept/Discard resolve them and it drops off, but the row (Commit, preview)
    // stays. See stickyComposerHasActivityRow.
    if (options.onReview && stickyComposerHasChangesToReview(options)) {
        const changesGroup = document.createElement('div');
        changesGroup.className = 'theia-mobile-sticky-composer-changes-group';

        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'theia-mobile-sticky-composer-changes-pill';
        pill.setAttribute(
            'aria-label',
            buildChangesPillAriaLabel(fileCount, stats),
        );
        const label = document.createElement('span');
        label.className = 'theia-mobile-sticky-composer-changes-pill-label';
        label.textContent = nls.localize('qaap/mobileProjects/changes', 'Changes');
        pill.append(label);
        if (fileCount > 0) {
            const count = document.createElement('span');
            count.className = 'theia-mobile-sticky-composer-changes-pill-count';
            count.textContent = fileCount === 1
                ? nls.localize('qaap/mobileProjects/stickyComposerChangesOneFileShort', '1 file')
                : nls.localize('qaap/mobileProjects/stickyComposerChangesManyFilesShort', '{0} files', String(fileCount));
            pill.append(count);
        }
        appendDiffStatsInline(pill, stats);
        pill.addEventListener('click', ev => {
            ev.preventDefault();
            ev.stopPropagation();
            options.onReview?.();
        });
        changesGroup.append(pill);

        const changesMenuItems = buildChangesMenuItems(options);
        if (changesMenuItems.length > 0) {
            changesGroup.append(createStickyComposerSplitMenu(
                changesGroup,
                nls.localize('qaap/mobileProjects/changesOptions', 'Changes options'),
                changesMenuItems,
                // Only a running bulk Accept/Discard disables the menu — not agentWorking, whose stale
                // value locked the user out of managing on-disk changes after a finished turn.
                !!options.changedFilesBulkBusy,
            ));
        }
        row.append(changesGroup);
    }

    // Commit is tied to real git state: it shows only when there is something to
    // commit (staged after Accept, or still-unstaged), and drops off once a
    // Discard leaves the tree clean.
    if (options.onCommitAction && options.hasCommittableChanges) {
        row.append(renderChangesCommitGroup(options));
    }

    const nextActions = renderChangesNextActions(options);
    if (nextActions) {
        row.append(nextActions);
    }

    section.append(row);
    return section;
}

/** "Accept" / "Discard" entries for the Changes split-button menu. */
function buildChangesMenuItems(options: StickyComposerActivityStackOptions): StickyComposerSplitMenuItem[] {
    const items: StickyComposerSplitMenuItem[] = [];
    if (options.onKeepAll) {
        items.push({
            label: nls.localize('qaap/mobileProjects/changesAccept', 'Accept'),
            onSelect: options.onKeepAll,
        });
    }
    if (options.onUndoAll) {
        items.push({
            label: nls.localize('qaap/mobileProjects/changesDiscard', 'Discard'),
            onSelect: options.onUndoAll,
        });
    }
    return items;
}

function renderChangesNextActions(options: StickyComposerActivityStackOptions): HTMLElement | undefined {
    if (!options.onRunApp && !options.onOpenPreview) {
        return undefined;
    }
    const group = document.createElement('div');
    group.className = 'theia-mobile-sticky-composer-next-actions';
    patchChangesNextActions(group, options);
    return group;
}

function patchChangesNextActions(group: HTMLElement, options: StickyComposerActivityStackOptions): void {
    group.replaceChildren();
    // The two are alternatives, not a sequence: with a live preview URL the app
    // is already up, so the next step is opening it; without one it first has
    // to be started. Never show both.
    if (options.onOpenPreview) {
        group.append(createChangesNextActionButton({
            className: 'theia-mod-preview',
            label: nls.localize('qaap/mobileProjects/viewPreview', 'View Preview'),
            iconClass: 'codicon-globe',
            onClick: options.onOpenPreview,
        }));
    } else if (options.onRunApp) {
        group.append(createChangesNextActionButton({
            className: 'theia-mod-run',
            label: nls.localize('qaap/agentsHub/quickAction/runApp', 'Run app'),
            iconClass: 'codicon-rocket',
            onClick: options.onRunApp,
        }));
    }
}

function createChangesNextActionButton(options: {
    readonly className: string;
    readonly label: string;
    readonly iconClass: string;
    readonly onClick: () => void;
}): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `theia-mobile-sticky-composer-next-action ${options.className}`;
    btn.title = options.label;
    btn.setAttribute('aria-label', options.label);
    btn.append(createNextActionIcon(options.iconClass), document.createTextNode(options.label));
    btn.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        options.onClick();
    });
    return btn;
}

function createNextActionIcon(iconClass: string): HTMLElement {
    const icon = document.createElement('span');
    icon.className = `codicon ${iconClass}`;
    icon.setAttribute('aria-hidden', 'true');
    return icon;
}

interface StickyComposerSplitMenuItem {
    readonly label: string;
    readonly onSelect: () => void;
}

/**
 * Chevron button + dropdown shared by the composer split-buttons (Commit &
 * Push, Changes). The changes-pill row is a horizontal scroll container
 * (overflow-x: auto), which clips absolutely-positioned descendants — so while
 * open, the menu is portaled to <body> with fixed viewport coords,
 * right-aligned to the chevron and opening upwards.
 */
function createStickyComposerSplitMenu(
    group: HTMLElement,
    menuLabel: string,
    items: readonly StickyComposerSplitMenuItem[],
    disabled: boolean,
): HTMLElement {
    const menuWrap = document.createElement('div');
    menuWrap.className = 'theia-mobile-sticky-composer-commit-menu-wrap';

    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'theia-mobile-sticky-composer-commit-menu';
    menuBtn.disabled = disabled;
    menuBtn.title = menuLabel;
    menuBtn.setAttribute('aria-label', menuLabel);
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.setAttribute('aria-haspopup', 'menu');
    menuBtn.innerHTML = '<span class="codicon codicon-chevron-down" aria-hidden="true"></span>';

    const dropdown = document.createElement('div');
    dropdown.className = 'theia-mobile-sticky-composer-commit-dropdown';
    dropdown.setAttribute('role', 'menu');
    dropdown.hidden = true;

    const onDocumentPointerDown = (ev: PointerEvent): void => {
        const target = ev.target;
        if (target instanceof Node && ((group.isConnected && group.contains(target)) || dropdown.contains(target))) {
            return;
        }
        closeMenu();
    };
    const onWindowScroll = (ev: Event): void => {
        // Scrolling inside the open menu itself is fine; anything else moves the
        // anchor button, so close instead of tracking it.
        if (ev.target instanceof Node && dropdown.contains(ev.target)) {
            return;
        }
        closeMenu();
    };
    const closeMenu = (): void => {
        dropdown.hidden = true;
        menuBtn.classList.remove('theia-mod-open');
        menuBtn.setAttribute('aria-expanded', 'false');
        // Return the portaled menu home so a later open starts from a clean slate.
        dropdown.classList.remove('theia-mod-portal');
        dropdown.style.left = '';
        dropdown.style.bottom = '';
        menuWrap.append(dropdown);
        document.removeEventListener('pointerdown', onDocumentPointerDown, true);
        window.removeEventListener('scroll', onWindowScroll, true);
        window.removeEventListener('resize', closeMenu);
    };
    const openMenu = (): void => {
        const view = menuBtn.ownerDocument.defaultView ?? window;
        const rect = menuBtn.getBoundingClientRect();
        dropdown.classList.add('theia-mod-portal');
        // Append (visible) before measuring so we get the real rendered width,
        // then anchor by `left` clamped into the viewport. Anchoring by `right`
        // aligned to the chevron pushed the menu off-screen left when the split
        // button sat on the left of the row (narrow phones).
        menuBtn.ownerDocument.body.append(dropdown);
        dropdown.hidden = false;
        const width = dropdown.offsetWidth;
        const margin = 8;
        // Right-align to the chevron by default, then clamp both edges in.
        let left = rect.right - width;
        left = Math.min(left, view.innerWidth - margin - width);
        left = Math.max(margin, left);
        dropdown.style.left = `${left}px`;
        dropdown.style.bottom = `${Math.max(margin, view.innerHeight - rect.top + margin)}px`;
        menuBtn.classList.add('theia-mod-open');
        menuBtn.setAttribute('aria-expanded', 'true');
        document.addEventListener('pointerdown', onDocumentPointerDown, true);
        window.addEventListener('scroll', onWindowScroll, true);
        window.addEventListener('resize', closeMenu);
    };

    menuBtn.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        if (dropdown.hidden) {
            openMenu();
        } else {
            closeMenu();
        }
    });

    for (const item of items) {
        const itemBtn = document.createElement('button');
        itemBtn.type = 'button';
        itemBtn.className = 'theia-mobile-sticky-composer-commit-dropdown-item';
        itemBtn.setAttribute('role', 'menuitem');
        itemBtn.textContent = item.label;
        itemBtn.addEventListener('click', ev => {
            ev.preventDefault();
            ev.stopPropagation();
            closeMenu();
            item.onSelect();
        });
        dropdown.append(itemBtn);
    }

    menuWrap.append(menuBtn, dropdown);
    return menuWrap;
}

/** Split button beside the Changes pill: primary "Commit & Push" + a menu with the other git workflows. */
function renderChangesCommitGroup(options: StickyComposerActivityStackOptions): HTMLElement {
    const disabled = !!options.commitBusy;

    const group = document.createElement('div');
    // theia-mod-busy drives the animated border beam while the commit workflow runs.
    group.className = `theia-mobile-sticky-composer-commit-group${disabled ? ' theia-mod-busy' : ''}`;

    const commitBtn = document.createElement('button');
    commitBtn.type = 'button';
    commitBtn.className = 'theia-mobile-sticky-composer-commit-btn';
    commitBtn.disabled = disabled;
    commitBtn.textContent = nls.localize('qaap/mobileProjects/commit', 'Commit');
    commitBtn.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        options.onCommitAction?.('commit');
    });

    const menuWrap = createStickyComposerSplitMenu(
        group,
        nls.localize('qaap/mobileProjects/commitOptions', 'Commit options'),
        stickyComposerCommitMenuOptions().map(option => ({
            label: option.label,
            onSelect: () => options.onCommitAction?.(option.action),
        })),
        disabled,
    );

    // Same bloom layer as the composer's border beam; CSS only shows it while theia-mod-busy is set.
    const borderBeamBloom = document.createElement('div');
    borderBeamBloom.className = 'qaap-border-beam-bloom';
    borderBeamBloom.setAttribute('aria-hidden', 'true');
    group.append(commitBtn, menuWrap, borderBeamBloom);
    return group;
}

function createQueueActionButton(iconClass: string, label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theia-mobile-sticky-composer-queue-action';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.innerHTML = `<span class="codicon ${iconClass}" aria-hidden="true"></span>`;
    btn.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        onClick();
    });
    return btn;
}
