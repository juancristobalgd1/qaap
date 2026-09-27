// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { CommandRegistry } from '@theia/core/lib/common/command';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { MessageService } from '@theia/core/lib/common/message-service';
import {
    type AnnotationPointPayload,
    type AnnotationReanchorResultItem,
    type PreviewInteractionMode,
} from '@theia/qaap-element-inspector/lib/browser/element-inspector-types';
import { guessSourceLocationFromElement } from '@theia/qaap-element-inspector/lib/browser/qaap-element-inspector-source-map';
import type { PickedElement } from '@theia/qaap-element-inspector/lib/browser/element-inspector-types';
import {
    type PreviewAnnotationChatImageAttachment,
} from './qaap-preview-annotation-context';
import { mountPreviewAnnotationMarkers, type AnnotationMarkerPosition, type PreviewAnnotationMarkersHandle } from './qaap-preview-annotation-markers';
import {
    type AnnotationCommentPopoverHandle,
    type AnnotationComposerSessionControls,
    type AnnotationPopoverElementRef,
    type AnnotationPopoverPendingImage,
} from './qaap-preview-annotation-popover';
import {
    PreviewAnnotationStore,
} from './qaap-preview-annotation-store';
import {
    type PreviewAnnotation,
    type PreviewAnnotationElementMeta,
    type PreviewAnnotationScope,
} from './qaap-preview-annotation-types';
import { addAnnotationsToChatExtracted, addPendingChatImageFromPasteExtracted, askDeleteAllConfirmationExtracted, clearAllAnnotationsExtracted, clearAnnotationsAfterSuccessfulSendExtracted, clearPendingChatImagesExtracted, confirmAndClearAllAnnotationsExtracted, disposeExtracted, exitAnnotateModeExtracted, formatAnnotationsSentToastExtracted, handleEscapeExtracted, hasClearableAnnotationsExtracted, installMessageListenerExtracted, listPopoverImagesExtracted, notifyUserExtracted, onFrameLoadExtracted, onWindowMessageExtracted, redoLastAnnotationExtracted, removePendingChatImageExtracted, setInteractionModeExtracted, setPendingChatScreenshotExtracted, setToolbarHostExtracted, undoLastAnnotationExtracted } from './qaap-preview-annotation-controller-render2';
import { cancelScheduledReanchorExtracted, captureScreenshotForChatExtracted, closePopoverExtracted, frameTargetOriginExtracted, handleAnnotationPointExtracted, handleReanchorResultExtracted, installReanchorObserversExtracted, openExistingAnnotationExtracted, openPopoverForExtracted, postSetModeExtracted, refreshMarkersExtracted, requestReanchorExtracted, scheduleReanchorExtracted, setComparingOriginalExtracted, takeScreenshotExtracted } from './qaap-preview-annotation-controller-streaming2';
import { countReadyAnnotationsExtracted, ensureAnnotateToolbarExtracted, syncAnnotateToolbarExtracted } from './qaap-preview-annotation-controller-timeline2';

/**
 * Side-by-side compare silhouette (left/right rounded brackets + center split).
 * Closer to the hold-to-see-original affordance than `codicon-diff-single` or
 * filled pane icons like `codicon-split-horizontal`.
 */
export function createHoldToSeeOriginalIcon(): SVGSVGElement {
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
    /**
     * Optional confirm gate for toolbar delete-all. Defaults to a Theia ConfirmDialog
     * (lazy-loaded so unit tests do not pull Lumino).
     */
    readonly confirmDeleteAllAnnotations?: () => boolean | Promise<boolean>;
}

/**
 * Annotate mode for a single preview iframe. Reuses the Preview Bridge for hit-testing /
 * set-mode / re-anchor; Select continues to use the one-shot picker script.
 */
export class QaapPreviewAnnotationController implements Disposable {

    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public readonly toDispose = new DisposableCollection();
    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public readonly store: PreviewAnnotationStore;
    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public mode: PreviewInteractionMode = 'browse';
    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public markers: PreviewAnnotationMarkersHandle | undefined;
    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public positions = new Map<string, AnnotationMarkerPosition>();
    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public popover: AnnotationCommentPopoverHandle | undefined;
    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public provisionalId: string | undefined;
    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public sendInFlight = false;
    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public reanchorRaf = 0;
    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public toolbarHost: HTMLElement | undefined;
    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public annotateToolbar: HTMLElement | undefined;
    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public annotateUrlField: HTMLElement | undefined;
    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public annotateChromeToolbar: HTMLElement | undefined;
    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public annotateSendButton: HTMLButtonElement | undefined;
    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public annotateSendBadge: HTMLElement | undefined;
    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public annotateUndoButton: HTMLButtonElement | undefined;
    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public annotateRedoButton: HTMLButtonElement | undefined;
    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public annotateDeleteButton: HTMLButtonElement | undefined;
    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public annotateScreenshotButton: HTMLButtonElement | undefined;
    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public annotateCompareButton: HTMLButtonElement | undefined;
    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public screenshotCaptureInFlight: Promise<void> | undefined;
    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public comparingOriginal = false;
    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public listenerInstalled = false;
    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public notify: ((message: string, kind?: 'info' | 'warn') => void) | undefined;
    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public composerSession: AnnotationComposerSessionControls | undefined;
    /**
     * Pending images for Annotate Send (toolbar screenshot and/or pasted images).
     * Preview URLs are shown in the open comment popover.
     * @internal Used by the extracted qaap-preview-annotation-controller-* modules.
     */
    public pendingChatImages: Array<{
        readonly id: string;
        readonly previewUrl: string;
        readonly attachment: PreviewAnnotationChatImageAttachment;
    }> = [];

    constructor(
        /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
        public readonly options: QaapPreviewAnnotationControllerOptions,
    ) {
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

    setToolbarHost(host: HTMLElement | undefined): void {
        setToolbarHostExtracted(this, host);
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
        disposeExtracted(this);
    }

    getInteractionMode(): PreviewInteractionMode {
        return this.mode;
    }

    setInteractionMode(mode: PreviewInteractionMode): void {
        setInteractionModeExtracted(this, mode);
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
        undoLastAnnotationExtracted(this);
    }

    redoLastAnnotation(): void {
        redoLastAnnotationExtracted(this);
    }

    async addAnnotationsToChat(): Promise<void> {
        return addAnnotationsToChatExtracted(this);
    }

    /**
     * Confirmed annotations for the whole conversation (any route of this preview thread).
     * @internal Used by the extracted qaap-preview-annotation-controller-* modules.
     */
    public listConfirmedForConversation(scope: PreviewAnnotationScope): PreviewAnnotation[] {
        return this.store.listForConversation(scope.workspaceId, scope.threadId, scope.previewId ?? scope.previewUrl)
            .filter(item => item.status === 'confirmed');
    }

    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public exitAnnotateMode(): void {
        exitAnnotateModeExtracted(this);
    }

    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public clearAllAnnotations(): void {
        clearAllAnnotationsExtracted(this);
    }

    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public async confirmAndClearAllAnnotations(): Promise<void> {
        return confirmAndClearAllAnnotationsExtracted(this);
    }

    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public async askDeleteAllConfirmation(): Promise<boolean> {
        return askDeleteAllConfirmationExtracted(this);
    }

    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public hasClearableAnnotations(): boolean {
        return hasClearableAnnotationsExtracted(this);
    }

    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public clearAnnotationsAfterSuccessfulSend(scope: PreviewAnnotationScope, sentIds: readonly string[]): void {
        clearAnnotationsAfterSuccessfulSendExtracted(this, scope, sentIds);
    }

    setPendingChatScreenshot(image: PreviewAnnotationChatImageAttachment | undefined): void {
        setPendingChatScreenshotExtracted(this, image);
    }

    getPendingChatScreenshot(): PreviewAnnotationChatImageAttachment | undefined {
        return this.pendingChatImages[0]?.attachment;
    }

    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public listPopoverImages(): AnnotationPopoverPendingImage[] {
        return listPopoverImagesExtracted(this);
    }

    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public syncPopoverImages(): void {
        this.popover?.setImages(this.listPopoverImages());
    }

    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public clearPendingChatImages(): void {
        clearPendingChatImagesExtracted(this);
    }

    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public removePendingChatImage(id: string): void {
        removePendingChatImageExtracted(this, id);
    }

    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public async addPendingChatImageFromPaste(image: { readonly id: string; readonly file: File; readonly previewUrl: string; readonly name: string; }): Promise<void> {
        return addPendingChatImageFromPasteExtracted(this, image);
    }

    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public formatAnnotationsSentToast(count: number): string {
        return formatAnnotationsSentToastExtracted(this, count);
    }

    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public notifyUser(message: string, kind: 'info' | 'warn' = 'info'): void {
        notifyUserExtracted(this, message, kind);
    }

    handleEscape(): boolean {
        return handleEscapeExtracted(this);
    }

    onFrameLoad(): void {
        onFrameLoadExtracted(this);
    }

    protected installMessageListener(): void {
        installMessageListenerExtracted(this);
    }

    onWindowMessage(event: Pick<MessageEvent, 'data' | 'source'> & Partial<Pick<MessageEvent, 'origin'>>): void {
        onWindowMessageExtracted(this, event);
    }

    protected installReanchorObservers(): void {
        installReanchorObserversExtracted(this);
    }

    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public handleAnnotationPoint(payload: AnnotationPointPayload): void {
        handleAnnotationPointExtracted(this, payload);
    }

    protected openExistingAnnotation(id: string, clientX: number, clientY: number): void {
        openExistingAnnotationExtracted(this, id, clientX, clientY);
    }

    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public openPopoverFor(annotation: PreviewAnnotation, clientX: number, clientY: number, isNew: boolean): void {
        openPopoverForExtracted(this, annotation, clientX, clientY, isNew);
    }

    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public closePopover(): void {
        closePopoverExtracted(this);
    }

    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public scheduleReanchor(): void {
        scheduleReanchorExtracted(this);
    }

    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public cancelScheduledReanchor(id: number): void {
        cancelScheduledReanchorExtracted(this, id);
    }

    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public requestReanchor(): void {
        requestReanchorExtracted(this);
    }

    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public handleReanchorResult(payload: { items?: AnnotationReanchorResultItem[] }): void {
        handleReanchorResultExtracted(this, payload);
    }

    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public refreshMarkers(): void {
        refreshMarkersExtracted(this);
    }

    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public postSetMode(mode: PreviewInteractionMode): void {
        postSetModeExtracted(this, mode);
    }

    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public frameTargetOrigin(): string {
        return frameTargetOriginExtracted(this);
    }

    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public setComparingOriginal(active: boolean): void {
        setComparingOriginalExtracted(this, active);
    }

    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public async takeScreenshot(): Promise<void> {
        return takeScreenshotExtracted(this);
    }

    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public async captureScreenshotForChat(): Promise<void> {
        return captureScreenshotForChatExtracted(this);
    }

    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public ensureAnnotateToolbar(): void {
        ensureAnnotateToolbarExtracted(this);
    }

    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public syncAnnotateToolbar(): void {
        syncAnnotateToolbarExtracted(this);
    }

    /** @internal Used by the extracted qaap-preview-annotation-controller-* modules. */
    public countReadyAnnotations(scope: PreviewAnnotationScope): number {
        return countReadyAnnotationsExtracted(this, scope);
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

export function buildAnnotationElementMeta(payload: AnnotationPointPayload): PreviewAnnotationElementMeta | undefined {
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

export function toPopoverElementRef(meta: PreviewAnnotationElementMeta): AnnotationPopoverElementRef {
    // Tag only in the chip UI; idHint stays on the annotation for agent context / dedupe.
    return { tagName: meta.tagName.trim().toLowerCase() || 'div' };
}
