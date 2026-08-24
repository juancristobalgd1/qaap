// @ts-nocheck
// Extracted from mobile-projects-project-rows-ui.ts

import { nls } from '@theia/core/lib/common/nls';
import { conversationTurnProgressRatio } from '../common/qaap-agent-conversation-list-metrics';
import {
    isConversationAutoApproveEnabled,
    type QaapAgentConversationSummaryDTO,
} from '../common/qaap-agent-conversation-client';
import { resolveQaapAgentTaskVisualStatus, type QaapAgentTaskVisualStatus } from '../common/qaap-agent-task-visual-status';
import { buildWorkHubInboxRowFingerprintFromSummary } from '../common/qaap-work-hub-inbox-fingerprint';
import {
    QAAP_INBOX_ROW_FP_ATTR,
    QAAP_INBOX_ROW_ID_ATTR,
} from './mobile-projects-hub-incremental-ui';
import { SHELL_AGENT_ID } from '../common/qaap-agent-task-client';
import { formatConversationComposerSessionMeta } from '../common/qaap-conversation-composer-state';
import { readStoredComposerSurface, type QaapComposerSurface } from '../common/qaap-composer-surface';
import { createAgentTaskBadge, createAgentTaskVerificationBadge } from './qaap-agent-ui';
import { sharedSecondTicker } from './qaap-shared-elapsed-ticker';
import type { MobileProjectsActiveTasks, MobileProjectTaskView } from './mobile-projects-active-tasks';
import type { MobileProjectsService } from './mobile-projects-service';
import { mobileProjectInitials, type MobileProjectEntry, type MobileProjectsHubView } from './mobile-projects-types';
import { attachSwipeToDelete } from './qaap-mobile-swipe-to-delete';

export function createTaskLeadingGlyphExtracted(ctx: any, codiconClass: string): HTMLElement {
        const glyph = document.createElement('span');
        glyph.className = `theia-mobile-projects-task-leading-glyph codicon ${codiconClass}`;
        glyph.setAttribute('aria-hidden', 'true');
        return glyph;
}

export function createSidebarStatusChipExtracted(ctx: any, visualStatus: QaapAgentTaskVisualStatus): HTMLElement {
        const chip = document.createElement('span');
        chip.className = `theia-mobile-projects-task-status-chip theia-mod-${visualStatus.id}`;
        chip.textContent = nls.localize(visualStatus.labelKey, visualStatus.label);
        chip.setAttribute('aria-label', chip.textContent);
        chip.title = chip.textContent;
        return chip;
}

export function createRowExtracted(ctx: any, project: MobileProjectEntry): HTMLElement {
        const card = document.createElement('div');
        card.className = 'theia-mobile-projects-card';
        card.dataset.qaapProjectId = project.id;
        card.style.setProperty('--qaap-mobile-project-accent', project.color);
        if (project.isCurrent) {
            card.classList.add('theia-mod-current');
        }
        const isExpanded = !ctx.host.homeMode && ctx.host.expandedId === project.id;
        if (isExpanded) {
            card.classList.add('theia-mod-expanded');
        }

        const running = ctx.host.conversationIndexUi.countRunningTasks(project) > 0;
        const needsInput = ctx.host.conversationIndexUi.countNeedsInputTasks(project) > 0;
        const failed = ctx.host.conversationIndexUi.countFailedTasks(project) > 0;
        const unreadCount = ctx.host.conversationIndexUi.countUnreadTasks(project);
        const doneCount = ctx.host.conversationIndexUi.countDoneTasks(project);
        const activeInfo = ctx.host.conversationIndexUi.activeInfoForProject(project);

        // Collapsed header (always visible) — clicking toggles the expansion.
        const header = document.createElement('div');
        header.className = 'theia-mobile-projects-row-head';
        header.setAttribute('role', 'button');
        header.setAttribute('tabindex', '0');
        header.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');

        // Status glyph follows a priority ladder so the most actionable state wins:
        //   needs-input > failed > running > unread > current workspace > done > idle
        // The colored dot + animation pair signals intent at a glance from the project list.
        const glyph = document.createElement('span');
        glyph.className = 'theia-mobile-projects-row-glyph';
        if (project.isCurrent) {
            glyph.classList.add('theia-mod-workspace');
        }
        if (needsInput) {
            glyph.classList.add('theia-mod-needs-input');
            glyph.title = nls.localize('qaap/mobileProjects/glyphNeedsInput', 'Waiting for your input');
        } else if (failed) {
            glyph.classList.add('theia-mod-failed');
            glyph.title = nls.localize('qaap/mobileProjects/glyphFailed', 'A task failed — review and retry');
        } else if (running) {
            glyph.classList.add('theia-mod-running');
            glyph.title = nls.localize('qaap/mobileProjects/glyphRunning', 'Agent is active');
        } else if (unreadCount > 0) {
            glyph.classList.add('theia-mod-unread');
            glyph.title = unreadCount === 1
                ? nls.localize('qaap/mobileProjects/glyphUnreadOne', 'New agent reply since you last opened this project')
                : nls.localize('qaap/mobileProjects/glyphUnreadMany', '{0} tasks with new agent replies', String(unreadCount));
        } else if (doneCount > 0) {
            glyph.classList.add('theia-mod-done');
        }

        const leading = ctx.host.homeMode ? ctx.createHomeRowAvatar(project) : glyph;
        if (ctx.host.homeMode) {
            for (const cls of glyph.classList) {
                if (cls !== 'theia-mobile-projects-row-glyph') {
                    leading.classList.add(cls);
                }
            }
            if (glyph.title) {
                leading.title = glyph.title;
            }
        }
        header.append(leading);

        const main = document.createElement('div');
        main.className = 'theia-mobile-projects-row-main';

        const nameRow = document.createElement('div');
        nameRow.className = 'theia-mobile-projects-row-name-row';
        const chevron = document.createElement('span');
        chevron.className = 'theia-mobile-projects-row-chevron';
        chevron.textContent = '›';
        chevron.setAttribute('aria-hidden', 'true');
        nameRow.append(chevron);
        const nameGroup = document.createElement('span');
        nameGroup.className = 'theia-mobile-projects-row-name-group';
        const name = document.createElement('span');
        name.className = 'theia-mobile-projects-row-name';
        name.textContent = project.name;
        nameGroup.append(name);
        if (project.pinned) {
            const pin = document.createElement('span');
            pin.className = 'codicon codicon-pin theia-mobile-projects-row-pin';
            pin.setAttribute('aria-hidden', 'true');
            nameGroup.append(pin);
        }
        nameRow.append(nameGroup);
        if (ctx.host.homeMode) {
            const homeStatus = ctx.createHomeRowStatus(project, {
                unreadCount,
                running,
                runningCount: ctx.host.conversationIndexUi.countRunningTasks(project),
                needsInput,
                failed,
                failedCount: ctx.host.conversationIndexUi.countFailedTasks(project),
                needsInputCount: ctx.host.conversationIndexUi.countNeedsInputTasks(project),
            });
            if (isExpanded && homeStatus) {
                homeStatus.classList.add('theia-mobile-projects-row-status-inline');
                nameRow.append(homeStatus);
            }
            const open = ctx.createWorkspaceOpenControl(project);
            open.classList.add('theia-mobile-projects-row-name-open');
            nameRow.append(open);
            main.append(nameRow);
            if (homeStatus && !isExpanded) {
                const subRow = document.createElement('div');
                subRow.className = 'theia-mobile-projects-row-sub';
                homeStatus.classList.add('theia-mobile-projects-row-status-inline');
                subRow.append(homeStatus);
                main.append(subRow);
            }
        } else {
            main.append(nameRow);
        }

        const metaRow = document.createElement('div');
        metaRow.className = 'theia-mobile-projects-row-meta';
        const branchSpan = document.createElement('span');
        branchSpan.textContent = project.branch;
        metaRow.append(branchSpan);
        if (project.lastActive && project.lastActive !== '—') {
            const sep = document.createElement('span');
            sep.className = 'theia-mobile-projects-row-meta-sep';
            sep.textContent = '·';
            const time = document.createElement('span');
            time.textContent = project.lastActive;
            metaRow.append(sep, time);
        }
        if (running) {
            const sep = document.createElement('span');
            sep.className = 'theia-mobile-projects-row-meta-sep';
            sep.textContent = '·';
            const run = document.createElement('span');
            run.className = 'theia-mobile-projects-row-meta-running';
            const runningCount = ctx.host.conversationIndexUi.countRunningTasks(project);
            run.textContent = runningCount === 1
                ? nls.localize('qaap/mobileProjects/rowRunning', '1 running')
                : nls.localize('qaap/mobileProjects/rowRunningMany', '{0} running', String(runningCount));
            metaRow.append(sep, run);
        } else if (doneCount > 0) {
            const sep = document.createElement('span');
            sep.className = 'theia-mobile-projects-row-meta-sep';
            sep.textContent = '·';
            const cluster = document.createElement('span');
            cluster.className = 'theia-mobile-projects-row-meta-cluster';
            if (doneCount > 0) {
                const done = document.createElement('span');
                done.className = 'theia-mobile-projects-row-meta-done';
                done.textContent = doneCount === 1
                    ? nls.localize('qaap/mobileProjects/rowTask', '1 task')
                    : nls.localize('qaap/mobileProjects/rowTasksMany', '{0} tasks', String(doneCount));
                cluster.append(done);
            }
            metaRow.append(sep, cluster);
        }
        // Explicit "open in workspace" icon button on the meta row for non-home list layout.
        // Home mode always places it on the name row (collapsed and expanded).
        if (!ctx.host.homeMode) {
            metaRow.append(ctx.createWorkspaceOpenControl(project));
        }
        if (!ctx.host.homeMode || isExpanded) {
            main.append(metaRow);
        }
        header.append(main);

        const menu = ctx.host.cardMenuUi.buildProjectOptionsMenu(project);
        const menuBtn = document.createElement('button');
        menuBtn.type = 'button';
        menuBtn.className = 'theia-mobile-projects-card-menu-btn theia-mobile-projects-row-menu';
        menuBtn.setAttribute('aria-label', nls.localize('qaap/mobileProjects/cardMenu', 'Project options'));
        menuBtn.setAttribute('aria-haspopup', 'menu');
        menuBtn.setAttribute('aria-expanded', 'false');
        const menuIcon = document.createElement('span');
        menuIcon.className = 'codicon codicon-kebab-vertical';
        menuIcon.setAttribute('aria-hidden', 'true');
        menuBtn.append(menuIcon);
        menuBtn.addEventListener('click', ev => {
            ev.stopPropagation();
            ctx.host.cardMenuUi.toggleCardMenu(card, menu, menuBtn);
        });
        menuBtn.addEventListener('keydown', ev => ev.stopPropagation());
        header.append(menuBtn);

        const onRowActivate = (): void => {
            if (ctx.host.homeMode) {
                void ctx.host.openProjectDetail(project);
                return;
            }
            void ctx.host.toggleRowExpanded(project);
        };
        header.addEventListener('click', ev => {
            ev.stopPropagation();
            onRowActivate();
        });
        header.addEventListener('keydown', ev => {
            if (ev.key !== 'Enter' && ev.key !== ' ') {
                return;
            }
            ev.preventDefault();
            ev.stopPropagation();
            onRowActivate();
        });
        header.addEventListener('contextmenu', ev => {
            ev.preventDefault();
            onRowActivate();
        });
        card.append(header);

        if (!isExpanded) {
            return card;
        }

        const body = document.createElement('div');
        body.className = 'theia-mobile-projects-row-body';

        const workspaceBlock = ctx.createWorkspaceBlock(project);
        if (workspaceBlock) {
            body.append(workspaceBlock);
        }
        body.append(ctx.createTaskBlock(project, activeInfo));

        card.append(body, menu);
        return card;
}

export function createHomeRowAvatarExtracted(ctx: any, project: MobileProjectEntry): HTMLSpanElement {
        const avatar = document.createElement('span');
        avatar.className = 'theia-mobile-projects-row-avatar';
        avatar.textContent = mobileProjectInitials(project.name);
        avatar.style.setProperty('--qaap-mobile-project-accent', project.color);
        return avatar;
}

export function createHomeRowStatusExtracted(ctx: any, project: MobileProjectEntry,
        state: {
            unreadCount: number;
            running: boolean;
            runningCount: number;
            needsInput: boolean;
            needsInputCount: number;
            failed: boolean;
            failedCount: number;
        },): HTMLElement | undefined {
        const line = document.createElement('div');
        line.className = 'theia-mobile-projects-row-status';
        if (state.unreadCount > 0) {
            line.classList.add('theia-mod-new');
            line.textContent = state.unreadCount === 1
                ? nls.localize('qaap/mobileProjects/rowNewOne', '1 new')
                : nls.localize('qaap/mobileProjects/rowNewMany', '{0} new', String(state.unreadCount));
            return line;
        }
        if (state.needsInput) {
            line.classList.add('theia-mod-needs-input');
            line.textContent = state.needsInputCount === 1
                ? nls.localize('qaap/mobileProjects/rowNeedsInputOne', 'Needs your input')
                : nls.localize('qaap/mobileProjects/rowNeedsInputMany', '{0} need your input', String(state.needsInputCount));
            return line;
        }
        if (state.failed) {
            line.classList.add('theia-mod-failed');
            line.textContent = state.failedCount === 1
                ? nls.localize('qaap/mobileProjects/rowFailedOne', '1 failed')
                : nls.localize('qaap/mobileProjects/rowFailedMany', '{0} failed', String(state.failedCount));
            return line;
        }
        if (state.running) {
            line.classList.add('theia-mod-running');
            line.textContent = state.runningCount === 1
                ? nls.localize('qaap/mobileProjects/rowRunning', '1 running')
                : nls.localize('qaap/mobileProjects/rowRunningMany', '{0} running', String(state.runningCount));
            return line;
        }
        return undefined;
}

export function createWorkspaceOpenControlExtracted(ctx: any, project: MobileProjectEntry): HTMLButtonElement {
        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'theia-mobile-projects-row-meta-open';
        const openLabel = nls.localize('qaap/mobileProjects/workspaceOpenIn', 'Open in workspace');
        openBtn.setAttribute('aria-label', openLabel);
        openBtn.title = openLabel;
        const openIcon = document.createElement('span');
        openIcon.className = 'codicon codicon-link-external';
        openIcon.setAttribute('aria-hidden', 'true');
        openBtn.append(openIcon);
        openBtn.addEventListener('click', ev => {
            ev.stopPropagation();
            ctx.host.delegate.onProjectOpen(project);
        });
        openBtn.addEventListener('keydown', ev => ev.stopPropagation());
        return openBtn;
}

export function createWorkspaceBlockExtracted(ctx: any, project: MobileProjectEntry): HTMLElement | undefined {
        if (project.isCurrent) {
            return undefined;
        }
        // For non-current projects the "Open in workspace" affordance is rendered as a compact
        // icon button on the meta row (see createRow) so it doesn't take a full line in the body.
        return undefined;
}

