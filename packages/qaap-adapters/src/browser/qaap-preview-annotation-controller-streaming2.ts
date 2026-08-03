// @ts-nocheck
// Extracted from qaap-preview-annotation-controller.ts

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

export function installReanchorObserversExtracted(ctx: any): void {
        const schedule = (): void => ctx.scheduleReanchor();
        window.addEventListener('resize', schedule);
        ctx.toDispose.push(Disposable.create(() => window.removeEventListener('resize', schedule)));
        const onFrameLoad = (): void => ctx.onFrameLoad();
        ctx.options.frame.addEventListener('load', onFrameLoad);
        ctx.toDispose.push(Disposable.create(() => ctx.options.frame.removeEventListener('load', onFrameLoad)));
        try {
            const ro = new ResizeObserver(() => schedule());
            ro.observe(ctx.options.frameSlot);
            ctx.toDispose.push(Disposable.create(() => ro.disconnect()));
        } catch {
            /* ResizeObserver unavailable */
        }
}

export function handleAnnotationPointExtracted(ctx: any, payload: AnnotationPointPayload): void {
        if (ctx.mode !== 'annotate' || ctx.comparingOriginal) {
            return;
        }
        const scope = ctx.options.getScope();
        if (!scope) {
            return;
        }
        // Route comes from the in-app navigation; keep previewUrl stable for isolation.
        const route = payload.route || scope.route;
        const activeScope: PreviewAnnotationScope = { ...scope, route };

        // Cursor-style: empty draft = retarget (replace the provisional element).
        // Only append another unique element once the user has typed a comment.
        if (ctx.provisionalId && ctx.popover && payload.element) {
            const draft = ctx.store.get(ctx.provisionalId);
            if (draft) {
                const liveComment = ctx.popover.getComment();
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
                        ctx.store.update(draft.id, {
                            comment: liveComment,
                            element: elements[0],
                            elements,
                        });
                        ctx.popover.setElementRefs(elements.map(toPopoverElementRef));
                        ctx.syncAnnotateToolbar();
                        return;
                    }
                }
            }
        }

        if (ctx.provisionalId) {
            ctx.store.remove(ctx.provisionalId);
            ctx.positions.delete(ctx.provisionalId);
            ctx.provisionalId = undefined;
        }
        ctx.closePopover();

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
        ctx.store.add(annotation);
        ctx.provisionalId = annotation.id;
        const frameRect = ctx.options.frame.getBoundingClientRect();
        ctx.positions.set(annotation.id, {
            id: annotation.id,
            clientX: payload.clientX,
            clientY: payload.clientY,
            unresolved: false,
        });
        ctx.refreshMarkers();
        ctx.syncAnnotateToolbar();
        ctx.openPopoverFor(annotation, frameRect.left + payload.clientX, frameRect.top + payload.clientY, true);
}

export function openExistingAnnotationExtracted(ctx: any, id: string, clientX: number, clientY: number): void {
        const annotation = ctx.store.get(id);
        if (!annotation) {
            return;
        }
        ctx.openPopoverFor(annotation, clientX, clientY, false);
}

export function openPopoverForExtracted(ctx: any, annotation: PreviewAnnotation, clientX: number, clientY: number, isNew: boolean): void {
        ctx.closePopover();
        const panel = ctx.options.frameSlot.getBoundingClientRect();
        const elementRefs = listPreviewAnnotationElements(annotation).map(toPopoverElementRef);
        const fallbackTag = annotation.anchor.kind === 'element'
            ? annotation.anchor.selector.split(/[\s.#[:>+~]/)[0]
            : undefined;
        ctx.popover = mountAnnotationCommentPopover({
            anchorClientX: clientX,
            anchorClientY: clientY,
            panel,
            initialComment: annotation.comment,
            elementRefs: elementRefs.length > 0
                ? elementRefs
                : (fallbackTag ? [{ tagName: fallbackTag }] : undefined),
            initialImages: ctx.listPopoverImages(),
            allowDelete: !isNew,
            composerSession: ctx.composerSession,
            onWarn: message => {
                ctx.notify?.(message, 'warn');
                ctx.options.messageService.warn(message);
            },
            onPasteImage: image => ctx.addPendingChatImageFromPaste(image),
            onRemoveImage: id => ctx.removePendingChatImage(id),
            onConfirm: comment => {
                if (isBlankAnnotationComment(comment)) {
                    return;
                }
                ctx.store.update(annotation.id, { comment, status: 'confirmed' });
                if (ctx.provisionalId === annotation.id) {
                    ctx.provisionalId = undefined;
                }
                ctx.popover = undefined;
                ctx.refreshMarkers();
                ctx.syncAnnotateToolbar();
            },
            onCancel: () => {
                if (isNew || ctx.provisionalId === annotation.id) {
                    ctx.store.remove(annotation.id);
                    ctx.positions.delete(annotation.id);
                    ctx.provisionalId = undefined;
                    ctx.refreshMarkers();
                    ctx.syncAnnotateToolbar();
                }
                ctx.popover = undefined;
            },
            onDelete: () => {
                ctx.store.remove(annotation.id);
                ctx.positions.delete(annotation.id);
                ctx.refreshMarkers();
                ctx.syncAnnotateToolbar();
            },
        });
        // The open popover flips Send to enabled (commit-on-send) — resync after mount.
        ctx.syncAnnotateToolbar();
}

export function closePopoverExtracted(ctx: any): void {
        ctx.popover?.dispose();
        ctx.popover = undefined;
        ctx.syncAnnotateToolbar();
}

export function scheduleReanchorExtracted(ctx: any): void {
        if (ctx.reanchorRaf) {
            ctx.cancelScheduledReanchor(ctx.reanchorRaf);
        }
        const schedule = typeof requestAnimationFrame === 'function'
            ? requestAnimationFrame
            : ((cb: FrameRequestCallback) => window.setTimeout(() => cb(Date.now()), 0) as unknown as number);
        ctx.reanchorRaf = schedule(() => {
            ctx.reanchorRaf = 0;
            ctx.requestReanchor();
        });
}

export function cancelScheduledReanchorExtracted(ctx: any, id: number): void {
        if (typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(id);
            return;
        }
        window.clearTimeout(id);
}

export function requestReanchorExtracted(ctx: any): void {
        const scope = ctx.options.getScope();
        if (!scope) {
            return;
        }
        const win = ctx.options.frame.contentWindow;
        if (!win) {
            return;
        }
        const items = ctx.store.listVisibleMarkers(scope).map(item => ({
            id: item.id,
            selector: item.anchor.kind === 'element' ? item.anchor.selector : undefined,
            documentXRatio: item.documentXRatio,
            documentYRatio: item.documentYRatio,
            xRatio: item.anchor.kind === 'element' ? item.anchor.xRatio : undefined,
            yRatio: item.anchor.kind === 'element' ? item.anchor.yRatio : undefined,
        }));
        if (items.length === 0) {
            ctx.refreshMarkers();
            return;
        }
        if (ctx.options.postBridgeMessage) {
            ctx.options.postBridgeMessage({ type: ELEMENT_ANNOTATION_REANCHOR_TYPE, payload: { items } });
        } else {
            win.postMessage({ type: ELEMENT_ANNOTATION_REANCHOR_TYPE, payload: { items } }, ctx.frameTargetOrigin());
        }
}

export function handleReanchorResultExtracted(ctx: any, payload: { items?: AnnotationReanchorResultItem[] }): void {
        const items = payload.items ?? [];
        for (const item of items) {
            ctx.positions.set(item.id, {
                id: item.id,
                clientX: item.clientX,
                clientY: item.clientY,
                unresolved: item.unresolved,
            });
            if (item.unresolved) {
                ctx.store.update(item.id, { unresolved: true });
            } else {
                ctx.store.update(item.id, { unresolved: false });
            }
        }
        ctx.refreshMarkers();
}

export function refreshMarkersExtracted(ctx: any): void {
        const scope = ctx.options.getScope();
        if (!scope || !ctx.markers) {
            ctx.markers?.sync([], []);
            return;
        }
        const annotations = ctx.store.listVisibleMarkers(scope);
        const positions = annotations
            .map(item => ctx.positions.get(item.id))
            .filter((item): item is AnnotationMarkerPosition => !!item);
        ctx.markers.sync(annotations, positions);
        ctx.markers.setVisible(!ctx.comparingOriginal);
}

export function postSetModeExtracted(ctx: any, mode: PreviewInteractionMode): void {
        const win = ctx.options.frame.contentWindow;
        if (!win) {
            return;
        }
        if (ctx.options.postBridgeMessage) {
            ctx.options.postBridgeMessage({ type: ELEMENT_SET_MODE_TYPE, mode });
        } else {
            win.postMessage({ type: ELEMENT_SET_MODE_TYPE, mode }, ctx.frameTargetOrigin());
        }
}

export function frameTargetOriginExtracted(ctx: any): string {
        try {
            const origin = new URL(ctx.options.frame.src || window.location.href, window.location.href).origin;
            return origin === 'null' ? window.location.origin : origin;
        } catch {
            return window.location.origin;
        }
}

export function setComparingOriginalExtracted(ctx: any, active: boolean): void {
        if (ctx.comparingOriginal === active) {
            return;
        }
        ctx.comparingOriginal = active;
        ctx.annotateToolbar?.classList.toggle('qaap-mod-comparing-original', active);
        ctx.annotateCompareButton?.classList.toggle('qaap-mod-pressed', active);
        ctx.markers?.setVisible(!active);
        if (active) {
            ctx.popover?.root.classList.add('qaap-mod-compare-hidden');
        } else {
            ctx.popover?.root.classList.remove('qaap-mod-compare-hidden');
        }
}

export async function takeScreenshotExtracted(ctx: any): Promise<void> {
        if (ctx.screenshotCaptureInFlight) {
            await ctx.screenshotCaptureInFlight;
            return;
        }
        const capture = (async (): Promise<void> => {
            if (ctx.options.takeScreenshot) {
                await ctx.options.takeScreenshot();
                return;
            }
            await ctx.captureScreenshotForChat();
        })();
        ctx.screenshotCaptureInFlight = capture;
        ctx.syncAnnotateToolbar();
        try {
            await capture;
        } finally {
            if (ctx.screenshotCaptureInFlight === capture) {
                ctx.screenshotCaptureInFlight = undefined;
                ctx.syncAnnotateToolbar();
            }
        }
}

export async function captureScreenshotForChatExtracted(ctx: any): Promise<void> {
        const frame = ctx.options.frame;
        const doc = frame.contentDocument;
        if (!doc?.body) {
            ctx.notifyUser(nls.localize(
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
            const previewUrl = URL.createObjectURL(blob);
            ctx.pendingChatImages.push({
                id: generateUuid(),
                previewUrl,
                attachment: {
                    name: 'preview-screenshot.png',
                    mimeType: 'image/png',
                    data,
                },
            });
            ctx.syncPopoverImages();
            const copied = await writePngBlobToClipboard(blob);
            if (copied) {
                ctx.notifyUser(nls.localize(
                    'qaap/preview/screenshotCopiedAndAttached',
                    'Screenshot copied and attached',
                ));
            } else {
                ctx.notifyUser(nls.localize(
                    'qaap/preview/screenshotAttachedClipboardBlocked',
                    'Screenshot attached (clipboard unavailable)',
                ), 'warn');
            }
        } catch {
            ctx.notifyUser(nls.localize(
                'qaap/preview/screenshotFailed',
                'Could not capture a screenshot for this page.',
            ), 'warn');
        }
}

