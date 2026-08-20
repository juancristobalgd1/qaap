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

export function isWorkHubAiFeaturesPreferencesQuery(query?: string): boolean {
    return typeof query === 'string' && query.trim().toLowerCase() === WORK_HUB_AI_FEATURES_PREFERENCES_QUERY;
}

/** Opens the same Settings widget as the IDE, embedded in the Work Hub overlay. */
export class MobileWorkHubPreferencesSheet {

    readonly node: HTMLElement;
    protected readonly widgetHost: HTMLElement;
    protected readonly titleEl: HTMLElement;
    protected visible = false;
    protected preferencesWidget: PreferencesWidget | undefined;
    protected widgetHostResizeObserver: ResizeObserver | undefined;
    protected windowResizeListener: (() => void) | undefined;
    /** When set, the embedded search bar stays pinned to this AI Features query. */
    protected lockedAiFeaturesQuery: string | undefined;
    protected searchLockObserver: MutationObserver | undefined;
    protected searchLockListener: ((ev: Event) => void) | undefined;
    protected searchLockTarget: HTMLElement | undefined;

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

        const header = document.createElement('header');
        header.className = 'theia-mobile-work-hub-preferences-header';

        const backBtn = document.createElement('button');
        backBtn.type = 'button';
        backBtn.className = 'theia-mobile-work-hub-preferences-back theia-mobile-projects-header-back';
        backBtn.title = nls.localize('qaap/mobileProjects/backToProjects', 'Back to projects');
        backBtn.setAttribute('aria-label', backBtn.title);
        backBtn.innerHTML = '<span class="codicon codicon-chevron-left" aria-hidden="true"></span>';
        backBtn.addEventListener('click', () => this.hide());

        const title = document.createElement('h2');
        title.className = 'theia-mobile-work-hub-preferences-title';
        title.textContent = nls.localize('qaap/accountMenu/settings', 'Settings');
        this.titleEl = title;

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'theia-mobile-work-hub-preferences-close codicon codicon-close';
        closeBtn.title = nls.localize('qaap/mobileWorkHubPreferences/close', 'Close');
        closeBtn.setAttribute('aria-label', closeBtn.title);
        closeBtn.addEventListener('click', () => this.hide());

        header.append(backBtn, title, closeBtn);

        this.widgetHost = document.createElement('div');
        this.widgetHost.className = 'theia-mobile-work-hub-preferences-widget-host';

        sheet.append(header, this.widgetHost);
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
        this.titleEl.textContent = aiFeatures
            ? nls.localize('theia/preferences/ai-features', 'AI Features')
            : nls.localize('qaap/accountMenu/settings', 'Settings');
        this.attachWidget(widget);
        this.node.hidden = false;
        this.node.classList.add('theia-mod-visible');
        this.node.setAttribute('aria-hidden', 'false');
        this.visible = true;
        document.addEventListener('keydown', this.onKeyDown, true);
        this.windowResizeListener = () => { this.scheduleLayoutSync(widget); };
        window.addEventListener('resize', this.windowResizeListener, { passive: true });
        this.observeWidgetHostResize(widget);
        this.scheduleLayoutSync(widget);
        await animationFrame(2);
        if (typeof query === 'string' && this.visible) {
            await this.applyPreferencesQuery(widget, query);
            if (aiFeatures && this.visible) {
                this.lockAiFeaturesSearch(widget, WORK_HUB_AI_FEATURES_PREFERENCES_QUERY);
            }
        } else {
            this.unlockAiFeaturesSearch();
        }
        if (this.visible) {
            this.scheduleLayoutSync(widget);
        }
    }

    hide(): void {
        if (!this.visible) {
            return;
        }
        if (this.windowResizeListener) {
            window.removeEventListener('resize', this.windowResizeListener);
            this.windowResizeListener = undefined;
        }
        this.unobserveWidgetHostResize();
        const lockedWidget = this.lockedAiFeaturesQuery ? this.preferencesWidget : undefined;
        this.unlockAiFeaturesSearch();
        if (lockedWidget) {
            void lockedWidget.setSearchTerm('');
        }
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
