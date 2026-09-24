// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { SplitPanel, Widget as LuminoWidget } from '@lumino/widgets';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import { StatusBarImpl } from '@theia/core/lib/browser/status-bar/status-bar';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { Disposable } from '@theia/core/lib/common/disposable';
import type { MobileProjectEntry, MobileProjectsHubView } from './mobile-projects-types';
import type { MobileProjectsPanel } from './mobile-projects-panel';
import type { MobileProjectsService } from './mobile-projects-service';
import type { QaapProjectBootstrapService } from './qaap-project-bootstrap-service';
import {
    BottomBarSecondaryItem,
    MOBILE_BOTTOM_OPEN_CLASS,
    MobileBottomBarWidget,
    MobileBottomButton,
    MobileBottomButtonId,
    ShellWithMaximizedOverlay,
} from './mobile-shell-bottom-bar-widget';
import { activateMobileIdeHeaderViewExtracted, applyMobileBottomPanelMaximizedSizeExtracted, canToggleTerminalBottomPanelExtracted, clearMobileMaximizedOverlayInsetsExtracted, detachBottomBarFromShellExtracted, ensureBottomBarWidgetExtracted, ensureBottomChromeHostExtracted, getMobileBottomButtonsExtracted, getMobileIdeHeaderViewButtonsExtracted, getWorkHubLandingBottomButtonsExtracted, installBottomChromeTouchScrollExtracted, isMainAgentSurfaceEmptyExtracted, isMobileBottomButtonActiveExtracted, isMobileWorkspaceHubPrimaryBottomBarExtracted, isWorkHubLandingBottomBarExtracted, measureMobileBottomPanelHeightPxExtracted, pinBottomChromeToBodyExtracted, resolveMobileBottomSplitSizesExtracted, restoreMobileBottomPanelFromMaximizedExtracted, syncMobileBottomSplitExtracted, syncMobileHubPrimaryBottomChromeExtracted, syncMobileMaximizedOverlayInsetsExtracted, unpinBottomChromeFromBodyExtracted } from './mobile-shell-bottom-bar-controller-render';
import { createMobileBottomButtonExtracted, getAgentSecondaryItemsExtracted, getBottomBarSecondaryItemsExtracted, getProjectsSecondaryItemsExtracted, getPullRequestSecondaryItemsExtracted, getTerminalSecondaryItemsExtracted, installBottomBarLongPressExtracted, refreshBottomBarExtracted, removeBottomBarSecondaryMenuExtracted, showBottomBarSecondaryMenuExtracted, toggleTerminalBottomPanelExtracted } from './mobile-shell-bottom-bar-controller-streaming';
import { getExploreSecondaryItemsExtracted, getPreviewSecondaryItemsExtracted, onMobileBottomButtonClickExtracted, shouldDismissSheetsForButtonExtracted } from './mobile-shell-bottom-bar-controller-timeline';

export interface MobileShellBottomBarHost {
    isMobileActive(): boolean;
    getLandingLeftThisSession(): boolean;
    getProjectsCount(): number;
    getProjectsPanel(): MobileProjectsPanel | undefined;
    isMobileWorkHubLandingVisible(): boolean;
    isPullRequestPanelShown(): boolean;
    isMobileAgentSheetVisible(): boolean;
    isMobileExploreSheetVisible(): boolean;
    getActivePreviewWidget(): LuminoWidget | undefined;
    isSidePanelSheetCollapsedInDom(side: 'left' | 'right'): boolean;
    scheduleSnapAndUiRefresh(): void;
    refreshWorkbenchTopBar(): void;
    hideProjectsPanel(): void;
    hidePullRequestPanel(): void;
    toggleProjectsPanel(): Promise<void>;
    togglePullRequestPanel(): Promise<void>;
    openMobileWorkHubLanding(view: MobileProjectsHubView): Promise<void>;
    collapseMobileSidePanels(): Promise<void>;
    dismissSheetsAsync(): Promise<void>;
    settleMobileSidePanelsCollapsed(): void;
    onProjectsPanelOpen(project: MobileProjectEntry): Promise<void>;
    refreshProjectsCount(): Promise<void>;
    toggleMobileAgentSheet(): Promise<void>;
    toggleMobilePreview(): Promise<void>;
    toggleMobileExploreSheet(): Promise<void>;
    openPullRequestPanel(): void;
    executeAndDismiss(commandId: string): Promise<void>;
    relayoutMainPreviewWidgets(): void;
    conversationsStart(): void;
    inboxStreamStart(): void;
    syncOverlayEdgeSwipeZones(): void;
}

export interface MobileShellBottomBarControllerOptions {
    host: MobileShellBottomBarHost;
    shell: ApplicationShell;
    statusBar: StatusBarImpl;
    commands: CommandRegistry;
    projectsService: MobileProjectsService;
    projectBootstrap: QaapProjectBootstrapService;
    mobileMq?: MediaQueryList;
}

/**
 * Mobile bottom activity bar, status chrome pinning, terminal split/maximize, and secondary action sheets.
 */
export class MobileShellBottomBarController {

    suppressMobileBottomAutoMaximize = false;

    /** @internal Used by the extracted mobile-shell-bottom-bar-controller-* modules. */
    public bottomChromeHost: HTMLElement | undefined;
    /** @internal Used by the extracted mobile-shell-bottom-bar-controller-* modules. */
    public bottomChromeTouchScrollDispose = Disposable.NULL;
    /** @internal Used by the extracted mobile-shell-bottom-bar-controller-* modules. */
    public statusBarShellIndex = -1;
    /** @internal Used by the extracted mobile-shell-bottom-bar-controller-* modules. */
    public bottomBarWidget: MobileBottomBarWidget | undefined;
    /** @internal Used by the extracted mobile-shell-bottom-bar-controller-* modules. */
    public bottomBarMenuCleanup: (() => void) | undefined;

    /** @internal Used by the extracted mobile-shell-bottom-bar-controller-* modules. */
    public readonly host: MobileShellBottomBarHost;
    /** @internal Used by the extracted mobile-shell-bottom-bar-controller-* modules. */
    public readonly shell: ApplicationShell;
    /** @internal Used by the extracted mobile-shell-bottom-bar-controller-* modules. */
    public readonly statusBar: StatusBarImpl;
    /** @internal Used by the extracted mobile-shell-bottom-bar-controller-* modules. */
    public readonly commands: CommandRegistry;
    /** @internal Used by the extracted mobile-shell-bottom-bar-controller-* modules. */
    public readonly projectsService: MobileProjectsService;
    /** @internal Used by the extracted mobile-shell-bottom-bar-controller-* modules. */
    public readonly projectBootstrap: QaapProjectBootstrapService;
    /** @internal Used by the extracted mobile-shell-bottom-bar-controller-* modules. */
    public readonly mobileMq: MediaQueryList | undefined;

    constructor(options: MobileShellBottomBarControllerOptions) {
        this.host = options.host;
        this.shell = options.shell;
        this.statusBar = options.statusBar;
        this.commands = options.commands;
        this.projectsService = options.projectsService;
        this.projectBootstrap = options.projectBootstrap;
        this.mobileMq = options.mobileMq;
    }

    getBottomBarNode(): HTMLElement | undefined {
        return this.bottomBarWidget?.node;
    }

    /** Bottom panel is visible with at least one widget (matches Projects “open” semantics for the bar). */
    isTerminalBottomPanelOpen(): boolean {
        return this.isMobileBottomTerminalVisible();
    }

    /** Bottom terminal area is shown (may still be mid expand animation). */
    isMobileBottomTerminalVisible(): boolean {
        const bottom = this.shell.bottomPanel;
        return !bottom.isHidden && !bottom.isEmpty;
    }

    getBottomPanelPendingUpdate(): Promise<void> {
        const state = (this.shell as ApplicationShell & { bottomPanelState?: { pendingUpdate: Promise<void> } }).bottomPanelState;
        return state?.pendingUpdate ?? Promise.resolve();
    }

    getBottomAreaSplitPanel(): SplitPanel | undefined {
        const parent = this.shell.mainPanel.parent;
        return parent instanceof SplitPanel ? parent : undefined;
    }

    measureMobileBottomPanelHeightPx(): number | undefined {
        return measureMobileBottomPanelHeightPxExtracted(this);
    }

    resolveMobileBottomSplitSizes(): [number, number] {
        return resolveMobileBottomSplitSizesExtracted(this);
    }

    syncMobileBottomSplit(): void {
        syncMobileBottomSplitExtracted(this);
    }

    async applyMobileBottomPanelMaximizedSize(): Promise<void> {
        return applyMobileBottomPanelMaximizedSizeExtracted(this);
    }

    restoreMobileBottomPanelFromMaximized(): void {
        restoreMobileBottomPanelFromMaximizedExtracted(this);
    }

    getMaximizedOverlayElement(): HTMLElement | undefined {
        return (this.shell as unknown as ShellWithMaximizedOverlay).maximizedElement;
    }

    syncMobileMaximizedOverlayInsets(): void {
        syncMobileMaximizedOverlayInsetsExtracted(this);
    }

    clearMobileMaximizedOverlayInsets(): void {
        clearMobileMaximizedOverlayInsetsExtracted(this);
    }

    updateMobileShellStateClasses(): void {
        this.shell.node.classList.toggle(MOBILE_BOTTOM_OPEN_CLASS, this.shell.isExpanded('bottom'));
    }

    ensureBottomChromeHost(): HTMLElement {
        return ensureBottomChromeHostExtracted(this);
    }

    ensureBottomBarWidget(): MobileBottomBarWidget {
        return ensureBottomBarWidgetExtracted(this);
    }

    pinBottomChromeToBody(): void {
        pinBottomChromeToBodyExtracted(this);
    }

    installBottomChromeTouchScroll(): void {
        installBottomChromeTouchScrollExtracted(this);
    }

    unpinBottomChromeFromBody(): void {
        unpinBottomChromeFromBodyExtracted(this);
    }

    detachBottomBarFromShell(): void {
        detachBottomBarFromShellExtracted(this);
    }

    isWorkHubLandingBottomBar(): boolean {
        return isWorkHubLandingBottomBarExtracted(this);
    }

    isMobileWorkspaceHubPrimaryBottomBar(): boolean {
        return isMobileWorkspaceHubPrimaryBottomBarExtracted(this);
    }

    isMainAgentSurfaceEmpty(): boolean {
        return isMainAgentSurfaceEmptyExtracted(this);
    }

    syncMobileHubPrimaryBottomChrome(): void {
        syncMobileHubPrimaryBottomChromeExtracted(this);
    }

    getWorkHubLandingBottomButtons(): MobileBottomButton[] {
        return getWorkHubLandingBottomButtonsExtracted(this);
    }

    getMobileBottomButtons(): MobileBottomButton[] {
        return getMobileBottomButtonsExtracted(this);
    }

    getMobileIdeHeaderViewButtons(): MobileBottomButton[] {
        return getMobileIdeHeaderViewButtonsExtracted(this);
    }

    isMobileBottomButtonActive(id: MobileBottomButtonId): boolean {
        return isMobileBottomButtonActiveExtracted(this, id);
    }

    canToggleTerminalBottomPanel(): boolean {
        return canToggleTerminalBottomPanelExtracted(this);
    }

    async activateMobileIdeHeaderView(id: MobileBottomButtonId): Promise<void> {
        return activateMobileIdeHeaderViewExtracted(this, id);
    }

    async toggleTerminalBottomPanel(): Promise<void> {
        return toggleTerminalBottomPanelExtracted(this);
    }

    refreshBottomBar(): void {
        refreshBottomBarExtracted(this);
    }

    createMobileBottomButton(def: MobileBottomButton): HTMLButtonElement {
        return createMobileBottomButtonExtracted(this, def);
    }

    installBottomBarLongPress(btn: HTMLButtonElement, def: MobileBottomButton): void {
        installBottomBarLongPressExtracted(this, btn, def);
    }

    async showBottomBarSecondaryMenu(anchor: HTMLElement, def: MobileBottomButton): Promise<void> {
        return showBottomBarSecondaryMenuExtracted(this, anchor, def);
    }

    removeBottomBarSecondaryMenu(): void {
        removeBottomBarSecondaryMenuExtracted(this);
    }

    async getBottomBarSecondaryItems(def: MobileBottomButton): Promise<BottomBarSecondaryItem[]> {
        return getBottomBarSecondaryItemsExtracted(this, def);
    }

    async getProjectsSecondaryItems(): Promise<BottomBarSecondaryItem[]> {
        return getProjectsSecondaryItemsExtracted(this);
    }

    getTerminalSecondaryItems(): BottomBarSecondaryItem[] {
        return getTerminalSecondaryItemsExtracted(this);
    }

    getAgentSecondaryItems(): BottomBarSecondaryItem[] {
        return getAgentSecondaryItemsExtracted(this);
    }

    getPullRequestSecondaryItems(): BottomBarSecondaryItem[] {
        return getPullRequestSecondaryItemsExtracted(this);
    }

    getPreviewSecondaryItems(): BottomBarSecondaryItem[] {
        return getPreviewSecondaryItemsExtracted(this);
    }

    getExploreSecondaryItems(): BottomBarSecondaryItem[] {
        return getExploreSecondaryItemsExtracted(this);
    }

    shouldDismissSheetsForButton(id: MobileBottomButtonId): boolean {
        return shouldDismissSheetsForButtonExtracted(this, id);
    }

    async onMobileBottomButtonClick(def: MobileBottomButton, btn: HTMLButtonElement): Promise<void> {
        return onMobileBottomButtonClickExtracted(this, def, btn);
    }
}
