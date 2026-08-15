// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import {
    createWorkHubWorkingChildIcon,
    createWorkHubWorkingParentIcon,
} from '@theia/qaap-adapters/lib/browser/qaap-lucide-icons';
import {
    buildTeamTree,
    countRunningTeamMembers,
    type WorkHubTeamMember,
} from '../common/qaap-work-hub-team';
import {
    renderWorkingAgentDetailActivityFeed,
    resolveWorkingMemberCommand,
    type WorkingAgentDetailActivityFeed,
} from './qaap-sticky-composer-working-detail-activity';
import {
    findWorkingDetailTaskLog,
    renderWorkingDetailTaskLog,
    shouldShowWorkingDetailTaskLog,
    updateWorkingDetailTaskLog,
    workingDetailTaskLogHasTranscriptSegments,
    WORKING_DETAIL_TASK_LOG_CLASS,
} from './qaap-sticky-composer-working-detail-task-log';
import { resolveAgentDisplayLabel } from './qaap-agent-ui';

export const WORKING_CONTROL_CLASS = 'theia-mobile-sticky-composer-working-control';
export const WORKING_EXPAND_CLIP_CLASS = 'qaap-working-agents-expand-clip';
export const WORKING_DETAIL_PANEL_CLASS = 'qaap-working-agents-detail-panel';

function markWorkingPillExpanded(anchor: HTMLElement, open: boolean): void {
    anchor.setAttribute('aria-expanded', open ? 'true' : 'false');
    anchor.classList.toggle('theia-mod-active', open);
}

export interface WorkingAgentsPopoverEntry {
    readonly member: WorkHubTeamMember;
    readonly depth: number;
}

export interface OpenWorkingAgentsPopoverOptions {
    readonly anchor: HTMLElement;
    readonly members: readonly WorkHubTeamMember[];
    readonly transcriptOverlay?: boolean;
    /** Open the agent/session transcript (detail footer action — not row click). */
    readonly onSelect: (member: WorkHubTeamMember) => void;
    readonly onStop?: (member: WorkHubTeamMember) => boolean | void | Promise<boolean | void>;
    readonly onStopAll: (
        members: readonly WorkHubTeamMember[],
    ) => boolean | void | Promise<boolean | void>;
    readonly onClose?: () => void;
    /**
     * Cursor-style live activity feed for the DETAIL panel.
     * Prefer transcript segments from threadStore; fallback to activityLabel.
     */
    readonly resolveDetailActivityFeed?: (
        member: WorkHubTeamMember,
    ) => WorkingAgentDetailActivityFeed | undefined;
    /**
     * Fired when the DETAIL member changes (row → detail, back → list, close).
     * Hosts use this to subscribe/unsubscribe live transcript activity.
     */
    readonly onDetailMemberChange?: (member: WorkHubTeamMember | undefined) => void;
}

interface ActiveWorkingAgentsExpand {
    readonly shell: HTMLElement;
    readonly clip: HTMLElement;
    readonly inner: HTMLElement;
    readonly cleanup: () => void;
    anchor: HTMLElement;
    onSelect: (member: WorkHubTeamMember) => void;
    onStop?: (member: WorkHubTeamMember) => boolean | void | Promise<boolean | void>;
    onStopAll: (
        members: readonly WorkHubTeamMember[],
    ) => boolean | void | Promise<boolean | void>;
    onClose: () => void;
    resolveDetailActivityFeed?: (
        member: WorkHubTeamMember,
    ) => WorkingAgentDetailActivityFeed | undefined;
    onDetailMemberChange?: (member: WorkHubTeamMember | undefined) => void;
    members: WorkHubTeamMember[];
    detailMemberId: string | undefined;
}

let activeWorkingAgentsExpand: ActiveWorkingAgentsExpand | undefined;

/** Survives DOM teardown (pill row remount, composer refresh). */
interface WorkingExpandSession {
    open: boolean;
    detailMemberId?: string;
    detailLarge?: boolean;
    transcriptOverlay?: boolean;
    /** Live handlers — kept on session so remount/reclaim never falls back to no-ops. */
    onSelect?: (member: WorkHubTeamMember) => void;
    onStop?: (member: WorkHubTeamMember) => boolean | void | Promise<boolean | void>;
    onStopAll?: (
        members: readonly WorkHubTeamMember[],
    ) => boolean | void | Promise<boolean | void>;
    onCloseExtra?: () => void;
    resolveDetailActivityFeed?: (
        member: WorkHubTeamMember,
    ) => WorkingAgentDetailActivityFeed | undefined;
    onDetailMemberChange?: (member: WorkHubTeamMember | undefined) => void;
}

let workingExpandSession: WorkingExpandSession = { open: false };

function bindSessionHandlers(options: OpenWorkingAgentsPopoverOptions): void {
    workingExpandSession.onSelect = options.onSelect;
    workingExpandSession.onStop = options.onStop;
    workingExpandSession.onStopAll = options.onStopAll;
    workingExpandSession.onCloseExtra = options.onClose;
    if (options.resolveDetailActivityFeed) {
        workingExpandSession.resolveDetailActivityFeed = options.resolveDetailActivityFeed;
    }
    if (options.onDetailMemberChange) {
        workingExpandSession.onDetailMemberChange = options.onDetailMemberChange;
    }
}

function notifyDetailMemberChange(member: WorkHubTeamMember | undefined): void {
    const handler = workingExpandSession.onDetailMemberChange
        ?? activeWorkingAgentsExpand?.onDetailMemberChange;
    handler?.(member);
}

function resolveSessionDetailActivityFeed(
    member: WorkHubTeamMember,
): WorkingAgentDetailActivityFeed | undefined {
    const resolve = workingExpandSession.resolveDetailActivityFeed
        ?? activeWorkingAgentsExpand?.resolveDetailActivityFeed;
    return resolve?.(member);
}

function resolveSessionOnSelect(): (member: WorkHubTeamMember) => void {
    return workingExpandSession.onSelect
        ?? activeWorkingAgentsExpand?.onSelect
        ?? ((): void => undefined);
}

function resolveSessionOnStopAll(): (
    members: readonly WorkHubTeamMember[],
) => boolean | void | Promise<boolean | void> {
    return workingExpandSession.onStopAll
        ?? activeWorkingAgentsExpand?.onStopAll
        ?? ((): void => undefined);
}

function resolveSessionOnStop(): (
    member: WorkHubTeamMember,
) => boolean | void | Promise<boolean | void> {
    return workingExpandSession.onStop
        ?? activeWorkingAgentsExpand?.onStop
        ?? ((): void => undefined);
}

function invokeSessionOnClose(): void {
    const extra = workingExpandSession.onCloseExtra;
    closeWorkingAgentsPopover();
    extra?.();
}

/** Off-DOM parking lot so remounts (`replaceChildren`) cannot destroy an open Working menu. */
const WORKING_CONTROL_PARK_ID = 'qaap-working-control-park-root';

function clearWorkingExpandSession(): void {
    const hadDetail = !!workingExpandSession.detailMemberId;
    const onDetailMemberChange = workingExpandSession.onDetailMemberChange;
    workingExpandSession = { open: false, detailLarge: false };
    if (hadDetail) {
        onDetailMemberChange?.(undefined);
    }
}

export function isWorkingAgentsExpandSessionOpen(): boolean {
    return workingExpandSession.open;
}

/**
 * True while the user has a *visible* Working expand open (list or detail) for reading.
 * Auto-collapse from count=0 / idle / summary settled must NOT fire in this state.
 *
 * Session flag alone is not enough: an orphaned `workingExpandSession.open` after the
 * shell disconnects would otherwise force a ghost "1 Working" pill forever.
 */
export function isWorkingAgentsExpandPinnedOpen(): boolean {
    ensureWorkingExpandOrphanedIfDisconnected();
    const active = activeWorkingAgentsExpand;
    if (active?.shell.isConnected && active.shell.classList.contains('theia-mod-expanded')) {
        return true;
    }
    // Parked control during sticky-composer remount — still pinned for reclaim/reading.
    const park = document.getElementById(WORKING_CONTROL_PARK_ID);
    return !!(
        workingExpandSession.open
        && park?.querySelector(`.${WORKING_CONTROL_CLASS}.theia-mod-expanded`)
    );
}

/**
 * Members shown in an open expand. Prefer live working agents; when they all go idle
 * (summary / settled), keep the last snapshot so the user can finish reading.
 */
export function resolveExpandMembersForSession(
    members: readonly WorkHubTeamMember[],
): WorkHubTeamMember[] {
    const working = filterWorkingTeamMembers(members);
    if (working.length > 0) {
        return working;
    }
    if (!isWorkingAgentsExpandPinnedOpen()) {
        return working;
    }
    const active = activeWorkingAgentsExpand;
    const byId = new Map(members.map(member => [member.id, member]));
    if (active?.members.length) {
        return active.members.map(member => byId.get(member.id) ?? member);
    }
    const detailId = workingExpandSession.detailMemberId;
    if (detailId) {
        const pinned = byId.get(detailId);
        if (pinned) {
            return [pinned];
        }
    }
    return working;
}

function getWorkingControlParkRoot(): HTMLElement {
    let park = document.getElementById(WORKING_CONTROL_PARK_ID);
    if (!(park instanceof HTMLElement)) {
        park = document.createElement('div');
        park.id = WORKING_CONTROL_PARK_ID;
        park.hidden = true;
        park.setAttribute('aria-hidden', 'true');
        document.body.append(park);
    }
    return park;
}

/**
 * Suspend dismiss listeners without clearing session.
 * Call when the sticky-composer host is about to be torn down.
 */
export function suspendWorkingAgentsExpandForRemount(): void {
    if (!activeWorkingAgentsExpand) {
        return;
    }
    // Keep session + shell node; only drop document listeners that would false-close.
    activeWorkingAgentsExpand.cleanup();
    activeWorkingAgentsExpand = {
        ...activeWorkingAgentsExpand,
        cleanup: () => undefined,
    };
}

/**
 * Move the Working control (and open panel) out of an ephemeral host before
 * `replaceChildren` / host rebuild. Preserves expand + detail session.
 */
export function parkWorkingControlFromAncestor(ancestor: HTMLElement): boolean {
    const control = ancestor.querySelector(`.${WORKING_CONTROL_CLASS}`);
    if (!(control instanceof HTMLElement)) {
        suspendWorkingAgentsExpandForRemount();
        ensureWorkingExpandOrphanedIfDisconnected();
        return false;
    }
    suspendWorkingAgentsExpandForRemount();
    getWorkingControlParkRoot().append(control);
    // Shell is still in the document (parked); keep active refs if this was the open shell.
    if (activeWorkingAgentsExpand?.shell === control) {
        const pill = control.querySelector('.theia-mobile-sticky-composer-working-pill');
        if (pill instanceof HTMLElement) {
            activeWorkingAgentsExpand = {
                ...activeWorkingAgentsExpand,
                anchor: pill,
                cleanup: () => undefined,
            };
        }
    } else if (workingExpandSession.open) {
        // Control was open visually but active was already cleared — keep session.
        workingExpandSession.open = true;
    }
    return true;
}

/**
 * Re-insert a parked Working control into a freshly built pill row (same node = same expand state).
 * Returns true when a parked control was reclaimed.
 */
export function reclaimParkedWorkingControlIntoRow(
    row: HTMLElement,
    options?: { readonly onOpen?: (anchor: HTMLButtonElement) => void },
): boolean {
    const park = document.getElementById(WORKING_CONTROL_PARK_ID);
    const control = park?.querySelector(`:scope > .${WORKING_CONTROL_CLASS}`);
    if (!(control instanceof HTMLElement)) {
        return false;
    }
    row.insertBefore(control, row.firstChild);
    const pill = control.querySelector<HTMLButtonElement>(':scope > .theia-mobile-sticky-composer-working-pill');
    if (pill && options?.onOpen) {
        pill.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            options.onOpen!(pill);
        };
    }
    if (workingExpandSession.open && pill) {
        // Re-wire dismiss + active state against the reattached shell.
        const onClose = (): void => {
            closeWorkingAgentsPopover();
            workingExpandSession.onCloseExtra?.();
        };
        const cleanup = wireWorkingAgentsExpandDismiss(control, pill, onClose);
        const clip = control.querySelector(`.${WORKING_EXPAND_CLIP_CLASS}`);
        const inner = clip?.querySelector('.qaap-working-agents-expand-inner');
        if (clip instanceof HTMLElement && inner instanceof HTMLElement) {
            clip.classList.add('theia-mod-open');
            control.classList.add('theia-mod-expanded');
            if (workingExpandSession.detailMemberId) {
                control.classList.add('theia-mod-detail');
            }
            if (workingExpandSession.detailLarge) {
                control.classList.add('theia-mod-detail-large');
                clip.classList.add('theia-mod-detail-large-clip');
            }
            markWorkingPillExpanded(pill, true);
            activeWorkingAgentsExpand = {
                shell: control,
                clip,
                inner,
                cleanup,
                anchor: pill,
                onSelect: resolveSessionOnSelect(),
                onStop: resolveSessionOnStop(),
                onStopAll: resolveSessionOnStopAll(),
                onClose,
                resolveDetailActivityFeed: workingExpandSession.resolveDetailActivityFeed
                    ?? activeWorkingAgentsExpand?.resolveDetailActivityFeed,
                members: activeWorkingAgentsExpand?.members ?? [],
                detailMemberId: workingExpandSession.detailMemberId,
            };
            return true;
        }
    }
    return true;
}

function orphanWorkingAgentsExpand(): void {
    if (!activeWorkingAgentsExpand) {
        return;
    }
    activeWorkingAgentsExpand.cleanup();
    activeWorkingAgentsExpand = undefined;
    // Keep workingExpandSession.open so remount can restore via
    // restoreWorkingAgentsExpandIfNeeded. Chrome must not treat session alone as
    // pinned (see isWorkingAgentsExpandPinnedOpen) or a ghost pill appears.
}

function ensureWorkingExpandOrphanedIfDisconnected(): void {
    const active = activeWorkingAgentsExpand;
    if (!active) {
        return;
    }
    // Parked controls stay in `#qaap-working-control-park-root` and remain connected.
    if (!active.shell.isConnected) {
        orphanWorkingAgentsExpand();
        return;
    }
    if (!active.anchor.isConnected) {
        const pill = active.shell.querySelector('.theia-mobile-sticky-composer-working-pill');
        if (pill instanceof HTMLElement) {
            activeWorkingAgentsExpand = { ...active, anchor: pill };
            return;
        }
        orphanWorkingAgentsExpand();
    }
}

/** Working / streaming team members only (flat). */
export function filterWorkingTeamMembers(members: readonly WorkHubTeamMember[]): WorkHubTeamMember[] {
    return members.filter(member => member.state === 'running' || member.state === 'streaming');
}

/**
 * Flatten parent→child working agents for the Cursor-style Working expand panel.
 * Uses {@link WorkHubTeamMember.parentId} (VPS subtasks + conversation forks).
 */
export function flattenWorkingAgentsTree(members: readonly WorkHubTeamMember[]): WorkingAgentsPopoverEntry[] {
    const working = filterWorkingTeamMembers(members);
    // Retained idle snapshots (after summary/settled) must still flatten while the user reads.
    const source = working.length > 0
        ? working
        : (isWorkingAgentsExpandPinnedOpen() ? [...members] : working);
    const tree = buildTeamTree(source);
    const entries: WorkingAgentsPopoverEntry[] = [];
    const visit = (member: WorkHubTeamMember, depth: number): void => {
        entries.push({ member, depth });
        const children = tree.childrenByParent.get(member.id) ?? [];
        for (const child of children) {
            visit(child, depth + 1);
        }
    };
    for (const root of tree.roots) {
        visit(root, 0);
    }
    return entries;
}

/** Direct working children of a member (for the detail subagents section). */
export function getWorkingAgentChildren(
    members: readonly WorkHubTeamMember[],
    parentId: string,
): WorkHubTeamMember[] {
    const working = filterWorkingTeamMembers(members);
    const tree = buildTeamTree(working);
    return [...(tree.childrenByParent.get(parentId) ?? [])];
}

/** Wrap the Working pill in a shared-surface shell used for in-place expand. */
export function ensureWorkingControlShell(pill: HTMLElement): HTMLElement {
    if (pill.parentElement?.classList.contains(WORKING_CONTROL_CLASS)) {
        return pill.parentElement;
    }
    const shell = document.createElement('div');
    shell.className = WORKING_CONTROL_CLASS;
    pill.replaceWith(shell);
    shell.append(pill);
    return shell;
}

function createWorkingAgentsCloseButton(onClose: () => void): HTMLButtonElement {
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'qaap-working-agents-popover-close';
    closeBtn.title = nls.localizeByDefault('Close');
    closeBtn.setAttribute('aria-label', closeBtn.title);
    closeBtn.innerHTML = '<span class="codicon codicon-close" aria-hidden="true"></span>';
    closeBtn.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
    });
    return closeBtn;
}

function createWorkingAgentsCloudBadge(): HTMLElement {
    const cloud = document.createElement('span');
    cloud.className = 'qaap-working-agents-popover-cloud codicon codicon-cloud';
    cloud.setAttribute('aria-hidden', 'true');
    cloud.title = nls.localize('qaap/workHubChrome/workingCloudAgent', 'Cloud agent');
    return cloud;
}

function createWorkingAgentsRowStopButton(
    member: WorkHubTeamMember,
    onStop: (member: WorkHubTeamMember) => boolean | void | Promise<boolean | void>,
): HTMLButtonElement {
    const stopBtn = document.createElement('button');
    stopBtn.type = 'button';
    stopBtn.className = 'qaap-working-agents-popover-stop-one qaap-working-agents-popover-row-stop';
    stopBtn.textContent = nls.localize('qaap/workHubChrome/workingStop', 'Stop');
    stopBtn.setAttribute('aria-label', nls.localize(
        'qaap/workHubChrome/workingStopAgent',
        'Stop {0}',
        resolveAgentDisplayLabel(member.agentId),
    ));
    stopBtn.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        stopBtn.disabled = true;
        stopBtn.setAttribute('aria-busy', 'true');
        void (async (): Promise<void> => {
            try {
                await onStop(member);
            } catch (error) {
                console.warn('[qaap-working-agents] Stop handler failed:', error);
            } finally {
                if (!stopBtn.isConnected) {
                    return;
                }
                stopBtn.disabled = false;
                stopBtn.removeAttribute('aria-busy');
            }
        })();
    });
    return stopBtn;
}

export function renderWorkingAgentsPopoverPanel(options: {
    readonly entries: readonly WorkingAgentsPopoverEntry[];
    readonly onStopAll: () => boolean | void | Promise<boolean | void>;
    readonly onClose: () => void;
    readonly onSelect: (member: WorkHubTeamMember) => void;
    readonly onStop?: (member: WorkHubTeamMember) => boolean | void | Promise<boolean | void>;
}): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'qaap-working-agents-popover-panel';

    const header = document.createElement('div');
    header.className = 'qaap-working-agents-popover-header';

    const title = document.createElement('span');
    title.className = 'qaap-working-agents-popover-title';
    title.textContent = nls.localize(
        'qaap/workHubChrome/workingPill',
        '{0} Working',
        String(options.entries.length),
    );

    const actions = document.createElement('div');
    actions.className = 'qaap-working-agents-popover-actions';

    const stopAll = document.createElement('button');
    stopAll.type = 'button';
    stopAll.className = 'qaap-working-agents-popover-stop-all';
    stopAll.textContent = nls.localize('qaap/workHubChrome/workingStopAll', 'Stop All');
    let stopAllConfirmationPending = false;
    let stopAllConfirmationTimer: number | undefined;
    stopAll.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (options.entries.length > 1 && !stopAllConfirmationPending) {
            stopAllConfirmationPending = true;
            stopAll.textContent = nls.localize(
                'qaap/workHubChrome/workingStopAllConfirm',
                'Confirm Stop All',
            );
            stopAll.setAttribute('aria-label', nls.localize(
                'qaap/workHubChrome/workingStopAllConfirmAria',
                'Confirm stopping {0} agents',
                String(options.entries.length),
            ));
            if (stopAllConfirmationTimer !== undefined) {
                window.clearTimeout(stopAllConfirmationTimer);
            }
            stopAllConfirmationTimer = window.setTimeout(() => {
                stopAllConfirmationPending = false;
                stopAll.textContent = nls.localize('qaap/workHubChrome/workingStopAll', 'Stop All');
                stopAll.removeAttribute('aria-label');
            }, 5_000);
            return;
        }
        stopAllConfirmationPending = false;
        if (stopAllConfirmationTimer !== undefined) {
            window.clearTimeout(stopAllConfirmationTimer);
            stopAllConfirmationTimer = undefined;
        }
        stopAll.disabled = true;
        stopAll.setAttribute('aria-busy', 'true');
        void (async (): Promise<void> => {
            try {
                await options.onStopAll();
            } catch (error) {
                console.warn('[qaap-working-agents] Stop All handler failed:', error);
            } finally {
                if (!stopAll.isConnected) {
                    return;
                }
                stopAll.disabled = false;
                stopAll.removeAttribute('aria-busy');
                stopAll.textContent = nls.localize('qaap/workHubChrome/workingStopAll', 'Stop All');
                stopAll.removeAttribute('aria-label');
            }
        })();
    });

    actions.append(stopAll, createWorkingAgentsCloseButton(options.onClose));
    header.append(title, actions);

    const list = document.createElement('div');
    list.className = 'qaap-working-agents-popover-list';
    list.setAttribute('role', 'list');

    for (const entry of options.entries) {
        list.append(renderWorkingAgentsPopoverRow(entry, options.onSelect, options.onStop));
    }

    panel.append(header, list);
    return panel;
}

export function renderWorkingAgentsDetailPanel(options: {
    readonly member: WorkHubTeamMember;
    readonly children: readonly WorkHubTeamMember[];
    readonly parent?: WorkHubTeamMember;
    readonly detailLarge?: boolean;
    readonly activityFeed?: WorkingAgentDetailActivityFeed;
    readonly commandLogText?: string;
    readonly commandLogTruncated?: boolean;
    readonly onStop?: (member: WorkHubTeamMember) => boolean | void | Promise<boolean | void>;
    readonly onBack: () => void;
    readonly onClose: () => void;
    readonly onToggleLarge: () => void;
    readonly onSelectChild: (member: WorkHubTeamMember) => void;
}): HTMLElement {
    const panel = document.createElement('div');
    panel.className = `qaap-working-agents-popover-panel ${WORKING_DETAIL_PANEL_CLASS}`;
    panel.dataset.detailMemberId = options.member.id;

    const header = document.createElement('div');
    header.className = 'qaap-working-agents-popover-header theia-mod-detail';

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'qaap-working-agents-popover-back';
    back.title = nls.localizeByDefault('Back');
    back.setAttribute('aria-label', back.title);
    back.innerHTML = '<span class="codicon codicon-chevron-left" aria-hidden="true"></span>';
    back.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        options.onBack();
    });

    const title = document.createElement('span');
    title.className = 'qaap-working-agents-popover-title theia-mod-detail';
    title.textContent = formatWorkingAgentTaskTitle(options.member);
    title.title = formatWorkingAgentAccessibleTitle(options.member);

    const actions = document.createElement('div');
    actions.className = 'qaap-working-agents-popover-actions';

    const expandBtn = document.createElement('button');
    expandBtn.type = 'button';
    expandBtn.className = 'qaap-working-agents-popover-expand';
    expandBtn.title = options.detailLarge
        ? nls.localize('qaap/workHubChrome/workingDetailRestore', 'Restore')
        : nls.localize('qaap/workHubChrome/workingDetailExpand', 'Expand view');
    expandBtn.setAttribute('aria-label', expandBtn.title);
    expandBtn.setAttribute('aria-pressed', options.detailLarge ? 'true' : 'false');
    expandBtn.innerHTML = options.detailLarge
        ? '<span class="codicon codicon-screen-normal" aria-hidden="true"></span>'
        : '<span class="codicon codicon-screen-full" aria-hidden="true"></span>';
    expandBtn.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        options.onToggleLarge();
    });

    actions.append(createWorkingAgentsCloudBadge(), expandBtn, createWorkingAgentsCloseButton(options.onClose));
    header.append(back, title, actions);

    const body = document.createElement('div');
    body.className = 'qaap-working-agents-detail-body';

    if (options.parent) {
        const parentLine = document.createElement('div');
        parentLine.className = 'qaap-working-agents-detail-parent';
        parentLine.textContent = nls.localize(
            'qaap/workHubChrome/workingParentOf',
            'Under {0}',
            options.parent.title?.trim()
            || nls.localize('qaap/mobileProjects/untitledTask', 'Untitled task'),
        );
        body.append(parentLine);
    }

    const feed = options.activityFeed ?? {
        items: [],
        liveLabel: resolveWorkingAgentStatusLabel(options.member),
    };
    body.append(renderWorkingAgentDetailActivityFeed(feed));

    if (shouldShowWorkingDetailTaskLog(options.member) && options.member.taskId
        && !workingDetailTaskLogHasTranscriptSegments(options.commandLogText)) {
        const running = isWorkingAgentStatusLive(options.member);
        body.append(renderWorkingDetailTaskLog({
            taskId: options.member.taskId,
            text: options.commandLogText,
            truncated: options.commandLogTruncated,
            running,
        }));
    }

    if (options.children.length > 0) {
        const section = document.createElement('div');
        section.className = 'qaap-working-agents-detail-section';

        const label = document.createElement('div');
        label.className = 'qaap-working-agents-detail-section-label';
        label.textContent = nls.localize(
            'qaap/workHubChrome/workingSubagents',
            '{0} Subagents',
            String(options.children.length),
        );
        section.append(label);

        const list = document.createElement('div');
        list.className = 'qaap-working-agents-popover-list theia-mod-detail-children';
        list.setAttribute('role', 'list');
        for (const child of options.children) {
            list.append(renderWorkingAgentsPopoverRow(
                { member: child, depth: 1 },
                options.onSelectChild,
                options.onStop,
            ));
        }
        section.append(list);
        body.append(section);
    }

    panel.append(header, body);
    return panel;
}

export function resolveWorkingAgentKindLabel(member: WorkHubTeamMember): string {
    if (member.kind === 'subtask') {
        return nls.localize('qaap/workHubChrome/workingKindSubagent', 'Subagent');
    }
    if (member.kind === 'leader-task') {
        return nls.localize('qaap/workHubChrome/workingKindTask', 'Task');
    }
    return nls.localize('qaap/workHubChrome/workingKindAgent', 'Agent');
}

function renderWorkingAgentsPopoverRow(
    entry: WorkingAgentsPopoverEntry,
    onSelect: (member: WorkHubTeamMember) => void,
    onStop?: (member: WorkHubTeamMember) => boolean | void | Promise<boolean | void>,
): HTMLElement {
    const row = document.createElement('div');
    row.className = 'qaap-working-agents-popover-row';
    row.classList.toggle('theia-mod-child', entry.depth > 0);
    row.setAttribute('role', 'listitem');
    row.dataset.memberId = entry.member.id;
    if (entry.depth > 0) {
        row.style.setProperty('--qaap-working-agents-depth', String(Math.min(entry.depth, 3)));
    }

    // Parent: 2×3 grid. Child: L-shaped tree connector (Cursor Working panel).
    const icon = entry.depth > 0
        ? createWorkHubWorkingChildIcon()
        : createWorkHubWorkingParentIcon();
    icon.classList.add('qaap-working-agents-popover-row-icon');
    icon.classList.add(entry.depth > 0
        ? 'theia-mod-child-icon'
        : 'theia-mod-parent-icon');

    const title = document.createElement('span');
    title.className = 'qaap-working-agents-popover-row-title';
    title.textContent = formatWorkingAgentTaskTitle(entry.member);
    title.title = formatWorkingAgentAccessibleTitle(entry.member);

    const status = document.createElement('span');
    status.className = 'qaap-working-agents-popover-row-status';
    status.dataset.memberId = entry.member.id;
    applyWorkingAgentStatusLoader(status, entry.member);

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'qaap-working-agents-popover-row-main';
    main.append(icon, title, status);
    main.setAttribute('aria-label', nls.localize(
        'qaap/workHubChrome/workingAgentRowAria',
        '{0}, {1}',
        formatWorkingAgentAccessibleTitle(entry.member),
        resolveWorkingAgentStatusLabel(entry.member),
    ));
    main.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        onSelect(entry.member);
    });

    const progressTrack = renderWorkingAgentProgressTrack(entry.member);
    row.append(main);
    if (progressTrack) {
        row.append(progressTrack);
        row.classList.add('qaap-mod-has-progress');
    }
    row.append(createWorkingAgentsCloudBadge());
    if (onStop && isWorkingAgentStatusLive(entry.member)) {
        row.append(createWorkingAgentsRowStopButton(entry.member, onStop));
    }
    row.addEventListener('click', event => {
        if (event.defaultPrevented) {
            return;
        }
        const target = event.target;
        if (target instanceof Element && target.closest('button')) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        onSelect(entry.member);
    });
    return row;
}

/**
 * Renders a visual progress track (mini-timeline) for a working agent when
 * `progressCurrent` / `progressTotal` are available. Returns undefined when
 * no meaningful progress data is present (the row keeps its text-only status).
 *
 * The track is a horizontal bar split into `progressTotal` segments, with the
 * first `progressCurrent` segments filled. This gives the user a step-level
 * visual of how far along the agent's turn is — the same data the transcript
 * shows as "Step 3/7", now visible in the working agents popover.
 */
function renderWorkingAgentProgressTrack(member: WorkHubTeamMember): HTMLElement | undefined {
    const total = member.progressTotal ?? 0;
    const current = member.progressCurrent ?? 0;
    if (total <= 0 || current <= 0) {
        return undefined;
    }
    const clampedCurrent = Math.min(current, total);
    const track = document.createElement('div');
    track.className = 'qaap-working-agents-progress-track';
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-valuenow', String(clampedCurrent));
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', String(total));
    const label = nls.localize(
        'qaap/workHubChrome/workingAgentProgress',
        'Step {0} of {1}',
        clampedCurrent,
        total,
    );
    track.setAttribute('aria-label', label);
    track.title = label;

    // Cap segments at 20 for visual density (long turns with 50+ steps would
    // render individual segments too thin to see; the fill ratio stays accurate).
    const visualSegments = Math.min(total, 20);
    const filledSegments = Math.round((clampedCurrent / total) * visualSegments);
    for (let i = 0; i < visualSegments; i++) {
        const seg = document.createElement('span');
        seg.className = 'qaap-working-agents-progress-segment';
        if (i < filledSegments) {
            seg.classList.add('theia-mod-filled');
        }
        track.append(seg);
    }
    return track;
}

function formatWorkingAgentTaskTitle(member: WorkHubTeamMember): string {
    return member.title?.trim()
        || nls.localize('qaap/mobileProjects/untitledTask', 'Untitled task');
}

function formatWorkingAgentTitle(member: WorkHubTeamMember): string {
    return nls.localize(
        'qaap/workHubChrome/workingAgentAndTask',
        '{0} · {1}',
        resolveAgentDisplayLabel(member.agentId),
        formatWorkingAgentTaskTitle(member),
    );
}

function formatWorkingAgentAccessibleTitle(member: WorkHubTeamMember): string {
    const identity = member.taskId ?? member.conversationId ?? member.id;
    const shortIdentity = identity.length > 8 ? identity.slice(-6) : identity;
    return nls.localize(
        'qaap/workHubChrome/workingAgentTaskIdentity',
        '{0}, run {1}',
        formatWorkingAgentTitle(member),
        shortIdentity,
    );
}

/** True while the agent/subagent is actively working (status row acts as a live loader). */
export function isWorkingAgentStatusLive(member: WorkHubTeamMember): boolean {
    return member.state === 'streaming' || member.state === 'running';
}

/**
 * Live loader label: prefer concrete activity/process text; fall back to localized "Working".
 * VPS tasks expose `command` / command-like titles — never hide those behind a generic label.
 */
export function resolveWorkingAgentStatusLabel(member: WorkHubTeamMember): string {
    const activity = member.activityLabel?.trim();
    if (activity && !/^working\.?$/i.test(activity.replace(/[.…]+$/u, ''))) {
        return activity;
    }
    const command = resolveWorkingMemberCommand(member);
    if (command) {
        return command;
    }
    if (isWorkingAgentStatusLive(member)) {
        return nls.localize('qaap/mobileProjects/status/working', 'Working');
    }
    return member.state;
}

/** Apply status text + shimmer loader chrome for a working-agents expand row. */
export function applyWorkingAgentStatusLoader(status: HTMLElement, member: WorkHubTeamMember): void {
    const live = isWorkingAgentStatusLive(member);
    status.textContent = resolveWorkingAgentStatusLabel(member);
    status.classList.toggle('theia-mod-shimmer', live);
    status.classList.toggle('theia-mod-live', live);
    status.setAttribute('aria-live', live ? 'polite' : 'off');
}

function mountActivePanel(panel: HTMLElement): void {
    const active = activeWorkingAgentsExpand;
    if (!active) {
        return;
    }
    active.inner.replaceChildren(panel);
}

async function stopWorkingMemberFromExpand(target: WorkHubTeamMember): Promise<boolean> {
    const stopped = await resolveSessionOnStop()(target);
    if (stopped === false) {
        return false;
    }
    const current = activeWorkingAgentsExpand;
    if (!current) {
        return true;
    }
    current.members = current.members.filter(entry => entry.id !== target.id);
    if (current.members.length === 0) {
        closeWorkingAgentsPopover(true);
    } else {
        showWorkingAgentsListView();
    }
    return true;
}

function showWorkingAgentsListView(): void {
    const active = activeWorkingAgentsExpand;
    if (!active) {
        return;
    }
    const leavingDetail = !!(active.detailMemberId ?? workingExpandSession.detailMemberId);
    active.detailMemberId = undefined;
    workingExpandSession.detailMemberId = undefined;
    if (leavingDetail) {
        notifyDetailMemberChange(undefined);
    }
    const liveWorking = filterWorkingTeamMembers(active.members);
    const working = liveWorking.length > 0 ? liveWorking : active.members;
    const entries = flattenWorkingAgentsTree(working);
    const panel = renderWorkingAgentsPopoverPanel({
        entries,
        // Resolve live module state on click — remounts replace `activeWorkingAgentsExpand`.
        onClose: () => {
            const current = activeWorkingAgentsExpand;
            if (current) {
                current.onClose();
            } else {
                invokeSessionOnClose();
            }
        },
        onStopAll: () => {
            const current = activeWorkingAgentsExpand;
            const stop = resolveSessionOnStopAll();
            const targets = filterWorkingTeamMembers(current?.members ?? working);
            return stop(targets);
        },
        onStop: target => stopWorkingMemberFromExpand(target),
        onSelect: member => showWorkingAgentsDetailView(member.id),
    });
    mountActivePanel(panel);
    active.clip.setAttribute('aria-label', nls.localize(
        'qaap/workHubChrome/workingPill',
        '{0} Working',
        String(entries.length),
    ));
    active.shell.classList.remove('theia-mod-detail', 'theia-mod-detail-large');
    active.clip.classList.remove('theia-mod-detail-large-clip');
}

function showWorkingAgentsDetailView(memberId: string): void {
    const active = activeWorkingAgentsExpand;
    if (!active) {
        return;
    }
    // Include idle retained members so summary → settled does not bounce detail → list → close.
    const working = active.members.length > 0
        ? active.members
        : filterWorkingTeamMembers(active.members);
    const member = working.find(entry => entry.id === memberId);
    if (!member) {
        showWorkingAgentsListView();
        return;
    }
    active.detailMemberId = memberId;
    workingExpandSession.detailMemberId = memberId;
    const parent = member.parentId
        ? working.find(entry => entry.id === member.parentId)
        : undefined;
    const children = working.filter(entry => entry.parentId === member.id);
    const detailLarge = !!workingExpandSession.detailLarge;
    const activityFeed = resolveSessionDetailActivityFeed(member);
    const panel = renderWorkingAgentsDetailPanel({
        member,
        children,
        parent,
        detailLarge,
        activityFeed,
        onStop: async target => stopWorkingMemberFromExpand(target),
        onBack: () => showWorkingAgentsListView(),
        onClose: () => {
            const current = activeWorkingAgentsExpand;
            if (current) {
                current.onClose();
            } else {
                invokeSessionOnClose();
            }
        },
        onToggleLarge: () => {
            workingExpandSession.detailLarge = !workingExpandSession.detailLarge;
            const current = activeWorkingAgentsExpand;
            current?.shell.classList.toggle('theia-mod-detail-large', !!workingExpandSession.detailLarge);
            current?.clip.classList.toggle('theia-mod-detail-large-clip', !!workingExpandSession.detailLarge);
            showWorkingAgentsDetailView(memberId);
        },
        onSelectChild: child => showWorkingAgentsDetailView(child.id),
    });
    mountActivePanel(panel);
    active.clip.setAttribute('aria-label', member.title?.trim()
        || nls.localize('qaap/mobileProjects/untitledTask', 'Untitled task'));
    active.shell.classList.add('theia-mod-detail');
    active.shell.classList.toggle('theia-mod-detail-large', detailLarge);
    active.clip.classList.toggle('theia-mod-detail-large-clip', detailLarge);
    // Always re-bind so remounts (expand toggle) re-seed activity + command log into the new DOM.
    notifyDetailMemberChange(member);
}

function wireWorkingAgentsExpandDismiss(
    shell: HTMLElement,
    anchor: HTMLElement,
    onClose: () => void,
): () => void {
    const controller = new AbortController();
    const { signal } = controller;
    const onPointerDown = (event: PointerEvent): void => {
        // Remounts detach/reparent the shell; never treat that as an outside click.
        if (!shell.isConnected) {
            return;
        }
        const target = event.target;
        if (!(target instanceof Node)) {
            return;
        }
        if (shell.contains(target)) {
            return;
        }
        // Ignore events that originate from a parked Working control / park root.
        if (target instanceof Element && target.closest(`#${WORKING_CONTROL_PARK_ID}, .${WORKING_CONTROL_CLASS}`)) {
            return;
        }
        onClose();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape') {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (activeWorkingAgentsExpand?.detailMemberId) {
            showWorkingAgentsListView();
            return;
        }
        onClose();
        if (typeof anchor.focus === 'function') {
            anchor.focus();
        }
    };
    document.addEventListener('pointerdown', onPointerDown, { capture: true, signal });
    document.addEventListener('keydown', onKeyDown, { capture: true, signal });
    return () => controller.abort();
}

function tearDownWorkingAgentsExpand(immediate: boolean, clearSession = true): void {
    if (!activeWorkingAgentsExpand) {
        // Active may already be orphaned while the session flag remains — still clear it.
        if (clearSession) {
            clearWorkingExpandSession();
        }
        return;
    }
    const { shell, clip, cleanup, anchor } = activeWorkingAgentsExpand;
    activeWorkingAgentsExpand = undefined;
    cleanup();
    if (clearSession) {
        clearWorkingExpandSession();
    }
    if (anchor.isConnected) {
        markWorkingPillExpanded(anchor, false);
    }
    shell.classList.remove('theia-mod-expanded', 'theia-mod-detail', 'theia-mod-detail-large');
    clip.classList.remove('theia-mod-open', 'theia-mod-detail-large-clip');

    if (immediate) {
        clip.remove();
        return;
    }

    let finished = false;
    const finish = (): void => {
        if (finished) {
            return;
        }
        finished = true;
        clip.removeEventListener('transitionend', onEnd);
        clip.remove();
    };
    const onEnd = (event: TransitionEvent): void => {
        if (event.target !== clip) {
            return;
        }
        if (event.propertyName !== 'grid-template-rows' && event.propertyName !== 'opacity') {
            return;
        }
        finish();
    };
    clip.addEventListener('transitionend', onEnd);
    window.setTimeout(finish, 420);
}

export function closeWorkingAgentsPopover(immediate = false): void {
    tearDownWorkingAgentsExpand(immediate);
}

/**
 * Explicit Stop All dismiss: collapse expand, clear reading/idle retain snapshot, and
 * drop any parked Working control so chrome cannot resurrect a "1 Working" pill.
 */
export function dismissWorkingAgentsExpandForStopAll(): void {
    tearDownWorkingAgentsExpand(true, true);
    const park = document.getElementById(WORKING_CONTROL_PARK_ID);
    park?.querySelectorAll(`.${WORKING_CONTROL_CLASS}`).forEach(node => node.remove());
    // Hide pill until attention has cleared and a *new* working agent appears.
    // (Stale running count right after cancel must not re-show "1 Working".)
    workingPillSuppressedAfterStopAll = true;
    workingPillSawZeroAfterStopAll = false;
}

/** Cleared only after count hits 0 post-Stop All, then rises again (new work). */
let workingPillSuppressedAfterStopAll = false;
let workingPillSawZeroAfterStopAll = false;

export function isWorkingPillSuppressedAfterStopAll(): boolean {
    return workingPillSuppressedAfterStopAll;
}

export function noteWorkingPillChromeCount(realCount: number): void {
    if (!workingPillSuppressedAfterStopAll) {
        return;
    }
    if (realCount <= 0) {
        workingPillSawZeroAfterStopAll = true;
        return;
    }
    if (workingPillSawZeroAfterStopAll) {
        workingPillSuppressedAfterStopAll = false;
        workingPillSawZeroAfterStopAll = false;
    }
}

/** Test / remount helper — clears Stop All pill suppression without opening new work. */
export function clearWorkingPillStopAllSuppression(): void {
    workingPillSuppressedAfterStopAll = false;
    workingPillSawZeroAfterStopAll = false;
}

/**
 * Test helper — leave `workingExpandSession.open` without a live expand shell
 * (reproduces the ghost "1 Working" retain after orphaning).
 */
export function forceOrphanedWorkingExpandSessionForTests(): void {
    if (activeWorkingAgentsExpand) {
        activeWorkingAgentsExpand.cleanup();
        activeWorkingAgentsExpand = undefined;
    }
    workingExpandSession = { open: true, detailLarge: false };
}

export function isWorkingAgentsPopoverOpen(anchor?: HTMLElement): boolean {
    if (!activeWorkingAgentsExpand) {
        return false;
    }
    return !anchor || activeWorkingAgentsExpand.anchor === anchor;
}

export function getWorkingAgentsDetailMemberId(): string | undefined {
    return activeWorkingAgentsExpand?.detailMemberId ?? workingExpandSession.detailMemberId;
}

/** Member currently shown in the Working DETAIL panel (if any). */
export function getWorkingAgentsDetailMember(): WorkHubTeamMember | undefined {
    const detailId = getWorkingAgentsDetailMemberId();
    if (!detailId) {
        return undefined;
    }
    return activeWorkingAgentsExpand?.members.find(entry => entry.id === detailId);
}

/**
 * Re-resolve and patch only the DETAIL activity feed (no header/list remount).
 * Used when threadStore hydrates or streams segments after the panel opened.
 */
export function refreshWorkingAgentsDetailActivityFeed(): boolean {
    const active = activeWorkingAgentsExpand;
    const detailId = active?.detailMemberId ?? workingExpandSession.detailMemberId;
    if (!active?.shell.isConnected || !detailId) {
        return false;
    }
    const member = active.members.find(entry => entry.id === detailId);
    if (!member) {
        return false;
    }
    const body = active.inner.querySelector('.qaap-working-agents-detail-body');
    const existing = body?.querySelector('.qaap-working-agents-detail-activity');
    if (!(body instanceof HTMLElement)) {
        showWorkingAgentsDetailView(detailId);
        return true;
    }
    const feed = resolveSessionDetailActivityFeed(member) ?? {
        items: [],
        liveLabel: resolveWorkingAgentStatusLabel(member),
    };
    const next = renderWorkingAgentDetailActivityFeed(feed);
    if (existing instanceof HTMLElement) {
        existing.replaceWith(next);
    } else {
        // Prefer inserting before command log / subagents section when present.
        const before = body.querySelector(`.${WORKING_DETAIL_TASK_LOG_CLASS}, .qaap-working-agents-detail-section`);
        if (before) {
            body.insertBefore(next, before);
        } else {
            body.append(next);
        }
    }
    return true;
}

/**
 * Patch (or mount) the live VPS command-output card in Working DETAIL.
 * Keeps scroll stickiness when the user is near the bottom.
 */
export function refreshWorkingAgentsDetailCommandLog(options: {
    readonly taskId: string;
    readonly text: string;
    readonly truncated?: boolean;
    readonly running?: boolean;
    readonly loading?: boolean;
    readonly forceScrollToBottom?: boolean;
}): boolean {
    const active = activeWorkingAgentsExpand;
    const detailId = active?.detailMemberId ?? workingExpandSession.detailMemberId;
    if (!active?.shell.isConnected || !detailId) {
        return false;
    }
    const member = active.members.find(entry => entry.id === detailId);
    if (!member || !shouldShowWorkingDetailTaskLog(member) || member.taskId !== options.taskId) {
        return false;
    }
    const body = active.inner.querySelector('.qaap-working-agents-detail-body');
    if (!(body instanceof HTMLElement)) {
        return false;
    }
    // Structured OpenCode/QAIQ streams belong in the Cursor-style activity feed, not a raw
    // "Command output" card — keep the log card only for unstructured shell tails.
    if (workingDetailTaskLogHasTranscriptSegments(options.text)) {
        findWorkingDetailTaskLog(body)?.remove();
        refreshWorkingAgentsDetailActivityFeed();
        return true;
    }
    let log = findWorkingDetailTaskLog(body);
    if (!log) {
        log = renderWorkingDetailTaskLog({
            taskId: options.taskId,
            text: options.text,
            truncated: options.truncated,
            running: options.running,
            loading: options.loading,
        });
        const section = body.querySelector('.qaap-working-agents-detail-section');
        if (section) {
            body.insertBefore(log, section);
        } else {
            body.append(log);
        }
        if (options.forceScrollToBottom !== false) {
            const output = log.querySelector('.qaap-working-agents-detail-command-log-output');
            if (output instanceof HTMLElement) {
                output.scrollTop = output.scrollHeight;
            }
        }
        return true;
    }
    updateWorkingDetailTaskLog(log, {
        text: options.text,
        truncated: options.truncated,
        running: options.running,
        loading: options.loading,
        forceScrollToBottom: options.forceScrollToBottom,
    });
    return true;
}

function mountWorkingAgentsExpand(
    options: OpenWorkingAgentsPopoverOptions,
    working: WorkHubTeamMember[],
    restoreDetailMemberId: string | undefined,
): void {
    const entries = flattenWorkingAgentsTree(working);
    if (entries.length === 0) {
        return;
    }

    const shell = ensureWorkingControlShell(options.anchor);
    shell.querySelectorAll(`.${WORKING_EXPAND_CLIP_CLASS}`).forEach(node => node.remove());

    bindSessionHandlers(options);
    const onClose = (): void => {
        invokeSessionOnClose();
    };

    const clip = document.createElement('div');
    clip.className = WORKING_EXPAND_CLIP_CLASS;
    clip.setAttribute('role', 'dialog');
    clip.setAttribute('aria-label', nls.localize(
        'qaap/workHubChrome/workingPill',
        '{0} Working',
        String(entries.length),
    ));
    if (options.transcriptOverlay ?? workingExpandSession.transcriptOverlay) {
        clip.classList.add('theia-mod-transcript-overlay');
    }

    const inner = document.createElement('div');
    inner.className = 'qaap-working-agents-expand-inner';
    clip.append(inner);
    shell.append(clip);

    markWorkingPillExpanded(options.anchor, true);
    shell.classList.add('theia-mod-expanded');
    if (workingExpandSession.detailLarge && restoreDetailMemberId) {
        shell.classList.add('theia-mod-detail-large');
        clip.classList.add('theia-mod-detail-large-clip');
    }

    const cleanup = wireWorkingAgentsExpandDismiss(shell, options.anchor, onClose);
    activeWorkingAgentsExpand = {
        shell,
        clip,
        inner,
        cleanup,
        anchor: options.anchor,
        onSelect: options.onSelect,
        onStop: options.onStop,
        onStopAll: options.onStopAll,
        onClose,
        resolveDetailActivityFeed: options.resolveDetailActivityFeed
            ?? workingExpandSession.resolveDetailActivityFeed,
        onDetailMemberChange: options.onDetailMemberChange
            ?? workingExpandSession.onDetailMemberChange,
        members: [...working],
        detailMemberId: restoreDetailMemberId,
    };

    workingExpandSession.open = true;
    workingExpandSession.detailMemberId = restoreDetailMemberId;
    workingExpandSession.transcriptOverlay = options.transcriptOverlay ?? workingExpandSession.transcriptOverlay;

    if (restoreDetailMemberId) {
        showWorkingAgentsDetailView(restoreDetailMemberId);
    } else {
        showWorkingAgentsListView();
    }

    // Restores must paint open in the same turn (no flash/collapse before rAF).
    // First user open keeps the short expand animation via double rAF.
    if (restoreDetailMemberId || workingExpandSession.open) {
        clip.classList.add('theia-mod-open');
    } else {
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                if (activeWorkingAgentsExpand?.clip === clip) {
                    clip.classList.add('theia-mod-open');
                }
            });
        });
    }
}

/**
 * Reattach the Working expand panel after a DOM remount when session state is still open.
 * Returns true when the panel was restored or refreshed in place.
 */
export function restoreWorkingAgentsExpandIfNeeded(options: OpenWorkingAgentsPopoverOptions): boolean {
    ensureWorkingExpandOrphanedIfDisconnected();
    if (!workingExpandSession.open) {
        return false;
    }
    bindSessionHandlers(options);
    // Keep reading session even when agents go idle (summary/settled → count=0).
    const expandMembers = resolveExpandMembersForSession(options.members);
    if (expandMembers.length === 0) {
        // Nothing left to show, but do not auto-collapse — user dismisses explicitly.
        return !!activeWorkingAgentsExpand?.shell.isConnected;
    }

    // Prefer reclaiming the parked control (same DOM node / expand surface).
    const row = options.anchor.closest('.theia-mobile-sticky-composer-changes-pill-row')
        ?? options.anchor.parentElement;
    if (row instanceof HTMLElement) {
        const reclaimed = reclaimParkedWorkingControlIntoRow(row, {
            onOpen: anchor => openWorkingAgentsPopover({ ...options, anchor }),
        });
        if (reclaimed && activeWorkingAgentsExpand?.shell.isConnected) {
            activeWorkingAgentsExpand.onSelect = options.onSelect;
            activeWorkingAgentsExpand.onStop = options.onStop;
            activeWorkingAgentsExpand.onStopAll = options.onStopAll;
            activeWorkingAgentsExpand.onClose = (): void => {
                invokeSessionOnClose();
            };
            if (options.resolveDetailActivityFeed) {
                activeWorkingAgentsExpand.resolveDetailActivityFeed = options.resolveDetailActivityFeed;
            }
            if (options.onDetailMemberChange) {
                activeWorkingAgentsExpand.onDetailMemberChange = options.onDetailMemberChange;
            }
            activeWorkingAgentsExpand.members = [...expandMembers];
            workingExpandSession.transcriptOverlay = options.transcriptOverlay ?? workingExpandSession.transcriptOverlay;
            // Ensure the pill button used as restore target is the live one inside the shell.
            const livePill = activeWorkingAgentsExpand.shell.querySelector<HTMLButtonElement>(
                '.theia-mobile-sticky-composer-working-pill',
            );
            if (livePill && livePill !== options.anchor && options.anchor.parentElement) {
                // Drop the duplicate placeholder pill created by sync if present.
                if (options.anchor.parentElement === row && options.anchor !== livePill) {
                    options.anchor.remove();
                }
            }
            if (workingExpandSession.detailMemberId) {
                showWorkingAgentsDetailView(workingExpandSession.detailMemberId);
            } else {
                syncWorkingAgentsExpandContent(options.members);
            }
            return true;
        }
    }

    const active = activeWorkingAgentsExpand;
    if (active?.shell.isConnected && active.anchor.isConnected) {
        // Same open shell already in the tree (transfer path) — refresh handlers/content.
        if (active.shell.contains(options.anchor) || active.anchor === options.anchor) {
            active.onSelect = options.onSelect;
            active.onStop = options.onStop;
            active.onStopAll = options.onStopAll;
            active.onClose = (): void => {
                invokeSessionOnClose();
            };
            if (options.resolveDetailActivityFeed) {
                active.resolveDetailActivityFeed = options.resolveDetailActivityFeed;
            }
            if (options.onDetailMemberChange) {
                active.onDetailMemberChange = options.onDetailMemberChange;
            }
            active.members = [...expandMembers];
            workingExpandSession.transcriptOverlay = options.transcriptOverlay ?? workingExpandSession.transcriptOverlay;
            syncWorkingAgentsExpandContent(options.members);
            return true;
        }
    }

    const restoreDetailMemberId = workingExpandSession.detailMemberId
        && expandMembers.some(member => member.id === workingExpandSession.detailMemberId)
        ? workingExpandSession.detailMemberId
        : undefined;
    // Keep detail id even if the agent went idle — reader may still be on that panel.
    if (!restoreDetailMemberId && workingExpandSession.detailMemberId) {
        // detail id retained on session; mount will reopen detail via showWorkingAgentsDetailView
    }

    // Drop a duplicate placeholder pill before mounting a fresh expand on this anchor.
    mountWorkingAgentsExpand(options, expandMembers, workingExpandSession.detailMemberId);
    return true;
}

/**
 * Move the Working control shell into a remounted pill row without losing expand state.
 * Keeps active shell/clip refs valid when the control node is preserved.
 */
export function transferWorkingControlToHost(fromHost: HTMLElement, toHost: HTMLElement): void {
    const fromRow = fromHost.querySelector('.theia-mobile-sticky-composer-changes-pill-row');
    const control = fromRow?.querySelector(`:scope > .${WORKING_CONTROL_CLASS}`)
        ?? fromHost.querySelector(`.${WORKING_CONTROL_CLASS}`);
    if (!(control instanceof HTMLElement)) {
        return;
    }
    const toRow = toHost.querySelector('.theia-mobile-sticky-composer-changes-pill-row');
    if (!(toRow instanceof HTMLElement)) {
        return;
    }
    toRow.insertBefore(control, toRow.firstChild);
    if (activeWorkingAgentsExpand?.shell === control) {
        const pill = control.querySelector('.theia-mobile-sticky-composer-working-pill');
        if (pill instanceof HTMLElement) {
            activeWorkingAgentsExpand = {
                ...activeWorkingAgentsExpand,
                anchor: pill,
            };
        }
    }
}

/**
 * Expand (or collapse) the Working pill in place above the sticky composer.
 * Shared surface: the control shell grows into the agents panel (not a floating popover).
 * Row click opens an in-place detail view (does not collapse).
 */
export function openWorkingAgentsPopover(options: OpenWorkingAgentsPopoverOptions): void {
    ensureWorkingExpandOrphanedIfDisconnected();
    if (activeWorkingAgentsExpand?.anchor === options.anchor && options.anchor.isConnected) {
        closeWorkingAgentsPopover();
        options.onClose?.();
        return;
    }
    if (workingExpandSession.open) {
        if (restoreWorkingAgentsExpandIfNeeded(options)) {
            return;
        }
    }
    tearDownWorkingAgentsExpand(true, false);

    const working = filterWorkingTeamMembers(options.members);
    if (working.length === 0) {
        return;
    }

    bindSessionHandlers(options);
    workingExpandSession.open = true;
    workingExpandSession.detailMemberId = undefined;
    workingExpandSession.detailLarge = false;
    workingExpandSession.transcriptOverlay = options.transcriptOverlay;
    mountWorkingAgentsExpand(options, working, undefined);
}

/**
 * Refresh live loader statuses (and row/detail set) while the expand panel stays open.
 * Called from hub chrome sync so activityLabel updates stream into the panel.
 */
export function syncWorkingAgentsExpandContent(members: readonly WorkHubTeamMember[]): void {
    ensureWorkingExpandOrphanedIfDisconnected();
    const active = activeWorkingAgentsExpand;
    if (!active) {
        return;
    }
    const expandMembers = resolveExpandMembersForSession(members);
    if (expandMembers.length === 0) {
        // Summary/settled may clear the working set — keep the open panel for reading.
        return;
    }
    active.members = [...expandMembers];

    if (active.detailMemberId || workingExpandSession.detailMemberId) {
        const detailId = active.detailMemberId ?? workingExpandSession.detailMemberId!;
        const detailMember = expandMembers.find(member => member.id === detailId);
        if (!detailMember) {
            // Only leave detail when the pinned agent disappeared from the retained set.
            showWorkingAgentsListView();
            return;
        }
        // Patch in place — remounting DETAIL would reset command-log scroll and fight live tails.
        active.detailMemberId = detailId;
        workingExpandSession.detailMemberId = detailId;
        if (!refreshWorkingAgentsDetailActivityFeed()) {
            showWorkingAgentsDetailView(detailId);
            return;
        }
        const title = active.inner.querySelector('.qaap-working-agents-popover-title');
        if (title) {
            title.textContent = detailMember.title?.trim()
                || nls.localize('qaap/mobileProjects/untitledTask', 'Untitled task');
        }
        active.clip.setAttribute('aria-label', detailMember.title?.trim()
            || nls.localize('qaap/mobileProjects/untitledTask', 'Untitled task'));
        // Re-paint command log / activity subscriptions without destroying the card DOM.
        notifyDetailMemberChange(detailMember);
        return;
    }

    const entries = flattenWorkingAgentsTree(expandMembers);
    const panel = active.inner.querySelector('.qaap-working-agents-popover-panel:not(.qaap-working-agents-detail-panel)');
    const list = panel?.querySelector('.qaap-working-agents-popover-list');
    if (!(panel instanceof HTMLElement) || !(list instanceof HTMLElement)) {
        showWorkingAgentsListView();
        return;
    }

    const title = panel.querySelector('.qaap-working-agents-popover-title');
    if (title) {
        title.textContent = nls.localize(
            'qaap/workHubChrome/workingPill',
            '{0} Working',
            String(entries.length),
        );
    }
    active.clip.setAttribute('aria-label', nls.localize(
        'qaap/workHubChrome/workingPill',
        '{0} Working',
        String(entries.length),
    ));

    const rows = Array.from(list.querySelectorAll<HTMLElement>('.qaap-working-agents-popover-row'));
    const sameShape = rows.length === entries.length
        && rows.every((row, index) => row.dataset.memberId === entries[index]?.member.id);
    if (sameShape) {
        for (let i = 0; i < entries.length; i++) {
            const status = rows[i].querySelector<HTMLElement>('.qaap-working-agents-popover-row-status');
            if (status) {
                applyWorkingAgentStatusLoader(status, entries[i].member);
            }
            const titleEl = rows[i].querySelector('.qaap-working-agents-popover-row-title');
            if (titleEl) {
                titleEl.textContent = entries[i].member.title?.trim()
                    || nls.localize('qaap/mobileProjects/untitledTask', 'Untitled task');
            }
        }
        return;
    }

    showWorkingAgentsListView();
}

export function countWorkingAgentsInPopover(members: readonly WorkHubTeamMember[]): number {
    return countRunningTeamMembers(filterWorkingTeamMembers(members));
}
