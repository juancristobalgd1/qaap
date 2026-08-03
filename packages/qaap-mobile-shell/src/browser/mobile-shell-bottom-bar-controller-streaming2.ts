// @ts-nocheck
// Extracted from mobile-shell-bottom-bar-controller.ts

import { ArrayExt } from '@lumino/algorithm';
import { MessageLoop } from '@lumino/messaging';
import { BoxLayout, BoxPanel, SplitPanel, Widget as LuminoWidget } from '@lumino/widgets';
import { ApplicationShell, MAXIMIZED_CLASS } from '@theia/core/lib/browser/shell/application-shell';
import { StatusBarImpl } from '@theia/core/lib/browser/status-bar/status-bar';
import { CommonCommands } from '@theia/core/lib/browser/common-commands';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { nls } from '@theia/core/lib/common/nls';
import { MobileHaptics } from './mobile-haptics';
import { installMobileHorizontalTouchScroll } from './mobile-horizontal-touch-scroll';
import {
    clearPreferAgentsSurface,
    markPreferDesktopIde,
    peekPreferDesktopIde,
    setMobileLandingHubListChrome,
    setMobileWorkHubComposerHeaderChrome,
    setMobileWorkHubHideBottomChrome,
} from './mobile-projects-open';
import type { MobileProjectEntry, MobileProjectsHubView } from './mobile-projects-types';
import type { MobileProjectsPanel } from './mobile-projects-panel';
import type { MobileProjectsService } from './mobile-projects-service';
import { MobileSnackbar } from './mobile-snackbar';
import { dismissQaapAccountMenu, QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND } from './qaap-workbench-account-menu';
import type { QaapProjectBootstrapService } from './qaap-project-bootstrap-service';
import {
    BottomBarSecondaryItem,
    EDIT_CHAT_SESSION_SETTINGS_COMMAND,
    MOBILE_BOTTOM_OPEN_CLASS,
    MOBILE_BOTTOM_SPLIT_DEFAULT_BOTTOM_RATIO,
    MOBILE_BOTTOM_SPLIT_MAIN_MIN_RATIO,
    MobileBottomBarWidget,
    MobileBottomButton,
    MobileBottomButtonId,
    OPEN_AI_CONFIGURATION_COMMAND,
    ShellWithMaximizedOverlay,
    WORKBENCH_AI_CHAT_TOGGLE,
    WORKBENCH_TOGGLE_TERMINAL,
} from './mobile-shell-bottom-bar-widget';

export async function toggleTerminalBottomPanelExtracted(ctx: any): Promise<void> {
        if (ctx.isTerminalBottomPanelOpen()) {
            if (ctx.shell.bottomPanel.hasClass(MAXIMIZED_CLASS)) {
                ctx.suppressMobileBottomAutoMaximize = false;
                ctx.restoreMobileBottomPanelFromMaximized();
                await ctx.shell.collapsePanel('bottom');
                ctx.host.scheduleSnapAndUiRefresh();
                return;
            }
            ctx.suppressMobileBottomAutoMaximize = false;
            await ctx.applyMobileBottomPanelMaximizedSize();
            ctx.host.scheduleSnapAndUiRefresh();
            return;
        }
        ctx.suppressMobileBottomAutoMaximize = false;
        const toggleBottom = CommonCommands.TOGGLE_BOTTOM_PANEL.id;
        if (ctx.commands.getCommand(toggleBottom) && ctx.commands.isEnabled(toggleBottom)) {
            try {
                await ctx.commands.executeCommand(toggleBottom);
            } catch (e) {
                console.error(`[qaap-mobile-shell] bottom bar command failed: ${toggleBottom}`, e);
            }
        } else if (ctx.commands.getCommand(WORKBENCH_TOGGLE_TERMINAL) && ctx.commands.isEnabled(WORKBENCH_TOGGLE_TERMINAL)) {
            try {
                await ctx.commands.executeCommand(WORKBENCH_TOGGLE_TERMINAL);
            } catch (e) {
                console.error(`[qaap-mobile-shell] bottom bar command failed: ${WORKBENCH_TOGGLE_TERMINAL}`, e);
            }
        }
        await ctx.applyMobileBottomPanelMaximizedSize();
        ctx.host.scheduleSnapAndUiRefresh();
}

export function refreshBottomBarExtracted(ctx: any): void {
        const bottomBar = ctx.getBottomBarNode();
        if (!bottomBar || !ctx.host.isMobileActive()) {
            return;
        }
        ctx.syncMobileHubPrimaryBottomChrome();
        dismissQaapAccountMenu();
        bottomBar.replaceChildren();
        if (ctx.isWorkHubLandingBottomBar()) {
            return;
        }
        for (const def of ctx.getMobileBottomButtons()) {
            bottomBar.appendChild(ctx.createMobileBottomButton(def));
        }
}

export function createMobileBottomButtonExtracted(ctx: any, def: MobileBottomButton): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theia-mobile-bottom-activity-btn';
        btn.dataset.actionId = def.id;
        btn.title = def.label;
        const icon = document.createElement('span');
        icon.className = `theia-mobile-bottom-activity-icon codicon ${def.icon}`;
        icon.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.className = 'theia-mobile-bottom-activity-label';
        label.textContent = def.id === 'projects' && ctx.host.getProjectsCount() > 0
            ? `${def.label} ${ctx.host.getProjectsCount()}`
            : def.label;
        btn.append(icon, label);
        if (def.id === 'terminal') {
            if (!ctx.canToggleTerminalBottomPanel()) {
                btn.classList.add('theia-mod-unavailable');
            }
        } else {
            const commandId = def.commandId;
            if (commandId && !ctx.commands.getCommand(commandId)) {
                btn.classList.add('theia-mod-unavailable');
            }
        }
        if (ctx.isMobileBottomButtonActive(def.id)) {
            btn.classList.add('theia-mod-active');
            btn.setAttribute('aria-pressed', 'true');
        } else {
            btn.setAttribute('aria-pressed', 'false');
        }
        const isHubLandingTab = def.id === 'hub-tasks';
        let hubTabNavAt = 0;
        const onHubTabActivate = (): void => {
            const now = Date.now();
            if (now - hubTabNavAt < 320) {
                return;
            }
            hubTabNavAt = now;
            void ctx.onMobileBottomButtonClick(def, btn);
        };
        if (isHubLandingTab) {
            // Sin long-press: en iOS el click sintético a veces se pierde tras touchend del menú secundario.
            btn.addEventListener('pointerup', event => {
                if (event.pointerType === 'mouse' && event.button !== 0) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                onHubTabActivate();
            });
            btn.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                onHubTabActivate();
            });
        } else {
            btn.addEventListener('click', event => {
                event.stopPropagation();
                void ctx.onMobileBottomButtonClick(def, btn);
            });
            ctx.installBottomBarLongPress(btn, def);
        }
        return btn;
}

export function installBottomBarLongPressExtracted(ctx: any, btn: HTMLButtonElement, def: MobileBottomButton): void {
        let timer: number | undefined;
        let startX = 0;
        let startY = 0;
        let fired = false;
        const LONG_PRESS_MS = 480;
        const MOVE_THRESHOLD = 12;
        const cancel = (): void => {
            if (timer !== undefined) {
                window.clearTimeout(timer);
                timer = undefined;
            }
        };
        btn.addEventListener('touchstart', ev => {
            if (ev.touches.length !== 1) {
                cancel();
                return;
            }
            const touch = ev.touches[0];
            startX = touch.clientX;
            startY = touch.clientY;
            fired = false;
            cancel();
            timer = window.setTimeout(() => {
                timer = undefined;
                fired = true;
                MobileHaptics.fire(MobileHaptics.MEDIUM);
                void ctx.showBottomBarSecondaryMenu(btn, def);
            }, LONG_PRESS_MS);
        }, { passive: true });
        btn.addEventListener('touchmove', ev => {
            if (timer === undefined) {
                return;
            }
            const touch = ev.touches[0];
            if (!touch) {
                cancel();
                return;
            }
            if (Math.abs(touch.clientX - startX) > MOVE_THRESHOLD
                || Math.abs(touch.clientY - startY) > MOVE_THRESHOLD) {
                cancel();
            }
        }, { passive: true });
        btn.addEventListener('touchend', ev => {
            cancel();
            if (fired && ev.cancelable) {
                ev.preventDefault();
            }
        });
        btn.addEventListener('touchcancel', () => cancel(), { passive: true });
        btn.addEventListener('click', ev => {
            if (fired) {
                ev.preventDefault();
                ev.stopImmediatePropagation();
                fired = false;
            }
        }, true);
}

export async function showBottomBarSecondaryMenuExtracted(ctx: any, anchor: HTMLElement, def: MobileBottomButton): Promise<void> {
        const items = await ctx.getBottomBarSecondaryItems(def);
        if (items.length === 0) {
            MobileSnackbar.show(def.label, { duration: 800 });
            return;
        }
        ctx.removeBottomBarSecondaryMenu();
        const menu = document.createElement('div');
        menu.className = 'theia-mobile-bottom-actionsheet';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', def.label);
        for (const item of items) {
            const itemBtn = document.createElement('button');
            itemBtn.type = 'button';
            itemBtn.className = 'theia-mobile-bottom-actionsheet-item';
            itemBtn.setAttribute('role', 'menuitem');
            if (item.icon) {
                const ic = document.createElement('span');
                ic.className = `codicon ${item.icon}`;
                ic.setAttribute('aria-hidden', 'true');
                itemBtn.appendChild(ic);
            }
            const lbl = document.createElement('span');
            lbl.className = 'theia-mobile-bottom-actionsheet-label';
            lbl.textContent = item.label;
            itemBtn.appendChild(lbl);
            if (item.detail) {
                const det = document.createElement('span');
                det.className = 'theia-mobile-bottom-actionsheet-detail';
                det.textContent = item.detail;
                itemBtn.appendChild(det);
            }
            itemBtn.addEventListener('click', () => {
                ctx.removeBottomBarSecondaryMenu();
                MobileHaptics.fire(MobileHaptics.LIGHT);
                void item.run();
            });
            menu.appendChild(itemBtn);
        }
        document.body.appendChild(menu);
        const rect = anchor.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();
        let left = rect.left + rect.width / 2 - menuRect.width / 2;
        const minLeft = 8;
        const maxLeft = window.innerWidth - menuRect.width - 8;
        if (left < minLeft) { left = minLeft; }
        if (left > maxLeft) { left = maxLeft; }
        menu.style.left = `${Math.round(left)}px`;
        menu.style.bottom = `calc(${Math.round(window.innerHeight - rect.top + 8)}px)`;
        menu.classList.add('theia-mod-visible');

        const onDocPointer = (ev: PointerEvent): void => {
            if (menu.contains(ev.target as Node)) {
                return;
            }
            ctx.removeBottomBarSecondaryMenu();
        };
        document.addEventListener('pointerdown', onDocPointer, { capture: true, once: false });
        ctx.bottomBarMenuCleanup = () => {
            document.removeEventListener('pointerdown', onDocPointer, true);
        };
}

export function removeBottomBarSecondaryMenuExtracted(ctx: any): void {
        const existing = document.querySelector('.theia-mobile-bottom-actionsheet');
        existing?.parentElement?.removeChild(existing);
        ctx.bottomBarMenuCleanup?.();
        ctx.bottomBarMenuCleanup = undefined;
}

export async function getBottomBarSecondaryItemsExtracted(ctx: any, def: MobileBottomButton): Promise<BottomBarSecondaryItem[]> {
        if (def.id === 'hub-home' || def.id === 'hub-projects' || def.id === 'hub-tasks' || def.id === 'hub-review' || def.id === 'hub-team' || def.id === 'hub-automations') {
            return [];
        }
        switch (def.id) {
            case 'projects':
                return ctx.getProjectsSecondaryItems();
            case 'terminal':
                return ctx.getTerminalSecondaryItems();
            case 'agent':
                return ctx.getAgentSecondaryItems();
            case 'pr':
                return ctx.getPullRequestSecondaryItems();
            case 'preview':
                return ctx.getPreviewSecondaryItems();
            case 'explore':
                return ctx.getExploreSecondaryItems();
            default:
                return [];
        }
}

export async function getProjectsSecondaryItemsExtracted(ctx: any): Promise<BottomBarSecondaryItem[]> {
        const items: BottomBarSecondaryItem[] = [];
        let projects: MobileProjectEntry[] = [];
        try {
            projects = await ctx.projectsService.loadProjects();
        } catch {
            projects = [];
        }
        const switchable = projects.filter(p => !p.isCurrent).slice(0, 4);
        for (const project of switchable) {
            items.push({
                label: project.name,
                detail: project.github?.fullName ?? project.branch,
                icon: 'codicon-repo',
                run: () => ctx.host.onProjectsPanelOpen(project),
            });
        }
        if (items.length > 0) {
            items.push({
                label: nls.localize('qaap/mobileBottomBar/projectsAll', 'All projects'),
                icon: 'codicon-list-unordered',
                run: () => ctx.host.toggleProjectsPanel(),
            });
        }
        items.push({
            label: nls.localize('qaap/mobileBottomBar/projectsRefresh', 'Refresh'),
            icon: 'codicon-refresh',
            run: async () => {
                await ctx.host.refreshProjectsCount();
                ctx.refreshBottomBar();
                MobileSnackbar.show(
                    nls.localize('qaap/mobileBottomBar/projectsRefreshed', 'Work Hub refreshed'),
                    { kind: 'success', duration: 1200 }
                );
            },
        });
        return items;
}

export function getTerminalSecondaryItemsExtracted(ctx: any): BottomBarSecondaryItem[] {
        const items: BottomBarSecondaryItem[] = [];
        const newTerminal = 'terminal:new';
        if (ctx.commands.getCommand(newTerminal)) {
            items.push({
                label: nls.localize('qaap/mobileBottomBar/newTerminal', 'New terminal'),
                icon: 'codicon-add',
                run: () => ctx.host.executeAndDismiss(newTerminal),
            });
        }
        const killAll = 'terminal:kill-all';
        if (ctx.commands.getCommand(killAll)) {
            items.push({
                label: nls.localize('qaap/mobileBottomBar/closeAllTerminals', 'Close all terminals'),
                icon: 'codicon-trash',
                run: () => ctx.host.executeAndDismiss(killAll),
            });
        }
        if (ctx.isTerminalBottomPanelOpen()) {
            items.push({
                label: nls.localize('qaap/mobileBottomBar/collapseTerminal', 'Collapse panel'),
                icon: 'codicon-chevron-down',
                run: async () => { await ctx.shell.collapsePanel('bottom'); ctx.host.scheduleSnapAndUiRefresh(); },
            });
        }
        return items;
}

export function getAgentSecondaryItemsExtracted(ctx: any): BottomBarSecondaryItem[] {
        const items: BottomBarSecondaryItem[] = [];
        if (ctx.commands.getCommand(EDIT_CHAT_SESSION_SETTINGS_COMMAND)) {
            items.push({
                label: nls.localize('qaap/mobileBottomBar/agentSettings', 'Session settings'),
                icon: 'codicon-settings',
                run: () => ctx.host.executeAndDismiss(EDIT_CHAT_SESSION_SETTINGS_COMMAND),
            });
        }
        if (ctx.commands.getCommand(OPEN_AI_CONFIGURATION_COMMAND)) {
            items.push({
                label: nls.localize('qaap/mobileBottomBar/agentConfig', 'AI configuration'),
                icon: 'codicon-extensions',
                run: () => ctx.host.executeAndDismiss(OPEN_AI_CONFIGURATION_COMMAND),
            });
        }
        return items;
}

export function getPullRequestSecondaryItemsExtracted(ctx: any): BottomBarSecondaryItem[] {
        return [{
            label: nls.localize('qaap/mobileBottomBar/prRefresh', 'Refresh pull requests'),
            icon: 'codicon-refresh',
            run: async () => {
                ctx.host.hideProjectsPanel();
                ctx.host.openPullRequestPanel();
                ctx.refreshBottomBar();
            },
        }];
}

