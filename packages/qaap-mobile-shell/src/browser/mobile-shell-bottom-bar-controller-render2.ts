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

export function measureMobileBottomPanelHeightPxExtracted(ctx: any): number | undefined {
        const parent = ctx.shell.bottomPanel.parent;
        if (!(parent instanceof SplitPanel) || !parent.isVisible) {
            return undefined;
        }
        const index = parent.widgets.indexOf(ctx.shell.bottomPanel) - 1;
        if (index < 0) {
            return undefined;
        }
        const handle = parent.handles[index];
        if (handle.classList.contains('lm-mod-hidden')) {
            return undefined;
        }
        const parentHeight = parent.node.clientHeight;
        if (parentHeight <= 0) {
            return undefined;
        }
        return parentHeight - handle.offsetTop;
}

export function resolveMobileBottomSplitSizesExtracted(ctx: any): [number, number] {
        const split = ctx.getBottomAreaSplitPanel();
        const total = split?.node.clientHeight ?? 0;
        if (total <= 0) {
            const bottom = MOBILE_BOTTOM_SPLIT_DEFAULT_BOTTOM_RATIO;
            return [1 - bottom, bottom];
        }
        let bottomPx = ctx.measureMobileBottomPanelHeightPx();
        if (!bottomPx || bottomPx <= 0) {
            const state = (ctx.shell as ApplicationShell & { bottomPanelState?: { lastPanelSize?: number } }).bottomPanelState;
            bottomPx = state?.lastPanelSize ?? Math.round(total * MOBILE_BOTTOM_SPLIT_DEFAULT_BOTTOM_RATIO);
        }
        const minBottomPx = 120;
        const maxBottomPx = Math.round(total * (1 - MOBILE_BOTTOM_SPLIT_MAIN_MIN_RATIO));
        bottomPx = Math.max(minBottomPx, Math.min(maxBottomPx, bottomPx));
        const mainPx = Math.max(Math.round(total * MOBILE_BOTTOM_SPLIT_MAIN_MIN_RATIO), total - bottomPx);
        const adjustedBottomPx = total - mainPx;
        return [mainPx / total, adjustedBottomPx / total];
}

export function syncMobileBottomSplitExtracted(ctx: any): void {
        if (ctx.shell.bottomPanel.hasClass(MAXIMIZED_CLASS)) {
            return;
        }
        const split = ctx.getBottomAreaSplitPanel();
        if (!split) {
            return;
        }
        try {
            if (ctx.shell.isExpanded('bottom')) {
                const current = split.relativeSizes();
                if (current.length >= 2 && current[0] >= MOBILE_BOTTOM_SPLIT_MAIN_MIN_RATIO) {
                    return;
                }
                const [main, bottom] = ctx.resolveMobileBottomSplitSizes();
                split.setRelativeSizes([main, bottom]);
            } else {
                split.setRelativeSizes([1, 0]);
            }
        } catch {
            /* layout not ready */
        }
}

export async function applyMobileBottomPanelMaximizedSizeExtracted(ctx: any): Promise<void> {
        if (!ctx.host.isMobileActive() || ctx.suppressMobileBottomAutoMaximize) {
            return;
        }
        await ctx.getBottomPanelPendingUpdate();
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const bottomPanel = ctx.shell.bottomPanel;
        if (!ctx.isMobileBottomTerminalVisible() || bottomPanel.hasClass(MAXIMIZED_CLASS)) {
            return;
        }
        bottomPanel.toggleMaximized();
        ctx.syncMobileMaximizedOverlayInsets();
}

export function restoreMobileBottomPanelFromMaximizedExtracted(ctx: any): void {
        const bottomPanel = ctx.shell.bottomPanel;
        if (bottomPanel.hasClass(MAXIMIZED_CLASS)) {
            bottomPanel.toggleMaximized();
        }
        ctx.clearMobileMaximizedOverlayInsets();
}

export function syncMobileMaximizedOverlayInsetsExtracted(ctx: any): void {
        const overlay = ctx.getMaximizedOverlayElement();
        if (!overlay || !ctx.host.isMobileActive()) {
            return;
        }
        if (!ctx.shell.bottomPanel.hasClass(MAXIMIZED_CLASS)) {
            ctx.clearMobileMaximizedOverlayInsets();
            return;
        }
        const topRect = ctx.shell.topPanel.node.getBoundingClientRect();
        overlay.style.top = `${topRect.bottom}px`;
        overlay.style.bottom = [
            'calc(',
            'var(--theia-mobile-bottom-chrome-reserved, 0px)',
            '+ var(--theia-mobile-keyboard-inset, 0px)',
            '+ env(safe-area-inset-bottom, 0px)',
            ')',
        ].join(' ');
}

export function clearMobileMaximizedOverlayInsetsExtracted(ctx: any): void {
        const overlay = ctx.getMaximizedOverlayElement();
        overlay?.style.removeProperty('bottom');
        overlay?.style.removeProperty('top');
}

export function ensureBottomChromeHostExtracted(ctx: any): HTMLElement {
        if (!ctx.bottomChromeHost) {
            const host = document.createElement('div');
            host.className = 'theia-mobile-bottom-chrome-host';
            host.setAttribute('aria-hidden', 'false');
            document.body.appendChild(host);
            ctx.bottomChromeHost = host;
        }
        return ctx.bottomChromeHost;
}

export function ensureBottomBarWidgetExtracted(ctx: any): MobileBottomBarWidget {
        if (!ctx.bottomBarWidget) {
            ctx.bottomBarWidget = new MobileBottomBarWidget();
            ctx.bottomBarWidget.node.setAttribute(
                'aria-label',
                nls.localize('theia/core/mobileBottomBar', 'Primary views')
            );
        }
        return ctx.bottomBarWidget;
}

export function pinBottomChromeToBodyExtracted(ctx: any): void {
        const bottomWidget = ctx.bottomBarWidget;
        if (!bottomWidget) {
            return;
        }
        const host = ctx.ensureBottomChromeHost();
        const layout = ctx.shell.layout as BoxLayout | null;
        if (layout instanceof BoxLayout && ctx.statusBar.parent === ctx.shell) {
            const widgets = layout.widgets as ReadonlyArray<LuminoWidget>;
            ctx.statusBarShellIndex = ArrayExt.findFirstIndex(widgets, w => w === ctx.statusBar);
            if (ctx.statusBarShellIndex >= 0) {
                layout.removeWidget(ctx.statusBar);
            }
        }
        if (bottomWidget.parent) {
            bottomWidget.parent = null;
        }
        BoxPanel.setStretch(bottomWidget, 0);
        if (!host.contains(bottomWidget.node)) {
            host.appendChild(bottomWidget.node);
        }
        if (!host.contains(ctx.statusBar.node)) {
            host.appendChild(ctx.statusBar.node);
        }
        ctx.installBottomChromeTouchScroll();
        MessageLoop.postMessage(ctx.shell, LuminoWidget.Msg.FitRequest);
}

export function installBottomChromeTouchScrollExtracted(ctx: any): void {
        ctx.bottomChromeTouchScrollDispose.dispose();
        if (typeof window === 'undefined') {
            return;
        }
        const coarse = window.matchMedia('(pointer: coarse)').matches;
        const narrow = ctx.mobileMq?.matches ?? false;
        if (!coarse && !narrow) {
            ctx.bottomChromeTouchScrollDispose = Disposable.NULL;
            return;
        }
        const bottomNode = ctx.bottomBarWidget?.node;
        const toDispose = new DisposableCollection();
        if (bottomNode) {
            toDispose.push(installMobileHorizontalTouchScroll(bottomNode));
        }
        toDispose.push(installMobileHorizontalTouchScroll(ctx.statusBar.node));
        ctx.bottomChromeTouchScrollDispose = toDispose;
}

export function unpinBottomChromeFromBodyExtracted(ctx: any): void {
        ctx.bottomChromeTouchScrollDispose.dispose();
        ctx.bottomChromeTouchScrollDispose = Disposable.NULL;
        if (ctx.bottomChromeHost) {
            while (ctx.bottomChromeHost.firstChild) {
                ctx.bottomChromeHost.removeChild(ctx.bottomChromeHost.firstChild);
            }
            ctx.bottomChromeHost.parentElement?.removeChild(ctx.bottomChromeHost);
            ctx.bottomChromeHost = undefined;
        }
        const layout = ctx.shell.layout as BoxLayout | null;
        if (layout instanceof BoxLayout && ctx.statusBar.parent !== ctx.shell) {
            if (ctx.statusBarShellIndex >= 0) {
                layout.insertWidget(ctx.statusBarShellIndex, ctx.statusBar);
            } else {
                layout.addWidget(ctx.statusBar);
            }
            BoxPanel.setStretch(ctx.statusBar, 0);
            MessageLoop.postMessage(ctx.shell, LuminoWidget.Msg.FitRequest);
        }
        ctx.statusBarShellIndex = -1;
}

export function detachBottomBarFromShellExtracted(ctx: any): void {
        const widget = ctx.bottomBarWidget;
        if (!widget) {
            return;
        }
        if (widget.parent) {
            widget.parent = null;
        }
        ctx.bottomBarWidget = undefined;
}

export function isWorkHubLandingBottomBarExtracted(ctx: any): boolean {
        if (!ctx.host.isMobileActive() || peekPreferDesktopIde()) {
            return false;
        }
        if (document.body.classList.contains('theia-mobile-mod-workhub-composer-header')
            || document.body.classList.contains('theia-mobile-mod-active-transcript')) {
            return true;
        }
        const panel = ctx.host.getProjectsPanel();
        if (panel?.isVisible() && panel.isHomeMode() && panel.getHubView() === 'tasks'
            && (panel.isAgentsHubShellActive() || panel.node.classList.contains('theia-mod-agents-hub-landing'))) {
            return true;
        }
        const onLandingPanel = document.body.classList.contains('theia-mobile-mod-landing')
            && panel?.isHomeMode() === true
            && panel.isVisible();
        if (onLandingPanel) {
            return true;
        }
        return ctx.isMobileWorkspaceHubPrimaryBottomBar();
}

export function isMobileWorkspaceHubPrimaryBottomBarExtracted(ctx: any): boolean {
        return ctx.host.getLandingLeftThisSession()
            && !document.body.classList.contains('theia-mobile-mod-landing')
            && ctx.isMainAgentSurfaceEmpty();
}

export function isMainAgentSurfaceEmptyExtracted(ctx: any): boolean {
        const shell = ctx.shell.node;
        if (shell.querySelector('.theia-mobile-agent-transcript-empty')) {
            return true;
        }
        const transcript = shell.querySelector(
            '.theia-mobile-agent-transcript-root.theia-mod-visible .theia-mobile-agent-transcript',
        );
        if (transcript && transcript.querySelector('.theia-mobile-agent-transcript-msg') === null) {
            return transcript.querySelector('.theia-mobile-agent-transcript-empty') !== null;
        }
        return false;
}

export function syncMobileHubPrimaryBottomChromeExtracted(ctx: any): void {
        if (peekPreferDesktopIde()) {
            setMobileWorkHubHideBottomChrome(false);
            setMobileWorkHubComposerHeaderChrome(false);
            if (ctx.bottomChromeHost) {
                ctx.bottomChromeHost.setAttribute('aria-hidden', 'false');
            }
            return;
        }
        const hideBottomChrome = ctx.isWorkHubLandingBottomBar();
        setMobileWorkHubHideBottomChrome(hideBottomChrome);
        if (hideBottomChrome) {
            setMobileLandingHubListChrome(false);
        }
        if (ctx.bottomChromeHost) {
            ctx.bottomChromeHost.setAttribute('aria-hidden', hideBottomChrome ? 'true' : 'false');
        }
}

export function getWorkHubLandingBottomButtonsExtracted(ctx: any): MobileBottomButton[] {
        return [
            {
                id: 'hub-tasks',
                label: nls.localize('qaap/mobileBottomBar/hubAgents', 'Agents'),
                icon: 'codicon-sparkle',
            },
        ];
}

export function getMobileBottomButtonsExtracted(ctx: any): MobileBottomButton[] {
        if (ctx.isWorkHubLandingBottomBar()) {
            return ctx.getWorkHubLandingBottomButtons();
        }
        return [
            { id: 'agent', label: nls.localize('theia/core/mobileBottomBar/agent', 'Agent'), icon: 'codicon-sparkle', commandId: WORKBENCH_AI_CHAT_TOGGLE },
            { id: 'preview', label: nls.localize('theia/core/mobileBottomBar/preview', 'Preview'), icon: 'codicon-play' },
            { id: 'terminal', label: nls.localize('theia/core/mobileBottomBar/terminal', 'Terminal'), icon: 'codicon-terminal' },
            { id: 'explore', label: nls.localize('qaap/mobileBottomBar/explore', 'Explore'), icon: 'codicon-folder-opened' },
            { id: 'pr', label: nls.localize('qaap/mobileBottomBar/pr', 'PR'), icon: 'codicon-git-pull-request' },
        ];
}

export function getMobileIdeHeaderViewButtonsExtracted(ctx: any): MobileBottomButton[] {
        return ctx.getMobileBottomButtons().filter(def => (
            def.id === 'preview'
            || def.id === 'terminal'
            || def.id === 'explore'
            || def.id === 'pr'
        ));
}

export function isMobileBottomButtonActiveExtracted(ctx: any, id: MobileBottomButtonId): boolean {
        if (!ctx.host.isMobileWorkHubLandingVisible()) {
            switch (id) {
                case 'hub-home':
                case 'hub-inbox':
                case 'hub-projects':
                case 'hub-tasks':
                case 'hub-review':
                case 'hub-team':
                case 'hub-automations':
                    return false;
                default:
                    break;
            }
        }
        switch (id) {
            case 'hub-home':
                return ctx.host.isMobileWorkHubLandingVisible()
                    && ctx.host.getProjectsPanel()?.getHubView() === 'home';
            case 'hub-inbox':
                return ctx.host.isMobileWorkHubLandingVisible()
                    && ctx.host.getProjectsPanel()?.getHubView() === 'review';
            case 'hub-projects':
                return ctx.host.isMobileWorkHubLandingVisible()
                    && ctx.host.getProjectsPanel()?.getHubView() === 'repos'
                    && !ctx.host.getProjectsPanel()?.isProjectDetailView();
            case 'hub-tasks':
                if (ctx.host.isMobileWorkHubLandingVisible()) {
                    return ctx.host.getProjectsPanel()?.getHubView() === 'tasks';
                }
                return ctx.isMobileWorkspaceHubPrimaryBottomBar() && ctx.isMainAgentSurfaceEmpty();
            case 'hub-review':
                return ctx.host.isMobileWorkHubLandingVisible()
                    && ctx.host.getProjectsPanel()?.getHubView() === 'review';
            case 'hub-team':
                return ctx.host.isMobileWorkHubLandingVisible()
                    && ctx.host.getProjectsPanel()?.getHubView() === 'tasks';
            case 'hub-automations':
                return ctx.host.isMobileWorkHubLandingVisible()
                    && ctx.host.getProjectsPanel()?.getHubView() === 'routines';
            case 'projects':
                return !!ctx.host.getProjectsPanel()?.isVisible();
            case 'editor':
                return !ctx.host.getProjectsPanel()?.isVisible()
                    && !ctx.host.isPullRequestPanelShown()
                    && !ctx.host.isMobileAgentSheetVisible()
                    && !ctx.host.isMobileExploreSheetVisible()
                    && !ctx.host.getActivePreviewWidget()
                    && !ctx.isTerminalBottomPanelOpen();
            case 'pr':
                return ctx.host.isPullRequestPanelShown();
            case 'agent':
                return ctx.host.isMobileAgentSheetVisible();
            case 'preview':
                return !!ctx.host.getActivePreviewWidget();
            case 'explore':
                return ctx.host.isMobileExploreSheetVisible();
            case 'terminal':
                return ctx.isTerminalBottomPanelOpen();
            default:
                return false;
        }
}

export function canToggleTerminalBottomPanelExtracted(ctx: any): boolean {
        if (ctx.isTerminalBottomPanelOpen()) {
            return true;
        }
        const toggleBottom = CommonCommands.TOGGLE_BOTTOM_PANEL.id;
        if (ctx.commands.getCommand(toggleBottom) && ctx.commands.isEnabled(toggleBottom)) {
            return true;
        }
        return !!(ctx.commands.getCommand(WORKBENCH_TOGGLE_TERMINAL) && ctx.commands.isEnabled(WORKBENCH_TOGGLE_TERMINAL));
}

export async function activateMobileIdeHeaderViewExtracted(ctx: any, id: MobileBottomButtonId): Promise<void> {
        if (id === 'agent' || id === 'editor') {
            const def = ctx.getMobileBottomButtons().find(candidate => candidate.id === id)
                ?? ({ id, label: id, icon: '' } as MobileBottomButton);
            const anchor = document.createElement('button');
            await ctx.onMobileBottomButtonClick(def, anchor);
            return;
        }
        const def = ctx.getMobileIdeHeaderViewButtons().find(candidate => candidate.id === id);
        if (!def) {
            return;
        }
        const anchor = document.createElement('button');
        await ctx.onMobileBottomButtonClick(def, anchor);
}

