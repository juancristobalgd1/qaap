// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { animationFrame, UnsafeWidgetUtilities, Widget, WidgetManager } from '@theia/core/lib/browser';
import { MessageLoop } from '@lumino/messaging';
import { Widget as LuminoWidget } from '@lumino/widgets';
import { PreferencesWidget } from '@theia/preferences/lib/browser/views/preference-widget';
import { PreferencesSearchbarWidget } from '@theia/preferences/lib/browser/views/preference-searchbar-widget';
import { isWorkHubTheiaDialogOpen } from '../common/qaap-work-hub-dialog-utils';

/** Work Hub AI Features sheet scopes Settings to this search term. */
export const WORK_HUB_AI_FEATURES_PREFERENCES_QUERY = 'ai-features';

const AI_FEATURES_SEARCH_LOCKED_CLASS = 'theia-mod-ai-features-search-locked';
const DEFAULT_WORK_HUB_SETTINGS_SIDEBAR_WIDTH = 262;
const MIN_WORK_HUB_SETTINGS_SIDEBAR_WIDTH = 180;
const MAX_WORK_HUB_SETTINGS_SIDEBAR_WIDTH = 420;

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
    { id: 'agents', label: nls.localize('qaap/workHubSettings/agents', 'Agents'), icon: 'hubot', query: 'ai-features.agentSettings' },
    { id: 'cloud-agents', label: nls.localize('qaap/workHubSettings/cloudAgents', 'Cloud Agents'), icon: 'cloud', query: 'qaap' },
    { id: 'models', label: nls.localize('qaap/workHubSettings/models', 'Models'), icon: 'symbol-method', query: 'ai-features' },
    { id: 'git-prs', label: nls.localize('qaap/workHubSettings/gitPrs', 'Git & PRs'), icon: 'git-branch', query: 'git' },
    { id: 'worktrees', label: nls.localize('qaap/workHubSettings/worktrees', 'Worktrees'), icon: 'repo', query: 'workbench' },
    { id: 'browser-network', label: nls.localize('qaap/workHubSettings/browserNetwork', 'Browser & Network'), icon: 'globe', query: 'http' },
    { id: 'tab', label: nls.localize('qaap/workHubSettings/tab', 'Tab'), icon: 'multiple-windows', query: 'workbench.editor' },
    { id: 'code-intelligence', label: nls.localize('qaap/workHubSettings/codeIntelligence', 'Code Intelligence'), icon: 'lightbulb', query: 'editor' },
    { id: 'beta', label: nls.localize('qaap/workHubSettings/beta', 'Beta'), icon: 'beaker', query: 'experimental' },
    { id: 'docs', label: nls.localize('qaap/workHubSettings/docs', 'Docs'), icon: 'book', query: '' },
];

export function isWorkHubAiFeaturesPreferencesQuery(query?: string): boolean {
    return typeof query === 'string' && query.trim().toLowerCase() === WORK_HUB_AI_FEATURES_PREFERENCES_QUERY;
}

/** Opens the same Settings widget as the IDE, embedded in the Work Hub overlay. */
export class MobileWorkHubPreferencesSheet {

    readonly node: HTMLElement;
    protected readonly widgetHost: HTMLElement;
    protected readonly titleEl: HTMLElement;
    protected readonly settingsSearchInput: HTMLInputElement;
    protected readonly settingsNav: HTMLElement;
    protected readonly settingsSidebar: HTMLElement;
    protected readonly settingsLayout: HTMLElement;
    protected readonly settingsSidebarResizer: HTMLElement;
    protected visible = false;
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
    ) {
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

        const backBtn = document.createElement('button');
        backBtn.type = 'button';
        backBtn.className = 'theia-mobile-work-hub-settings-back';
        backBtn.title = nls.localize('qaap/mobileProjects/backToProjects', 'Back to projects');
        backBtn.setAttribute('aria-label', backBtn.title);
        backBtn.innerHTML = '<span class="codicon codicon-chevron-left" aria-hidden="true"></span>'
            + `<span>${nls.localize('qaap/mobileProjects/back', 'Back')}</span>`;
        backBtn.addEventListener('click', () => this.hide());

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
            const value = searchInput.value;
            this.activeSettingsSectionId = value ? 'search' : 'general';
            this.titleEl.textContent = value
                ? nls.localize('qaap/workHubSettings/searchResults', 'Search results')
                : this.getSettingsSection('general').label;
            this.updateSettingsNavigation();
            void this.applyWorkHubSearch(value);
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

        sidebar.append(backBtn, searchLabel, settingsSectionLabel, settingsNav);

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

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'theia-mobile-work-hub-preferences-close codicon codicon-close';
        closeBtn.title = nls.localize('qaap/mobileWorkHubPreferences/close', 'Close');
        closeBtn.setAttribute('aria-label', closeBtn.title);
        closeBtn.addEventListener('click', () => this.hide());

        header.append(title, closeBtn);

        this.widgetHost = document.createElement('div');
        this.widgetHost.className = 'theia-mobile-work-hub-preferences-widget-host';

        content.append(header, this.widgetHost);
        settingsLayout.append(sidebar, sidebarResizer, content);
        sheet.append(settingsLayout);
        this.node.append(backdrop, sheet);
    }

    isVisible(): boolean {
        return this.visible;
    }

    async show(query?: string): Promise<void> {
        const widget = await this.widgetManager.getOrCreateWidget<PreferencesWidget>(PreferencesWidget.ID);
        this.preferencesWidget = widget;
        if (!this.node.parentElement) {
            document.body.appendChild(this.node);
        }
        const aiFeatures = isWorkHubAiFeaturesPreferencesQuery(query);
        const section = this.resolveSettingsSection(query);
        this.activeSettingsSectionId = section.id;
        this.titleEl.textContent = section.label;
        this.settingsSearchInput.value = typeof query === 'string' ? query : section.query;
        this.updateSettingsNavigation();
        this.attachWidget(widget);
        this.node.hidden = false;
        this.node.classList.add('theia-mod-visible');
        this.node.setAttribute('aria-hidden', 'false');
        this.visible = true;
        const renderedSidebarWidth = this.settingsSidebar.getBoundingClientRect().width;
        if (renderedSidebarWidth > 0) {
            this.settingsSidebarWidth = renderedSidebarWidth;
        }
        this.applySettingsSidebarWidth(this.settingsSidebarWidth);
        document.addEventListener('keydown', this.onKeyDown, true);
        this.windowResizeListener = () => { this.scheduleLayoutSync(widget); };
        window.addEventListener('resize', this.windowResizeListener, { passive: true });
        this.observeWidgetHostResize(widget);
        this.scheduleLayoutSync(widget);
        await animationFrame(2);
        if (this.visible) {
            this.unlockAiFeaturesSearch();
            await this.applyPreferencesQuery(widget, typeof query === 'string' ? query : section.query);
            if (aiFeatures && this.visible) {
                this.lockAiFeaturesSearch(widget, WORK_HUB_AI_FEATURES_PREFERENCES_QUERY);
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
        this.node.classList.remove('theia-mod-visible');
        this.node.hidden = true;
        this.node.setAttribute('aria-hidden', 'true');
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
        this.settingsSearchInput.value = section.query;
        this.updateSettingsNavigation();
        if (this.visible && this.preferencesWidget) {
            await this.applyPreferencesQuery(this.preferencesWidget, section.query);
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
        const rect = this.widgetHost.getBoundingClientRect();
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

    protected observeWidgetHostResize(widget: PreferencesWidget): void {
        this.unobserveWidgetHostResize();
        if (typeof ResizeObserver === 'undefined') {
            return;
        }
        this.widgetHostResizeObserver = new ResizeObserver(() => {
            this.scheduleLayoutSync(widget);
        });
        this.widgetHostResizeObserver.observe(this.widgetHost);
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
