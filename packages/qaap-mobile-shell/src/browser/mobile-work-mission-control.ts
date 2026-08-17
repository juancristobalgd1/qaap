// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import type { QaapAgentFailureKind } from '../common/qaap-agent-failure-message';
import { isFailedRunSummary, type QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import {
    buildMissionControlRowFingerprint,
    buildMissionControlStructureFingerprint,
    QAAP_MC_ROW_FP_ATTR,
    QAAP_MC_ROW_KEY_ATTR,
    QAAP_MC_STRUCTURE_FP_ATTR,
} from '../common/qaap-work-mission-control-fingerprint';

/**
 * Prototype "mission control" for the Work Hub landing — a single cross-project view of agent work
 * grouped by what the human should do next, instead of splitting the same conversation object across
 * the Chat / Tasks / Review tabs. It reuses the live cross-project streams already maintained by
 * {@link MobileProjectsConversations} and {@link MobileProjectsActiveTasks}; it adds no new data
 * source.
 */
export type MissionControlLane = 'needs-you' | 'running' | 'done';

/**
 * The surface an item came from — recovers the legacy Chat / Tasks / Review tabs as a secondary
 * filter axis instead of three separate destinations. `pr` wins over `chat`/`task` so the "PRs"
 * filter surfaces work that reached the reviewable GitHub handoff.
 */
export type MissionControlSurface = 'chat' | 'task' | 'pr';

export type MissionControlLaneFilter = 'all' | MissionControlLane;
export type MissionControlSurfaceFilter = 'all' | MissionControlSurface;

export interface MissionControlItem {
    /** Stable DOM key (projectId + conversation id). */
    readonly key: string;
    readonly conversationId: string;
    readonly projectId: string;
    readonly projectName: string;
    readonly projectColor: string;
    readonly title: string;
    readonly preview?: string;
    readonly lane: MissionControlLane;
    readonly surface: MissionControlSurface;
    readonly agentLabel?: string;
    readonly updatedAt: number;
    readonly progressCurrent?: number;
    readonly progressTotal?: number;
    readonly linesAdded?: number;
    readonly linesRemoved?: number;
    readonly hasPullRequest: boolean;
    /** Classified agent/API failure when the conversation last turn failed. */
    readonly failureKind?: QaapAgentFailureKind;
}

/** Single-axis classification used by the "Chats / Tasks / PRs" filter. */
export function classifyMissionControlSurface(
    summary: { source?: 'qaap-agent' | 'theia-chat'; linkedPullRequest?: { number?: number } },
): MissionControlSurface {
    if (summary.linkedPullRequest?.number) {
        return 'pr';
    }
    return summary.source === 'theia-chat' ? 'chat' : 'task';
}

/** Applies the lane + surface filters. Pure — drives both the list and the tab counts. */
export function filterMissionControlItems(
    items: readonly MissionControlItem[],
    lane: MissionControlLaneFilter,
    surface: MissionControlSurfaceFilter,
): MissionControlItem[] {
    return items.filter(item =>
        (lane === 'all' || item.lane === lane)
        && (surface === 'all' || item.surface === surface));
}

/**
 * The single rule that unifies the three legacy status vocabularies (running/pending,
 * working/review/idle, streaming/idle/failed) into one human-centric lane.
 *
 * - `running`   — a turn is currently streaming on the VPS.
 * - `needs-you` — the agent stopped and the ball is in the human's court: it failed, the user
 *   flagged it priority, or it finished a turn that has not been read yet.
 * - `done`      — idle and already reviewed; kept for context, sorts last.
 *
 * `unread` is supplied by the caller because the read/seen ledger lives in the panel
 * (`MobileProjectsConversationFlags`), not on the summary DTO.
 */
export function classifyMissionControlLane(
    summary: QaapAgentConversationSummaryDTO,
    unread: boolean,
): MissionControlLane {
    if (summary.status === 'streaming') {
        return 'running';
    }
    if (isFailedRunSummary(summary)) {
        return 'needs-you';
    }
    if (summary.priority) {
        return 'needs-you';
    }
    if (!summary.paused && unread && summary.lastMessageRole === 'agent' && summary.messageCount > 0) {
        return 'needs-you';
    }
    return 'done';
}

/** Lane render order and per-lane caps so the landing preview stays scannable. */
const LANE_ORDER: readonly MissionControlLane[] = ['needs-you', 'running', 'done'];
const LANE_CAP: Record<MissionControlLane, number> = {
    'needs-you': 6,
    'running': 6,
    'done': 4,
};

interface LaneSpec {
    readonly titleKey: string;
    readonly title: string;
    readonly dotClass: string;
    readonly icon: string;
}

const LANE_SPECS: Record<MissionControlLane, LaneSpec> = {
    'needs-you': {
        titleKey: 'qaap/workMissionControl/laneNeedsYou',
        title: 'Needs you',
        dotClass: 'q-danger',
        icon: 'codicon-bell-dot',
    },
    'running': {
        titleKey: 'qaap/workMissionControl/laneRunning',
        title: 'Running',
        dotClass: 'q-success',
        icon: 'codicon-sync',
    },
    'done': {
        titleKey: 'qaap/workMissionControl/laneDone',
        title: 'Recently done',
        dotClass: 'q-muted',
        icon: 'codicon-check',
    },
};

export interface MobileWorkMissionControlDeps {
    formatRelativeTime(updatedAt: number): string;
    onOpenItem(item: MissionControlItem): void;
    onShowAll(): void;
    onLaneFilter?(lane: MissionControlLaneFilter): void;
    onSurfaceFilter?(surface: MissionControlSurfaceFilter): void;
}

export interface MissionControlRenderOptions {
    /** Render the lane/surface filter bars (full "Work" view) vs. the capped home preview card. */
    readonly showFilters?: boolean;
    readonly laneFilter?: MissionControlLaneFilter;
    readonly surfaceFilter?: MissionControlSurfaceFilter;
    /** Full-screen mission control on the home hub (shows collapse instead of view-all). */
    readonly expanded?: boolean;
    readonly onCollapse?: () => void;
    readonly query?: string;
}

const LANE_FILTER_ORDER: readonly MissionControlLaneFilter[] = ['all', 'needs-you', 'running', 'done'];
const SURFACE_FILTER_ORDER: readonly MissionControlSurfaceFilter[] = ['all', 'chat', 'task', 'pr'];

const LANE_FILTER_LABEL: Record<MissionControlLaneFilter, { key: string; label: string }> = {
    'all': { key: 'qaap/workMissionControl/filterAll', label: 'All' },
    'needs-you': { key: 'qaap/workMissionControl/laneNeedsYou', label: 'Needs you' },
    'running': { key: 'qaap/workMissionControl/laneRunning', label: 'Running' },
    'done': { key: 'qaap/workMissionControl/laneDone', label: 'Done' },
};

const SURFACE_FILTER_LABEL: Record<MissionControlSurfaceFilter, { key: string; label: string }> = {
    'all': { key: 'qaap/workMissionControl/surfaceAll', label: 'All' },
    'chat': { key: 'qaap/workMissionControl/surfaceChat', label: 'Chats' },
    'task': { key: 'qaap/workMissionControl/surfaceTask', label: 'Tasks' },
    'pr': { key: 'qaap/workMissionControl/surfacePr', label: 'PRs' },
};

export class MobileWorkMissionControl {

    constructor(protected readonly deps: MobileWorkMissionControlDeps) { }

    /** Renders the mission-control card into {@link host}. No-op visual when there is no work. */
    render(host: HTMLElement, items: readonly MissionControlItem[], options: MissionControlRenderOptions = {}): void {
        const showFilters = options.showFilters === true;
        const laneFilter = options.laneFilter ?? 'all';
        const surfaceFilter = options.surfaceFilter ?? 'all';

        const panel = document.createElement('section');
        panel.className = 'theia-mobile-work-hub-home-panel q-card theia-mobile-mission-control';

        const needsYou = items.filter(item => item.lane === 'needs-you').length;
        panel.append(this.createHeader(needsYou, items.length, options));

        if (showFilters) {
            panel.append(this.createFilters(items, laneFilter, surfaceFilter));
        }

        if (items.length === 0) {
            panel.append(this.createEmpty(nls.localize(
                'qaap/workMissionControl/empty',
                'No agent work in flight. Capture a task, delegate it, then track it here until PR.',
            )));
            panel.setAttribute(
                QAAP_MC_STRUCTURE_FP_ATTR,
                this.buildStructureFingerprint(items, options, !options.expanded),
            );
            host.append(panel);
            return;
        }

        const visible = showFilters ? filterMissionControlItems(items, laneFilter, surfaceFilter) : items;
        if (visible.length === 0) {
            panel.append(this.createEmpty(nls.localize(
                'qaap/workMissionControl/emptyFilter',
                'Nothing matches this filter.',
            )));
            panel.setAttribute(
                QAAP_MC_STRUCTURE_FP_ATTR,
                this.buildStructureFingerprint(items, options, !options.expanded),
            );
            host.append(panel);
            return;
        }

        const byLane = this.groupByLane(visible, !showFilters);
        for (const lane of LANE_ORDER) {
            const laneItems = byLane.get(lane);
            if (!laneItems || laneItems.length === 0) {
                continue;
            }
            panel.append(this.createLane(lane, laneItems));
        }
        panel.setAttribute(
            QAAP_MC_STRUCTURE_FP_ATTR,
            this.buildStructureFingerprint(items, options, !options.expanded),
        );
        host.append(panel);
    }

    /**
     * In-place row updates when structure is unchanged — used by hub incremental patching on SSE ticks.
     */
    patchRows(
        panel: HTMLElement,
        items: readonly MissionControlItem[],
        options: MissionControlRenderOptions = {},
    ): boolean {
        const showOverview = !options.expanded;
        const structure = this.buildStructureFingerprint(items, options, showOverview);
        if (panel.getAttribute(QAAP_MC_STRUCTURE_FP_ATTR) !== structure) {
            return false;
        }
        const showFilters = options.showFilters === true;
        const laneFilter = options.laneFilter ?? 'all';
        const surfaceFilter = options.surfaceFilter ?? 'all';
        if (items.length === 0) {
            return true;
        }
        const visible = showFilters ? filterMissionControlItems(items, laneFilter, surfaceFilter) : items;
        if (visible.length === 0) {
            return true;
        }
        const needsYou = items.filter(item => item.lane === 'needs-you').length;
        const badge = panel.querySelector('.theia-mobile-mission-control-badge');
        if (badge) {
            badge.textContent = String(needsYou);
        } else if (needsYou > 0) {
            return false;
        }
        const byLane = this.groupByLane(visible, !showFilters);
        for (const lane of LANE_ORDER) {
            const laneItems = byLane.get(lane) ?? [];
            for (const item of laneItems) {
                const nextFingerprint = buildMissionControlRowFingerprint(item);
                const existing = panel.querySelector<HTMLElement>(
                    `.theia-mobile-mission-control-row[${QAAP_MC_ROW_KEY_ATTR}="${cssEscape(item.key)}"]`,
                );
                if (!existing) {
                    return false;
                }
                if (existing.getAttribute(QAAP_MC_ROW_FP_ATTR) === nextFingerprint) {
                    continue;
                }
                existing.replaceWith(this.createRow(item));
            }
            const laneCount = panel.querySelector(
                `.theia-mobile-mission-control-lane.theia-mod-${lane} .theia-mobile-mission-control-lane-count`,
            );
            if (laneCount && laneItems.length > 0) {
                laneCount.textContent = String(laneItems.length);
            }
        }
        return true;
    }

    protected buildStructureFingerprint(
        items: readonly MissionControlItem[],
        options: MissionControlRenderOptions,
        showOverview: boolean,
    ): string {
        const showFilters = options.showFilters === true;
        const laneFilter = options.laneFilter ?? 'all';
        const surfaceFilter = options.surfaceFilter ?? 'all';
        const visible = showFilters
            ? filterMissionControlItems(items, laneFilter, surfaceFilter)
            : items;
        const byLane = this.groupByLane(visible, !showFilters);
        const rowKeys: string[] = [];
        for (const lane of LANE_ORDER) {
            const laneItems = byLane.get(lane) ?? [];
            for (const item of laneItems) {
                rowKeys.push(item.key);
            }
        }
        return buildMissionControlStructureFingerprint({
            expanded: options.expanded === true,
            laneFilter,
            surfaceFilter,
            query: options.query ?? '',
            showOverview,
            rowKeys,
        });
    }

    protected resolveHeaderAction(
        needsYou: number,
        total: number,
        options: MissionControlRenderOptions,
    ): HTMLElement | undefined {
        if (options.expanded) {
            if (!options.onCollapse) {
                return undefined;
            }
            const link = document.createElement('button');
            link.type = 'button';
            link.className = 'theia-mobile-work-hub-home-section-action';
            link.textContent = nls.localize('qaap/workMissionControl/showLess', 'Show less');
            link.addEventListener('click', () => options.onCollapse?.());
            return link;
        }
        if (total <= 0) {
            return undefined;
        }
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'theia-mobile-work-hub-home-section-action';
        link.textContent = nls.localize('qaap/workMissionControl/viewAll', 'View all');
        link.addEventListener('click', () => this.deps.onShowAll());
        return link;
    }

    protected createEmpty(text: string): HTMLElement {
        const empty = document.createElement('p');
        empty.className = 'theia-mobile-mission-control-empty q-fs-meta';
        empty.textContent = text;
        return empty;
    }

    /** Cap lanes only in the home preview; the full Work view shows everything. */
    protected groupByLane(items: readonly MissionControlItem[], cap: boolean): Map<MissionControlLane, MissionControlItem[]> {
        const byLane = new Map<MissionControlLane, MissionControlItem[]>();
        for (const item of items) {
            const list = byLane.get(item.lane) ?? [];
            list.push(item);
            byLane.set(item.lane, list);
        }
        for (const [lane, list] of byLane) {
            list.sort((a, b) => b.updatedAt - a.updatedAt);
            byLane.set(lane, cap ? list.slice(0, LANE_CAP[lane]) : list);
        }
        return byLane;
    }

    protected createFilters(
        items: readonly MissionControlItem[],
        laneFilter: MissionControlLaneFilter,
        surfaceFilter: MissionControlSurfaceFilter,
    ): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'theia-mobile-mission-control-filters';

        // Lane counts reflect the current surface; surface counts reflect the current lane.
        const laneScope = filterMissionControlItems(items, 'all', surfaceFilter);
        const surfaceScope = filterMissionControlItems(items, laneFilter, 'all');

        wrap.append(this.createFilterRow(
            'lane',
            LANE_FILTER_ORDER,
            laneFilter,
            id => LANE_FILTER_LABEL[id],
            id => id === 'all' ? laneScope.length : laneScope.filter(item => item.lane === id).length,
            id => this.deps.onLaneFilter?.(id),
        ));
        wrap.append(this.createFilterRow(
            'surface',
            SURFACE_FILTER_ORDER,
            surfaceFilter,
            id => SURFACE_FILTER_LABEL[id],
            id => id === 'all' ? surfaceScope.length : surfaceScope.filter(item => item.surface === id).length,
            id => this.deps.onSurfaceFilter?.(id),
        ));
        return wrap;
    }

    protected createFilterRow<T extends string>(
        axis: 'lane' | 'surface',
        order: readonly T[],
        active: T,
        labelOf: (id: T) => { key: string; label: string },
        countOf: (id: T) => number,
        onSelect: (id: T) => void,
    ): HTMLElement {
        const row = document.createElement('div');
        row.className = `theia-mobile-projects-filters theia-mobile-mission-control-filter-row theia-mod-${axis}`;
        row.setAttribute('role', 'tablist');
        for (const id of order) {
            const spec = labelOf(id);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'theia-mobile-projects-filter-tab';
            btn.setAttribute('role', 'tab');
            const isActive = active === id;
            btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
            if (isActive) {
                btn.classList.add('theia-mod-active');
            }
            const label = document.createElement('span');
            label.className = 'theia-mobile-projects-filter-tab-label';
            label.textContent = nls.localize(spec.key, spec.label);
            const count = document.createElement('span');
            count.className = 'theia-mobile-projects-filter-tab-count';
            count.textContent = String(countOf(id));
            btn.append(label, count);
            btn.addEventListener('click', () => onSelect(id));
            row.append(btn);
        }
        return row;
    }

    protected createHeader(
        needsYou: number,
        total: number,
        options: MissionControlRenderOptions = {},
    ): HTMLElement {
        const head = document.createElement('div');
        head.className = 'theia-mobile-work-hub-home-section-head theia-mobile-mission-control-head';

        const title = document.createElement('span');
        title.className = 'theia-mobile-work-hub-home-section-title q-overline';
        title.textContent = nls.localize('qaap/workMissionControl/title', 'Agent work to PR');
        head.append(title);

        if (needsYou > 0) {
            const badge = document.createElement('span');
            badge.className = 'theia-mobile-mission-control-badge q-dot q-danger';
            badge.textContent = String(needsYou);
            badge.title = nls.localize(
                'qaap/workMissionControl/needsYouTitle',
                '{0} need your attention',
                String(needsYou),
            );
            head.append(badge);
        }

        const action = this.resolveHeaderAction(needsYou, total, options);
        if (action) {
            head.append(action);
        }
        return head;
    }

    protected createLane(lane: MissionControlLane, items: readonly MissionControlItem[]): HTMLElement {
        const section = document.createElement('div');
        section.className = `theia-mobile-mission-control-lane theia-mod-${lane}`;

        const spec = LANE_SPECS[lane];
        const laneHead = document.createElement('div');
        laneHead.className = 'theia-mobile-mission-control-lane-head';
        const dot = document.createElement('span');
        dot.className = `theia-mobile-mission-control-lane-dot q-dot ${spec.dotClass}`;
        dot.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.className = 'theia-mobile-mission-control-lane-label q-overline';
        label.textContent = nls.localize(spec.titleKey, spec.title);
        const count = document.createElement('span');
        count.className = 'theia-mobile-mission-control-lane-count';
        count.textContent = String(items.length);
        laneHead.append(dot, label, count);
        section.append(laneHead);

        const rows = document.createElement('div');
        rows.className = 'theia-mobile-work-hub-home-rows';
        for (const item of items) {
            rows.append(this.createRow(item));
        }
        section.append(rows);
        return section;
    }

    protected createRow(item: MissionControlItem): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `theia-mobile-work-hub-home-row theia-mobile-mission-control-row theia-mod-${item.lane}`;
        btn.setAttribute(QAAP_MC_ROW_KEY_ATTR, item.key);
        btn.setAttribute(QAAP_MC_ROW_FP_ATTR, buildMissionControlRowFingerprint(item));
        if (item.failureKind) {
            btn.classList.add(`theia-mod-failure-${item.failureKind}`);
        }
        btn.style.setProperty('--qaap-mobile-project-accent', item.projectColor);
        btn.addEventListener('click', () => this.deps.onOpenItem(item));

        const avatar = document.createElement('span');
        avatar.className = 'theia-mobile-work-hub-home-row-avatar';
        avatar.textContent = projectInitials(item.projectName);

        const body = document.createElement('span');
        body.className = 'theia-mobile-work-hub-home-row-body';

        const titleRow = document.createElement('span');
        titleRow.className = 'theia-mobile-work-hub-home-row-title-row';
        const title = document.createElement('span');
        title.className = 'theia-mobile-work-hub-home-row-title';
        title.textContent = item.title;
        titleRow.append(title);
        if (item.lane === 'running') {
            titleRow.append(this.createProgressChip(item));
        } else if (item.failureKind) {
            titleRow.append(this.createFailureChip(item.failureKind));
        }

        const meta = document.createElement('span');
        meta.className = 'theia-mobile-work-hub-home-row-meta';
        meta.textContent = this.buildMeta(item);

        body.append(titleRow, meta);

        if (item.preview) {
            const preview = document.createElement('span');
            preview.className = 'theia-mobile-work-hub-home-row-meta theia-mod-secondary theia-mobile-mission-control-preview';
            preview.textContent = item.preview;
            body.append(preview);
        }

        btn.append(avatar, body, this.createChevron());
        return btn;
    }

    protected buildMeta(item: MissionControlItem): string {
        const parts: string[] = [item.projectName];
        if (item.agentLabel) {
            parts.push(item.agentLabel);
        }
        parts.push(this.deps.formatRelativeTime(item.updatedAt));
        if (item.hasPullRequest) {
            parts.push(nls.localize('qaap/workMissionControl/hasPr', 'PR'));
        }
        const diff = this.buildDiffLabel(item);
        if (diff) {
            parts.push(diff);
        }
        return parts.join(' · ');
    }

    protected buildDiffLabel(item: MissionControlItem): string | undefined {
        const added = item.linesAdded ?? 0;
        const removed = item.linesRemoved ?? 0;
        if (added === 0 && removed === 0) {
            return undefined;
        }
        return `+${added} −${removed}`;
    }

    protected createProgressChip(item: MissionControlItem): HTMLElement {
        const chip = document.createElement('span');
        chip.className = 'theia-mobile-mission-control-progress';
        if (item.progressTotal && item.progressTotal > 0) {
            chip.textContent = nls.localize(
                'qaap/workMissionControl/progress',
                'step {0}/{1}',
                String(item.progressCurrent ?? 0),
                String(item.progressTotal),
            );
        } else {
            chip.textContent = nls.localize('qaap/workMissionControl/working', 'working…');
        }
        return chip;
    }

    protected createFailureChip(kind: QaapAgentFailureKind): HTMLElement {
        const chip = document.createElement('span');
        chip.className = `theia-mobile-mission-control-failure-chip theia-mod-${kind}`;
        switch (kind) {
            case 'quota':
                chip.textContent = nls.localize('qaap/workMissionControl/quotaChip', 'Credits');
                break;
            case 'rate_limit':
                chip.textContent = nls.localize('qaap/workMissionControl/rateLimitChip', 'Rate limit');
                break;
            case 'model_unavailable':
                chip.textContent = nls.localize('qaap/workMissionControl/modelChip', 'Model');
                break;
            case 'auth':
                chip.textContent = nls.localize('qaap/workMissionControl/authChip', 'Auth');
                break;
            case 'cli_missing':
                chip.textContent = nls.localize('qaap/workMissionControl/cliMissingChip', 'CLI missing');
                break;
            default:
                chip.textContent = nls.localize('qaap/workMissionControl/failedChip', 'Failed');
        }
        return chip;
    }

    protected createChevron(): HTMLElement {
        const chevron = document.createElement('span');
        chevron.className = 'theia-mobile-work-hub-home-row-chevron codicon codicon-chevron-right';
        chevron.setAttribute('aria-hidden', 'true');
        return chevron;
    }
}

function projectInitials(name: string): string {
    const parts = name.split(/[-_.\s]+/).filter(Boolean);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
}

function cssEscape(value: string): string {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
        return CSS.escape(value);
    }
    return value.replace(/["\\]/g, '\\$&');
}
