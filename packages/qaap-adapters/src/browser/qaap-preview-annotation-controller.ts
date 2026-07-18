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
    buildAnnotateChatAttachArgs,
    QAAP_WORK_HUB_ATTACH_COMPOSER_CONTEXT_COMMAND,
    type PreviewAnnotationChatImageAttachment,
} from './qaap-preview-annotation-context';
import { mountPreviewAnnotationMarkers, type AnnotationMarkerPosition, type PreviewAnnotationMarkersHandle } from './qaap-preview-annotation-markers';
import {
    mountAnnotationCommentPopover,
    type AnnotationCommentPopoverHandle,
    type AnnotationComposerSessionControls,
    type AnnotationPopoverElementRef,
} from './qaap-preview-annotation-popover';
import {
    createPreviewAnnotation,
    isBlankAnnotationComment,
    PreviewAnnotationStore,
} from './qaap-preview-annotation-store';
import {
    listPreviewAnnotationElements,
    previewAnnotationElementKey,
    type PreviewAnnotation,
    type PreviewAnnotationElementMeta,
    type PreviewAnnotationScope,
} from './qaap-preview-annotation-types';
import {
    blobToBase64,
    captureSameOriginPreview,
    previewNotify,
    writePngBlobToClipboard,
} from './qaap-preview-overflow-actions';

/**
 * Side-by-side compare silhouette (left/right rounded brackets + center split).
 * Closer to the hold-to-see-original affordance than `codicon-diff-single` or
 * filled pane icons like `codicon-split-horizontal`.
 */
function createHoldToSeeOriginalIcon(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.classList.add('qaap-preview-annotate-toolbar-compare-icon');

    const stroke = (d: string): SVGPathElement => {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'currentColor');
        path.setAttribute('stroke-width', '1.2');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        path.setAttribute('d', d);
        return path;
    };

    // Left rounded bracket, center divider, right rounded bracket.
    svg.append(
        stroke('M6.25 3.25H4.5A1.25 1.25 0 0 0 3.25 4.5v7A1.25 1.25 0 0 0 4.5 12.75h1.75'),
        stroke('M8 3.25v9.5'),
        stroke('M9.75 3.25H11.5A1.25 1.25 0 0 1 12.75 4.5v7A1.25 1.25 0 0 1 11.5 12.75H9.75'),
    );

    return svg;
}

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
    /** Authenticated bridge transport supplied by QaapPreviewFramePicker in production. */
    readonly postBridgeMessage?: (message: Record<string, unknown>) => boolean;
    readonly isBridgeMessage?: (event: Pick<MessageEvent, 'data' | 'source' | 'origin'>) => boolean;
    readonly toDispose: DisposableCollection;
    /**
     * Optional override for the annotate-toolbar camera control.
     * Default: capture preview → clipboard + attach as chat context for Send.
     */
    readonly takeScreenshot?: () => void | Promise<void>;
    /**
     * Work Hub sticky-composer agent/model controls for the annotation popover footer.
     */
    readonly composerSession?: AnnotationComposerSessionControls;
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
    protected sendInFlight = false;
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
    protected composerSession: AnnotationComposerSessionControls | undefined;
    /** Latest annotate-toolbar screenshot; included with Send as image chat context. */
    protected pendingChatScreenshot: PreviewAnnotationChatImageAttachment | undefined;

    constructor(protected readonly options: QaapPreviewAnnotationControllerOptions) {
        this.store = options.store ?? new PreviewAnnotationStore();
        this.toolbarHost = options.toolbarHost;
        this.notify = options.notify;
        this.composerSession = options.composerSession;
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

    /** Wire Work Hub agent/model session controls into the annotation popover footer. */
    setComposerSession(session: AnnotationComposerSessionControls | undefined): void {
        this.composerSession = session;
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
        if (this.sendInFlight) {
            return;
        }
        const scope = this.options.getScope();
        if (!scope) {
            return;
        }
        // A typed-but-unconfirmed popover draft is the user's most recent intent — commit it
        // instead of silently dropping it when Send is tapped with the popover still open.
        this.popover?.commit();
        // Send every confirmed annotation of this conversation, not just the current route's:
        // SPA navigation between Confirm and Send must never turn Send into a silent no-op.
        const confirmed = this.listConfirmedForConversation(scope);
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
        const images = this.pendingChatScreenshot ? [this.pendingChatScreenshot] : undefined;
        const routes = new Set(confirmed.map(item => item.route));
        const titleRoute = routes.size === 1 ? confirmed[0]!.route : scope.route;
        const attachArgs = buildAnnotateChatAttachArgs(
            confirmed,
            titleRoute,
            scope.viewportMode,
            images,
        );
        if (!attachArgs) {
            return;
        }
        const annotationIds = confirmed.map(item => item.id);
        this.sendInFlight = true;
        try {
            const sent = await this.options.commands.executeCommand(
                QAAP_WORK_HUB_ATTACH_COMPOSER_CONTEXT_COMMAND,
                attachArgs,
            );
            if (sent !== true) {
                this.notifyUser(nls.localize(
                    'qaap/preview/annotateSendFailed',
                    'Could not send annotations to chat. Open Work Hub and try again.',
                ), 'warn');
                return;
            }
            this.clearAnnotationsAfterSuccessfulSend(scope, annotationIds);
            this.notifyUser(this.formatAnnotationsSentToast(annotationIds.length));
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            this.notifyUser(nls.localize(
                'qaap/preview/annotateAttachFailed',
                'Could not attach annotations: {0}',
                detail,
            ), 'warn');
        } finally {
            this.sendInFlight = false;
        }
    }

    /** Confirmed annotations for the whole conversation (any route of this preview thread). */
    protected listConfirmedForConversation(scope: PreviewAnnotationScope): PreviewAnnotation[] {
        return this.store.listForConversation(scope.workspaceId, scope.threadId, scope.previewId ?? scope.previewUrl)
            .filter(item => item.status === 'confirmed');
    }

    /**
     * Toolbar × — leaving Annotate discards the session: every annotation of this preview
     * conversation (any route), the open comment popover, and the pending screenshot.
     */
    protected exitAnnotateModeAndClear(): void {
        const scope = this.options.getScope();
        this.pendingChatScreenshot = undefined;
        this.provisionalId = undefined;
        this.closePopover();
        this.setComparingOriginal(false);
        if (scope) {
            for (const item of this.store.listForConversation(
                scope.workspaceId,
                scope.threadId,
                scope.previewId ?? scope.previewUrl,
            )) {
                this.store.remove(item.id);
            }
            this.store.clearScope(scope);
        }
        this.positions.clear();
        this.refreshMarkers();
        this.setInteractionMode('browse');
    }

    /**
     * After a successful Work Hub attach/submit: remove exactly the sent annotations plus any
     * leftover drafts in the current scope, hide markers, close the comment popover, reset the
     * toolbar badge, and return to browse.
     */
    protected clearAnnotationsAfterSuccessfulSend(scope: PreviewAnnotationScope, sentIds: readonly string[]): void {
        this.pendingChatScreenshot = undefined;
        this.provisionalId = undefined;
        this.closePopover();
        this.setComparingOriginal(false);
        for (const id of sentIds) {
            this.store.remove(id);
            this.positions.delete(id);
        }
        this.store.clearScope(scope);
        this.positions.clear();
        this.refreshMarkers();
        // Prefer browse so the URL toolbar returns; annotate can be started again empty.
        if (this.mode === 'annotate') {
            this.setInteractionMode('browse');
        } else {
            this.syncAnnotateToolbar();
        }
    }

    /** Test seam: seed a pending screenshot that Send includes as image context. */
    setPendingChatScreenshot(image: PreviewAnnotationChatImageAttachment | undefined): void {
        this.pendingChatScreenshot = image;
    }

    getPendingChatScreenshot(): PreviewAnnotationChatImageAttachment | undefined {
        return this.pendingChatScreenshot;
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
        // Agent/model picker (portaled above the annotation card) owns Escape first.
        if (document.querySelector(
            '.qaap-sticky-composer-sheet-popover, .theia-mobile-sticky-composer-sheet, .theia-mobile-projects-sticky-composer-sheet',
        )) {
            return false;
        }
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
    onWindowMessage(event: Pick<MessageEvent, 'data' | 'source'> & Partial<Pick<MessageEvent, 'origin'>>): void {
        if (!event.data || typeof event.data !== 'object') {
            return;
        }
        if (this.options.isBridgeMessage) {
            if (!this.options.isBridgeMessage(event as Pick<MessageEvent, 'data' | 'source' | 'origin'>)) {
                return;
            }
        } else if (!this.options.frame.contentWindow || event.source !== this.options.frame.contentWindow) {
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

        // Cursor-style: empty draft = retarget (replace the provisional element).
        // Only append another unique element once the user has typed a comment.
        if (this.provisionalId && this.popover && payload.element) {
            const draft = this.store.get(this.provisionalId);
            if (draft) {
                const liveComment = this.popover.getComment();
                const hasTypedText = !isBlankAnnotationComment(liveComment);
                if (hasTypedText) {
                    const existing = listPreviewAnnotationElements(draft);
                    const nextMeta = buildAnnotationElementMeta(payload);
                    if (nextMeta) {
                        const nextKey = previewAnnotationElementKey(nextMeta);
                        if (existing.some(item => previewAnnotationElementKey(item) === nextKey)) {
                            return;
                        }
                        const elements = [...existing, nextMeta];
                        this.store.update(draft.id, {
                            comment: liveComment,
                            element: elements[0],
                            elements,
                        });
                        this.popover.setElementRefs(elements.map(toPopoverElementRef));
                        this.syncAnnotateToolbar();
                        return;
                    }
                }
            }
        }

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

        const elementMeta = payload.element ? buildAnnotationElementMeta(payload) : undefined;
        const elements = elementMeta ? [elementMeta] : undefined;

        const annotation = createPreviewAnnotation(activeScope, {
            comment: '',
            anchor,
            documentXRatio: payload.documentXRatio,
            documentYRatio: payload.documentYRatio,
            element: elementMeta,
            elements,
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
        const elementRefs = listPreviewAnnotationElements(annotation).map(toPopoverElementRef);
        const fallbackTag = annotation.anchor.kind === 'element'
            ? annotation.anchor.selector.split(/[\s.#[:>+~]/)[0]
            : undefined;
        this.popover = mountAnnotationCommentPopover({
            anchorClientX: clientX,
            anchorClientY: clientY,
            panel,
            initialComment: annotation.comment,
            elementRefs: elementRefs.length > 0
                ? elementRefs
                : (fallbackTag ? [{ tagName: fallbackTag }] : undefined),
            allowDelete: !isNew,
            composerSession: this.composerSession,
            onWarn: message => {
                this.notify?.(message, 'warn');
                this.options.messageService.warn(message);
            },
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
        // The open popover flips Send to enabled (commit-on-send) — resync after mount.
        this.syncAnnotateToolbar();
    }

    protected closePopover(): void {
        this.popover?.dispose();
        this.popover = undefined;
        this.syncAnnotateToolbar();
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
        if (this.options.postBridgeMessage) {
            this.options.postBridgeMessage({ type: ELEMENT_ANNOTATION_REANCHOR_TYPE, payload: { items } });
        } else {
            win.postMessage({ type: ELEMENT_ANNOTATION_REANCHOR_TYPE, payload: { items } }, this.frameTargetOrigin());
        }
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
        if (this.options.postBridgeMessage) {
            this.options.postBridgeMessage({ type: ELEMENT_SET_MODE_TYPE, mode });
        } else {
            win.postMessage({ type: ELEMENT_SET_MODE_TYPE, mode }, this.frameTargetOrigin());
        }
    }

    protected frameTargetOrigin(): string {
        try {
            const origin = new URL(this.options.frame.src || window.location.href, window.location.href).origin;
            return origin === 'null' ? window.location.origin : origin;
        } catch {
            return window.location.origin;
        }
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
        await this.captureScreenshotForChat();
    }

    /**
     * Annotate-toolbar camera: capture preview frame, copy to clipboard, and keep as
     * pending chat context for the next Send. Never triggers a download.
     */
    protected async captureScreenshotForChat(): Promise<void> {
        const frame = this.options.frame;
        const doc = frame.contentDocument;
        if (!doc?.body) {
            this.notifyUser(nls.localize(
                'qaap/preview/screenshotUnavailable',
                'Screenshots only work for same-origin previews. Open in browser to capture cross-origin pages.',
            ), 'warn');
            return;
        }
        try {
            const blob = await captureSameOriginPreview(doc, frame);
            if (!blob) {
                throw new Error('capture failed');
            }
            const data = await blobToBase64(blob);
            this.pendingChatScreenshot = {
                name: 'preview-screenshot.png',
                mimeType: 'image/png',
                data,
            };
            const copied = await writePngBlobToClipboard(blob);
            if (copied) {
                this.notifyUser(nls.localize(
                    'qaap/preview/screenshotCopiedAndAttached',
                    'Screenshot copied and attached',
                ));
            } else {
                this.notifyUser(nls.localize(
                    'qaap/preview/screenshotAttachedClipboardBlocked',
                    'Screenshot attached (clipboard unavailable)',
                ), 'warn');
            }
        } catch {
            this.notifyUser(nls.localize(
                'qaap/preview/screenshotFailed',
                'Could not capture a screenshot for this page.',
            ), 'warn');
        }
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
        screenshotBtn.title = nls.localize(
            'qaap/preview/screenshotAndAttach',
            'Screenshot and attach',
        );
        screenshotBtn.setAttribute('aria-label', screenshotBtn.title);

        const compareBtn = document.createElement('button');
        compareBtn.type = 'button';
        compareBtn.className = 'qaap-preview-annotate-toolbar-icon-btn qaap-preview-annotate-toolbar-compare-btn';
        compareBtn.title = nls.localize('qaap/preview/annotateHoldToSeeOriginal', 'Hold to see original');
        compareBtn.setAttribute('aria-label', compareBtn.title);
        compareBtn.setAttribute('aria-pressed', 'false');
        compareBtn.append(createHoldToSeeOriginalIcon());

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
            this.exitAnnotateModeAndClear();
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
        // An open comment popover counts as sendable: Send commits its draft first, so the
        // button must not stay disabled while the user is still typing the only annotation.
        const sendReady = readyCount > 0 || !!this.popover;

        if (this.annotateSendBadge) {
            this.annotateSendBadge.textContent = String(readyCount);
            this.annotateSendBadge.hidden = readyCount <= 0;
        }
        if (this.annotateSendButton) {
            this.annotateSendButton.disabled = !sendReady;
            this.annotateSendButton.classList.toggle('qaap-mod-disabled', !sendReady);
        }
        if (this.annotateUndoButton) {
            this.annotateUndoButton.disabled = scopedCount <= 0;
            this.annotateUndoButton.classList.toggle('qaap-mod-disabled', scopedCount <= 0);
        }
    }

    protected countReadyAnnotations(scope: PreviewAnnotationScope): number {
        // Mirror addAnnotationsToChat: Send covers every confirmed annotation of the
        // conversation, so the badge/enabled state must count the same set.
        return this.listConfirmedForConversation(scope).length;
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

function extractElementIdHint(element: NonNullable<AnnotationPointPayload['element']>): string | undefined {
    const attrId = element.attributes?.find(item => item.name === 'id')?.value?.trim();
    if (attrId) {
        return attrId.slice(0, 24);
    }
    const selectorId = element.selector.match(/#([A-Za-z][\w-]*)/)?.[1];
    if (selectorId) {
        return selectorId.slice(0, 24);
    }
    const picked = element.pickedId?.trim();
    if (picked && picked !== 'annotate' && picked.length >= 4) {
        return picked.slice(-7);
    }
    return undefined;
}

function buildAnnotationElementMeta(payload: AnnotationPointPayload): PreviewAnnotationElementMeta | undefined {
    if (!payload.element) {
        return undefined;
    }
    let elementMeta: PreviewAnnotationElementMeta = {
        tagName: payload.element.tagName,
        selector: payload.element.selector,
        idHint: extractElementIdHint(payload.element),
        text: payload.element.text,
        ariaLabel: payload.element.ariaLabel,
    };
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
    return elementMeta;
}

function toPopoverElementRef(meta: PreviewAnnotationElementMeta): AnnotationPopoverElementRef {
    const tagName = meta.tagName.trim().toLowerCase() || 'div';
    const detail = meta.idHint?.trim();
    return detail ? { tagName, detail } : { tagName };
}
