// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************
// @ts-nocheck

import { CommandRegistry } from '@theia/core/lib/common/command';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { nls } from '@theia/core/lib/common/nls';
import { MessageService } from '@theia/core/lib/common/message-service';
import { generateUuid } from '@theia/core/lib/common/uuid';
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
    type AnnotationPopoverPendingImage,
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
import { addAnnotationsToChatExtracted, addPendingChatImageFromPasteExtracted, askDeleteAllConfirmationExtracted, clearAllAnnotationsExtracted, clearAnnotationsAfterSuccessfulSendExtracted, clearPendingChatImagesExtracted, confirmAndClearAllAnnotationsExtracted, disposeExtracted, exitAnnotateModeExtracted, formatAnnotationsSentToastExtracted, handleEscapeExtracted, hasClearableAnnotationsExtracted, installMessageListenerExtracted, listPopoverImagesExtracted, notifyUserExtracted, onFrameLoadExtracted, onWindowMessageExtracted, redoLastAnnotationExtracted, removePendingChatImageExtracted, setInteractionModeExtracted, setPendingChatScreenshotExtracted, setToolbarHostExtracted, undoLastAnnotationExtracted } from './qaap-preview-annotation-controller-render2';
import { cancelScheduledReanchorExtracted, captureScreenshotForChatExtracted, closePopoverExtracted, frameTargetOriginExtracted, handleAnnotationPointExtracted, handleReanchorResultExtracted, installReanchorObserversExtracted, openExistingAnnotationExtracted, openPopoverForExtracted, postSetModeExtracted, refreshMarkersExtracted, requestReanchorExtracted, scheduleReanchorExtracted, setComparingOriginalExtracted, takeScreenshotExtracted } from './qaap-preview-annotation-controller-streaming2';
import { countReadyAnnotationsExtracted, ensureAnnotateToolbarExtracted, syncAnnotateToolbarExtracted } from './qaap-preview-annotation-controller-timeline2';

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
    protected annotateRedoButton: HTMLButtonElement | undefined;
    protected annotateDeleteButton: HTMLButtonElement | undefined;
    protected annotateScreenshotButton: HTMLButtonElement | undefined;
    protected annotateCompareButton: HTMLButtonElement | undefined;
    protected screenshotCaptureInFlight: Promise<void> | undefined;
    protected comparingOriginal = false;
    protected listenerInstalled = false;
    protected notify: ((message: string, kind?: 'info' | 'warn') => void) | undefined;
    protected composerSession: AnnotationComposerSessionControls | undefined;
    /**
     * Pending images for Annotate Send (toolbar screenshot and/or pasted images).
     * Preview URLs are shown in the open comment popover.
     */
    protected pendingChatImages: Array<{
        readonly id: string;
        readonly previewUrl: string;
        readonly attachment: PreviewAnnotationChatImageAttachment;
    }> = [];

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

    /** Confirmed annotations for the whole conversation (any route of this preview thread). */
    protected listConfirmedForConversation(scope: PreviewAnnotationScope): PreviewAnnotation[] {
        return this.store.listForConversation(scope.workspaceId, scope.threadId, scope.previewId ?? scope.previewUrl)
            .filter(item => item.status === 'confirmed');
    }

    protected exitAnnotateMode(): void {
        exitAnnotateModeExtracted(this);
    }

    protected clearAllAnnotations(): void {
        clearAllAnnotationsExtracted(this);
    }

    protected async confirmAndClearAllAnnotations(): Promise<void> {
        return confirmAndClearAllAnnotationsExtracted(this);
    }

    protected async askDeleteAllConfirmation(): Promise<boolean> {
        return askDeleteAllConfirmationExtracted(this);
    }

    protected hasClearableAnnotations(): boolean {
        return hasClearableAnnotationsExtracted(this);
    }

    protected clearAnnotationsAfterSuccessfulSend(scope: PreviewAnnotationScope, sentIds: readonly string[]): void {
        clearAnnotationsAfterSuccessfulSendExtracted(this, scope, sentIds);
    }

    setPendingChatScreenshot(image: PreviewAnnotationChatImageAttachment | undefined): void {
        setPendingChatScreenshotExtracted(this, image);
    }

    getPendingChatScreenshot(): PreviewAnnotationChatImageAttachment | undefined {
        return this.pendingChatImages[0]?.attachment;
    }

    protected listPopoverImages(): AnnotationPopoverPendingImage[] {
        return listPopoverImagesExtracted(this);
    }

    protected syncPopoverImages(): void {
        this.popover?.setImages(this.listPopoverImages());
    }

    protected clearPendingChatImages(): void {
        clearPendingChatImagesExtracted(this);
    }

    protected removePendingChatImage(id: string): void {
        removePendingChatImageExtracted(this, id);
    }

    protected async addPendingChatImageFromPaste(image: { readonly id: string; readonly file: File; readonly previewUrl: string; readonly name: string; }): Promise<void> {
        return addPendingChatImageFromPasteExtracted(this, image);
    }

    protected formatAnnotationsSentToast(count: number): string {
        return formatAnnotationsSentToastExtracted(this, count);
    }

    protected notifyUser(message: string, kind: 'info' | 'warn' = 'info'): void {
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

    protected handleAnnotationPoint(payload: AnnotationPointPayload): void {
        handleAnnotationPointExtracted(this, payload);
    }

    protected openExistingAnnotation(id: string, clientX: number, clientY: number): void {
        openExistingAnnotationExtracted(this, id, clientX, clientY);
    }

    protected openPopoverFor(annotation: PreviewAnnotation, clientX: number, clientY: number, isNew: boolean): void {
        openPopoverForExtracted(this, annotation, clientX, clientY, isNew);
    }

    protected closePopover(): void {
        closePopoverExtracted(this);
    }

    protected scheduleReanchor(): void {
        scheduleReanchorExtracted(this);
    }

    protected cancelScheduledReanchor(id: number): void {
        cancelScheduledReanchorExtracted(this, id);
    }

    protected requestReanchor(): void {
        requestReanchorExtracted(this);
    }

    protected handleReanchorResult(payload: { items?: AnnotationReanchorResultItem[] }): void {
        handleReanchorResultExtracted(this, payload);
    }

    protected refreshMarkers(): void {
        refreshMarkersExtracted(this);
    }

    protected postSetMode(mode: PreviewInteractionMode): void {
        postSetModeExtracted(this, mode);
    }

    protected frameTargetOrigin(): string {
        return frameTargetOriginExtracted(this);
    }

    protected setComparingOriginal(active: boolean): void {
        setComparingOriginalExtracted(this, active);
    }

    protected async takeScreenshot(): Promise<void> {
        return takeScreenshotExtracted(this);
    }

    protected async captureScreenshotForChat(): Promise<void> {
        return captureScreenshotForChatExtracted(this);
    }

    protected ensureAnnotateToolbar(): void {
        ensureAnnotateToolbarExtracted(this);
    }

    protected syncAnnotateToolbar(): void {
        syncAnnotateToolbarExtracted(this);
    }

    protected countReadyAnnotations(scope: PreviewAnnotationScope): number {
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
    // Tag only in the chip UI; idHint stays on the annotation for agent context / dedupe.
    return { tagName: meta.tagName.trim().toLowerCase() || 'div' };
}
