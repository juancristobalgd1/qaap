// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import type { TranscriptFollowUpEntry } from '../common/qaap-transcript-follow-up-queue';
import type { QaapGitCommitWorkflowAction } from '../common/qaap-git-review';

export interface StickyComposerChangedFileView {
    readonly path: string;
    readonly kind: 'edited' | 'created';
    readonly added?: number;
    readonly removed?: number;
}

export interface StickyComposerActivityStackOptions {
    queueEntries?: readonly TranscriptFollowUpEntry[];
    queueExpanded?: boolean;
    onQueueExpandedChange?: (expanded: boolean) => void;
    onQueueEdit?: (index: number, entry: TranscriptFollowUpEntry) => void;
    onQueueMoveUp?: (index: number) => void;
    onQueueRemove?: (index: number) => void;
    changedFiles?: readonly StickyComposerChangedFileView[];
    diffStats?: { readonly added: number; readonly removed: number };
    filesExpanded?: boolean;
    onFilesExpandedChange?: (expanded: boolean) => void;
    agentWorking?: boolean;
    onStop?: () => void;
    onUndoAll?: () => void;
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
            action: 'commit',
            label: nls.localize('qaap/mobileProjects/commit', 'Commit'),
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
        drafts,
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
    const section = stack.querySelector(':scope > .theia-mobile-sticky-composer-activity-section.theia-mod-queue');
    if (!(section instanceof HTMLElement)) {
        return false;
    }
    const head = section.querySelector<HTMLButtonElement>(':scope > .theia-mobile-sticky-composer-activity-head');
    const body = section.querySelector<HTMLElement>(':scope > .theia-mobile-sticky-composer-activity-body.theia-mobile-sticky-composer-queue-list');
    const chevron = head?.querySelector<HTMLElement>('.theia-mobile-sticky-composer-activity-chevron');
    const title = head?.querySelector<HTMLElement>('.theia-mobile-sticky-composer-activity-title');
    if (!head || !body || !chevron || !title) {
        return false;
    }
    const items = Array.from(body.querySelectorAll<HTMLElement>(':scope > .theia-mobile-sticky-composer-queue-item'));
    if (items.length !== entries.length) {
        return false;
    }
    const expanded = options.queueExpanded ?? true;
    head.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    chevron.classList.toggle('theia-mod-collapsed', !expanded);
    body.hidden = !expanded;
    title.textContent = entries.length === 1
        ? nls.localize('qaap/mobileProjects/stickyComposerQueueOne', '1 Queued')
        : nls.localize('qaap/mobileProjects/stickyComposerQueueMany', '{0} Queued', String(entries.length));
    for (let index = 0; index < entries.length; index++) {
        const item = items[index];
        const textEl = item?.querySelector<HTMLElement>('.theia-mobile-sticky-composer-queue-text');
        if (!textEl) {
            return false;
        }
        if (textEl.textContent !== entries[index].draft) {
            textEl.textContent = entries[index].draft;
        }
        const expectedMoveUp = index > 0;
        const hasMoveUp = !!item?.querySelector('.codicon-arrow-up');
        if (hasMoveUp !== expectedMoveUp) {
            return false;
        }
    }
    return true;
}

export function buildStickyComposerChangesPillFingerprint(options: StickyComposerActivityStackOptions): string {
    const files = options.changedFiles ?? [];
    const stats = options.diffStats;
    const paths = files.map(file => file.path).sort().join('\n');
    return [
        files.length,
        stats?.added ?? 0,
        stats?.removed ?? 0,
        paths,
        options.agentWorking ? 1 : 0,
        options.commitBusy ? 1 : 0,
        options.onCommitAction ? 1 : 0,
        options.onRunApp ? 1 : 0,
        options.onOpenPreview ? 1 : 0,
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
    const fileCount = files.length > 0
        ? files.length
        : ((stats?.added ?? 0) > 0 || (stats?.removed ?? 0) > 0 ? 1 : 0);
    const hasCommitAction = !!options.onCommitAction;
    const hasNextActions = !!options.onRunApp || !!options.onOpenPreview;
    const existingCommitGroup = row.querySelector(':scope > .theia-mobile-sticky-composer-commit-group');
    if (!!existingCommitGroup !== hasCommitAction) {
        return false;
    }
    const existingNextActions = row.querySelector(':scope > .theia-mobile-sticky-composer-next-actions');
    if (!!existingNextActions !== hasNextActions) {
        return false;
    }

    const pill = row.querySelector<HTMLButtonElement>(':scope > .theia-mobile-sticky-composer-changes-pill');
    if (options.onReview) {
        if (!pill) {
            return false;
        }
        pill.setAttribute('aria-label', buildChangesPillAriaLabel(fileCount, stats));
        let statsInline = pill.querySelector<HTMLElement>(':scope > .theia-mobile-sticky-composer-activity-inline-stats');
        if (!statsInline) {
            statsInline = document.createElement('span');
            statsInline.className = 'theia-mobile-sticky-composer-activity-inline-stats';
            pill.append(statsInline);
        }
        statsInline.replaceChildren();
        appendDiffStatsInline(statsInline, stats);
    } else if (pill) {
        return false;
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

    const existingStop = row.querySelector(':scope > .theia-mobile-sticky-composer-activity-stop');
    if (options.agentWorking && options.onStop) {
        if (!existingStop) {
            return false;
        }
    } else if (existingStop) {
        existingStop.remove();
    }

    return true;
}

export function renderStickyComposerChangesPill(options: StickyComposerActivityStackOptions): HTMLElement | undefined {
    const hasFiles = (options.changedFiles?.length ?? 0) > 0;
    const hasStats = !!options.diffStats && ((options.diffStats.added ?? 0) > 0 || (options.diffStats.removed ?? 0) > 0);
    if (!hasFiles && !hasStats) {
        return undefined;
    }
    const host = document.createElement('div');
    host.className = 'theia-mobile-sticky-composer-changes-pill-host';
    host.append(renderStickyComposerChangedFilesSection(options));
    return host;
}

export function renderStickyComposerActivityStack(options: StickyComposerActivityStackOptions): HTMLElement | undefined {
    const queueSection = options.queueEntries?.length
        ? renderStickyComposerQueueSection(options)
        : undefined;
    if (!queueSection) {
        return undefined;
    }
    const stack = document.createElement('div');
    stack.className = 'theia-mobile-sticky-composer-activity-stack';
    stack.append(queueSection);
    return stack;
}

function renderStickyComposerQueueSection(options: StickyComposerActivityStackOptions): HTMLElement {
    const entries = options.queueEntries ?? [];
    let expanded = options.queueExpanded ?? true;

    const section = document.createElement('div');
    section.className = 'theia-mobile-sticky-composer-activity-section theia-mod-queue';

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'theia-mobile-sticky-composer-activity-head';
    head.setAttribute('aria-expanded', expanded ? 'true' : 'false');

    const chevron = document.createElement('span');
    chevron.className = 'theia-mobile-sticky-composer-activity-chevron codicon codicon-chevron-down';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.classList.toggle('theia-mod-collapsed', !expanded);

    const title = document.createElement('span');
    title.className = 'theia-mobile-sticky-composer-activity-title';
    title.textContent = entries.length === 1
        ? nls.localize('qaap/mobileProjects/stickyComposerQueueOne', '1 Queued')
        : nls.localize('qaap/mobileProjects/stickyComposerQueueMany', '{0} Queued', String(entries.length));

    head.append(chevron, title);

    const body = document.createElement('div');
    body.className = 'theia-mobile-sticky-composer-activity-body theia-mobile-sticky-composer-queue-list';
    body.hidden = !expanded;

    const syncExpanded = (): void => {
        head.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        chevron.classList.toggle('theia-mod-collapsed', !expanded);
        body.hidden = !expanded;
        options.onQueueExpandedChange?.(expanded);
    };

    head.addEventListener('click', ev => {
        ev.stopPropagation();
        expanded = !expanded;
        syncExpanded();
    });

    entries.forEach((entry, index) => {
        body.append(renderQueueItem(entry, index, entries.length, options));
    });

    section.append(head, body);
    return section;
}

function renderQueueItem(
    entry: TranscriptFollowUpEntry,
    index: number,
    total: number,
    options: StickyComposerActivityStackOptions,
): HTMLElement {
    const row = document.createElement('div');
    row.className = 'theia-mobile-sticky-composer-queue-item';

    const marker = document.createElement('span');
    marker.className = 'theia-mobile-sticky-composer-queue-marker';
    marker.setAttribute('aria-hidden', 'true');

    const text = document.createElement('span');
    text.className = 'theia-mobile-sticky-composer-queue-text';
    text.textContent = entry.draft;

    const actions = document.createElement('div');
    actions.className = 'theia-mobile-sticky-composer-queue-actions';

    const editBtn = createQueueActionButton(
        'codicon-edit',
        nls.localize('qaap/mobileProjects/stickyComposerQueueEdit', 'Edit queued message'),
        () => options.onQueueEdit?.(index, entry),
    );
    actions.append(editBtn);

    if (index > 0) {
        actions.append(createQueueActionButton(
            'codicon-arrow-up',
            nls.localize('qaap/mobileProjects/stickyComposerQueueMoveUp', 'Move up in queue'),
            () => options.onQueueMoveUp?.(index),
        ));
    }

    actions.append(createQueueActionButton(
        'codicon-trash',
        nls.localize('qaap/mobileProjects/stickyComposerQueueRemove', 'Remove from queue'),
        () => options.onQueueRemove?.(index),
    ));

    row.append(marker, text, actions);
    row.title = total > 1
        ? nls.localize('qaap/mobileProjects/stickyComposerQueueItemHint', 'Queued message {0} of {1}', String(index + 1), String(total))
        : '';
    return row;
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
    if ((stats.removed ?? 0) > 0) {
        const removed = document.createElement('span');
        removed.className = 'theia-mobile-agent-diff-stat theia-mod-removed';
        removed.textContent = `-${stats.removed}`;
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
    const fileCount = files.length > 0
        ? files.length
        : ((stats?.added ?? 0) > 0 || (stats?.removed ?? 0) > 0 ? 1 : 0);

    const section = document.createElement('div');
    section.className = 'theia-mobile-sticky-composer-activity-section theia-mod-files theia-mod-changes-pill';

    const row = document.createElement('div');
    row.className = 'theia-mobile-sticky-composer-changes-pill-row';

    if (options.onReview) {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'theia-mobile-sticky-composer-changes-pill';
        pill.setAttribute(
            'aria-label',
            buildChangesPillAriaLabel(fileCount, stats),
        );
        const label = document.createElement('span');
        label.className = 'theia-mobile-sticky-composer-changes-pill-label';
        label.textContent = nls.localize('qaap/mobileProjects/reviewChanges', 'Review changes');
        pill.append(label);
        appendDiffStatsInline(pill, stats);
        pill.addEventListener('click', ev => {
            ev.preventDefault();
            ev.stopPropagation();
            options.onReview?.();
        });
        row.append(pill);
    }

    if (options.onCommitAction) {
        row.append(renderChangesCommitGroup(options));
    }

    const nextActions = renderChangesNextActions(options);
    if (nextActions) {
        row.append(nextActions);
    }

    if (options.agentWorking && options.onStop) {
        const stopBtn = document.createElement('button');
        stopBtn.type = 'button';
        stopBtn.className = 'theia-mobile-sticky-composer-activity-stop';
        stopBtn.title = nls.localize('qaap/mobileProjects/cancelTaskRun', 'Cancel run');
        stopBtn.setAttribute('aria-label', stopBtn.title);
        stopBtn.textContent = nls.localize('qaap/mobileProjects/stickyComposerFilesStop', 'Stop');
        stopBtn.addEventListener('click', ev => {
            ev.preventDefault();
            ev.stopPropagation();
            options.onStop?.();
        });
        row.append(stopBtn);
    }

    section.append(row);
    return section;
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
    if (options.onRunApp) {
        group.append(createChangesNextActionButton({
            className: 'theia-mod-run',
            label: nls.localize('qaap/agentsHub/quickAction/runApp', 'Run app'),
            iconClass: 'codicon-rocket',
            onClick: options.onRunApp,
        }));
    }
    if (options.onOpenPreview) {
        group.append(createChangesNextActionButton({
            className: 'theia-mod-preview',
            label: nls.localize('qaap/mobileProjects/openPreview', 'Open preview'),
            iconClass: 'codicon-globe',
            onClick: options.onOpenPreview,
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
    commitBtn.textContent = nls.localize('qaap/mobileProjects/commitPush', 'Commit & Push');
    commitBtn.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        options.onCommitAction?.('commit-push');
    });

    const menuWrap = document.createElement('div');
    menuWrap.className = 'theia-mobile-sticky-composer-commit-menu-wrap';

    const menuLabel = nls.localize('qaap/mobileProjects/commitOptions', 'Commit options');
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
        if (target instanceof Node && group.isConnected && group.contains(target)) {
            return;
        }
        closeMenu();
    };
    const closeMenu = (): void => {
        dropdown.hidden = true;
        menuBtn.classList.remove('theia-mod-open');
        menuBtn.setAttribute('aria-expanded', 'false');
        document.removeEventListener('pointerdown', onDocumentPointerDown, true);
    };
    const openMenu = (): void => {
        dropdown.hidden = false;
        menuBtn.classList.add('theia-mod-open');
        menuBtn.setAttribute('aria-expanded', 'true');
        document.addEventListener('pointerdown', onDocumentPointerDown, true);
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

    for (const option of stickyComposerCommitMenuOptions()) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'theia-mobile-sticky-composer-commit-dropdown-item';
        item.setAttribute('role', 'menuitem');
        item.textContent = option.label;
        item.addEventListener('click', ev => {
            ev.preventDefault();
            ev.stopPropagation();
            closeMenu();
            options.onCommitAction?.(option.action);
        });
        dropdown.append(item);
    }

    menuWrap.append(menuBtn, dropdown);
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
