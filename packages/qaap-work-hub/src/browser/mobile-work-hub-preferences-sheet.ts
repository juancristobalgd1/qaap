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
    createQaapBillingCheckout,
    fetchQaapBilling,
    type QaapBillingApiResponse,
} from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';
import { QaapUserFacingErrors } from '@theia/qaap-adapters/lib/common/qaap-user-facing-error';
import { listAllConversationGroups } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { isWorkHubTheiaDialogOpen } from '../common/qaap-work-hub-dialog-utils';
import {
    hasPreferencesContent,
    isPreferencesFilterApplied,
    WORK_HUB_PREFERENCES_APPLYING_QUERY_CLASS,
} from './mobile-work-hub-preferences-filter';
import type { QaapAppearanceMode } from '@theia/qaap-shared-core/lib/common/qaap-appearance-mode';
import { QaapAppearanceModeService } from '@theia/qaap-shared-core/lib/browser/qaap-appearance-mode-service';
import { QaapWorkHubNotificationSettings } from '@theia/qaap-shared-core/lib/browser/qaap-work-hub-notification-settings';
import { QaapCompletionSound } from '@theia/qaap-shared-core/lib/browser/qaap-completion-sound';
import { Disposable } from '@theia/core/lib/common/disposable';
import type { MCPFrontendService } from '@theia/ai-mcp/lib/common/mcp-server-manager';
import type {
    MobileWorkHubSessionsSidebar,
    MobileWorkHubSettingsSidebarOptions,
} from './mobile-work-hub-sessions-sidebar';
import { MobileWorkHubMcpServerSummary } from './mobile-work-hub-mcp-server-summary';
import { MobileWorkHubActivityCalendar } from './mobile-work-hub-activity-calendar';
import { collectQaapActivityTimestamps } from '../common/qaap-activity-calendar';

/** Work Hub AI Features sheet scopes Settings to this search term. */
export const WORK_HUB_AI_FEATURES_PREFERENCES_QUERY = 'ai-features';

const DEFAULT_WORK_HUB_SETTINGS_SIDEBAR_WIDTH = 262;
const MIN_WORK_HUB_SETTINGS_SIDEBAR_WIDTH = 180;
const MAX_WORK_HUB_SETTINGS_SIDEBAR_WIDTH = 420;
const CUSTOM_SETTINGS_SECTIONS = new Set([
    'general',
    'profile',
    'appearance',
    'plan-usage',
    'agents',
    'mcp',
    'skills',
    'keybindings',
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
    /** Heading of the nav group this section opens; sections without one continue the previous group. */
    readonly group?: string;
}

/**
 * Work Hub owns a compact product settings shell, while the IDE keeps the
 * full Theia preferences editor. Queries are deliberately delegated to the
 * existing preferences widget so values, scopes and persistence stay intact.
 */
const WORK_HUB_SETTINGS_SECTIONS: readonly WorkHubSettingsSection[] = [
    {
        id: 'general', label: nls.localize('qaap/workHubSettings/general', 'General'), icon: 'settings-gear', query: '',
        group: nls.localize('qaap/workHubSettings/groupApp', 'App'),
    },
    { id: 'appearance', label: nls.localize('qaap/workHubSettings/appearance', 'Appearance'), icon: 'symbol-color', query: 'workbench' },
    { id: 'keybindings', label: nls.localize('qaap/workHubSettings/keybindings', 'Keybindings'), icon: 'keyboard', query: '' },
    {
        id: 'agents', label: nls.localize('qaap/workHubSettings/agents', 'Harness'), icon: 'hubot', query: 'Agents',
        group: nls.localize('qaap/workHubSettings/groupAgents', 'Agents'),
    },
    { id: 'mcp', label: nls.localize('qaap/workHubSettings/mcp', 'MCP'), icon: 'plug', query: 'MCP' },
    { id: 'skills', label: nls.localize('qaap/workHubSettings/skills', 'Skills'), icon: 'lightbulb', query: 'Skills' },
    {
        id: 'profile', label: nls.localize('qaap/workHubSettings/profile', 'Profile'), icon: 'account', query: '',
        group: nls.localize('qaap/workHubSettings/groupAccount', 'Account'),
    },
    // Usage has its own view (sidebar footer); this section only shows the plan.
    { id: 'plan-usage', label: nls.localize('qaap/workHubSettings/plan', 'Plan'), icon: 'credit-card', query: '' },
];

/** Small heading that opens a group of Settings nav items (the Work Hub sidebar renders the same markup). */
function createWorkHubSettingsGroupLabel(label: string): HTMLElement {
    const heading = document.createElement('div');
    heading.className = 'theia-mobile-work-hub-settings-group-label';
    heading.setAttribute('role', 'presentation');
    heading.textContent = label;
    return heading;
}

export function isWorkHubAiFeaturesPreferencesQuery(query?: string): boolean {
    return typeof query === 'string' && query.trim().toLowerCase() === WORK_HUB_AI_FEATURES_PREFERENCES_QUERY;
}

/** Structural contract of the Keybindings section, so the sheet does not import the panel class. */
export interface WorkHubKeybindingsPanelContract {
    render(host: HTMLElement): Disposable;
}

/** Opens the same Settings widget as the IDE, embedded in the Work Hub overlay. */
export class MobileWorkHubPreferencesSheet {

    readonly node: HTMLElement;
    protected readonly widgetHost: HTMLElement;
    protected readonly customContentHost: HTMLElement;
    protected readonly titleEl: HTMLElement;
    protected readonly restoreDefaultsButton: HTMLButtonElement;
    protected readonly notificationSettings = new QaapWorkHubNotificationSettings();
    protected previewCompletionSound: QaapCompletionSound | undefined;
    protected keybindingsRender: Disposable | undefined;
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
    protected settingsSidebarWidth = DEFAULT_WORK_HUB_SETTINGS_SIDEBAR_WIDTH;
    protected settingsSidebarResizePointerId: number | undefined;
    protected settingsSidebarResizeStartX = 0;
    protected settingsSidebarResizeStartWidth = DEFAULT_WORK_HUB_SETTINGS_SIDEBAR_WIDTH;
    protected planUsageRenderToken = 0;
    protected profileActivityRenderToken = 0;
    protected embeddedSettingsRenderToken = 0;
    protected embeddedSettingsWidget: Widget | undefined;
    protected mcpServerSummary: MobileWorkHubMcpServerSummary | undefined;
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
        protected readonly keybindingsPanel?: WorkHubKeybindingsPanelContract,
        protected readonly mcpFrontendService?: MCPFrontendService,
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
        settingsSectionLabel.hidden = true;
        for (const section of WORK_HUB_SETTINGS_SECTIONS) {
            if (section.group) {
                settingsNav.append(createWorkHubSettingsGroupLabel(section.group));
            }
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

        const crumb = document.createElement('span');
        crumb.className = 'theia-mobile-work-hub-settings-crumb';
        crumb.textContent = nls.localize('qaap/workHubSettings/crumbSettings', 'Settings');
        const crumbSeparator = document.createElement('span');
        crumbSeparator.className = 'theia-mobile-work-hub-settings-crumb-separator';
        crumbSeparator.setAttribute('aria-hidden', 'true');
        crumbSeparator.textContent = '/';
        this.restoreDefaultsButton = this.createRestoreDefaultsButton();

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

        header.append(openSidebarButton, crumb, crumbSeparator, title, this.restoreDefaultsButton);

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
        const section = this.resolveSettingsSection(query);
        this.activeSettingsSectionId = section.id;
        this.titleEl.textContent = section.label;
        this.settingsSearchInput.value = this.isCustomSettingsSection(section.id)
            ? ''
            : (typeof query === 'string' ? query : section.query);
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
                if (this.isCustomSettingsSection(section.id)) {
                this.showCustomSettingsSection(section.id);
            } else {
                await this.showPreferencesSectionFiltered(widget, typeof query === 'string' ? query : section.query);
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
        this.widgetHost.classList.remove(WORK_HUB_PREFERENCES_APPLYING_QUERY_CLASS);
        void this.preferencesWidget?.setSearchTerm('');
        this.settingsSearchInput.value = '';
        this.activeSettingsSectionId = 'general';
        this.updateSettingsNavigation();
        this.disposeKeybindingsRender();
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
        this.mcpServerSummary?.dispose();
        this.mcpServerSummary = undefined;
        this.hide();
        this.node.remove();
    }

    protected getMcpServerSummary(): MobileWorkHubMcpServerSummary | undefined {
        if (!this.mcpServerSummary && this.preferenceService) {
            this.mcpServerSummary = new MobileWorkHubMcpServerSummary({
                preferenceService: this.preferenceService,
                mcpFrontendService: this.mcpFrontendService,
                findUpstreamCard: slug => this.findUpstreamMcpServerCard(slug),
            });
        }
        return this.mcpServerSummary;
    }

    /** The upstream MCP card of one server in the embedded settings widget, matched by its name. */
    protected findUpstreamMcpServerCard(slug: string): HTMLElement | undefined {
        return Array.from(this.customContentHost.querySelectorAll<HTMLElement>('.mcp-server-card'))
            .find(card => card.querySelector('.mcp-server-name')?.firstChild?.textContent?.trim() === slug);
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
            return this.getSettingsSection('agents');
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
        this.restoreDefaultsButton.hidden = this.activeSettingsSectionId !== 'general';
        for (const item of this.settingsNav.querySelectorAll<HTMLButtonElement>('[data-qaap-settings-section]')) {
            const selected = item.dataset.qaapSettingsSection === this.activeSettingsSectionId;
            item.classList.toggle('theia-mod-selected', selected);
            item.setAttribute('aria-current', selected ? 'page' : 'false');
        }
        // The visible menu on desktop is rendered by the Work Hub sessions sidebar, not by
        // this sheet's own (unmounted) nav: keep its selection in sync too.
        this.settingsSidebarController?.refreshSettingsNavigation();
    }

    protected async selectSettingsSection(section: WorkHubSettingsSection): Promise<void> {
        this.activeSettingsSectionId = section.id;
        this.titleEl.textContent = section.label;
        this.settingsSearchInput.value = this.isCustomSettingsSection(section.id) ? '' : section.query;
        this.updateSettingsNavigation();
        if (this.visible && this.preferencesWidget) {
            if (this.isCustomSettingsSection(section.id)) {
                this.showCustomSettingsSection(section.id);
            } else {
                await this.showPreferencesSectionFiltered(this.preferencesWidget, section.query);
            }
        }
    }

    protected isCustomSettingsSection(sectionId: string): boolean {
        return CUSTOM_SETTINGS_SECTIONS.has(sectionId);
    }

    protected showPreferencesSection(widget: PreferencesWidget): void {
        this.disposeKeybindingsRender();
        this.detachEmbeddedSettingsWidget();
        this.customContentHost.hidden = true;
        this.customContentHost.classList.remove('theia-mod-embedded-settings');
        this.widgetHost.hidden = false;
        this.attachWidget(widget);
        this.observeWidgetHostResize(widget, this.widgetHost);
    }

    /**
     * Attaches the preferences widget and applies the section query. The host is covered until the
     * filter has taken effect, so the unfiltered editor (Commonly Used, files.*, editor.*) never shows.
     */
    protected async showPreferencesSectionFiltered(widget: PreferencesWidget, query: string): Promise<void> {
        this.widgetHost.classList.add(WORK_HUB_PREFERENCES_APPLYING_QUERY_CLASS);
        try {
            this.showPreferencesSection(widget);
            await this.applyPreferencesQuery(widget, query);
        } finally {
            this.widgetHost.classList.remove(WORK_HUB_PREFERENCES_APPLYING_QUERY_CLASS);
        }
    }

    protected showCustomSettingsSection(sectionId: string): void {
        this.disposeKeybindingsRender();
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
        if (sectionId === 'mcp') {
            // Same server list as the composer "+" MCP view, above the upstream widget (add/edit/delete).
            const summary = this.getMcpServerSummary();
            if (summary) {
                panel.append(summary.node);
                void summary.refresh();
            }
        }
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
            case 'keybindings':
                this.renderKeybindingsSection();
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
        const blockedNote = document.createElement('p');
        blockedNote.className = 'theia-mobile-work-hub-settings-note';
        blockedNote.textContent = nls.localize(
            'qaap/workHubSettings/general/notificationsBlocked',
            'Notifications are blocked by the browser for this site.',
        );
        blockedNote.hidden = !this.isNotificationPermissionDenied();
        const systemNotificationsRow = this.createSettingsRow(
            nls.localize('qaap/workHubSettings/general/systemNotifications', 'System Notifications'),
            nls.localize(
                'qaap/workHubSettings/general/systemNotificationsDescription',
                'Show a notification when an agent completes or needs your attention.',
            ),
            this.createToggle(this.notificationSettings.systemNotifications, nls.localize(
                'qaap/workHubSettings/general/systemNotificationsLabel',
                'System notifications',
            ), checked => {
                void this.setSystemNotificationsEnabled(checked).then(() => {
                    blockedNote.hidden = !this.isNotificationPermissionDenied();
                });
            }),
        );
        // The note belongs to this row: render it under the description, not as a separate row.
        systemNotificationsRow.querySelector('.theia-mobile-work-hub-settings-row-copy')?.append(blockedNote);
        notificationsCard.append(systemNotificationsRow);
        notificationsCard.append(this.createSettingsRow(
            nls.localize('qaap/workHubSettings/general/completionSound', 'Completion Sound'),
            nls.localize(
                'qaap/workHubSettings/general/completionSoundDescription',
                'Play a sound when agents finish or need your attention.',
            ),
            this.createToggle(this.notificationSettings.completionSound, nls.localize(
                'qaap/workHubSettings/general/completionSoundLabel',
                'Completion sound',
            ), checked => {
                this.notificationSettings.setCompletionSound(checked);
                if (checked) {
                    this.playPreviewCompletionSound();
                }
            }),
        ));
        panel.append(notificationsCard);
        this.customContentHost.append(panel);
    }

    /** Turns OS notifications on or off, keeps the IDE chat preference in step, and asks for permission on enable. */
    protected async setSystemNotificationsEnabled(enabled: boolean): Promise<void> {
        this.notificationSettings.setSystemNotifications(enabled);
        void this.preferenceService?.set(
            PREFERENCE_NAME_DEFAULT_NOTIFICATION_TYPE,
            enabled ? NOTIFICATION_TYPE_OS_NOTIFICATION : NOTIFICATION_TYPE_OFF,
        );
        if (enabled && typeof Notification !== 'undefined' && Notification.permission === 'default') {
            try {
                await Notification.requestPermission();
            } catch {
                /* user dismissed the prompt */
            }
        }
    }

    protected restoreGeneralDefaults(): void {
        this.notificationSettings.setSystemNotifications(true);
        this.notificationSettings.setCompletionSound(false);
        void this.preferenceService?.set(PREFERENCE_NAME_DEFAULT_NOTIFICATION_TYPE, NOTIFICATION_TYPE_OS_NOTIFICATION);
        this.renderCustomSettingsSection('general');
    }

    protected isNotificationPermissionDenied(): boolean {
        return typeof Notification !== 'undefined' && Notification.permission === 'denied';
    }

    protected playPreviewCompletionSound(): void {
        this.previewCompletionSound ??= new QaapCompletionSound();
        this.previewCompletionSound.play('completed');
    }

    protected createRestoreDefaultsButton(): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'theia-mobile-work-hub-settings-restore-defaults';
        button.hidden = true;
        const icon = document.createElement('span');
        icon.className = 'codicon codicon-discard';
        icon.setAttribute('aria-hidden', 'true');
        button.append(icon, document.createTextNode(nls.localize('qaap/workHubSettings/general/restoreDefaults', 'Restore defaults')));
        button.addEventListener('click', () => this.restoreGeneralDefaults());
        return button;
    }

    protected disposeKeybindingsRender(): void {
        this.keybindingsRender?.dispose();
        this.keybindingsRender = undefined;
    }

    protected renderKeybindingsSection(): void {
        this.disposeKeybindingsRender();
        this.keybindingsRender = this.keybindingsPanel?.render(this.customContentHost);
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
        this.renderProfileActivity(panel);
        this.customContentHost.append(panel);
    }

    protected renderProfileActivity(panel: HTMLElement): void {
        const token = ++this.profileActivityRenderToken;
        const calendar = new MobileWorkHubActivityCalendar();
        const heading = this.createCustomHeading(nls.localize('qaap/workHubSettings/activity/title', 'Activity'));
        panel.append(heading, calendar.node);
        calendar.showLoading();
        this.loadProfileActivity(calendar, token);
    }

    protected async loadProfileActivity(calendar: MobileWorkHubActivityCalendar, token: number): Promise<void> {
        let timestamps: number[] | undefined;
        try {
            const groups = await listAllConversationGroups();
            timestamps = collectQaapActivityTimestamps(groups.flatMap(group => group.conversations));
        } catch {
            timestamps = undefined;
        }
        if (!this.visible || token !== this.profileActivityRenderToken || this.activeSettingsSectionId !== 'profile') {
            return;
        }
        if (timestamps) {
            calendar.setActivity(timestamps, new Date());
        } else {
            calendar.showError();
        }
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

    protected async renderPlanUsageSection(): Promise<void> {
        const token = ++this.planUsageRenderToken;
        const panel = this.createCustomPanel();
        const loading = document.createElement('p');
        loading.className = 'theia-mobile-work-hub-settings-status';
        loading.textContent = nls.localize('qaap/workHubSettings/plan/loading', 'Loading plan…');
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
            'qaap/workHubSettings/plan/unavailable',
            'Plan details will appear here when your Qaap account is connected.',
        );
        card.append(title, description);
        panel.append(card);
        this.appendBillingButton(panel);
    }

    /**
     * Plan section: the Starter and Pro plans side by side (stacked on phones), the current one marked,
     * one clear action per plan that goes straight to Airwallex checkout, and "Manage subscription"
     * for cancellation and the full details sheet.
     */
    protected renderPlanUsageData(panel: HTMLElement, data: QaapBillingApiResponse): void {
        const currentPlanId = data.entitlements.planId;
        const plans = [...data.catalog.plans].sort((left, right) => left.priceUsdMonthly - right.priceUsdMonthly);
        const currentPrice = plans.find(plan => plan.id === currentPlanId)?.priceUsdMonthly ?? 0;

        const intro = document.createElement('div');
        intro.className = 'qaap-plan-picker-intro';
        const title = document.createElement('h2');
        title.className = 'qaap-plan-picker-title';
        title.textContent = nls.localize('qaap/workHubSettings/plans/title', 'Plans');
        const subtitle = document.createElement('p');
        subtitle.className = 'qaap-plan-picker-subtitle';
        subtitle.textContent = nls.localize(
            'qaap/workHubSettings/plans/subtitle',
            'You are on {0}. Bring your own model subscriptions; the plan sizes your cloud workspace.',
            this.planName(currentPlanId),
        );
        intro.append(title, subtitle);
        panel.append(intro);

        const error = document.createElement('p');
        error.className = 'qaap-plan-picker-error';
        error.hidden = true;

        const grid = document.createElement('div');
        grid.className = 'qaap-plan-picker';
        grid.setAttribute('role', 'list');
        for (const plan of plans) {
            grid.append(this.createPlanPickerCard(plan, currentPlanId, currentPrice, data, error));
        }
        panel.append(grid, error);

        const footer = document.createElement('div');
        footer.className = 'qaap-plan-picker-footer';
        const secure = document.createElement('span');
        secure.className = 'qaap-plan-picker-secure';
        const lock = document.createElement('span');
        lock.className = 'codicon codicon-lock';
        lock.setAttribute('aria-hidden', 'true');
        secure.append(lock, document.createTextNode(nls.localize(
            'qaap/workHubSettings/plans/secure',
            'Secure monthly checkout by Airwallex · Cancel anytime',
        )));
        footer.append(secure);
        if (this.openBilling) {
            const manage = document.createElement('button');
            manage.type = 'button';
            manage.className = 'qaap-plan-picker-manage';
            manage.textContent = nls.localize('qaap/workHubSettings/plans/manage', 'Manage subscription');
            manage.addEventListener('click', () => {
                this.hide();
                void this.openBilling?.();
            });
            footer.append(manage);
        }
        panel.append(footer);
    }

    protected createPlanPickerCard(
        plan: QaapBillingApiResponse['catalog']['plans'][number],
        currentPlanId: string,
        currentPrice: number,
        data: QaapBillingApiResponse,
        error: HTMLElement,
    ): HTMLElement {
        const isCurrent = plan.id === currentPlanId;
        const card = document.createElement('div');
        card.className = 'qaap-plan-card';
        card.setAttribute('role', 'listitem');
        card.classList.toggle('theia-mod-current', isCurrent);
        card.classList.toggle('theia-mod-featured', plan.id === 'pro');

        const head = document.createElement('div');
        head.className = 'qaap-plan-card-head';
        const name = document.createElement('span');
        name.className = 'qaap-plan-card-name';
        name.textContent = this.planName(plan.id);
        head.append(name);
        if (isCurrent || plan.id === 'pro') {
            const badge = document.createElement('span');
            badge.className = 'qaap-plan-card-badge';
            badge.textContent = isCurrent
                ? nls.localize('qaap/workHubSettings/plans/current', 'Current')
                : nls.localize('qaap/workHubSettings/plans/popular', 'Most popular');
            head.append(badge);
        }

        const price = document.createElement('div');
        price.className = 'qaap-plan-card-price';
        const amount = document.createElement('span');
        amount.className = 'qaap-plan-card-amount';
        // Whole prices read cleaner without cents ($12, not $12.00); $4.99 keeps them.
        amount.textContent = new Intl.NumberFormat(nls.locale ?? nls.defaultLocale, {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: Number.isInteger(plan.priceUsdMonthly) ? 0 : 2,
        }).format(plan.priceUsdMonthly);
        const period = document.createElement('span');
        period.className = 'qaap-plan-card-period';
        period.textContent = nls.localize('qaap/workHubSettings/plans/perMonth', '/ month');
        price.append(amount, period);

        const features = document.createElement('ul');
        features.className = 'qaap-plan-card-features';
        const memory = plan.memoryOptionsGb.length > 1
            ? nls.localize('qaap/workHubSettings/plans/memoryChoice', '{0} or {1} GB RAM',
                this.formatNumber(plan.memoryOptionsGb[0]), this.formatNumber(plan.memoryOptionsGb[plan.memoryOptionsGb.length - 1]))
            : nls.localize('qaap/workHubSettings/plans/memory', '{0} GB RAM', this.formatNumber(plan.defaultMemoryGb));
        for (const text of [
            nls.localize('qaap/workHubSettings/plans/repos', 'Up to {0} active repos', this.formatNumber(plan.maxActiveRepos)),
            nls.localize('qaap/workHubSettings/plans/agents', '{0} agents in parallel', this.formatNumber(plan.maxConcurrentAgents)),
            `${memory} · ${nls.localize('qaap/workHubSettings/plans/cpu', '{0} vCPU', this.formatNumber(plan.cpuLimit))}`,
            nls.localize('qaap/workHubSettings/plans/storage', '{0} GB storage', this.formatNumber(plan.storageGb)),
        ]) {
            const item = document.createElement('li');
            const check = document.createElement('span');
            check.className = 'codicon codicon-check';
            check.setAttribute('aria-hidden', 'true');
            item.append(check, document.createTextNode(text));
            features.append(item);
        }

        const action = document.createElement('button');
        action.type = 'button';
        action.className = 'qaap-plan-card-action';
        if (isCurrent) {
            action.disabled = true;
            action.textContent = nls.localize('qaap/workHubSettings/plans/currentAction', 'Your current plan');
        } else {
            const upgrade = plan.priceUsdMonthly > currentPrice;
            action.classList.toggle('theia-mod-primary', upgrade);
            action.textContent = upgrade
                ? nls.localize('qaap/workHubSettings/plans/upgrade', 'Upgrade to {0}', this.planName(plan.id))
                : nls.localize('qaap/workHubSettings/plans/switch', 'Switch to {0}', this.planName(plan.id));
            action.addEventListener('click', () => void this.startPlanCheckout(plan.id, action, data, error));
        }
        card.append(head, price, features, action);
        return card;
    }

    /** Straight to Airwallex hosted checkout; without checkout configured, the Billing sheet takes over. */
    protected async startPlanCheckout(planId: string, button: HTMLButtonElement, data: QaapBillingApiResponse, error: HTMLElement): Promise<void> {
        if (button.disabled) {
            return;
        }
        error.hidden = true;
        if (!data.checkout?.checkoutEnabled || (planId !== 'starter' && planId !== 'pro')) {
            this.hide();
            void this.openBilling?.();
            return;
        }
        const label = button.textContent ?? '';
        button.disabled = true;
        button.textContent = nls.localize('qaap/workHubSettings/plans/opening', 'Opening checkout…');
        try {
            const { url } = await createQaapBillingCheckout(planId);
            window.location.assign(url);
        } catch (err) {
            button.disabled = false;
            button.textContent = label;
            error.textContent = QaapUserFacingErrors.toMessageAndLog(err);
            error.hidden = false;
        }
    }

    protected createUsageLine(label: string, value: string): HTMLElement {
        const line = document.createElement('div');
        line.className = 'theia-mobile-work-hub-settings-row';
        const labelEl = document.createElement('span');
        labelEl.textContent = label;
        const valueEl = document.createElement('strong');
        valueEl.textContent = value;
        line.append(labelEl, valueEl);
        return line;
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
        button.textContent = nls.localize('qaap/workHubSettings/planUsage/billing', 'Billing');
        button.setAttribute('aria-label', nls.localize(
            'qaap/workHubSettings/planUsage/openBilling',
            'Open Billing to view plans and manage payment',
        ));
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

    protected planName(planId: string): string {
        switch (planId) {
            case 'pro':
                return nls.localize('qaap/workHubSettings/planUsage/pro', 'Pro');
            default:
                return nls.localize('qaap/workHubSettings/planUsage/starter', 'Starter');
        }
    }

    protected planSummary(plan: QaapBillingApiResponse['catalog']['plans'][number]): string {
        return nls.localize(
            'qaap/workHubSettings/planUsage/planSummary',
            '{0}/month · {1} GB storage · {2} parallel agents',
            this.formatUsd(plan.priceUsdMonthly),
            this.formatNumber(plan.storageGb),
            this.formatNumber(plan.maxConcurrentAgents),
        );
    }

    protected formatUsd(value: number): string {
        return new Intl.NumberFormat(nls.locale ?? nls.defaultLocale, { style: 'currency', currency: 'USD' }).format(value);
    }

    protected formatNumber(value: number): string {
        return new Intl.NumberFormat(nls.locale ?? nls.defaultLocale, { maximumFractionDigits: 1 }).format(value);
    }

    protected detachWidget(): void {
        const widget = this.preferencesWidget;
        if (!widget) {
            return;
        }
        this.clearMobilePreferencesEditorHeight(widget);
        widget.node.classList.remove('theia-mobile-work-hub-preferences-embed');
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
                if (await this.waitForPreferencesContent(widget, query)) {
                    this.scheduleLayoutSync(widget);
                    return;
                }
            }
            await animationFrame();
        }
        await this.commitPreferencesSearch(widget, undefined, query);
        await this.waitForPreferencesContent(widget, query);
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

    /**
     * Waits until the query's filter is visible in the editor (see {@link isPreferencesFilterApplied}).
     * When it does not settle within the frame budget, falls back to "any content rendered" so the
     * caller does not recommit the query in a loop.
     */
    protected async waitForPreferencesContent(widget: PreferencesWidget, query: string): Promise<boolean> {
        for (let attempt = 0; attempt < 30; attempt++) {
            if (!this.visible) {
                return false;
            }
            if (isPreferencesFilterApplied(widget.node, query)) {
                return true;
            }
            await animationFrame();
        }
        return hasPreferencesContent(widget.node);
    }
}
