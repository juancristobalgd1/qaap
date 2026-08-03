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
import { matchesMobileNarrowViewport } from '@theia/core/lib/browser/shell/mobile-layout-state';
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

export function getPreviewSecondaryItemsExtracted(ctx: any): BottomBarSecondaryItem[] {
    const items: BottomBarSecondaryItem[] = [];
    const descriptor = ctx.projectBootstrap.descriptor;
    const phase = ctx.projectBootstrap.phase;
    if (descriptor) {
        if (phase === 'detected') {
            items.push({
                label: nls.localize('qaap/mobileBottomBar/previewInstall', 'Install dependencies'),
                detail: descriptor.installCommand,
                icon: 'codicon-cloud-download',
                run: () => ctx.projectBootstrap.runInstall(),
            });
        }
        if (descriptor.devCommand && (phase === 'ready-to-run' || phase === 'detected' || phase === 'run-failed')) {
            items.push({
                label: nls.localize('qaap/mobileBottomBar/previewRunDev', 'Run dev server'),
                detail: descriptor.devCommandLabel ?? descriptor.devCommand,
                icon: 'codicon-play',
                run: () => ctx.projectBootstrap.runDevServer(),
            });
        }
        if (phase === 'dismissed') {
            items.push({
                label: nls.localize('qaap/mobileBottomBar/previewShowBanner', 'Show project setup'),
                icon: 'codicon-rocket',
                run: () => ctx.projectBootstrap.reset(),
            });
        }
        if (ctx.projectBootstrap.previewUrl) {
            items.push({
                label: nls.localize('qaap/mobileBottomBar/previewFocus', 'Open dev preview'),
                detail: ctx.projectBootstrap.previewUrl,
                icon: 'codicon-link-external',
                run: () => ctx.projectBootstrap.focusPreview(),
            });
        }
    }
    const reload = 'mini-browser.reload';
    if (ctx.commands.getCommand(reload)) {
        items.push({
            label: nls.localize('qaap/mobileBottomBar/previewReload', 'Reload preview'),
            icon: 'codicon-refresh',
            run: () => ctx.host.executeAndDismiss(reload),
        });
    }
    return items;
}

export function getExploreSecondaryItemsExtracted(ctx: any): BottomBarSecondaryItem[] {
    const items: BottomBarSecondaryItem[] = [];
    const newFile = 'file.newFile';
    if (ctx.commands.getCommand(newFile)) {
        items.push({
            label: nls.localize('qaap/mobileBottomBar/newFile', 'New file'),
            icon: 'codicon-new-file',
            run: () => ctx.host.executeAndDismiss(newFile),
        });
    }
    const newFolder = 'file.newFolder';
    if (ctx.commands.getCommand(newFolder)) {
        items.push({
            label: nls.localize('qaap/mobileBottomBar/newFolder', 'New folder'),
            icon: 'codicon-new-folder',
            run: () => ctx.host.executeAndDismiss(newFolder),
        });
    }
    return items;
}

export function shouldDismissSheetsForButtonExtracted(ctx: any, id: MobileBottomButtonId): boolean {
    // Agent lives in the right-side panel by design, so keep that sheet open. Projects uses its
    // own overlay. All other actions target the main editor area, the bottom panel, or a global
    // prompt; the side sheets must be closed so the result is visible.
    return id !== 'agent' && id !== 'projects' && id !== 'pr';
}

export async function onMobileBottomButtonClickExtracted(ctx: any, def: MobileBottomButton, btn: HTMLButtonElement): Promise<void> {
    MobileHaptics.fire(MobileHaptics.LIGHT);
    if (def.id === 'hub-tasks') {
        btn.blur();
    }
    if (def.id === 'hub-inbox') {
        dismissQaapAccountMenu();
        await ctx.host.openMobileWorkHubLanding('review');
        ctx.host.conversationsStart();
        ctx.host.inboxStreamStart();
        return;
    }
    if (def.id === 'hub-projects') {
        await ctx.host.openMobileWorkHubLanding('repos');
        return;
    }
    if (def.id === 'hub-tasks') {
        await ctx.host.openMobileWorkHubLanding('tasks');
        return;
    }
    if (def.id === 'hub-review') {
        dismissQaapAccountMenu();
        await ctx.host.openMobileWorkHubLanding('review');
        ctx.host.conversationsStart();
        ctx.host.inboxStreamStart();
        return;
    }
    if (def.id === 'hub-team') {
        await ctx.host.openMobileWorkHubLanding('tasks');
        return;
    }
    if (def.id === 'projects') {
        await ctx.host.toggleProjectsPanel();
        return;
    }
    if (def.id === 'editor') {
        // Classic IDE is desktop-only — never activate it on a narrow/touch viewport.
        if (matchesMobileNarrowViewport()) {
            return;
        }
        if (ctx.commands.getCommand(QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND) && ctx.commands.isEnabled(QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND)) {
            await ctx.commands.executeCommand(QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND);
            return;
        }
        clearPreferAgentsSurface();
        markPreferDesktopIde();
        setMobileWorkHubComposerHeaderChrome(false);
        setMobileWorkHubHideBottomChrome(false);
        document.body.classList.add('theia-mobile-mod-desktop-ide');
        document.body.classList.remove('theia-mobile-mod-landing');
        ctx.host.hideProjectsPanel();
        ctx.host.hidePullRequestPanel();
        await ctx.host.dismissSheetsAsync();
        await ctx.host.collapseMobileSidePanels();
        if (ctx.isTerminalBottomPanelOpen()) {
            ctx.restoreMobileBottomPanelFromMaximized();
            await ctx.shell.collapsePanel('bottom');
        }
        ctx.host.settleMobileSidePanelsCollapsed();
        ctx.host.relayoutMainPreviewWidgets();
        ctx.host.scheduleSnapAndUiRefresh();
        ctx.host.syncOverlayEdgeSwipeZones();
        return;
    }
    if (def.id === 'pr') {
        await ctx.host.togglePullRequestPanel();
        return;
    }
    if (def.id === 'terminal') {
        ctx.host.hideProjectsPanel();
        ctx.host.hidePullRequestPanel();
        await ctx.host.collapseMobileSidePanels();
        await ctx.toggleTerminalBottomPanel();
        await ctx.host.collapseMobileSidePanels();
        ctx.host.settleMobileSidePanelsCollapsed();
        return;
    }
    if (def.id === 'agent') {
        ctx.host.hidePullRequestPanel();
        await ctx.host.openMobileWorkHubLanding('tasks');
        await ctx.host.collapseMobileSidePanels();
        ctx.host.settleMobileSidePanelsCollapsed();
        ctx.host.scheduleSnapAndUiRefresh();
        return;
    }
    if (def.id === 'preview') {
        ctx.host.hidePullRequestPanel();
        await ctx.host.toggleMobilePreview();
        return;
    }
    if (def.id === 'explore') {
        ctx.host.hidePullRequestPanel();
        await ctx.host.toggleMobileExploreSheet();
        return;
    }
    ctx.host.hideProjectsPanel();
    ctx.host.hidePullRequestPanel();
    // Main-area actions: collapse side sheets first so preview / quick input are visible.
    if (ctx.shouldDismissSheetsForButton(def.id)) {
        await ctx.host.dismissSheetsAsync();
    }
    const commandId = def.commandId;
    if (commandId && ctx.commands.getCommand(commandId) && ctx.commands.isEnabled(commandId)) {
        try {
            await ctx.commands.executeCommand(commandId);
        } catch (e) {
            console.error(`[qaap-mobile-shell] bottom bar command failed: ${commandId}`, e);
        }
        ctx.host.relayoutMainPreviewWidgets();
        ctx.host.scheduleSnapAndUiRefresh();
    }
}

