// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { CommandRegistry } from '@theia/core/lib/common/command';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { nls } from '@theia/core/lib/common/nls';
import { MessageService } from '@theia/core/lib/common/message-service';
import {
    ELEMENT_ANNOTATION_CANCEL_TYPE,
    ELEMENT_ANNOTATION_POINT_TYPE,
    ELEMENT_ANNOTATION_REANCHOR_RESULT_TYPE,
    ELEMENT_ANNOTATION_REANCHOR_TYPE,
    ELEMENT_SET_MODE_TYPE,
    type AnnotationPointPayload,
    type AnnotationReanchorResultItem,
    type PreviewInteractionMode,
} from '@theia/qaap-element-inspector/lib/browser/element-inspector-types';
import { guessSourceLocationFromElement } from '@theia/qaap-element-inspector/lib/browser/qaap-element-inspector-source-map';
import type { PickedElement } from '@theia/qaap-element-inspector/lib/browser/element-inspector-types';
import {
    buildPreviewFeedbackDedupeKey,
    formatPreviewFeedbackAgentContext,
    formatPreviewFeedbackChipTitle,
    QAAP_WORK_HUB_ATTACH_COMPOSER_CONTEXT_COMMAND,
} from './qaap-preview-annotation-context';
import { mountPreviewAnnotationMarkers, type AnnotationMarkerPosition, type PreviewAnnotationMarkersHandle } from './qaap-preview-annotation-markers';
import { mountAnnotationCommentPopover, type AnnotationCommentPopoverHandle } from './qaap-preview-annotation-popover';
import {
    createPreviewAnnotation,
    isBlankAnnotationComment,
    PreviewAnnotationStore,
} from './qaap-preview-annotation-store';
import type { PreviewAnnotation, PreviewAnnotationScope } from './qaap-preview-annotation-types';
import { previewNotify, runPreviewOverflowAction } from './qaap-preview-overflow-actions';

export interface QaapPreviewAnnotationControllerOptions {
    readonly frame: HTMLIFrameElement;
    readonly frameSlot: HTMLElement;
    readonly toolbarHost?: HTMLElement;
    readonly commands: CommandRegistry;
    readonly messageService: MessageService;
    /**
     * Extra toast (e.g. MobileSnackbar in Work Hub). MessageService overlays are hidden
     * on the Work Hub surface, so callers should wire this for visible feedback.
     */
    readonly notify?: (message: string, kind?: 'info' | 'warn') => void;
    readonly store?: PreviewAnnotationStore;
    readonly getScope: () => PreviewAnnotationScope | undefined;
    readonly startSelectPicker: () => void;
    readonly injectBridge: () => void;
    readonly toDispose: DisposableCollection;
    /** Optional override; defaults to preview overflow take-screenshot action. */
    readonly takeScreenshot?: () => void | Promise<void>;
}

/**
 * Annotate mode for a single preview iframe. Reuses the Preview Bridge for hit-testing /
 * set-mode / re-anchor; Select continues to use the one-shot picker script.
 */
export class QaapPreviewAnnotationController implements Disposable {

    protected readonly toDispose = new DisposableCollection();
    protected readonly store: PreviewAnnotationStore;
    protected mode: PreviewInteractionMode = 'browse';
    protected markers: PreviewAnnotationMarkersHandle | undefined;
    protected positions = new Map<string, AnnotationMarkerPosition>();
    protected popover: AnnotationCommentPopoverHandle | undefined;
    protected provisionalId: string | undefined;
    protected reanchorRaf = 0;
    protected toolbarHost: HTMLElement | undefined;
    protected annotateToolbar: HTMLElement | undefined;
    protected annotateUrlField: HTMLElement | undefined;
    protected annotateChromeToolbar: HTMLElement | undefined;
    protected annotateSendButton: HTMLButtonElement | undefined;
    protected annotateSendBadge: HTMLElement | undefined;
    protected annotateUndoButton: HTMLButtonElement | undefined;
    protected annotateScreenshotButton: HTMLButtonElement | undefined;
    protected annotateCompareButton: HTMLButtonElement | undefined;
    protected comparingOriginal = false;
    protected listenerInstalled = false;
    protected notify: ((message: string, kind?: 'info' | 'warn') => void) | undefined;

    constructor(protected readonly options: QaapPreviewAnnotationControllerOptions) {
        this.store = options.store ?? new PreviewAnnotationStore();
        this.toolbarHost = options.toolbarHost;
        this.notify = options.notify;
        this.markers = mountPreviewAnnotationMarkers(options.frameSlot, {
            onMarkerActivate: (id, x, y) => this.openExistingAnnotation(id, x, y),
        });
        this.toDispose.push(Disposable.create(() => this.markers?.dispose()));
        this.ensureAnnotateToolbar();
        this.installMessageListener();
        this.installReanchorObservers();
        options.toDispose.push(this);
        this.refreshMarkers();
    }

    /**
     * Supplies (or updates) the workbench host used to locate chrome and mount the annotate bar.
     * Safe when the host was not yet parented under the toolbar at construction time.
     */
    setToolbarHost(host: HTMLElement | undefined): void {
        if (!host) {
            return;
        }
        this.toolbarHost = host;
        this.ensureAnnotateToolbar();
        this.syncAnnotateToolbar();
    }

    /** Wire Work Hub–visible toasts (e.g. MobileSnackbar) after construction. */
    setNotify(notify: ((message: string, kind?: 'info' | 'warn') => void) | undefined): void {
        this.notify = notify;
    }

    dispose(): void {
        this.closePopover();
        if (this.reanchorRaf) {
            this.cancelScheduledReanchor(this.reanchorRaf);
            this.reanchorRaf = 0;
        }
        this.postSetMode('browse');
        this.toDispose.dispose();
    }

    getInteractionMode(): PreviewInteractionMode {
        return this.mode;
    }

    setInteractionMode(mode: PreviewInteractionMode): void {
        if (mode === this.mode && mode !== 'select') {
            return;
        }
        this.options.injectBridge();
        if (mode === 'select') {
            this.mode = 'select';
            this.postSetMode('select');
            this.options.startSelectPicker();
            this.syncAnnotateToolbar();
            return;
        }
        this.mode = mode;
        this.postSetMode(mode);
        if (mode === 'annotate') {
            // Retry mount if construction ran before the workbench was parented under chrome.
            this.ensureAnnotateToolbar();
        }
        this.syncAnnotateToolbar();
        if (mode === 'annotate') {
            this.options.messageService.info(nls.localize(
                'qaap/preview/annotateActive',
                'Annotate mode — tap the preview to add a comment. Scroll still works.',
            ));
            this.scheduleReanchor();
        }
        this.refreshMarkers();
    }

    startAnnotateMode(): void {
        this.ensureAnnotateToolbar();
        this.setInteractionMode('annotate');
    }

    /** Called when Select picker starts outside {@link setInteractionMode}. */
    noteSelectModeActivated(): void {
        this.mode = 'select';
        this.syncAnnotateToolbar();
    }

    undoLastAnnotation(): void {
        const scope = this.options.getScope();
        if (!scope) {
            return;
        }
        const removed = this.store.undoLast(scope);
        if (!removed) {
            return;
        }
        this.positions.delete(removed.id);
        if (this.provisionalId === removed.id) {
            this.provisionalId = undefined;
            this.closePopover();
        }
        this.refreshMarkers();
        this.syncAnnotateToolbar();
    }

    async addAnnotationsToChat(): Promise<void> {
        const scope = this.options.getScope();
        if (!scope) {
            return;
        }
        const confirmed = this.store.listScope(scope).filter(item => item.status === 'confirmed');
        if (confirmed.length === 0) {
            this.notifyUser(nls.localize(
                'qaap/preview/annotateNothingToAttach',
                'Confirm at least one annotation before adding to chat.',
            ), 'warn');
            return;
        }
        if (!this.options.commands.getCommand(QAAP_WORK_HUB_ATTACH_COMPOSER_CONTEXT_COMMAND)) {
            this.notifyUser(nls.localize(
                'qaap/preview/attachComposerUnavailable',
                'Work Hub composer attach is unavailable in this session.',
            ), 'warn');
            return;
        }
        const chipTitle = formatPreviewFeedbackChipTitle(confirmed, scope.route, scope.viewportMode);
        const contextBody = formatPreviewFeedbackAgentContext(confirmed);
        const dedupeKey = buildPreviewFeedbackDedupeKey(confirmed[0]!, confirmed.map(item => item.id));
        const annotationIds = confirmed.map(item => item.id);
        try {
            const sent = await this.options.commands.executeCommand(
                QAAP_WORK_HUB_ATTACH_COMPOSER_CONTEXT_COMMAND,
                {
                    chipTitle,
                    contextBody,
                    dedupeKey,
                    submit: true,
                },
            );
            if (sent !== true) {
                this.notifyUser(nls.localize(
                    'qaap/preview/annotateSendFailed',
                    'Could not send annotations to chat. Open Work Hub and try again.',
                ), 'warn');
                return;
            }
            this.store.markAttached(annotationIds);
            this.notifyUser(this.formatAnnotationsSentToast(annotationIds.length));
            this.syncAnnotateToolbar();
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            this.notifyUser(nls.localize(
                'qaap/preview/annotateAttachFailed',
                'Could not attach annotations: {0}',
                detail,
            ), 'warn');
        }
    }

    protected formatAnnotationsSentToast(count: number): string {
        if (count === 1) {
            return nls.localize('qaap/preview/annotateSentOne', '1 annotation sent to chat');
        }
        return nls.localize('qaap/preview/annotateSentMany', '{0} annotations sent to chat', String(count));
    }

    protected notifyUser(message: string, kind: 'info' | 'warn' = 'info'): void {
        previewNotify(
            { messageService: this.options.messageService, notify: this.notify },
            message,
            kind,
        );
    }

    handleEscape(): boolean {
        if (this.popover) {
            this.popover.dispose();
            this.popover = undefined;
            if (this.provisionalId) {
                this.store.remove(this.provisionalId);
                this.positions.delete(this.provisionalId);
                this.provisionalId = undefined;
                this.refreshMarkers();
                this.syncAnnotateToolbar();
            }
            return true;
        }
        if (this.mode === 'annotate') {
            this.setInteractionMode('browse');
            return true;
        }
        return false;
    }

    onFrameLoad(): void {
        this.options.injectBridge();
        if (this.mode === 'annotate') {
            this.postSetMode('annotate');
        } else if (this.mode === 'select') {
            this.postSetMode('select');
        }
        this.scheduleReanchor();
    }

    protected installMessageListener(): void {
        if (this.listenerInstalled) {
            return;
        }
        this.listenerInstalled = true;
        const handler = (event: MessageEvent): void => this.onWindowMessage(event);
        window.addEventListener('message', handler);
        this.toDispose.push(Disposable.create(() => window.removeEventListener('message', handler)));
        const onKeyDown = (e: KeyboardEvent): void => {
            if (e.key === 'Escape' && this.handleEscape()) {
                e.preventDefault();
                e.stopPropagation();
            }
        };
        window.addEventListener('keydown', onKeyDown, true);
        this.toDispose.push(Disposable.create(() => window.removeEventListener('keydown', onKeyDown, true)));
    }

    /** Visible for unit tests — validates iframe source before handling protocol payloads. */
    onWindowMessage(event: Pick<MessageEvent, 'data' | 'source'>): void {
        if (!event.data || typeof event.data !== 'object') {
            return;
        }
        if (!this.options.frame.contentWindow || event.source !== this.options.frame.contentWindow) {
            return;
        }
        const data = event.data as { type?: string; payload?: unknown };
        if (data.type === ELEMENT_ANNOTATION_POINT_TYPE && data.payload) {
            this.handleAnnotationPoint(data.payload as AnnotationPointPayload);
        } else if (data.type === ELEMENT_ANNOTATION_REANCHOR_RESULT_TYPE && data.payload) {
            this.handleReanchorResult(data.payload as { items?: AnnotationReanchorResultItem[] });
        } else if (data.type === ELEMENT_ANNOTATION_CANCEL_TYPE) {
            if (this.mode === 'annotate') {
                this.setInteractionMode('browse');
            }
        }
    }

    protected installReanchorObservers(): void {
        const schedule = (): void => this.scheduleReanchor();
        window.addEventListener('resize', schedule);
        this.toDispose.push(Disposable.create(() => window.removeEventListener('resize', schedule)));
        const onFrameLoad = (): void => this.onFrameLoad();
        this.options.frame.addEventListener('load', onFrameLoad);
        this.toDispose.push(Disposable.create(() => this.options.frame.removeEventListener('load', onFrameLoad)));
        try {
            const ro = new ResizeObserver(() => schedule());
            ro.observe(this.options.frameSlot);
            this.toDispose.push(Disposable.create(() => ro.disconnect()));
        } catch {
            /* ResizeObserver unavailable */
        }
    }

    protected handleAnnotationPoint(payload: AnnotationPointPayload): void {
        if (this.mode !== 'annotate' || this.comparingOriginal) {
            return;
        }
        const scope = this.options.getScope();
        if (!scope) {
            return;
        }
        // Route comes from the in-app navigation; keep previewUrl stable for isolation.
        const route = payload.route || scope.route;
        const activeScope: PreviewAnnotationScope = { ...scope, route };
        if (this.provisionalId) {
            this.store.remove(this.provisionalId);
            this.positions.delete(this.provisionalId);
            this.provisionalId = undefined;
        }
        this.closePopover();

        const anchor = payload.element
            ? {
                kind: 'element' as const,
                selector: payload.element.selector,
                xRatio: payload.element.xRatio,
                yRatio: payload.element.yRatio,
            }
            : {
                kind: 'page' as const,
                documentXRatio: payload.documentXRatio,
                documentYRatio: payload.documentYRatio,
            };

        let elementMeta: PreviewAnnotation['element'] = payload.element
            ? {
                tagName: payload.element.tagName,
                text: payload.element.text,
                ariaLabel: payload.element.ariaLabel,
            }
            : undefined;
        if (payload.element && elementMeta) {
            const pseudo = toPickedElementShim(payload);
            const source = guessSourceLocationFromElement(pseudo);
            if (source?.file) {
                elementMeta = {
                    ...elementMeta,
                    sourceFile: source.file,
                    sourceLine: source.line,
                    component: source.file,
                };
            }
        }

        const annotation = createPreviewAnnotation(activeScope, {
            comment: '',
            anchor,
            documentXRatio: payload.documentXRatio,
            documentYRatio: payload.documentYRatio,
            element: elementMeta,
            status: 'draft',
        });
        this.store.add(annotation);
        this.provisionalId = annotation.id;
        const frameRect = this.options.frame.getBoundingClientRect();
        this.positions.set(annotation.id, {
            id: annotation.id,
            clientX: payload.clientX,
            clientY: payload.clientY,
            unresolved: false,
        });
        this.refreshMarkers();
        this.syncAnnotateToolbar();
        this.openPopoverFor(annotation, frameRect.left + payload.clientX, frameRect.top + payload.clientY, true);
    }

    protected openExistingAnnotation(id: string, clientX: number, clientY: number): void {
        const annotation = this.store.get(id);
        if (!annotation) {
            return;
        }
        this.openPopoverFor(annotation, clientX, clientY, false);
    }

    protected openPopoverFor(annotation: PreviewAnnotation, clientX: number, clientY: number, isNew: boolean): void {
        this.closePopover();
        const panel = this.options.frameSlot.getBoundingClientRect();
        this.popover = mountAnnotationCommentPopover({
            anchorClientX: clientX,
            anchorClientY: clientY,
            panel,
            initialComment: annotation.comment,
            elementTagName: annotation.element?.tagName
                ?? (annotation.anchor.kind === 'element'
                    ? annotation.anchor.selector.split(/[\s.#[:>+~]/)[0]
                    : undefined),
            allowDelete: !isNew,
            onWarn: message => this.options.messageService.warn(message),
            onConfirm: comment => {
                if (isBlankAnnotationComment(comment)) {
                    return;
                }
                this.store.update(annotation.id, { comment, status: 'confirmed' });
                if (this.provisionalId === annotation.id) {
                    this.provisionalId = undefined;
                }
                this.popover = undefined;
                this.refreshMarkers();
                this.syncAnnotateToolbar();
            },
            onCancel: () => {
                if (isNew || this.provisionalId === annotation.id) {
                    this.store.remove(annotation.id);
                    this.positions.delete(annotation.id);
                    this.provisionalId = undefined;
                    this.refreshMarkers();
                    this.syncAnnotateToolbar();
                }
                this.popover = undefined;
            },
            onDelete: () => {
                this.store.remove(annotation.id);
                this.positions.delete(annotation.id);
                this.refreshMarkers();
                this.syncAnnotateToolbar();
            },
        });
    }

    protected closePopover(): void {
        this.popover?.dispose();
        this.popover = undefined;
    }

    protected scheduleReanchor(): void {
        if (this.reanchorRaf) {
            this.cancelScheduledReanchor(this.reanchorRaf);
        }
        const schedule = typeof requestAnimationFrame === 'function'
            ? requestAnimationFrame
            : ((cb: FrameRequestCallback) => window.setTimeout(() => cb(Date.now()), 0) as unknown as number);
        this.reanchorRaf = schedule(() => {
            this.reanchorRaf = 0;
            this.requestReanchor();
        });
    }

    protected cancelScheduledReanchor(id: number): void {
        if (typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(id);
            return;
        }
        window.clearTimeout(id);
    }

    protected requestReanchor(): void {
        const scope = this.options.getScope();
        if (!scope) {
            return;
        }
        const win = this.options.frame.contentWindow;
        if (!win) {
            return;
        }
        const items = this.store.listVisibleMarkers(scope).map(item => ({
            id: item.id,
            selector: item.anchor.kind === 'element' ? item.anchor.selector : undefined,
            documentXRatio: item.documentXRatio,
            documentYRatio: item.documentYRatio,
            xRatio: item.anchor.kind === 'element' ? item.anchor.xRatio : undefined,
            yRatio: item.anchor.kind === 'element' ? item.anchor.yRatio : undefined,
        }));
        if (items.length === 0) {
            this.refreshMarkers();
            return;
        }
        win.postMessage({ type: ELEMENT_ANNOTATION_REANCHOR_TYPE, payload: { items } }, '*');
    }

    protected handleReanchorResult(payload: { items?: AnnotationReanchorResultItem[] }): void {
        const items = payload.items ?? [];
        for (const item of items) {
            this.positions.set(item.id, {
                id: item.id,
                clientX: item.clientX,
                clientY: item.clientY,
                unresolved: item.unresolved,
            });
            if (item.unresolved) {
                this.store.update(item.id, { unresolved: true });
            } else {
                this.store.update(item.id, { unresolved: false });
            }
        }
        this.refreshMarkers();
    }

    protected refreshMarkers(): void {
        const scope = this.options.getScope();
        if (!scope || !this.markers) {
            this.markers?.sync([], []);
            return;
        }
        const annotations = this.store.listVisibleMarkers(scope);
        const positions = annotations
            .map(item => this.positions.get(item.id))
            .filter((item): item is AnnotationMarkerPosition => !!item);
        this.markers.sync(annotations, positions);
        this.markers.setVisible(!this.comparingOriginal);
    }

    protected postSetMode(mode: PreviewInteractionMode): void {
        const win = this.options.frame.contentWindow;
        if (!win) {
            return;
        }
        win.postMessage({ type: ELEMENT_SET_MODE_TYPE, mode }, '*');
    }

    protected setComparingOriginal(active: boolean): void {
        if (this.comparingOriginal === active) {
            return;
        }
        this.comparingOriginal = active;
        this.annotateToolbar?.classList.toggle('qaap-mod-comparing-original', active);
        this.annotateCompareButton?.classList.toggle('qaap-mod-pressed', active);
        this.markers?.setVisible(!active);
        if (active) {
            this.popover?.root.classList.add('qaap-mod-compare-hidden');
        } else {
            this.popover?.root.classList.remove('qaap-mod-compare-hidden');
        }
    }

    protected async takeScreenshot(): Promise<void> {
        if (this.options.takeScreenshot) {
            await this.options.takeScreenshot();
            return;
        }
        await runPreviewOverflowAction('take-screenshot', {
            getFrame: () => this.options.frame,
            getCurrentUrl: () => {
                try {
                    return this.options.frame.contentWindow?.location.href
                        ?? this.options.frame.src
                        ?? '';
                } catch {
                    return this.options.frame.src || '';
                }
            },
            reload: () => {
                try {
                    this.options.frame.contentWindow?.location.reload();
                } catch {
                    /* cross-origin */
                }
            },
            hardReload: () => {
                try {
                    this.options.frame.contentWindow?.location.reload();
                } catch {
                    /* cross-origin */
                }
            },
            openExternal: () => { /* annotate toolbar does not open external */ },
            copyCurrentUrl: async () => { /* unused for screenshot */ },
            messageService: this.options.messageService,
            notify: this.notify,
            bookmarkBarVisible: () => false,
            toggleBookmarkBar: () => { /* unused */ },
            clearHistory: () => { /* unused */ },
        });
    }

    protected ensureAnnotateToolbar(): void {
        if (this.annotateToolbar) {
            return;
        }
        const host = this.toolbarHost;
        if (!host) {
            return;
        }
        const chrome = host.closest<HTMLElement>(
            '.theia-mini-browser-toolbar, .theia-mini-browser-toolbar-read-only, .qaap-agent-preview-embedded-toolbar',
        ) ?? host.parentElement ?? undefined;
        if (!chrome) {
            return;
        }
        const urlField = chrome.querySelector<HTMLElement>('.theia-mini-browser-url-field') ?? undefined;
        this.annotateChromeToolbar = chrome;
        this.annotateUrlField = urlField;

        const bar = document.createElement('div');
        bar.className = 'qaap-preview-annotate-toolbar';
        bar.setAttribute('role', 'toolbar');
        bar.setAttribute('aria-label', nls.localize('qaap/preview/annotateToolbarLabel', 'Annotate'));

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'qaap-preview-annotate-toolbar-icon-btn codicon codicon-close';
        closeBtn.title = nls.localize('qaap/preview/annotateClose', 'Close annotate');
        closeBtn.setAttribute('aria-label', closeBtn.title);

        const undoBtn = document.createElement('button');
        undoBtn.type = 'button';
        undoBtn.className = 'qaap-preview-annotate-toolbar-icon-btn codicon codicon-discard';
        undoBtn.title = nls.localize('qaap/preview/annotateUndo', 'Undo');
        undoBtn.setAttribute('aria-label', undoBtn.title);

        const hint = document.createElement('span');
        hint.className = 'qaap-preview-annotate-toolbar-hint';
        hint.textContent = nls.localize('qaap/preview/annotateHint', 'Annotate...');

        const screenshotBtn = document.createElement('button');
        screenshotBtn.type = 'button';
        screenshotBtn.className = 'qaap-preview-annotate-toolbar-icon-btn codicon codicon-device-camera';
        screenshotBtn.title = nls.localize('qaap/preview/takeScreenshot', 'Take Screenshot');
        screenshotBtn.setAttribute('aria-label', screenshotBtn.title);

        const compareBtn = document.createElement('button');
        compareBtn.type = 'button';
        compareBtn.className = 'qaap-preview-annotate-toolbar-icon-btn codicon codicon-diff-single';
        compareBtn.title = nls.localize('qaap/preview/annotateHoldToSeeOriginal', 'Hold to see original');
        compareBtn.setAttribute('aria-label', compareBtn.title);
        compareBtn.setAttribute('aria-pressed', 'false');

        const sendBtn = document.createElement('button');
        sendBtn.type = 'button';
        sendBtn.className = 'qaap-preview-annotate-toolbar-send';
        const sendLabel = document.createElement('span');
        sendLabel.className = 'qaap-preview-annotate-toolbar-send-label';
        sendLabel.textContent = nls.localize('qaap/preview/annotateSend', 'Send');
        const badge = document.createElement('span');
        badge.className = 'qaap-preview-annotate-toolbar-send-badge';
        badge.hidden = true;
        sendBtn.append(sendLabel, badge);
        sendBtn.title = nls.localize('qaap/preview/annotateSendToChat', 'Send to chat');
        sendBtn.setAttribute('aria-label', sendBtn.title);

        bar.append(closeBtn, undoBtn, hint, screenshotBtn, compareBtn, sendBtn);
        // Full-width sibling of URL / workbench / overflow — not nested in workbench-controls.
        chrome.append(bar);

        this.annotateToolbar = bar;
        this.annotateSendButton = sendBtn;
        this.annotateSendBadge = badge;
        this.annotateUndoButton = undoBtn;
        this.annotateScreenshotButton = screenshotBtn;
        this.annotateCompareButton = compareBtn;

        const onClose = (e: MouseEvent): void => {
            e.preventDefault();
            e.stopPropagation();
            this.setComparingOriginal(false);
            this.setInteractionMode('browse');
        };
        const onUndo = (e: MouseEvent): void => {
            e.preventDefault();
            e.stopPropagation();
            this.undoLastAnnotation();
        };
        const onScreenshot = (e: MouseEvent): void => {
            e.preventDefault();
            e.stopPropagation();
            void this.takeScreenshot();
        };
        const onCompareDown = (e: PointerEvent): void => {
            e.preventDefault();
            e.stopPropagation();
            try {
                compareBtn.setPointerCapture(e.pointerId);
            } catch {
                /* capture optional */
            }
            this.setComparingOriginal(true);
            compareBtn.setAttribute('aria-pressed', 'true');
        };
        const onCompareRelease = (e: PointerEvent): void => {
            e.preventDefault();
            e.stopPropagation();
            if (compareBtn.hasPointerCapture?.(e.pointerId)) {
                try {
                    compareBtn.releasePointerCapture(e.pointerId);
                } catch {
                    /* ignore */
                }
            }
            this.setComparingOriginal(false);
            compareBtn.setAttribute('aria-pressed', 'false');
        };
        const onSend = (e: MouseEvent): void => {
            e.preventDefault();
            e.stopPropagation();
            if (sendBtn.disabled) {
                this.notifyUser(nls.localize(
                    'qaap/preview/annotateNothingToAttach',
                    'Confirm at least one annotation before adding to chat.',
                ), 'warn');
                return;
            }
            void this.addAnnotationsToChat();
        };
        closeBtn.addEventListener('click', onClose);
        undoBtn.addEventListener('click', onUndo);
        screenshotBtn.addEventListener('click', onScreenshot);
        const onCompareLostCapture = (): void => {
            this.setComparingOriginal(false);
            compareBtn.setAttribute('aria-pressed', 'false');
        };
        compareBtn.addEventListener('pointerdown', onCompareDown);
        compareBtn.addEventListener('pointerup', onCompareRelease);
        compareBtn.addEventListener('pointercancel', onCompareRelease);
        compareBtn.addEventListener('lostpointercapture', onCompareLostCapture);
        sendBtn.addEventListener('click', onSend);
        this.toDispose.push(Disposable.create(() => {
            this.setComparingOriginal(false);
            closeBtn.removeEventListener('click', onClose);
            undoBtn.removeEventListener('click', onUndo);
            screenshotBtn.removeEventListener('click', onScreenshot);
            compareBtn.removeEventListener('pointerdown', onCompareDown);
            compareBtn.removeEventListener('pointerup', onCompareRelease);
            compareBtn.removeEventListener('pointercancel', onCompareRelease);
            compareBtn.removeEventListener('lostpointercapture', onCompareLostCapture);
            sendBtn.removeEventListener('click', onSend);
            bar.remove();
            this.annotateUrlField?.classList.remove('qaap-mod-annotate-hidden');
            this.annotateChromeToolbar?.classList.remove('qaap-mod-annotate-active');
            this.annotateToolbar = undefined;
            this.annotateUrlField = undefined;
            this.annotateChromeToolbar = undefined;
            this.annotateSendButton = undefined;
            this.annotateSendBadge = undefined;
            this.annotateUndoButton = undefined;
            this.annotateScreenshotButton = undefined;
            this.annotateCompareButton = undefined;
        }));
        this.syncAnnotateToolbar();
    }

    protected syncAnnotateToolbar(): void {
        const active = this.mode === 'annotate';
        if (!active) {
            this.setComparingOriginal(false);
        }
        this.annotateToolbar?.classList.toggle('qaap-mod-visible', active);
        this.annotateUrlField?.classList.toggle('qaap-mod-annotate-hidden', active);
        this.annotateChromeToolbar?.classList.toggle('qaap-mod-annotate-active', active);

        const scope = this.options.getScope();
        const readyCount = scope ? this.countReadyAnnotations(scope) : 0;
        const scopedCount = scope ? this.store.listScope(scope).length : 0;

        if (this.annotateSendBadge) {
            this.annotateSendBadge.textContent = String(readyCount);
            this.annotateSendBadge.hidden = readyCount <= 0;
        }
        if (this.annotateSendButton) {
            this.annotateSendButton.disabled = readyCount <= 0;
            this.annotateSendButton.classList.toggle('qaap-mod-disabled', readyCount <= 0);
        }
        if (this.annotateUndoButton) {
            this.annotateUndoButton.disabled = scopedCount <= 0;
            this.annotateUndoButton.classList.toggle('qaap-mod-disabled', scopedCount <= 0);
        }
    }

    protected countReadyAnnotations(
        scope: Pick<PreviewAnnotationScope, 'workspaceId' | 'threadId' | 'previewUrl' | 'route'>,
    ): number {
        return this.store.listScope(scope).filter(item => item.status === 'confirmed').length;
    }
}

function toPickedElementShim(payload: AnnotationPointPayload): PickedElement {
    const el = payload.element;
    return {
        pickedId: el?.pickedId ?? 'annotate',
        tagName: el?.tagName ?? 'div',
        classes: [],
        attributes: el?.attributes ? [...el.attributes] : [],
        textPreview: el?.text ?? '',
        outerHTML: '',
        domPath: el?.domPath ?? '',
        position: el?.rect ?? { top: 0, left: 0, width: 0, height: 0 },
        computedStyles: {},
        ancestors: [],
        pageUrl: payload.pageUrl,
    };
}
