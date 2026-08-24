// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { addEventListener, codiconArray } from '@theia/core/lib/browser/widgets/widget';
import { createLucideArrowUpRightIcon } from './qaap-lucide-icons';
import { ClipboardService } from '@theia/core/lib/browser/clipboard-service';
import { MessageService } from '@theia/core/lib/common/message-service';
import { MiniBrowserProps } from '@theia/mini-browser/lib/browser/mini-browser-content';
import { normalizeMiniBrowserOpenUrl } from '@theia/mini-browser/lib/browser/mini-browser-url-utils';
import { QaapAgentPreviewChromeStyle as Style } from './qaap-agent-preview-chrome-style';
import {
    QAAP_DEV_PREVIEW_PATH_PREFIX,
    QAAP_IDENTITY_PREVIEW_PATH_PREFIX,
    normalizePreviewUrlForSameOrigin,
} from './qaap-preview-url-utils';
import {
    QaapPreviewInlineInspector,
    type QaapPreviewInspectorDeps,
    wirePreviewInspectorResize,
} from './qaap-preview-inline-inspector';
import {
    QaapPreviewSurfaceHandle,
    QaapPreviewSurfaceRegistry,
} from './qaap-preview-surface-registry';
import {
    clearPreviewBrowsingHistory,
    faviconUrlForPreview,
    groupPreviewBrowsingHistory,
    previewHistoryEntryLabel,
    readPreviewBrowsingHistory,
    recordPreviewBrowsingVisit,
    type QaapPreviewHistoryEntry,
} from './qaap-preview-browsing-history';
import { createPreviewEditButton } from './qaap-preview-edit-menu';
import { createPreviewMaximizeControl } from './qaap-preview-maximize';
import { QaapPreviewFrameHistory } from './qaap-preview-frame-history';
import {
    mountPreviewOverflowMenu,
    previewNotify,
} from './qaap-preview-overflow-actions';

export interface QaapAgentPreviewChromeHost {
    getRoot(): HTMLElement;
    getFrame(): HTMLIFrameElement | undefined;
    getCurrentUrl(): string;
    getPageTitle(): string | undefined;
    navigate(url: string, options?: { hard?: boolean }): void | Promise<void>;
    reload(): void;
    hardReload(): void;
    openExternal(): void;
    copyCurrentUrl(): Promise<void>;
    takeScreenshot?(): void | Promise<void>;
    onPickElement?(): void;
    onToggleInspector?(): void;
}

export interface QaapAgentPreviewChromeOptions {
    readonly clipboard?: ClipboardService;
    readonly messageService?: MessageService;
    readonly embedded?: boolean;
    /** Optional project/workspace identifier for embedded, project-local browsing history. */
    readonly historyScope?: string;
    /** Extra toast feedback (e.g. mobile snackbar). */
    readonly notify?: (message: string, kind?: 'info' | 'warn') => void;
}

let previewHistoryListId = 0;

/** Cursor-style preview chrome: address-bar history popover + overflow menu. */
export class QaapAgentPreviewChromeController implements Disposable {
    protected readonly toDispose = new DisposableCollection();
    protected historyOpen = false;
    protected historyPopoverAnchor: HTMLElement | undefined;
    protected historyPopoverQuery = '';
    protected historyComboboxInput: HTMLInputElement | undefined;
    protected historyRoot: HTMLElement | undefined;
    protected historyList: HTMLElement | undefined;
    protected overflowMenu: HTMLElement | undefined;
    protected overflowMenuDispose: (() => void) | undefined;
    protected historyPanel: HTMLElement | undefined;

    constructor(
        protected readonly host: QaapAgentPreviewChromeHost,
        protected readonly options: QaapAgentPreviewChromeOptions = {},
    ) {
        const root = host.getRoot();
        root.classList.add(Style.ROOT);
        if (options.embedded) {
            root.classList.add(Style.MOD_EMBEDDED);
        } else {
            root.classList.add(Style.MOD_MINI_BROWSER);
        }
        this.ensureHistoryPopover(root);
        const onResize = (): void => {
            if (this.historyOpen) {
                this.positionHistoryPopover();
            }
        };
        window.addEventListener('resize', onResize);
        this.toDispose.push(Disposable.create(() => window.removeEventListener('resize', onResize)));
        this.toDispose.push(Disposable.create(() => {
            root.classList.remove(
                Style.ROOT,
                Style.MOD_EMBEDDED,
                Style.MOD_MINI_BROWSER,
                Style.HISTORY_OPEN,
                Style.HISTORY_POPOVER,
            );
            this.historyRoot?.remove();
            this.overflowMenu?.remove();
        }));
    }

    setHistoryCombobox(input: HTMLInputElement): void {
        this.historyComboboxInput = input;
        const list = this.historyList;
        if (list && !list.id) {
            list.id = `qaap-preview-history-list-${++previewHistoryListId}`;
        }
        input.setAttribute('aria-haspopup', 'listbox');
        input.setAttribute('aria-expanded', String(this.historyOpen));
        if (list?.id) {
            input.setAttribute('aria-controls', list.id);
        }
    }

    openHistoryPopover(anchor: HTMLElement): void {
        this.historyPopoverAnchor = anchor;
        this.historyPopoverQuery = '';
        this.toggleHistory(true);
    }

    updateHistoryPopoverQuery(query: string): void {
        this.historyPopoverQuery = query;
        if (this.historyOpen) {
            this.renderHistoryList();
        }
    }

    dispose(): void {
        this.toDispose.dispose();
    }

    /** Toolbar buttons for mini-browser (reload + overflow). */
    attachToolbarControls(
        toolbar: HTMLElement,
        beforeFirst?: HTMLElement,
        reloadButton?: HTMLButtonElement,
    ): void {
        const overflowBtn = this.createToolbarIconButton(
            nls.localize('qaap/preview/moreActions', 'More preview actions'),
            'kebab-vertical',
            Style.TOOLBAR_OVERFLOW,
        );
        this.toDispose.push(addEventListener(overflowBtn, 'click', (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggleOverflowMenu(overflowBtn);
        }));

        if (reloadButton) {
            if (beforeFirst) {
                toolbar.insertBefore(reloadButton, beforeFirst);
            } else {
                toolbar.insertBefore(reloadButton, toolbar.firstChild);
            }
        }
        if (beforeFirst) {
            toolbar.appendChild(overflowBtn);
        } else {
            toolbar.appendChild(overflowBtn);
        }
    }

    recordNavigationIntent(url: string): void {
        const trimmed = url.trim();
        if (!trimmed || trimmed === 'about:blank') {
            return;
        }
        recordPreviewBrowsingVisit(trimmed, this.host.getPageTitle(), this.options.historyScope);
        if (this.historyOpen) {
            this.renderHistoryList();
        }
    }

    recordVisit(): void {
        const url = this.host.getCurrentUrl();
        if (!url) {
            return;
        }
        this.recordNavigationIntent(url);
    }

    toggleHistory(open?: boolean): void {
        this.historyOpen = open ?? !this.historyOpen;
        const root = this.host.getRoot();
        root.classList.toggle(Style.HISTORY_OPEN, this.historyOpen);
        root.classList.toggle(Style.HISTORY_POPOVER, this.historyOpen);
        this.historyComboboxInput?.setAttribute(
            'aria-expanded',
            String(this.historyOpen),
        );
        if (this.historyRoot) {
            this.historyRoot.hidden = !this.historyOpen;
            this.historyRoot.classList.toggle(Style.HISTORY_POPOVER, this.historyOpen);
        }
        if (this.historyPanel) {
            if (this.historyOpen) {
                this.positionHistoryPopover();
            } else {
                this.resetHistoryPopoverPosition();
            }
        }
        if (this.historyOpen) {
            this.renderHistoryList();
        }
    }

    protected ensureHistoryPopover(root: HTMLElement): void {
        const historyRoot = document.createElement('div');
        historyRoot.className = Style.HISTORY;
        historyRoot.hidden = true;

        const backdrop = document.createElement('button');
        backdrop.type = 'button';
        backdrop.className = Style.HISTORY_BACKDROP;
        backdrop.setAttribute('aria-label', nls.localize('qaap/preview/closeHistory', 'Close history'));
        this.toDispose.push(addEventListener(backdrop, 'click', () => this.toggleHistory(false)));

        const panel = document.createElement('aside');
        panel.className = Style.HISTORY_PANEL;
        panel.setAttribute('role', 'navigation');
        panel.setAttribute('aria-label', nls.localize('qaap/preview/historyTitle', 'Browsing history'));

        const panelBody = document.createElement('div');
        panelBody.className = Style.HISTORY_PANEL_BODY;

        const list = document.createElement('div');
        list.className = 'qaap-agent-preview-history-list';
        list.setAttribute('role', 'listbox');
        this.historyList = list;

        panelBody.append(list);
        panel.append(panelBody);
        this.toDispose.push(addEventListener(panel, 'pointerdown', (e: PointerEvent) => e.stopPropagation()));
        historyRoot.append(backdrop, panel);
        this.historyPanel = panel;
        const contentAnchor = root.querySelector(
            '.theia-mini-browser-content-area, .qaap-agent-preview-embedded-body',
        );
        if (contentAnchor instanceof HTMLElement) {
            contentAnchor.appendChild(historyRoot);
        } else {
            root.appendChild(historyRoot);
        }
        this.historyRoot = historyRoot;

        const onKey = (e: KeyboardEvent): void => {
            if (e.key === 'Escape' && this.historyOpen) {
                this.toggleHistory(false);
            }
        };
        window.addEventListener('keydown', onKey);
        this.toDispose.push(Disposable.create(() => window.removeEventListener('keydown', onKey)));
    }

    protected positionHistoryPopover(): void {
        const anchor = this.historyPopoverAnchor;
        const panel = this.historyPanel;
        const container = this.historyRoot?.parentElement;
        if (!anchor || !panel || !container) {
            return;
        }
        const anchorRect = anchor.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const maxWidth = Math.max(0, containerRect.width - 16);
        const width = Math.min(maxWidth, anchorRect.width);
        const left = Math.max(8, Math.min(
            anchorRect.left - containerRect.left,
            containerRect.width - width - 8,
        ));
        const top = anchorRect.bottom - containerRect.top;
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        panel.style.width = `${width}px`;
        panel.style.maxWidth = `${maxWidth}px`;
    }

    protected resetHistoryPopoverPosition(): void {
        if (!this.historyPanel) {
            return;
        }
        this.historyPanel.style.removeProperty('top');
        this.historyPanel.style.removeProperty('right');
        this.historyPanel.style.removeProperty('bottom');
        this.historyPanel.style.removeProperty('left');
        this.historyPanel.style.removeProperty('width');
        this.historyPanel.style.removeProperty('max-width');
    }

    protected renderHistoryList(): void {
        if (!this.historyList || !this.historyRoot) {
            return;
        }
        this.historyRoot.hidden = !this.historyOpen;
        const query = this.historyPopoverQuery.trim().toLowerCase();
        const entries = readPreviewBrowsingHistory(this.options.historyScope).filter(entry => {
            if (!query) {
                return true;
            }
            const label = previewHistoryEntryLabel(entry).toLowerCase();
            return label.includes(query) || entry.url.toLowerCase().includes(query);
        });
        this.historyList.replaceChildren();
        const sections = groupPreviewBrowsingHistory(entries);
        if (!sections.length) {
            const empty = document.createElement('div');
            empty.className = Style.HISTORY_EMPTY;
            empty.textContent = nls.localize('qaap/preview/historyEmpty', 'No pages visited yet.');
            this.historyList.append(empty);
            if (query) {
                this.historyList.append(this.createWebSearchItem(query));
            }
            return;
        }
        for (const section of sections) {
            const sectionEl = document.createElement('section');
            sectionEl.className = Style.HISTORY_SECTION;
            const title = document.createElement('div');
            title.className = Style.HISTORY_SECTION_TITLE;
            title.textContent = nls.localize(section.labelKey, section.defaultLabel);
            sectionEl.append(title);
            for (const entry of section.entries) {
                sectionEl.append(this.createHistoryItem(entry));
            }
            this.historyList.append(sectionEl);
        }
        if (query) {
            this.historyList.append(this.createWebSearchItem(query));
        }
    }

    protected createHistoryItem(entry: QaapPreviewHistoryEntry): HTMLElement {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = Style.HISTORY_ITEM;
        btn.setAttribute('role', 'option');
        btn.setAttribute('aria-label', previewHistoryEntryLabel(entry));
        const icon = document.createElement('img');
        icon.className = Style.HISTORY_ITEM_ICON;
        icon.alt = '';
        icon.loading = 'lazy';
        const favicon = faviconUrlForPreview(entry.url);
        if (favicon) {
            icon.src = favicon;
        } else {
            icon.hidden = true;
        }
        const label = document.createElement('span');
        label.className = Style.HISTORY_ITEM_LABEL;
        label.textContent = previewHistoryEntryLabel(entry);
        btn.append(icon, label);
        this.toDispose.push(addEventListener(btn, 'click', () => {
            void this.host.navigate(entry.url);
            this.toggleHistory(false);
        }));
        return btn;
    }

    protected createWebSearchItem(query: string): HTMLElement {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `${Style.HISTORY_ITEM} ${Style.HISTORY_WEB_SEARCH}`;
        btn.setAttribute('role', 'option');
        const label = nls.localize('qaap/preview/searchWeb', 'Search the web');
        btn.setAttribute('aria-label', `${label}: ${query}`);

        const icon = document.createElement('span');
        icon.className = `${Style.HISTORY_WEB_SEARCH_ICON} codicon codicon-search`;
        icon.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span');
        text.className = Style.HISTORY_ITEM_LABEL;
        text.textContent = label;
        btn.append(icon, text);
        this.toDispose.push(addEventListener(btn, 'click', () => {
            void this.host.navigate(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
            this.toggleHistory(false);
        }));
        return btn;
    }

    protected toggleOverflowMenu(anchor: HTMLElement): void {
        if (this.overflowMenu) {
            this.closeOverflowMenu();
            return;
        }
        const mounted = mountPreviewOverflowMenu({
            anchor,
            getContext: () => this.createOverflowActionContext(),
            onClose: () => this.closeOverflowMenu(),
        });
        this.overflowMenu = mounted.menu;
        this.overflowMenuDispose = mounted.dispose;
    }

    protected createOverflowActionContext() {
        return {
            getFrame: () => this.host.getFrame(),
            getCurrentUrl: () => this.host.getCurrentUrl(),
            reload: () => this.host.reload(),
            hardReload: () => this.host.hardReload(),
            openExternal: () => this.host.openExternal(),
            copyCurrentUrl: () => this.host.copyCurrentUrl(),
            clipboard: this.options.clipboard,
            messageService: this.options.messageService,
            notify: this.options.notify,
            clearHistory: () => this.clearHistory(),
        };
    }

    protected closeOverflowMenu(): void {
        this.overflowMenuDispose?.();
        this.overflowMenuDispose = undefined;
        this.overflowMenu = undefined;
    }

    protected clearHistory(): void {
        clearPreviewBrowsingHistory(this.options.historyScope);
        this.renderHistoryList();
        previewNotify(
            { messageService: this.options.messageService, notify: this.options.notify },
            nls.localize('qaap/preview/historyCleared', 'Browsing history cleared'),
        );
    }

    protected createToolbarIconButton(title: string, icon: string, className: string): HTMLButtonElement {
        return createQaapPreviewToolbarIconButton(title, icon, className);
    }
}

/** Icon toolbar control matching Qaap preview chrome (codicon, hover pill). */
export function createQaapPreviewToolbarIconButton(title: string, icon: string, className: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.title = title;
    button.classList.add(className, ...codiconArray(icon));
    return button;
}

export type { QaapPreviewInspectorDeps } from './qaap-preview-inline-inspector';

export interface EmbeddedAgentPreviewChromeOptions extends QaapAgentPreviewChromeOptions {
    readonly url: string;
    readonly readOnlyUrl?: boolean;
    readonly onNavigate?: (url: string) => void;
    readonly openExternal?: (url: string) => void;
    readonly previewSurfaces?: QaapPreviewSurfaceRegistry;
    readonly inspectorDeps?: QaapPreviewInspectorDeps;
    readonly onPickElement?: () => void;
    readonly onToggleInspector?: () => void;
    readonly onAnnotate?: () => void;
    readonly getAnnotationScope?: () => import('./qaap-preview-annotation-types').PreviewAnnotationScope | undefined;
    /**
     * When provided (Work Hub), annotation popover footer gets sticky-composer
     * agent/model controls that share session preference with the transcript composer.
     */
    readonly composerSession?: import('./qaap-preview-annotation-popover').AnnotationComposerSessionControls;
}

export interface EmbeddedAgentPreviewChrome extends Disposable {
    readonly root: HTMLElement;
    readonly frame: HTMLIFrameElement;
    readonly controller: QaapAgentPreviewChromeController;
    setUrl(url: string): void;
    navigate(url: string): void | Promise<void>;
    reload(): void;
}

/** Full preview chrome for embedded hosts (e.g. mobile transcript Preview tab). */
export function mountEmbeddedAgentPreviewChrome(
    host: HTMLElement,
    options: EmbeddedAgentPreviewChromeOptions,
): EmbeddedAgentPreviewChrome {
    const disposables = new DisposableCollection();
    const root = document.createElement('div');
    root.className = 'qaap-agent-preview-embedded';
    host.replaceChildren(root);

    const toolbar = document.createElement('div');
    toolbar.className = 'qaap-agent-preview-embedded-toolbar theia-mini-browser-toolbar';

    const backLabel = nls.localize('qaap/preview/showPreviousPage', 'Show the previous page');
    const forwardLabel = nls.localize('qaap/preview/showNextPage', 'Show the next page');
    const backBtn = createQaapPreviewToolbarIconButton(backLabel, 'arrow-left', Style.TOOLBAR_BACK);
    backBtn.setAttribute('aria-label', backLabel);
    backBtn.disabled = true;
    const forwardBtn = createQaapPreviewToolbarIconButton(forwardLabel, 'arrow-right', Style.TOOLBAR_FORWARD);
    forwardBtn.setAttribute('aria-label', forwardLabel);
    forwardBtn.disabled = true;

    const urlField = document.createElement('div');
    urlField.className = 'theia-mini-browser-url-field';

    const refreshBtn = createQaapPreviewToolbarIconButton(
        nls.localize('theia/mini-browser/reload', 'Reload'),
        'refresh',
        Style.TOOLBAR_REFRESH,
    );

    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.className = 'theia-input';
    urlInput.spellcheck = false;
    urlInput.readOnly = !!options.readOnlyUrl;
    urlField.append(urlInput);

    const openExternalLabel = nls.localize('theia/mini-browser/openInNewBrowserTab', 'Open in New Browser Tab');
    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.title = openExternalLabel;
    openBtn.setAttribute('aria-label', openExternalLabel);
    openBtn.classList.add(
        'theia-mini-browser-url-field-go',
        'theia-mini-browser-workbench-button',
        'theia-mini-browser-open',
    );
    openBtn.append(createLucideArrowUpRightIcon());
    urlField.append(openBtn);

    const body = document.createElement('div');
    body.className = 'theia-mini-browser-content-area qaap-agent-preview-embedded-body qaap-preview-content-area';

    const split = document.createElement('div');
    split.className = 'qaap-preview-split';

    const frameSlot = document.createElement('div');
    frameSlot.className = 'qaap-preview-frame-slot';

    const inspectorSlot = document.createElement('aside');
    inspectorSlot.className = 'qaap-preview-inspector-slot';

    const frame = document.createElement('iframe');
    const sandbox = (MiniBrowserProps.SandboxOptions.DEFAULT).map(name => MiniBrowserProps.SandboxOptions[name]);
    frame.sandbox.add(...sandbox);
    frameSlot.append(frame);
    split.append(frameSlot, inspectorSlot);
    body.append(split);
    wirePreviewInspectorResize(split, inspectorSlot, disposables);

    let surfaceHandle: QaapPreviewSurfaceHandle | undefined;
    if (options.previewSurfaces) {
        surfaceHandle = options.previewSurfaces.registerEmbedded(frame, disposables, root);
    }

    const workbench = document.createElement('div');
    workbench.className = 'theia-mini-browser-workbench-controls';

    const pickHandler = (): void => {
        if (surfaceHandle) {
            surfaceHandle.picker.startElementPicker();
            return;
        }
        options.onPickElement?.();
    };
    const inspectorHandler = (): void => {
        if (surfaceHandle) {
            void surfaceHandle.picker.openElementInspector();
            return;
        }
        options.onToggleInspector?.();
    };

    let inlineInspector: QaapPreviewInlineInspector | undefined;
    if (options.inspectorDeps) {
        inlineInspector = new QaapPreviewInlineInspector(inspectorSlot, {
            service: options.inspectorDeps.service,
            commands: options.inspectorDeps.commands,
            messageService: options.messageService,
            toDispose: disposables,
        });
        surfaceHandle?.picker.connectInlineInspector(inlineInspector);
    }

    const annotateHandler = (): void => {
        if (surfaceHandle) {
            surfaceHandle.picker.startAnnotateMode();
            return;
        }
        options.onAnnotate?.();
    };
    const editBtn = createPreviewEditButton({
        onSelectSelection: pickHandler,
        onSelectAnnotate: annotateHandler,
        toDispose: disposables,
    });
    const maximizeControl = createPreviewMaximizeControl({
        getPreviewRoot: () => root,
        toDispose: disposables,
    });
    workbench.append(maximizeControl.button, editBtn);

    // Parent workbench under chrome before mounting annotate toolbar — otherwise
    // ensureAnnotateToolbar cannot resolve `.qaap-agent-preview-embedded-toolbar`.
    // Order: Back, Forward, Reload, URL field, Edit, Overflow.
    toolbar.append(backBtn, forwardBtn, urlField, workbench);
    root.append(toolbar, body);

    if (surfaceHandle) {
        surfaceHandle.picker.setNotify(options.notify);
        if (options.composerSession) {
            surfaceHandle.picker.setComposerSession(options.composerSession);
        }
        surfaceHandle.picker.ensureAnnotationController(frameSlot, workbench);
        if (options.getAnnotationScope) {
            surfaceHandle.picker.setAnnotationScopeProvider(options.getAnnotationScope);
        }
    }

    let currentUrl = normalizePreviewNavigateUrl(options.url);
    let previewController: QaapAgentPreviewChromeController | undefined;
    const frameHistory = new QaapPreviewFrameHistory();

    // The dev-server holding page reloads itself every couple of seconds, and each iframe load
    // used to rewrite the URL field — wiping whatever the user was typing mid-load. Never touch
    // the field while it owns focus; it resyncs on the next programmatic update after blur.
    const syncUrlInput = (value: string): void => {
        if (document.activeElement === urlInput) {
            return;
        }
        urlInput.value = value;
    };

    const syncHistoryButtons = (): void => {
        backBtn.disabled = !frameHistory.canGoBack();
        forwardBtn.disabled = !frameHistory.canGoForward();
    };

    const adapter: QaapAgentPreviewChromeHost = {
        getRoot: () => root,
        getFrame: () => frame,
        getCurrentUrl: () => currentUrl,
        getPageTitle: () => {
            try {
                return frame.contentDocument?.title || undefined;
            } catch {
                return undefined;
            }
        },
        navigate: (url, navOptions) => {
            const next = normalizePreviewNavigateUrl(url);
            if (isQaapIdeShellUrl(next)) {
                if (frameHistory.isApplyingHistoryNav) {
                    frameHistory.finishHistoryNav();
                    syncHistoryButtons();
                }
                previewNotify(
                    { messageService: options.messageService, notify: options.notify },
                    nls.localize(
                        'qaap/preview/ideShellBlocked',
                        'That URL points to Qaap itself, not your app. Use "Open preview" or enter your application URL.',
                    ),
                    'warn',
                );
                return;
            }
            currentUrl = next;
            syncUrlInput(sanitizePreviewDisplayUrl(next));
            if (!frameHistory.isApplyingHistoryNav) {
                frameHistory.record(sanitizePreviewDisplayUrl(next));
                syncHistoryButtons();
            }
            if (navOptions?.hard) {
                const bust = next.includes('?') ? `${next}&_qaap_cache_bust=${Date.now()}` : `${next}?_qaap_cache_bust=${Date.now()}`;
                frame.src = bust;
            } else {
                frame.src = next;
            }
            previewController?.recordNavigationIntent(url);
            options.onNavigate?.(next);
        },
        reload: () => {
            try {
                frame.contentWindow?.location.reload();
            } catch {
                frame.src = currentUrl;
            }
        },
        hardReload: () => {
            const url = currentUrl.trim();
            if (!url) {
                previewNotify(
                    { messageService: options.messageService, notify: options.notify },
                    nls.localize('qaap/preview/noUrlToReload', 'No URL loaded'),
                    'warn',
                );
                return;
            }
            const bust = url.includes('?')
                ? `${url}&_qaap_cache_bust=${Date.now()}`
                : `${url}?_qaap_cache_bust=${Date.now()}`;
            try {
                frame.contentWindow?.location.replace(bust);
            } catch {
                frame.src = bust;
            }
        },
        openExternal: () => {
            const target = currentUrl;
            if (options.openExternal) {
                options.openExternal(target);
            } else {
                window.open(target, '_blank', 'noopener,noreferrer');
            }
        },
        copyCurrentUrl: async () => {
            if (options.clipboard) {
                await options.clipboard.writeText(currentUrl);
            } else if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(currentUrl);
            }
            options.messageService?.info(nls.localize('qaap/preview/urlCopied', 'URL copied to clipboard'));
        },
        onPickElement: pickHandler,
        onToggleInspector: inspectorHandler,
    };

    const controller = new QaapAgentPreviewChromeController(adapter, {
        clipboard: options.clipboard,
        messageService: options.messageService,
        notify: options.notify,
        embedded: true,
    });
    previewController = controller;
    controller.attachToolbarControls(toolbar, urlField, refreshBtn);
    disposables.push(controller);

    disposables.push(addEventListener(backBtn, 'click', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const target = frameHistory.back();
        syncHistoryButtons();
        if (!target) {
            return;
        }
        void adapter.navigate(target);
    }));
    disposables.push(addEventListener(forwardBtn, 'click', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const target = frameHistory.forward();
        syncHistoryButtons();
        if (!target) {
            return;
        }
        void adapter.navigate(target);
    }));
    disposables.push(addEventListener(refreshBtn, 'click', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        adapter.reload();
    }));
    disposables.push(addEventListener(openBtn, 'click', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        adapter.openExternal();
    }));
    disposables.push(addEventListener(urlInput, 'keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
            void adapter.navigate(urlInput.value);
            controller.toggleHistory(false);
        }
    }));
    controller.setHistoryCombobox(urlInput);
    disposables.push(addEventListener(urlInput, 'input', () => {
        controller.updateHistoryPopoverQuery(urlInput.value);
    }));
    disposables.push(addEventListener(urlInput, 'click', () => {
        controller.openHistoryPopover(urlField);
    }));
    disposables.push(addEventListener(urlInput, 'blur', () => {
        const caretPosition = urlInput.selectionEnd ?? urlInput.value.length;
        urlInput.setSelectionRange(caretPosition, caretPosition);
    }));
    disposables.push(addEventListener(frame, 'load', () => {
        try {
            const href = frame.contentWindow?.location.href;
            if (href && href !== 'about:blank') {
                currentUrl = href;
                syncUrlInput(href);
            }
        } catch {
            // Isolated preview hosts redirect a one-time query capability into a host-only cookie.
            // Never leave that capability visible/copyable in the preview URL bar afterwards.
            currentUrl = sanitizePreviewDisplayUrl(currentUrl);
            syncUrlInput(currentUrl);
        }
        if (frameHistory.isApplyingHistoryNav) {
            frameHistory.finishHistoryNav();
        } else if (currentUrl) {
            frameHistory.record(sanitizePreviewDisplayUrl(currentUrl));
        }
        syncHistoryButtons();
        surfaceHandle?.picker.onFrameLoad();
        controller.recordVisit();
    }));

    const api: EmbeddedAgentPreviewChrome = {
        root,
        frame,
        controller,
        setUrl: (url: string) => {
            void adapter.navigate(url);
        },
        navigate: (url: string) => adapter.navigate(url),
        reload: () => adapter.reload(),
        dispose: () => {
            disposables.dispose();
            host.replaceChildren();
        },
    };

    api.setUrl(options.url);
    return api;
}

function normalizePreviewNavigateUrl(url: string): string {
    const opened = normalizeMiniBrowserOpenUrl(url) || url;
    return normalizePreviewUrlForSameOrigin(opened);
}

/**
 * True when `url` would load the Qaap IDE shell itself (typing the bare VPS/IDE origin into the
 * preview bar loaded Qaap recursively inside its own preview). Anything on the IDE origin that is
 * not a `/qaap-preview/…` or `/qaap-dev/…` proxied path is the shell or its APIs — never a user
 * app — so the preview refuses to navigate there.
 */
function isQaapIdeShellUrl(url: string): boolean {
    try {
        const parsed = new URL(url, window.location.href);
        if (parsed.origin !== window.location.origin) {
            return false;
        }
        const path = parsed.pathname;
        return !(path.startsWith(`${QAAP_IDENTITY_PREVIEW_PATH_PREFIX}/`) || path.startsWith(`${QAAP_DEV_PREVIEW_PATH_PREFIX}/`));
    } catch {
        return false;
    }
}

function sanitizePreviewDisplayUrl(url: string): string {
    try {
        const parsed = new URL(url, window.location.href);
        parsed.searchParams.delete('qaap_preview_token');
        return parsed.toString();
    } catch {
        return url;
    }
}

export function attachAgentPreviewChromeToMiniBrowserContent(
    content: {
        readonly node: HTMLElement;
        readonly frame: HTMLIFrameElement;
        readonly input: HTMLInputElement;
        go(location: string, options?: { preserveFocus?: boolean; showLoadIndicator?: boolean }): Promise<void>;
        handleRefresh(): void;
        handleOpen(): void;
        frameSrc(): string | undefined;
        startElementPicker(): void;
        commands?: { executeCommand(id: string): Promise<unknown>; isEnabled(id: string): boolean };
    },
    deps: {
        clipboard: ClipboardService;
        messageService: MessageService;
        inspectorToggleCommandId?: string;
    },
): QaapAgentPreviewChromeController {
    let previewController: QaapAgentPreviewChromeController | undefined;
    const host: QaapAgentPreviewChromeHost = {
        getRoot: () => content.node,
        getFrame: () => content.frame,
        getCurrentUrl: () => content.frameSrc() || content.input.value || '',
        getPageTitle: () => {
            try {
                return content.frame.contentDocument?.title || undefined;
            } catch {
                return undefined;
            }
        },
        navigate: (url, options) => {
            const normalized = normalizeMiniBrowserOpenUrl(url) || url;
            previewController?.recordNavigationIntent(url);
            if (options?.hard) {
                const bust = normalized.includes('?')
                    ? `${normalized}&_qaap_cache_bust=${Date.now()}`
                    : `${normalized}?_qaap_cache_bust=${Date.now()}`;
                return content.go(bust, { preserveFocus: false });
            }
            return content.go(normalized, { preserveFocus: false });
        },
        reload: () => content.handleRefresh(),
        hardReload: () => {
            const current = content.frameSrc() || content.input.value;
            if (current) {
                void host.navigate(current, { hard: true });
            } else {
                content.handleRefresh();
            }
        },
        openExternal: () => content.handleOpen(),
        copyCurrentUrl: async () => {
            const url = host.getCurrentUrl();
            if (url) {
                await deps.clipboard.writeText(url);
                deps.messageService.info(nls.localize('qaap/preview/urlCopied', 'URL copied to clipboard'));
            }
        },
        onPickElement: () => content.startElementPicker(),
        onToggleInspector: deps.inspectorToggleCommandId && content.commands
            ? () => {
                const id = deps.inspectorToggleCommandId!;
                if (content.commands!.isEnabled(id)) {
                    void content.commands!.executeCommand(id).catch(() => undefined);
                }
            }
            : undefined,
    };
    const controller = new QaapAgentPreviewChromeController(host, {
        clipboard: deps.clipboard,
        messageService: deps.messageService,
    });
    previewController = controller;
    const toolbar = content.node.querySelector('.theia-mini-browser-toolbar, .theia-mini-browser-toolbar-read-only');
    if (toolbar instanceof HTMLElement) {
        const firstNav = toolbar.querySelector('.theia-mini-browser-previous');
        controller.attachToolbarControls(toolbar, firstNav instanceof HTMLElement ? firstNav : undefined);
    }
    return controller;
}
