// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import type { QaapGitCommitWorkflowAction } from '@theia/qaap-shared-core/lib/common/qaap-git-review';
import type { StickyComposerChangedFileView } from '@theia/qaap-transcript/lib/browser/qaap-transcript-host-contracts';

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
     * This conversation is about running the app (asked for it, runs a dev server or announced a
     * local URL): its verified preview is shown even when the agent edited no files.
     */
    previewInConversation?: boolean;
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
    /**
     * The conversation asked to run or preview the app and its turn has settled. Run app (or Starting
     * preview…) then shows even without file activity: an agent that wrote its launch plan through a
     * shell command has no file-change evidence, and the request must never end in silence.
     */
    previewRequested?: boolean;
    /** True while Run app is waiting for the managed dev server to become reachable. */
    previewStarting?: boolean;
    /** While a preview starts, the chip stays clickable and stops it (the chip must never be a dead end). */
    onStopPreview?: () => void;
    onOpenPreview?: () => void;
    /** When set, a commit split-button (primary action + options menu) renders beside the Changes pill. */
    onCommitAction?: (action: QaapGitCommitWorkflowAction) => void;
    /** Hide only the primary Approve & Commit button while keeping the existing options menu. */
    hideApproveCommit?: boolean;
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
        // A preview/run action belongs to the post-edit state. A stale preview URL must not
        // push the prompt suggestions out of a fresh, empty composer.
        || !!((options.hasFileActivity || options.previewInConversation) && !!options.onOpenPreview)
        || !!(options.hasFileActivity && !!options.onRunApp)
        || !!(options.previewRequested && !!options.onRunApp);
}

/**
 * Composer host class set while the changes pill row carries the run/preview next action
 * (Run app, Starting preview… or View Preview). The pill row is then the single owner of that
 * action and the quick-actions strip drops its own "Run app" chip, so a conversation never shows
 * two stacked "Run app" pills above the composer.
 */
export const STICKY_COMPOSER_RUN_APP_IN_PILL_ROW_CLASS = 'theia-mod-run-app-in-pill-row';

/** True when the changes pill row renders and carries the run/preview next action. */
export function stickyComposerPillRowOwnsRunApp(options: StickyComposerActivityStackOptions): boolean {
    return stickyComposerHasActivityRow(options) && (!!options.onRunApp || !!options.onOpenPreview);
}

/** Marks the composer host with {@link STICKY_COMPOSER_RUN_APP_IN_PILL_ROW_CLASS} from the activity options. */
export function syncStickyComposerRunAppOwner(host: HTMLElement, options: StickyComposerActivityStackOptions): void {
    host.classList.toggle(STICKY_COMPOSER_RUN_APP_IN_PILL_ROW_CLASS, stickyComposerPillRowOwnsRunApp(options));
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
        options.previewInConversation ? 1 : 0,
        options.previewRequested ? 1 : 0,
        options.hasCommittableChanges ? 1 : 0,
        options.agentWorking ? 1 : 0,
        options.commitBusy ? 1 : 0,
        options.onCommitAction ? 1 : 0,
        options.hideApproveCommit ? 1 : 0,
        options.onRunApp ? 1 : 0,
        options.previewStarting ? 1 : 0,
        options.onStopPreview ? 1 : 0,
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
    const showApproveCommit = hasCommitAction && !options.hideApproveCommit;
    const hasNextActions = !!options.onRunApp || !!options.onOpenPreview;
    const hasChangesMenu = buildChangesMenuItems(options).length > 0;
    const existingCommitGroup = row.querySelector(':scope > .theia-mobile-sticky-composer-commit-group');
    if (!!existingCommitGroup !== hasCommitAction) {
        return false;
    }
    if (!!existingCommitGroup?.querySelector('.theia-mobile-sticky-composer-commit-btn') !== showApproveCommit) {
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
    // has no file activity, so a stale preview URL cannot displace empty-state suggestions.
    if (!stickyComposerHasActivityRow(options)) {
        return undefined;
    }
    const host = document.createElement('div');
    host.className = 'theia-mobile-sticky-composer-changes-pill-host';
    host.append(renderStickyComposerChangedFilesSection(options));
    publishPillStripHeight(host);
    return host;
}

/**
 * The transcript keeps its tail clear of this strip by overlapping the composer by the strip's
 * height. A fixed guess (26–30px) hid the last line behind taller rows such as View Preview, so
 * the real height is published as `--qaap-composer-pill-strip-height` on the Work Hub root.
 * The observer stops once the strip leaves the document.
 */
function publishPillStripHeight(host: HTMLElement): void {
    if (typeof ResizeObserver === 'undefined') {
        return;
    }
    const observer = new ResizeObserver(() => {
        if (!host.isConnected) {
            observer.disconnect();
            return;
        }
        const root = host.closest<HTMLElement>('.theia-mobile-projects');
        if (!root || host.hidden) {
            return;
        }
        const height = Math.round(host.getBoundingClientRect().height);
        if (height > 0) {
            root.style.setProperty('--qaap-composer-pill-strip-height', `${height}px`);
        }
    });
    observer.observe(host);
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
    } else if (options.previewStarting && options.onStopPreview) {
        // Still starting: spinner look, but a click stops the start instead of being a dead end.
        group.append(createChangesNextActionButton({
            className: 'theia-mod-run theia-mod-preview-starting theia-mod-preview-cancelable',
            label: nls.localize('qaap/mobileProjects/previewStarting', 'Starting preview…'),
            hint: nls.localize('qaap/mobileProjects/previewStopAction', 'Starting preview… Tap to stop'),
            iconClass: 'codicon-loading',
            busy: true,
            busyDisabled: false,
            onClick: options.onStopPreview,
        }));
    } else if (options.onRunApp) {
        const label = options.previewStarting
            ? nls.localize('qaap/mobileProjects/previewStarting', 'Starting preview…')
            : nls.localize('qaap/agentsHub/quickAction/runApp', 'Run app');
        group.append(createChangesNextActionButton({
            className: options.previewStarting ? 'theia-mod-run theia-mod-preview-starting' : 'theia-mod-run',
            label,
            iconClass: options.previewStarting ? 'codicon-loading' : 'codicon-rocket',
            busy: options.previewStarting,
            onClick: options.onRunApp,
        }));
    }
}

function createChangesNextActionButton(options: {
    readonly className: string;
    readonly label: string;
    readonly iconClass: string;
    readonly busy?: boolean;
    /** Busy look only: a busy chip that stays clickable (cancelable start) sets this to false. */
    readonly busyDisabled?: boolean;
    /** Tooltip and accessible name when they differ from the visible label (e.g. "tap to stop"). */
    readonly hint?: string;
    readonly onClick: () => void;
}): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `theia-mobile-sticky-composer-next-action ${options.className}`;
    btn.title = options.hint ?? options.label;
    btn.setAttribute('aria-label', options.hint ?? options.label);
    if (options.busy) {
        btn.setAttribute('aria-busy', 'true');
        btn.disabled = options.busyDisabled !== false;
    }
    btn.append(createNextActionIcon(options.iconClass), document.createTextNode(options.label));
    if (options.busy) {
        const borderBeamBloom = document.createElement('div');
        borderBeamBloom.className = 'qaap-border-beam-bloom';
        borderBeamBloom.setAttribute('aria-hidden', 'true');
        btn.append(borderBeamBloom);
    }
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
    const positionMenu = (): void => {
        if (dropdown.hidden) {
            return;
        }
        const view = menuBtn.ownerDocument.defaultView ?? window;
        const rect = menuBtn.getBoundingClientRect();
        const width = dropdown.offsetWidth;
        const margin = 8;
        let left = rect.right - width;
        left = Math.min(left, view.innerWidth - margin - width);
        left = Math.max(margin, left);
        dropdown.style.left = `${left}px`;
        dropdown.style.bottom = `${Math.max(margin, view.innerHeight - rect.top + margin)}px`;
    };
    const onWindowScroll = (ev: Event): void => {
        // The activity row can settle its layout while the menu is open. Keep the
        // portaled menu attached to its trigger instead of dismissing it on an
        // incidental scroll event.
        if (ev.target instanceof Node && dropdown.contains(ev.target)) {
            return;
        }
        positionMenu();
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
        window.removeEventListener('resize', positionMenu);
    };
    const openMenu = (): void => {
        dropdown.classList.add('theia-mod-portal');
        // Append (visible) before measuring so we get the real rendered width,
        // then anchor by `left` clamped into the viewport. Anchoring by `right`
        // aligned to the chevron pushed the menu off-screen left when the split
        // button sat on the left of the row (narrow phones).
        menuBtn.ownerDocument.body.append(dropdown);
        dropdown.hidden = false;
        // Right-align to the chevron by default, then clamp both edges in.
        positionMenu();
        menuBtn.classList.add('theia-mod-open');
        menuBtn.setAttribute('aria-expanded', 'true');
        document.addEventListener('pointerdown', onDocumentPointerDown, true);
        window.addEventListener('scroll', onWindowScroll, true);
        window.addEventListener('resize', positionMenu);
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

    const commitBtn = options.hideApproveCommit ? undefined : document.createElement('button');
    if (commitBtn) {
        commitBtn.type = 'button';
        commitBtn.className = 'theia-mobile-sticky-composer-commit-btn';
        commitBtn.disabled = disabled;
        commitBtn.textContent = nls.localize('qaap/mobileProjects/approveAndCommit', 'Approve & Commit');
        commitBtn.addEventListener('click', ev => {
            ev.preventDefault();
            ev.stopPropagation();
            options.onCommitAction?.('commit');
        });
    }

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
    if (commitBtn) {
        group.append(commitBtn);
    }
    group.append(menuWrap, borderBeamBloom);
    return group;
}
