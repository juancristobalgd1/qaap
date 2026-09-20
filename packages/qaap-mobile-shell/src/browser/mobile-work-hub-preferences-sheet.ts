// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { animationFrame, UnsafeWidgetUtilities, Widget, WidgetManager } from '@theia/core/lib/browser';
import { ThemeService } from '@theia/core/lib/browser/theming';
import { PREFERENCE_NAME_DEFAULT_NOTIFICATION_TYPE } from '@theia/ai-core/lib/common/ai-core-preferences';
import {
    NOTIFICATION_TYPE_OFF,
    NOTIFICATION_TYPE_OS_NOTIFICATION,
} from '@theia/ai-core/lib/common/notification-types';
import { MessageLoop } from '@lumino/messaging';
import { Widget as LuminoWidget } from '@lumino/widgets';
import { PreferencesWidget } from '@theia/preferences/lib/browser/views/preference-widget';
import { PreferencesSearchbarWidget } from '@theia/preferences/lib/browser/views/preference-searchbar-widget';
import {
    qaapAuthUserInitials,
    readQaapAuthUser,
} from '@theia/qaap-adapters/lib/browser/qaap-auth-session';
import {
    fetchQaapBilling,
    type QaapBillingApiResponse,
} from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';
import { isWorkHubTheiaDialogOpen } from '../common/qaap-work-hub-dialog-utils';
import type { QaapAppearanceMode } from '../common/qaap-appearance-mode';
import { QaapAppearanceModeService } from './qaap-appearance-mode-service';
import type {
    MobileWorkHubSessionsSidebar,
    MobileWorkHubSettingsSidebarOptions,
} from './mobile-work-hub-sessions-sidebar';

/** Work Hub AI Features sheet scopes Settings to this search term. */
export const WORK_HUB_AI_FEATURES_PREFERENCES_QUERY = 'ai-features';

const AI_FEATURES_SEARCH_LOCKED_CLASS = 'theia-mod-ai-features-search-locked';
const BYOK_SETTINGS_WIDGET_CLASS = 'theia-mod-byok-settings';
const DEFAULT_WORK_HUB_SETTINGS_SIDEBAR_WIDTH = 262;
const MIN_WORK_HUB_SETTINGS_SIDEBAR_WIDTH = 180;
const MAX_WORK_HUB_SETTINGS_SIDEBAR_WIDTH = 420;
const WORK_HUB_COMPLETION_SOUND_KEY = 'qaap.workHub.settings.completionSound';
const WORK_HUB_TELEMETRY_PREFERENCE = 'telemetry.telemetryLevel';
const WORK_HUB_WORKTREE_MAX_COUNT_KEY = 'qaap.workHub.worktrees.maxCount';
const WORK_HUB_WORKTREE_MAX_SIZE_KEY = 'qaap.workHub.worktrees.maxSizeGb';
const CUSTOM_SETTINGS_SECTIONS = new Set([
    'general',
    'profile',
    'appearance',
    'plan-usage',
    'agents',
    'mcp',
    'skills',
    'worktrees',
    'docs',
]);

const EMBEDDED_AI_SETTINGS_WIDGET_IDS: Readonly<Record<string, string>> = {
    agents: 'qaap-harness-configuration-widget',
    mcp: 'ai-mcp-configuration-container-widget',
    skills: 'ai-skills-configuration-widget',
};

interface WorkHubSettingsSection {
    readonly id: string;
    readonly label: string;
    readonly icon: string;
    readonly query: string;
}

/**
 * Work Hub owns a compact product settings shell, while the IDE keeps the
 * full Theia preferences editor. Queries are deliberately delegated to the
 * existing preferences widget so values, scopes and persistence stay intact.
 */
const WORK_HUB_SETTINGS_SECTIONS: readonly WorkHubSettingsSection[] = [
    { id: 'general', label: nls.localize('qaap/workHubSettings/general', 'General'), icon: 'settings-gear', query: '' },
    { id: 'profile', label: nls.localize('qaap/workHubSettings/profile', 'Profile'), icon: 'account', query: '' },
    { id: 'appearance', label: nls.localize('qaap/workHubSettings/appearance', 'Appearance'), icon: 'symbol-color', query: 'workbench' },
    { id: 'plan-usage', label: nls.localize('qaap/workHubSettings/planUsage', 'Plan & Usage'), icon: 'credit-card', query: '' },
    { id: 'agents', label: nls.localize('qaap/workHubSettings/agents', 'Harness'), icon: 'hubot', query: 'Agents' },
    { id: 'mcp', label: nls.localize('qaap/workHubSettings/mcp', 'MCP'), icon: 'plug', query: 'MCP' },
    { id: 'skills', label: nls.localize('qaap/workHubSettings/skills', 'Skills'), icon: 'lightbulb', query: 'Skills' },
    { id: 'models', label: nls.localize('qaap/workHubSettings/models', 'BYOK'), icon: 'symbol-method', query: 'ai-features' },
    { id: 'worktrees', label: nls.localize('qaap/workHubSettings/worktrees', 'Worktrees'), icon: 'repo', query: '' },
    { id: 'docs', label: nls.localize('qaap/workHubSettings/docs', 'Docs'), icon: 'book', query: '' },
];

export function isWorkHubAiFeaturesPreferencesQuery(query?: string): boolean {
    return typeof query === 'string' && query.trim().toLowerCase() === WORK_HUB_AI_FEATURES_PREFERENCES_QUERY;
}

/** Opens the same Settings widget as the IDE, embedded in the Work Hub overlay. */
export class MobileWorkHubPreferencesSheet {

    readonly node: HTMLElement;
    protected readonly widgetHost: HTMLElement;
    protected readonly customContentHost: HTMLElement;
    protected readonly titleEl: HTMLElement;
    protected readonly settingsSearchInput: HTMLInputElement;
    protected readonly settingsNav: HTMLElement;
    protected readonly settingsSidebar: HTMLElement;
    protected readonly settingsLayout: HTMLElement;
    protected readonly settingsSidebarResizer: HTMLElement;
    protected readonly settingsSidebarCollapseButton: HTMLButtonElement;
    protected readonly settingsSidebarOpenButton: HTMLButtonElement;
    protected visible = false;
    protected settingsSidebarCollapsed = false;
    protected preferencesWidget: PreferencesWidget | undefined;
    protected activeSettingsSectionId = 'general';
    protected widgetHostResizeObserver: ResizeObserver | undefined;
    protected windowResizeListener: (() => void) | undefined;
    /** When set, the embedded search bar stays pinned to this AI Features query. */
    protected lockedAiFeaturesQuery: string | undefined;
    protected searchLockObserver: MutationObserver | undefined;
    protected searchLockListener: ((ev: Event) => void) | undefined;
    protected searchLockTarget: HTMLElement | undefined;
    protected settingsSidebarWidth = DEFAULT_WORK_HUB_SETTINGS_SIDEBAR_WIDTH;
    protected settingsSidebarResizePointerId: number | undefined;
    protected settingsSidebarResizeStartX = 0;
    protected settingsSidebarResizeStartWidth = DEFAULT_WORK_HUB_SETTINGS_SIDEBAR_WIDTH;
    protected planUsageRenderToken = 0;
    protected embeddedSettingsRenderToken = 0;
    protected embeddedSettingsWidget: Widget | undefined;
    protected settingsSidebarController: MobileWorkHubSessionsSidebar | undefined;

    protected readonly resolveWorkHubHost: (() => HTMLElement | undefined) | undefined;
    protected readonly resolveSettingsSidebar: (() => MobileWorkHubSessionsSidebar | undefined) | undefined;
    protected workHubRootWithSettings: HTMLElement | undefined;

    protected readonly onSettingsSidebarResizePointerDown = (ev: PointerEvent): void => {
        if (ev.pointerType === 'mouse' && ev.button !== 0) {
            return;
        }
        const bounds = this.getSettingsSidebarResizeBounds();
        this.settingsSidebarResizePointerId = ev.pointerId;
        this.settingsSidebarResizeStartX = ev.clientX;
        this.settingsSidebarResizeStartWidth = this.settingsSidebar.getBoundingClientRect().width;
        this.settingsSidebarWidth = Math.min(
            bounds.max,
            Math.max(bounds.min, this.settingsSidebarResizeStartWidth),
        );
        this.applySettingsSidebarWidth(this.settingsSidebarWidth, bounds);
        this.settingsSidebarResizer.classList.add('theia-mod-resizing');
        document.body.classList.add('theia-mod-work-hub-settings-resizing');
        document.addEventListener('pointermove', this.onSettingsSidebarResizePointerMove, { passive: false });
        document.addEventListener('pointerup', this.onSettingsSidebarResizePointerUp);
        document.addEventListener('pointercancel', this.onSettingsSidebarResizePointerUp);
        this.settingsSidebarResizer.setPointerCapture?.(ev.pointerId);
        ev.preventDefault();
    };

    protected readonly onSettingsSidebarResizePointerMove = (ev: PointerEvent): void => {
        if (ev.pointerId !== this.settingsSidebarResizePointerId) {
            return;
        }
        const bounds = this.getSettingsSidebarResizeBounds();
        const width = this.settingsSidebarResizeStartWidth + ev.clientX - this.settingsSidebarResizeStartX;
        this.settingsSidebarWidth = Math.min(bounds.max, Math.max(bounds.min, width));
        this.applySettingsSidebarWidth(this.settingsSidebarWidth, bounds);
        this.preferencesWidget && this.scheduleLayoutSync(this.preferencesWidget);
        ev.preventDefault();
    };

    protected readonly onSettingsSidebarResizePointerUp = (ev: PointerEvent): void => {
        if (this.settingsSidebarResizePointerId !== undefined && ev.pointerId !== this.settingsSidebarResizePointerId) {
            return;
        }
        this.stopSettingsSidebarResize();
    };

    protected readonly onSettingsSidebarResizeKeyDown = (ev: KeyboardEvent): void => {
        const bounds = this.getSettingsSidebarResizeBounds();
        const currentWidth = this.settingsSidebar.getBoundingClientRect().width;
        const step = ev.shiftKey ? 32 : 8;
        let width: number | undefined;
        if (ev.key === 'ArrowLeft') {
            width = currentWidth - step;
        } else if (ev.key === 'ArrowRight') {
            width = currentWidth + step;
        } else if (ev.key === 'Home') {
            width = bounds.min;
        } else if (ev.key === 'End') {
            width = bounds.max;
        }
        if (width === undefined) {
            return;
        }
        this.settingsSidebarWidth = Math.min(bounds.max, Math.max(bounds.min, width));
        this.applySettingsSidebarWidth(this.settingsSidebarWidth, bounds);
        this.preferencesWidget && this.scheduleLayoutSync(this.preferencesWidget);
        ev.preventDefault();
    };

    protected readonly onKeyDown = (ev: KeyboardEvent): void => {
        if (ev.key === 'Escape' && this.visible) {
            if (isWorkHubTheiaDialogOpen()) {
                return;
            }
            ev.stopPropagation();
            this.hide();
        }
    };

    constructor(
        protected readonly widgetManager: WidgetManager,
        protected readonly preferenceService?: PreferenceService,
        protected readonly appearanceModeService?: QaapAppearanceModeService,
        protected readonly themeService?: ThemeService,
        protected readonly openBilling?: () => Promise<void>,
        resolveWorkHubHost?: () => HTMLElement | undefined,
        resolveSettingsSidebar?: () => MobileWorkHubSessionsSidebar | undefined,
    ) {
        this.resolveWorkHubHost = resolveWorkHubHost;
        this.resolveSettingsSidebar = resolveSettingsSidebar;
        this.node = document.createElement('div');
        this.node.className = 'theia-mobile-work-hub-preferences';
        this.node.setAttribute('role', 'dialog');
        this.node.setAttribute('aria-modal', 'true');
        this.node.setAttribute('aria-hidden', 'true');
        this.node.hidden = true;

        const backdrop = document.createElement('div');
        backdrop.className = 'theia-mobile-work-hub-preferences-backdrop';
        backdrop.addEventListener('click', () => this.hide());

        const sheet = document.createElement('section');
        sheet.className = 'theia-mobile-work-hub-preferences-sheet';

        const settingsLayout = document.createElement('div');
        settingsLayout.className = 'theia-mobile-work-hub-settings-layout';
        this.settingsLayout = settingsLayout;

        const sidebar = document.createElement('aside');
        sidebar.className = 'theia-mobile-work-hub-settings-sidebar';
        this.settingsSidebar = sidebar;

        const sidebarHeader = document.createElement('div');
        sidebarHeader.className = 'theia-mobile-work-hub-settings-sidebar-header';

        const backBtn = document.createElement('button');
        backBtn.type = 'button';
        backBtn.className = 'theia-mobile-work-hub-settings-back';
        backBtn.title = nls.localize('qaap/mobileProjects/backToProjects', 'Back to projects');
        backBtn.setAttribute('aria-label', backBtn.title);
        backBtn.innerHTML = '<span class="codicon codicon-chevron-left" aria-hidden="true"></span>'
            + `<span>${nls.localize('qaap/mobileProjects/back', 'Back')}</span>`;
        backBtn.addEventListener('click', () => this.hide());

        const collapseSidebarLabel = nls.localize(
            'qaap/workHubSettings/collapseSidebar',
            'Collapse settings sidebar',
        );
        const collapseSidebarButton = document.createElement('button');
        collapseSidebarButton.type = 'button';
        collapseSidebarButton.className = 'theia-mobile-work-hub-settings-sidebar-toggle codicon codicon-layout-sidebar-left-off';
        collapseSidebarButton.title = collapseSidebarLabel;
        collapseSidebarButton.setAttribute('aria-label', collapseSidebarLabel);
        collapseSidebarButton.setAttribute('aria-expanded', 'true');
        collapseSidebarButton.addEventListener('click', () => this.setSettingsSidebarCollapsed(true));
        this.settingsSidebarCollapseButton = collapseSidebarButton;
        sidebarHeader.append(backBtn, collapseSidebarButton);

        const searchLabel = document.createElement('label');
        searchLabel.className = 'theia-mobile-work-hub-settings-search';
        const searchIcon = document.createElement('span');
        searchIcon.className = 'codicon codicon-search';
        searchIcon.setAttribute('aria-hidden', 'true');
        const searchInput = document.createElement('input');
        searchInput.type = 'search';
        searchInput.placeholder = nls.localize('qaap/workHubSettings/searchPlaceholder', 'Search settings');
        searchInput.setAttribute('aria-label', nls.localize('qaap/workHubSettings/searchLabel', 'Search settings'));
        searchInput.addEventListener('input', () => {
            if (searchInput.readOnly) {
                return;
            }
            void this.handleSettingsSearch(searchInput.value);
        });
        this.settingsSearchInput = searchInput;
        searchLabel.append(searchIcon, searchInput);

        const settingsSectionLabel = document.createElement('div');
        settingsSectionLabel.className = 'theia-mobile-work-hub-settings-section-label';
        settingsSectionLabel.textContent = nls.localize('qaap/workHubSettings/sectionLabel', 'Settings');

        const settingsNav = document.createElement('nav');
        settingsNav.className = 'theia-mobile-work-hub-settings-nav';
        settingsNav.setAttribute('aria-label', nls.localize('qaap/workHubSettings/navigationLabel', 'Work Hub settings sections'));
        this.settingsNav = settingsNav;
        for (const section of WORK_HUB_SETTINGS_SECTIONS) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'theia-mobile-work-hub-settings-nav-item';
            item.dataset.qaapSettingsSection = section.id;
            item.title = section.label;
            item.setAttribute('aria-label', section.label);
            item.innerHTML = `<span class="codicon codicon-${section.icon}" aria-hidden="true"></span><span>${section.label}</span>`;
            item.addEventListener('click', () => { void this.selectSettingsSection(section); });
            settingsNav.append(item);
        }

        sidebar.append(sidebarHeader, searchLabel, settingsSectionLabel, settingsNav);

        const sidebarResizer = document.createElement('div');
        sidebarResizer.className = 'theia-mobile-work-hub-settings-sidebar-resizer';
        sidebarResizer.setAttribute('role', 'separator');
        sidebarResizer.setAttribute('aria-orientation', 'vertical');
        sidebarResizer.setAttribute('aria-label', nls.localize(
            'qaap/workHubSettings/resizeSidebar',
            'Resize settings sidebar',
        ));
        sidebarResizer.setAttribute('aria-valuemin', String(MIN_WORK_HUB_SETTINGS_SIDEBAR_WIDTH));
        sidebarResizer.setAttribute('aria-valuemax', String(MAX_WORK_HUB_SETTINGS_SIDEBAR_WIDTH));
        sidebarResizer.tabIndex = 0;
        sidebarResizer.addEventListener('pointerdown', this.onSettingsSidebarResizePointerDown);
        sidebarResizer.addEventListener('keydown', this.onSettingsSidebarResizeKeyDown);
        this.settingsSidebarResizer = sidebarResizer;

        const content = document.createElement('main');
        content.className = 'theia-mobile-work-hub-settings-content';

        const header = document.createElement('header');
        header.className = 'theia-mobile-work-hub-settings-content-header';

        const title = document.createElement('h1');
        title.className = 'theia-mobile-work-hub-preferences-title';
        title.textContent = this.getSettingsSection('general').label;
        this.titleEl = title;

        const openSidebarLabel = nls.localize(
            'qaap/workHubSettings/openSidebar',
            'Open settings sidebar',
        );
        const openSidebarButton = document.createElement('button');
        openSidebarButton.type = 'button';
        openSidebarButton.className = 'theia-mobile-work-hub-settings-sidebar-toggle theia-mobile-work-hub-settings-sidebar-toggle-open codicon codicon-layout-sidebar-left';
        openSidebarButton.title = openSidebarLabel;
        openSidebarButton.setAttribute('aria-label', openSidebarLabel);
        openSidebarButton.setAttribute('aria-expanded', 'false');
        openSidebarButton.hidden = true;
        openSidebarButton.addEventListener('click', () => this.setSettingsSidebarCollapsed(false));
        this.settingsSidebarOpenButton = openSidebarButton;

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'theia-mobile-work-hub-preferences-close codicon codicon-close';
        closeBtn.title = nls.localize('qaap/mobileWorkHubPreferences/close', 'Close');
        closeBtn.setAttribute('aria-label', closeBtn.title);
        closeBtn.addEventListener('click', () => this.hide());

        header.append(openSidebarButton, title, closeBtn);

        this.widgetHost = document.createElement('div');
        this.widgetHost.className = 'theia-mobile-work-hub-preferences-widget-host';

        this.customContentHost = document.createElement('div');
        this.customContentHost.className = 'theia-mobile-work-hub-settings-custom-content';
        this.customContentHost.hidden = true;

        content.append(header, this.customContentHost, this.widgetHost);
        // Settings navigation is owned by the shared Work Hub sidebar used by
        // Chat and Pull Requests. Keep only the content surface in this sheet.
        settingsLayout.append(content);
        sheet.append(settingsLayout);
        this.node.append(backdrop, sheet);
    }

    isVisible(): boolean {
        return this.visible;
    }

    async show(query?: string): Promise<void> {
        const widget = await this.widgetManager.getOrCreateWidget<PreferencesWidget>(PreferencesWidget.ID);
        this.preferencesWidget = widget;
        const workHubHost = this.resolveWorkHubHost?.();
        const mountHost = workHubHost?.isConnected ? workHubHost : document.body;
        if (this.node.parentElement !== mountHost) {
            mountHost.appendChild(this.node);
        }
        const inline = mountHost !== document.body;
        const workHubRoot = mountHost.closest<HTMLElement>('.theia-mobile-projects') ?? undefined;
        if (this.workHubRootWithSettings && this.workHubRootWithSettings !== workHubRoot) {
            this.workHubRootWithSettings.classList.remove('theia-mod-work-hub-settings-active');
        }
        this.workHubRootWithSettings = workHubRoot;
        workHubRoot?.classList.toggle('theia-mod-work-hub-settings-active', inline);
        this.node.classList.toggle('theia-mod-work-hub-inline', inline);
        this.node.setAttribute('aria-modal', inline ? 'false' : 'true');
        this.settingsSidebarCollapsed = false;
        this.settingsLayout.classList.remove('theia-mod-sidebar-collapsed');
        this.settingsSidebarOpenButton.hidden = true;
        this.settingsSidebarController = inline ? this.resolveSettingsSidebar?.() : undefined;
        const aiFeatures = isWorkHubAiFeaturesPreferencesQuery(query);
        const section = this.resolveSettingsSection(query);
        this.activeSettingsSectionId = section.id;
        this.titleEl.textContent = section.label;
        this.settingsSearchInput.value = typeof query === 'string'
            ? query
            : (this.isCustomSettingsSection(section.id) ? '' : section.query);
        this.updateSettingsNavigation();
        this.node.hidden = false;
        this.node.classList.add('theia-mod-visible');
        this.node.setAttribute('aria-hidden', 'false');
        this.visible = true;
        this.settingsSidebarController?.showSettings(this.createSettingsSidebarOptions());
        const renderedSidebarWidth = this.settingsSidebar.getBoundingClientRect().width;
        if (renderedSidebarWidth > 0) {
            this.settingsSidebarWidth = renderedSidebarWidth;
        }
        this.applySettingsSidebarWidth(this.settingsSidebarWidth);
        document.addEventListener('keydown', this.onKeyDown, true);
        this.windowResizeListener = () => {
            const activeWidget = this.embeddedSettingsWidget ?? this.preferencesWidget;
            if (activeWidget) {
                this.scheduleLayoutSync(activeWidget);
            }
        };
        window.addEventListener('resize', this.windowResizeListener, { passive: true });
        this.observeWidgetHostResize(widget, this.widgetHost);
        this.scheduleLayoutSync(widget);
        await animationFrame(2);
        if (this.visible) {
            this.unlockAiFeaturesSearch();
            if (this.isCustomSettingsSection(section.id)) {
                this.showCustomSettingsSection(section.id);
            } else {
                this.showPreferencesSection(widget);
                await this.applyPreferencesQuery(widget, typeof query === 'string' ? query : section.query);
                if (aiFeatures && this.visible) {
                    this.lockAiFeaturesSearch(widget, WORK_HUB_AI_FEATURES_PREFERENCES_QUERY);
                }
            }
        }
        if (this.visible) {
            this.scheduleLayoutSync(widget);
        }
    }

    hide(): void {
        if (!this.visible) {
            return;
        }
        this.stopSettingsSidebarResize();
        if (this.windowResizeListener) {
            window.removeEventListener('resize', this.windowResizeListener);
            this.windowResizeListener = undefined;
        }
        this.unobserveWidgetHostResize();
        const lockedWidget = this.lockedAiFeaturesQuery ? this.preferencesWidget : undefined;
        this.unlockAiFeaturesSearch();
        void (lockedWidget ?? this.preferencesWidget)?.setSearchTerm('');
        this.settingsSearchInput.value = '';
        this.activeSettingsSectionId = 'general';
        this.updateSettingsNavigation();
        this.detachWidget();
        this.detachEmbeddedSettingsWidget();
        this.settingsSidebarController?.hide();
        this.settingsSidebarController = undefined;
        this.customContentHost.classList.remove('theia-mod-embedded-settings');
        this.node.classList.remove('theia-mod-visible');
        this.node.hidden = true;
        this.node.setAttribute('aria-hidden', 'true');
        this.workHubRootWithSettings?.classList.remove('theia-mod-work-hub-settings-active');
        this.workHubRootWithSettings = undefined;
        this.visible = false;
        document.removeEventListener('keydown', this.onKeyDown, true);
    }

    dispose(): void {
        this.unobserveWidgetHostResize();
        this.hide();
        this.node.remove();
    }

    protected attachWidget(widget: PreferencesWidget): void {
        if (!this.widgetHost.isConnected) {
            return;
        }
        if (widget.isAttached && widget.node.parentElement !== this.widgetHost) {
            UnsafeWidgetUtilities.detach(widget);
        }
        if (!widget.isAttached) {
            UnsafeWidgetUtilities.attach(widget, this.widgetHost);
        } else if (widget.node.parentElement !== this.widgetHost) {
            this.widgetHost.appendChild(widget.node);
        }
        widget.node.classList.add('theia-mobile-work-hub-preferences-embed');
        widget.node.classList.toggle(
            BYOK_SETTINGS_WIDGET_CLASS,
            this.activeSettingsSectionId === 'models',
        );
        widget.node.style.flex = '1 1 auto';
        widget.node.style.minHeight = '0';
        widget.node.style.height = '100%';
        widget.node.style.width = '100%';
        if (widget.isHidden) {
            widget.show();
        }
        widget.update();
    }

    protected getSettingsSection(id: string): WorkHubSettingsSection {
        return WORK_HUB_SETTINGS_SECTIONS.find(section => section.id === id)
            ?? WORK_HUB_SETTINGS_SECTIONS[0];
    }

    protected getSettingsSidebarResizeBounds(): { min: number; max: number } {
        const layoutWidth = this.settingsLayout.getBoundingClientRect().width;
        const min = Math.min(
            MIN_WORK_HUB_SETTINGS_SIDEBAR_WIDTH,
            Math.max(150, Math.floor(layoutWidth - 180)),
        );
        const max = Math.max(
            min,
            Math.min(MAX_WORK_HUB_SETTINGS_SIDEBAR_WIDTH, Math.floor(layoutWidth - 140)),
        );
        this.settingsSidebarResizer.setAttribute('aria-valuemin', String(min));
        this.settingsSidebarResizer.setAttribute('aria-valuemax', String(max));
        return { min, max };
    }

    protected applySettingsSidebarWidth(
        width: number,
        bounds = this.getSettingsSidebarResizeBounds(),
    ): void {
        const clampedWidth = Math.min(bounds.max, Math.max(bounds.min, width));
        this.settingsSidebarWidth = clampedWidth;
        this.settingsLayout.style.setProperty(
            '--qaap-work-hub-settings-sidebar-width',
            `${Math.round(clampedWidth)}px`,
        );
        this.settingsSidebarResizer.setAttribute('aria-valuenow', String(Math.round(clampedWidth)));
    }

    protected setSettingsSidebarCollapsed(collapsed: boolean): void {
        this.settingsSidebarCollapsed = collapsed;
        this.settingsLayout.classList.toggle('theia-mod-sidebar-collapsed', collapsed);
        this.settingsSidebar.setAttribute('aria-hidden', String(collapsed));
        this.settingsSidebarCollapseButton.setAttribute('aria-expanded', String(!collapsed));
        this.settingsSidebarOpenButton.setAttribute('aria-expanded', String(!collapsed));
        this.settingsSidebarCollapseButton.hidden = collapsed;
        this.settingsSidebarOpenButton.hidden = !collapsed;
        if (collapsed) {
            this.settingsSidebarController?.hide();
        } else {
            this.settingsSidebarController?.showSettings(this.createSettingsSidebarOptions());
        }
        if (collapsed) {
            this.stopSettingsSidebarResize();
            this.settingsSidebarOpenButton.focus();
        } else {
            this.settingsSidebarCollapseButton.focus();
        }
        if (this.visible && this.preferencesWidget) {
            this.scheduleLayoutSync(this.preferencesWidget);
        }
    }

    protected createSettingsSidebarOptions(): MobileWorkHubSettingsSidebarOptions {
        return {
            sections: WORK_HUB_SETTINGS_SECTIONS,
            activeSectionId: () => this.activeSettingsSectionId,
            searchValue: () => this.settingsSearchInput.value,
            searchReadOnly: () => this.settingsSearchInput.readOnly,
            onBack: () => {
                // Back exits Settings to the parent Work Hub sidebar. Keep a reference before
                // hide() clears the controller and restores the normal sidebar mode afterwards.
                const sidebar = this.settingsSidebarController;
                this.hide();
                if (sidebar) {
                    sidebar.showSessions();
                    sidebar.show();
                }
            },
            onClose: () => this.setSettingsSidebarCollapsed(true),
            onSectionSelected: sectionId => {
                void this.selectSettingsSection(this.getSettingsSection(sectionId));
            },
            onSearch: query => {
                this.settingsSearchInput.value = query;
                void this.handleSettingsSearch(query);
            },
        };
    }

    protected stopSettingsSidebarResize(): void {
        if (this.settingsSidebarResizePointerId !== undefined
            && this.settingsSidebarResizer.hasPointerCapture(this.settingsSidebarResizePointerId)) {
            this.settingsSidebarResizer.releasePointerCapture(this.settingsSidebarResizePointerId);
        }
        this.settingsSidebarResizePointerId = undefined;
        this.settingsSidebarResizer.classList.remove('theia-mod-resizing');
        document.body.classList.remove('theia-mod-work-hub-settings-resizing');
        document.removeEventListener('pointermove', this.onSettingsSidebarResizePointerMove);
        document.removeEventListener('pointerup', this.onSettingsSidebarResizePointerUp);
        document.removeEventListener('pointercancel', this.onSettingsSidebarResizePointerUp);
    }

    protected resolveSettingsSection(query?: string): WorkHubSettingsSection {
        if (isWorkHubAiFeaturesPreferencesQuery(query)) {
            return this.getSettingsSection('models');
        }
        if (typeof query === 'string' && query.trim()) {
            return {
                id: 'search',
                label: nls.localize('qaap/workHubSettings/searchResults', 'Search results'),
                icon: 'search',
                query: query.trim(),
            };
        }
        return this.getSettingsSection('general');
    }

    protected updateSettingsNavigation(): void {
        for (const item of this.settingsNav.querySelectorAll<HTMLButtonElement>('[data-qaap-settings-section]')) {
            const selected = item.dataset.qaapSettingsSection === this.activeSettingsSectionId;
            item.classList.toggle('theia-mod-selected', selected);
            item.setAttribute('aria-current', selected ? 'page' : 'false');
        }
    }

    protected async selectSettingsSection(section: WorkHubSettingsSection): Promise<void> {
        this.unlockAiFeaturesSearch();
        this.activeSettingsSectionId = section.id;
        this.titleEl.textContent = section.label;
        this.settingsSearchInput.value = this.isCustomSettingsSection(section.id) ? '' : section.query;
        this.updateSettingsNavigation();
        if (this.visible && this.preferencesWidget) {
            if (this.isCustomSettingsSection(section.id)) {
                this.showCustomSettingsSection(section.id);
            } else {
                this.showPreferencesSection(this.preferencesWidget);
                await this.applyPreferencesQuery(this.preferencesWidget, section.query);
            }
        }
    }

    protected isCustomSettingsSection(sectionId: string): boolean {
        return CUSTOM_SETTINGS_SECTIONS.has(sectionId);
    }

    protected showPreferencesSection(widget: PreferencesWidget): void {
        this.detachEmbeddedSettingsWidget();
        this.customContentHost.hidden = true;
        this.customContentHost.classList.remove('theia-mod-embedded-settings');
        this.widgetHost.hidden = false;
        this.attachWidget(widget);
        this.observeWidgetHostResize(widget, this.widgetHost);
    }

    protected showCustomSettingsSection(sectionId: string): void {
        this.detachWidget();
        this.detachEmbeddedSettingsWidget();
        this.widgetHost.hidden = true;
        this.customContentHost.hidden = false;
        const embeddedWidgetId = EMBEDDED_AI_SETTINGS_WIDGET_IDS[sectionId];
        this.customContentHost.classList.toggle('theia-mod-embedded-settings', !!embeddedWidgetId);
        if (embeddedWidgetId) {
            void this.showEmbeddedSettingsSection(sectionId, embeddedWidgetId);
            return;
        }
        this.renderCustomSettingsSection(sectionId);
    }

    protected async showEmbeddedSettingsSection(sectionId: string, widgetId: string): Promise<void> {
        const token = ++this.embeddedSettingsRenderToken;
        const panel = this.createCustomPanel();
        panel.classList.add('theia-mobile-work-hub-settings-embedded-panel');
        this.customContentHost.replaceChildren(panel);
        try {
            const widget = await this.widgetManager.getOrCreateWidget<Widget>(widgetId, {
                id: `qaap-work-hub-settings-${sectionId}`,
            });
            if (!this.visible || token !== this.embeddedSettingsRenderToken
                || this.activeSettingsSectionId !== sectionId) {
                return;
            }
            this.embeddedSettingsWidget = widget;
            if (widget.isAttached) {
                UnsafeWidgetUtilities.detach(widget);
            }
            UnsafeWidgetUtilities.attach(widget, panel);
            widget.node.classList.add('theia-mobile-work-hub-settings-embedded-widget');
            widget.node.style.flex = '1 1 auto';
            widget.node.style.minHeight = '0';
            widget.node.style.height = '100%';
            widget.node.style.width = '100%';
            if (widget.isHidden) {
                widget.show();
            }
            widget.update();
            this.observeWidgetHostResize(widget, this.customContentHost);
            this.scheduleLayoutSync(widget);
        } catch {
            if (token === this.embeddedSettingsRenderToken) {
                this.customContentHost.replaceChildren();
            }
        }
    }

    protected renderCustomSettingsSection(sectionId: string): void {
        this.customContentHost.replaceChildren();
        switch (sectionId) {
            case 'profile':
                this.renderProfileSection();
                break;
            case 'appearance':
                this.renderAppearanceSection();
                break;
            case 'plan-usage':
                void this.renderPlanUsageSection();
                break;
            case 'agents':
            case 'mcp':
            case 'skills':
                break;
            case 'worktrees':
                this.renderWorktreesSection();
                break;
            case 'docs':
                // Docs is intentionally reserved for a future Work Hub surface.
                break;
            case 'general':
            default:
                this.renderGeneralSection();
                break;
        }
    }

    protected async handleSettingsSearch(value: string): Promise<void> {
        const query = value.trim();
        if (!query) {
            await this.selectSettingsSection(this.getSettingsSection('general'));
            return;
        }
        this.unlockAiFeaturesSearch();
        this.activeSettingsSectionId = 'search';
        this.titleEl.textContent = nls.localize('qaap/workHubSettings/searchResults', 'Search results');
        this.updateSettingsNavigation();
        if (this.visible && this.preferencesWidget) {
            this.showPreferencesSection(this.preferencesWidget);
            await this.applyWorkHubSearch(query);
        }
    }

    protected async applyWorkHubSearch(value: string): Promise<void> {
        if (!this.visible || !this.preferencesWidget) {
            return;
        }
        await this.preferenceService?.ready;
        await this.preferencesWidget.setSearchTerm(value);
        this.scheduleLayoutSync(this.preferencesWidget);
    }

    protected renderGeneralSection(): void {
        const panel = this.createCustomPanel();
        panel.append(this.createCustomHeading(
            nls.localize('qaap/workHubSettings/general/notifications', 'Notifications'),
        ));

        const notificationsCard = this.createSettingsCard();
        const systemNotifications = this.preferenceService?.get<string>(
            PREFERENCE_NAME_DEFAULT_NOTIFICATION_TYPE,
            NOTIFICATION_TYPE_OFF,
        ) === NOTIFICATION_TYPE_OS_NOTIFICATION;
        notificationsCard.append(this.createSettingsRow(
            nls.localize('qaap/workHubSettings/general/systemNotifications', 'System Notifications'),
            nls.localize(
                'qaap/workHubSettings/general/systemNotificationsDescription',
                'Show a notification when an agent completes or needs your attention.',
            ),
            this.createToggle(systemNotifications, nls.localize(
                'qaap/workHubSettings/general/systemNotificationsLabel',
                'System notifications',
            ), checked => {
                void this.preferenceService?.set(
                    PREFERENCE_NAME_DEFAULT_NOTIFICATION_TYPE,
                    checked ? NOTIFICATION_TYPE_OS_NOTIFICATION : NOTIFICATION_TYPE_OFF,
                );
            }),
        ));
        const completionSound = this.readLocalBoolean(WORK_HUB_COMPLETION_SOUND_KEY, false);
        notificationsCard.append(this.createSettingsRow(
            nls.localize('qaap/workHubSettings/general/completionSound', 'Completion Sound'),
            nls.localize(
                'qaap/workHubSettings/general/completionSoundDescription',
                'Play a sound when agents finish or need your attention.',
            ),
            this.createToggle(completionSound, nls.localize(
                'qaap/workHubSettings/general/completionSoundLabel',
                'Completion sound',
            ), checked => this.writeLocalBoolean(WORK_HUB_COMPLETION_SOUND_KEY, checked)),
        ));
        panel.append(notificationsCard);

        panel.append(this.createCustomHeading(
            nls.localize('qaap/workHubSettings/general/privacy', 'Privacy'),
        ));
        const privacyCard = this.createSettingsCard();
        const telemetryLevel = this.preferenceService?.get<string>(WORK_HUB_TELEMETRY_PREFERENCE, 'off');
        const dataSharing = telemetryLevel !== 'off';
        privacyCard.append(this.createSettingsRow(
            nls.localize('qaap/workHubSettings/general/dataSharing', 'Data Sharing'),
            nls.localize(
                'qaap/workHubSettings/general/dataSharingDescription',
                'Share anonymous product usage data to help improve Qaap.',
            ),
            this.createToggle(dataSharing, nls.localize(
                'qaap/workHubSettings/general/dataSharingLabel',
                'Data sharing',
            ), checked => {
                void this.preferenceService?.set(WORK_HUB_TELEMETRY_PREFERENCE, checked ? 'all' : 'off');
            }),
        ));
        panel.append(privacyCard);
        this.customContentHost.append(panel);
    }

    protected renderProfileSection(): void {
        const panel = this.createCustomPanel();
        const user = readQaapAuthUser();
        const card = this.createSettingsCard('theia-mobile-work-hub-settings-profile-card');
        const identity = document.createElement('div');
        identity.className = 'theia-mobile-work-hub-settings-profile-identity';

        const avatar = document.createElement('div');
        avatar.className = 'theia-mobile-work-hub-settings-profile-avatar';
        if (user?.avatarUrl) {
            const image = document.createElement('img');
            image.src = user.avatarUrl;
            image.alt = '';
            image.draggable = false;
            image.referrerPolicy = 'no-referrer';
            image.decoding = 'async';
            avatar.append(image);
        } else {
            avatar.textContent = user ? qaapAuthUserInitials(user) : '?';
        }

        const details = document.createElement('div');
        details.className = 'theia-mobile-work-hub-settings-profile-details';
        const name = document.createElement('strong');
        name.textContent = user?.name || user?.login || nls.localize(
            'qaap/workHubSettings/profile/notSignedIn',
            'Not signed in',
        );
        const login = document.createElement('span');
        login.textContent = user?.login ? `@${user.login}` : nls.localize(
            'qaap/workHubSettings/profile/connectAccount',
            'Connect a GitHub account to sync your profile.',
        );
        details.append(name, login);
        identity.append(avatar, details);

        const provider = document.createElement('span');
        provider.className = 'theia-mobile-work-hub-settings-profile-provider';
        provider.textContent = user?.provider === 'gitlab'
            ? 'GitLab'
            : nls.localize('qaap/workHubSettings/profile/github', 'GitHub');
        card.append(identity, provider);
        panel.append(card);
        this.customContentHost.append(panel);
    }

    protected renderAppearanceSection(): void {
        const panel = this.createCustomPanel();
        panel.append(this.createCustomHeading(
            nls.localize('qaap/workHubSettings/appearance/theme', 'Theme'),
        ));

        const modeCard = this.createSettingsCard('theia-mobile-work-hub-settings-mode-card');
        const modeDescription = document.createElement('p');
        modeDescription.className = 'theia-mobile-work-hub-settings-description';
        modeDescription.textContent = nls.localize(
            'qaap/workHubSettings/appearance/modeDescription',
            'Choose how Qaap follows your preferred light and dark themes.',
        );
        const modeGroup = document.createElement('div');
        modeGroup.className = 'theia-mobile-work-hub-settings-mode-group';
        modeGroup.setAttribute('role', 'radiogroup');
        modeGroup.setAttribute('aria-label', nls.localize(
            'qaap/workHubSettings/appearance/modeLabel',
            'Color mode',
        ));
        const currentMode = this.appearanceModeService?.getMode() ?? 'system';
        const modes: ReadonlyArray<{ readonly id: QaapAppearanceMode; readonly label: string }> = [
            { id: 'system', label: nls.localize('qaap/workHubSettings/appearance/system', 'System') },
            { id: 'light', label: nls.localize('qaap/workHubSettings/appearance/light', 'Light') },
            { id: 'dark', label: nls.localize('qaap/workHubSettings/appearance/dark', 'Dark') },
        ];
        for (const mode of modes) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'theia-mobile-work-hub-settings-mode-button';
            button.textContent = mode.label;
            button.setAttribute('role', 'radio');
            button.setAttribute('aria-checked', String(currentMode === mode.id));
            button.classList.toggle('theia-mod-selected', currentMode === mode.id);
            button.addEventListener('click', () => {
                this.appearanceModeService?.setMode(mode.id);
                this.renderCustomSettingsSection('appearance');
            });
            modeGroup.append(button);
        }
        modeCard.append(modeDescription, modeGroup);
        panel.append(modeCard);

        const themeCard = this.createSettingsCard('theia-mobile-work-hub-settings-theme-card');
        const themeLabel = document.createElement('label');
        themeLabel.className = 'theia-mobile-work-hub-settings-field-label';
        themeLabel.textContent = nls.localize('qaap/workHubSettings/appearance/colorTheme', 'Color theme');
        const themeSelect = document.createElement('select');
        themeSelect.className = 'theia-mobile-work-hub-settings-select';
        themeSelect.setAttribute('aria-label', themeLabel.textContent);
        const themes = this.themeService?.getThemes() ?? [];
        const currentThemeId = this.themeService?.getCurrentTheme()?.id;
        for (const theme of themes) {
            const option = document.createElement('option');
            option.value = theme.id;
            option.textContent = theme.label;
            option.selected = theme.id === currentThemeId;
            themeSelect.append(option);
        }
        themeSelect.addEventListener('change', () => {
            if (themeSelect.value) {
                this.themeService?.setCurrentTheme(themeSelect.value);
                this.renderCustomSettingsSection('appearance');
            }
        });
        themeCard.append(themeLabel, themeSelect);
        panel.append(themeCard);
        this.customContentHost.append(panel);
    }

    protected renderWorktreesSection(): void {
        const panel = this.createCustomPanel();
        panel.append(this.createCustomHeading(
            nls.localize('qaap/workHubSettings/worktrees/cleanup', 'Cleanup'),
        ));

        const description = document.createElement('p');
        description.className = 'theia-mobile-work-hub-settings-description';
        description.textContent = nls.localize(
            'qaap/workHubSettings/worktrees/cleanupDescription',
            'Qaap periodically removes old, clean worktrees to keep workspace storage healthy. Active or modified worktrees are always preserved.',
        );
        panel.append(description);

        const card = this.createSettingsCard();
        const maxCount = this.readLocalNumber(WORK_HUB_WORKTREE_MAX_COUNT_KEY, 25);
        const maxSizeGb = this.readLocalNumber(WORK_HUB_WORKTREE_MAX_SIZE_KEY, 50);
        card.append(
            this.createSettingsRow(
                nls.localize('qaap/workHubSettings/worktrees/maxCount', 'Max Worktrees'),
                nls.localize(
                    'qaap/workHubSettings/worktrees/maxCountDescription',
                    'Maximum number of Qaap-managed worktrees to retain for this account. Older clean worktrees are removed first.',
                ),
                this.createNumberStepper(
                    maxCount,
                    1,
                    100,
                    nls.localize('qaap/workHubSettings/worktrees/maxCountLabel', 'Maximum worktrees'),
                    value => this.writeLocalNumber(WORK_HUB_WORKTREE_MAX_COUNT_KEY, value),
                ),
            ),
            this.createSettingsRow(
                nls.localize('qaap/workHubSettings/worktrees/maxSize', 'Max Total Size (GB)'),
                nls.localize(
                    'qaap/workHubSettings/worktrees/maxSizeDescription',
                    'Maximum storage budget for Qaap-managed worktrees. Set to 0 to disable the size limit.',
                ),
                this.createNumberStepper(
                    maxSizeGb,
                    0,
                    500,
                    nls.localize('qaap/workHubSettings/worktrees/maxSizeLabel', 'Maximum worktree storage in gigabytes'),
                    value => this.writeLocalNumber(WORK_HUB_WORKTREE_MAX_SIZE_KEY, value),
                ),
            ),
        );
        panel.append(card);
        this.customContentHost.append(panel);
    }

    protected async renderPlanUsageSection(): Promise<void> {
        const token = ++this.planUsageRenderToken;
        const panel = this.createCustomPanel();
        const loading = document.createElement('p');
        loading.className = 'theia-mobile-work-hub-settings-status';
        loading.textContent = nls.localize('qaap/workHubSettings/planUsage/loading', 'Loading plan and usage…');
        panel.append(loading);
        this.customContentHost.append(panel);

        let data: QaapBillingApiResponse | undefined;
        try {
            data = await fetchQaapBilling();
        } catch {
            data = undefined;
        }
        if (!this.visible || token !== this.planUsageRenderToken || this.activeSettingsSectionId !== 'plan-usage') {
            return;
        }
        panel.replaceChildren();
        if (!data) {
            this.renderPlanUsageFallback(panel);
            return;
        }
        this.renderPlanUsageData(panel, data);
    }

    protected renderPlanUsageFallback(panel: HTMLElement): void {
        panel.append(this.createCustomHeading(
            nls.localize('qaap/workHubSettings/planUsage/currentPlan', 'Current plan'),
        ));
        const card = this.createSettingsCard();
        const title = document.createElement('h3');
        title.textContent = nls.localize('qaap/workHubSettings/planUsage/starter', 'Starter');
        const description = document.createElement('p');
        description.textContent = nls.localize(
            'qaap/workHubSettings/planUsage/unavailable',
            'Usage details will appear here when your Qaap account is connected.',
        );
        card.append(title, description);
        panel.append(card);
        this.appendBillingButton(panel);
    }

    protected renderPlanUsageData(panel: HTMLElement, data: QaapBillingApiResponse): void {
        const currentPlan = data.catalog.plans.find(plan => plan.id === data.entitlements.planId);
        const currentPlanName = this.planName(data.entitlements.planId);
        panel.append(this.createCustomHeading(
            nls.localize('qaap/workHubSettings/planUsage/currentPlan', 'Current plan'),
        ));
        const planCard = this.createSettingsCard('theia-mobile-work-hub-settings-plan-card');
        const planMeta = document.createElement('span');
        planMeta.className = 'theia-mobile-work-hub-settings-eyebrow';
        planMeta.textContent = nls.localize('qaap/workHubSettings/planUsage/active', 'Active plan');
        const planTitle = document.createElement('h3');
        planTitle.textContent = currentPlanName;
        const planDescription = document.createElement('p');
        planDescription.textContent = currentPlan
            ? this.planSummary(currentPlan)
            : nls.localize('qaap/workHubSettings/planUsage/qaapPlan', 'Qaap agent workspace plan');
        planCard.append(planMeta, planTitle, planDescription);
        panel.append(planCard);

        panel.append(this.createCustomHeading(
            nls.localize('qaap/workHubSettings/planUsage/usage', 'Usage'),
        ));
        const usageCard = this.createSettingsCard();
        usageCard.append(
            this.createUsageMeter(
                nls.localize('qaap/workHubSettings/planUsage/runtime', 'Agent runtime'),
                data.entitlements.runtimeHoursRemaining,
                data.entitlements.includedRuntimeHoursPerMonth,
                data.entitlements.runtimeFairUse
                    ? nls.localize('qaap/workHubSettings/planUsage/fairUse', 'Fair use')
                    : nls.localize('qaap/workHubSettings/planUsage/hoursRemaining', '{0} hours remaining', this.formatNumber(data.entitlements.runtimeHoursRemaining)),
                data.entitlements.runtimeFairUse ? undefined : data.entitlements.runtimeUsageRatio,
            ),
            this.createUsageMeter(
                nls.localize('qaap/workHubSettings/planUsage/credits', 'Hosted model credits'),
                data.entitlements.creditsRemaining,
                data.entitlements.includedCreditsPerMonth,
                nls.localize('qaap/workHubSettings/planUsage/creditsRemaining', '{0} credits remaining', this.formatNumber(data.entitlements.creditsRemaining)),
            ),
        );
        panel.append(usageCard);
        this.appendBillingButton(panel);
    }

    protected appendBillingButton(panel: HTMLElement): void {
        if (!this.openBilling) {
            return;
        }
        const actions = document.createElement('div');
        actions.className = 'theia-mobile-work-hub-settings-actions';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'theia-mobile-work-hub-settings-primary-button';
        button.textContent = nls.localize('qaap/workHubSettings/planUsage/manage', 'Manage plan');
        button.addEventListener('click', () => {
            this.hide();
            void this.openBilling?.();
        });
        actions.append(button);
        panel.append(actions);
    }

    protected createCustomPanel(): HTMLElement {
        const panel = document.createElement('div');
        panel.className = 'theia-mobile-work-hub-settings-custom-panel';
        return panel;
    }

    protected createCustomHeading(text: string): HTMLElement {
        const heading = document.createElement('h2');
        heading.className = 'theia-mobile-work-hub-settings-custom-heading';
        heading.textContent = text;
        return heading;
    }

    protected createSettingsCard(className = ''): HTMLElement {
        const card = document.createElement('div');
        card.className = `theia-mobile-work-hub-settings-card${className ? ` ${className}` : ''}`;
        return card;
    }

    protected createSettingsRow(title: string, description: string, control: HTMLElement): HTMLElement {
        const row = document.createElement('div');
        row.className = 'theia-mobile-work-hub-settings-row';
        const copy = document.createElement('div');
        copy.className = 'theia-mobile-work-hub-settings-row-copy';
        const titleEl = document.createElement('strong');
        titleEl.textContent = title;
        const descriptionEl = document.createElement('span');
        descriptionEl.textContent = description;
        copy.append(titleEl, descriptionEl);
        row.append(copy, control);
        return row;
    }

    protected createToggle(checked: boolean, label: string, onChange: (checked: boolean) => void): HTMLElement {
        const wrapper = document.createElement('label');
        wrapper.className = 'theia-mobile-work-hub-settings-toggle';
        wrapper.title = label;
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = checked;
        input.setAttribute('aria-label', label);
        const track = document.createElement('span');
        track.className = 'theia-mobile-work-hub-settings-toggle-track';
        track.setAttribute('aria-hidden', 'true');
        input.addEventListener('change', () => onChange(input.checked));
        wrapper.append(input, track);
        return wrapper;
    }

    protected createNumberStepper(
        value: number,
        min: number,
        max: number,
        label: string,
        onChange: (value: number) => void,
    ): HTMLElement {
        const stepper = document.createElement('div');
        stepper.className = 'theia-mobile-work-hub-settings-stepper';
        stepper.setAttribute('role', 'group');
        stepper.setAttribute('aria-label', label);
        const input = document.createElement('input');
        input.type = 'number';
        input.min = String(min);
        input.max = String(max);
        input.step = '1';
        input.value = String(Math.min(max, Math.max(min, Math.round(value))));
        input.setAttribute('aria-label', label);
        const update = (): void => {
            const next = Math.min(max, Math.max(min, Math.round(Number(input.value) || min)));
            input.value = String(next);
            onChange(next);
        };
        const decrement = this.createStepperButton(
            '−',
            nls.localize('qaap/workHubSettings/worktrees/decrease', 'Decrease value'),
            () => {
                input.value = String(Math.max(min, Number(input.value) - 1));
                update();
            },
        );
        const increment = this.createStepperButton(
            '+',
            nls.localize('qaap/workHubSettings/worktrees/increase', 'Increase value'),
            () => {
                input.value = String(Math.min(max, Number(input.value) + 1));
                update();
            },
        );
        input.addEventListener('change', update);
        input.addEventListener('blur', update);
        stepper.append(decrement, input, increment);
        return stepper;
    }

    protected createStepperButton(text: string, label: string, onClick: () => void): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'theia-mobile-work-hub-settings-stepper-button';
        button.textContent = text;
        button.title = label;
        button.setAttribute('aria-label', label);
        button.addEventListener('click', onClick);
        return button;
    }

    protected createUsageMeter(
        title: string,
        remaining: number,
        total: number,
        caption: string,
        usageRatio?: number,
    ): HTMLElement {
        const meter = document.createElement('div');
        meter.className = 'theia-mobile-work-hub-settings-usage-meter';
        const header = document.createElement('div');
        header.className = 'theia-mobile-work-hub-settings-usage-header';
        const titleEl = document.createElement('strong');
        titleEl.textContent = title;
        const value = document.createElement('span');
        value.textContent = caption;
        header.append(titleEl, value);
        const progress = document.createElement('div');
        progress.className = 'theia-mobile-work-hub-settings-progress';
        const fill = document.createElement('span');
        const ratio = usageRatio ?? (total > 0 ? 1 - remaining / total : 0);
        fill.style.width = `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`;
        progress.append(fill);
        meter.append(header, progress);
        return meter;
    }

    protected planName(planId: string): string {
        switch (planId) {
            case 'pro':
                return nls.localize('qaap/workHubSettings/planUsage/pro', 'Pro');
            case 'team':
                return nls.localize('qaap/workHubSettings/planUsage/team', 'Team');
            default:
                return nls.localize('qaap/workHubSettings/planUsage/starter', 'Starter');
        }
    }

    protected planSummary(plan: QaapBillingApiResponse['catalog']['plans'][number]): string {
        if (plan.runtimeFairUse) {
            return nls.localize('qaap/workHubSettings/planUsage/fairUseSummary', 'Fair-use agent runtime with your own model keys.');
        }
        return nls.localize(
            'qaap/workHubSettings/planUsage/planSummary',
            '{0} agent hours/month · {1} GB workspace storage',
            this.formatNumber(plan.includedRuntimeHoursPerMonth),
            this.formatNumber(plan.storageGb),
        );
    }

    protected formatNumber(value: number): string {
        return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
    }

    protected readLocalBoolean(key: string, fallback: boolean): boolean {
        try {
            const value = window.localStorage.getItem(key);
            return value === null ? fallback : value === '1';
        } catch {
            return fallback;
        }
    }

    protected writeLocalBoolean(key: string, value: boolean): void {
        try {
            window.localStorage.setItem(key, value ? '1' : '0');
        } catch {
            // Private browsing / quota errors should not block the settings UI.
        }
    }

    protected readLocalNumber(key: string, fallback: number): number {
        try {
            const storedValue = window.localStorage.getItem(key);
            if (storedValue === null) {
                return fallback;
            }
            const value = Number(storedValue);
            return Number.isFinite(value) ? value : fallback;
        } catch {
            return fallback;
        }
    }

    protected writeLocalNumber(key: string, value: number): void {
        try {
            window.localStorage.setItem(key, String(value));
        } catch {
            // Private browsing / quota errors should not block the settings UI.
        }
    }

    protected detachWidget(): void {
        const widget = this.preferencesWidget;
        if (!widget) {
            return;
        }
        this.clearMobilePreferencesEditorHeight(widget);
        widget.node.classList.remove('theia-mobile-work-hub-preferences-embed');
        widget.node.classList.remove(BYOK_SETTINGS_WIDGET_CLASS);
        if (widget.isAttached) {
            UnsafeWidgetUtilities.detach(widget);
        }
    }

    protected detachEmbeddedSettingsWidget(): void {
        this.embeddedSettingsRenderToken++;
        const widget = this.embeddedSettingsWidget;
        this.embeddedSettingsWidget = undefined;
        if (!widget) {
            return;
        }
        widget.node.classList.remove('theia-mobile-work-hub-settings-embedded-widget');
        widget.node.style.removeProperty('flex');
        widget.node.style.removeProperty('min-height');
        widget.node.style.removeProperty('height');
        widget.node.style.removeProperty('width');
        if (widget.isAttached) {
            UnsafeWidgetUtilities.detach(widget);
        }
    }

    protected scheduleLayoutSync(widget: Widget, attempt = 0): void {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                this.syncWidgetLayout(widget, attempt);
            });
        });
    }

    protected syncWidgetLayout(widget: Widget, attempt = 0): void {
        if (!this.visible || !this.widgetHost.isConnected) {
            return;
        }
        const host = widget === this.embeddedSettingsWidget
            ? this.customContentHost
            : this.widgetHost;
        const rect = host.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            if (attempt < 16) {
                this.scheduleLayoutSync(widget, attempt + 1);
            }
            return;
        }
        MessageLoop.sendMessage(widget, new LuminoWidget.ResizeMessage(rect.width, rect.height));
        if (widget instanceof PreferencesWidget) {
            this.applyMobilePreferencesEditorHeight(widget, rect);
        }
    }

    /** Lumino Panel does not always stretch the editor; fill remaining sheet height for scroll. */
    protected applyMobilePreferencesEditorHeight(widget: PreferencesWidget, hostRect: DOMRectReadOnly): void {
        const editorNode = widget.node.querySelector<HTMLElement>('.preferences-editor-widget');
        if (!editorNode) {
            return;
        }
        editorNode.classList.add('full-pane');
        const editorTop = editorNode.getBoundingClientRect().top - hostRect.top;
        const editorHeight = Math.max(200, Math.floor(hostRect.height - editorTop));
        editorNode.style.height = `${editorHeight}px`;
        editorNode.style.minHeight = `${editorHeight}px`;
        editorNode.style.maxHeight = `${editorHeight}px`;
        editorNode.style.boxSizing = 'border-box';
    }

    protected clearMobilePreferencesEditorHeight(widget: PreferencesWidget): void {
        const editorNode = widget.node.querySelector<HTMLElement>('.preferences-editor-widget');
        editorNode?.style.removeProperty('height');
        editorNode?.style.removeProperty('min-height');
        editorNode?.style.removeProperty('max-height');
        editorNode?.style.removeProperty('box-sizing');
    }

    protected observeWidgetHostResize(widget: Widget, host: HTMLElement): void {
        this.unobserveWidgetHostResize();
        if (typeof ResizeObserver === 'undefined') {
            return;
        }
        this.widgetHostResizeObserver = new ResizeObserver(() => {
            this.scheduleLayoutSync(widget);
        });
        this.widgetHostResizeObserver.observe(host);
    }

    protected unobserveWidgetHostResize(): void {
        this.widgetHostResizeObserver?.disconnect();
        this.widgetHostResizeObserver = undefined;
    }

    /** Match `CommonCommands.OPEN_PREFERENCES` once the embedded widget has rendered. */
    protected async applyPreferencesQuery(widget: PreferencesWidget, query: string): Promise<void> {
        await this.preferenceService?.ready;
        await animationFrame(2);
        if (!this.visible) {
            return;
        }
        const searchId = PreferencesSearchbarWidget.SEARCHBAR_ID;
        for (let attempt = 0; attempt < 40; attempt++) {
            if (!this.visible) {
                return;
            }
            const searchInput = widget.node.querySelector<HTMLInputElement>(`#${CSS.escape(searchId)}`);
            if (searchInput) {
                await this.commitPreferencesSearch(widget, searchInput, query);
                if (await this.waitForPreferencesContent(widget)) {
                    this.scheduleLayoutSync(widget);
                    return;
                }
            }
            await animationFrame();
        }
        await this.commitPreferencesSearch(widget, undefined, query);
        await this.waitForPreferencesContent(widget);
        this.scheduleLayoutSync(widget);
    }

    protected async commitPreferencesSearch(
        widget: PreferencesWidget,
        searchInput: HTMLInputElement | undefined,
        query: string,
    ): Promise<void> {
        const scopedInput = searchInput
            ?? widget.node.querySelector<HTMLInputElement>(`#${CSS.escape(PreferencesSearchbarWidget.SEARCHBAR_ID)}`);
        if (scopedInput && scopedInput.value === query) {
            scopedInput.value = '';
            await widget.setSearchTerm('');
            await animationFrame();
        }
        await widget.setSearchTerm(query);
        if (scopedInput && scopedInput.value !== query) {
            scopedInput.value = query;
            scopedInput.dispatchEvent(new Event('input', { bubbles: true }));
            scopedInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    protected async waitForPreferencesContent(widget: PreferencesWidget): Promise<boolean> {
        for (let attempt = 0; attempt < 30; attempt++) {
            if (!this.visible) {
                return false;
            }
            const editor = widget.node.querySelector('.preferences-editor-widget');
            const hasPreferences = !!editor?.querySelector('.single-pref, .settings-section-category-title');
            const hasNoResults = widget.node.querySelector('.settings-main.no-results') !== null;
            if (hasPreferences || hasNoResults) {
                return true;
            }
            await animationFrame();
        }
        return false;
    }

    /**
     * Keep the AI Features filter pinned: users must not clear/edit search and land on IDE prefs.
     * Avoid capture-phase preventDefault/stopPropagation — that blocks list pan/scroll.
     * React re-renders of the searchbar can drop DOM attributes, so we re-apply via MutationObserver.
     */
    protected lockAiFeaturesSearch(widget: PreferencesWidget, query: string): void {
        this.unlockAiFeaturesSearch();
        this.lockedAiFeaturesQuery = query;
        this.settingsSearchInput.readOnly = true;
        this.settingsSearchInput.setAttribute('aria-readonly', 'true');
        this.settingsSearchInput.title = nls.localize(
            'qaap/mobileWorkHubPreferences/aiFeaturesSearchLocked',
            'Search is fixed to AI Features in Work Hub',
        );
        this.settingsSearchInput.value = query;
        widget.node.classList.add(AI_FEATURES_SEARCH_LOCKED_CLASS);

        let applying = false;
        const applyLock = (): void => {
            if (applying || !this.visible || this.lockedAiFeaturesQuery !== query) {
                return;
            }
            applying = true;
            try {
                const searchId = PreferencesSearchbarWidget.SEARCHBAR_ID;
                const input = widget.node.querySelector<HTMLInputElement>(`#${CSS.escape(searchId)}`);
                if (!input) {
                    return;
                }
                // readOnly (not disabled): disabled + capture listeners were blocking scroll/pan.
                input.readOnly = true;
                input.disabled = false;
                input.setAttribute('aria-readonly', 'true');
                input.tabIndex = -1;
                input.title = nls.localize(
                    'qaap/mobileWorkHubPreferences/aiFeaturesSearchLocked',
                    'Search is fixed to AI Features in Work Hub',
                );
                if (input.value !== query) {
                    input.value = query;
                    void widget.setSearchTerm(query);
                }
                const clearBtn = input.closest('.settings-search-container')
                    ?.querySelector<HTMLButtonElement>('button.option');
                if (clearBtn) {
                    clearBtn.disabled = true;
                    clearBtn.tabIndex = -1;
                    clearBtn.setAttribute('aria-hidden', 'true');
                }
            } finally {
                applying = false;
            }
        };

        // Restore the pinned query if anything still mutates the field (no preventDefault).
        const onInput = (ev: Event): void => {
            if (!this.lockedAiFeaturesQuery) {
                return;
            }
            const target = ev.target;
            if (!(target instanceof HTMLInputElement) || target.id !== PreferencesSearchbarWidget.SEARCHBAR_ID) {
                return;
            }
            if (target.value !== query) {
                target.value = query;
                void widget.setSearchTerm(query);
            }
        };

        this.searchLockListener = onInput;
        this.searchLockTarget = widget.node;
        widget.node.addEventListener('input', onInput, false);

        applyLock();
        if (typeof MutationObserver !== 'undefined') {
            const host = widget.node.querySelector('.preferences-searchbar-widget') ?? widget.node;
            this.searchLockObserver = new MutationObserver(() => applyLock());
            this.searchLockObserver.observe(host, {
                childList: true,
                subtree: true,
            });
        }
    }

    protected unlockAiFeaturesSearch(): void {
        const widget = this.preferencesWidget;
        widget?.node.classList.remove(AI_FEATURES_SEARCH_LOCKED_CLASS);
        this.searchLockObserver?.disconnect();
        this.searchLockObserver = undefined;
        if (this.searchLockListener && this.searchLockTarget) {
            this.searchLockTarget.removeEventListener('input', this.searchLockListener, false);
        }
        this.searchLockListener = undefined;
        this.searchLockTarget = undefined;
        this.settingsSearchInput.readOnly = false;
        this.settingsSearchInput.removeAttribute('aria-readonly');
        this.settingsSearchInput.removeAttribute('title');
        const searchId = PreferencesSearchbarWidget.SEARCHBAR_ID;
        const input = widget?.node.querySelector<HTMLInputElement>(`#${CSS.escape(searchId)}`);
        if (input) {
            input.readOnly = false;
            input.disabled = false;
            input.tabIndex = 0;
            input.removeAttribute('aria-readonly');
            input.removeAttribute('title');
            const clearBtn = input.closest('.settings-search-container')
                ?.querySelector<HTMLButtonElement>('button.option');
            if (clearBtn) {
                clearBtn.removeAttribute('aria-hidden');
                clearBtn.tabIndex = 0;
            }
        }
        this.lockedAiFeaturesQuery = undefined;
    }
}
