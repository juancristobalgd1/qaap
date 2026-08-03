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

export function setToolbarHostExtracted(ctx: any, host: HTMLElement | undefined): void {
        if (!host) {
            return;
        }
        ctx.toolbarHost = host;
        ctx.ensureAnnotateToolbar();
        ctx.syncAnnotateToolbar();
}

export function disposeExtracted(ctx: any): void {
        ctx.closePopover();
        ctx.clearPendingChatImages();
        if (ctx.reanchorRaf) {
            ctx.cancelScheduledReanchor(ctx.reanchorRaf);
            ctx.reanchorRaf = 0;
        }
        ctx.postSetMode('browse');
        ctx.toDispose.dispose();
}

export function setInteractionModeExtracted(ctx: any, mode: PreviewInteractionMode): void {
        if (mode === ctx.mode && mode !== 'select') {
            return;
        }
        ctx.options.injectBridge();
        if (mode === 'select') {
            ctx.mode = 'select';
            ctx.postSetMode('select');
            ctx.options.startSelectPicker();
            ctx.syncAnnotateToolbar();
            return;
        }
        ctx.mode = mode;
        ctx.postSetMode(mode);
        if (mode === 'annotate') {
            // Retry mount if construction ran before the workbench was parented under chrome.
            ctx.ensureAnnotateToolbar();
        }
        ctx.syncAnnotateToolbar();
        if (mode === 'annotate') {
            ctx.options.messageService.info(nls.localize(
                'qaap/preview/annotateActive',
                'Annotate mode — tap the preview to add a comment. Scroll still works.',
            ));
            ctx.scheduleReanchor();
        }
        ctx.refreshMarkers();
}

export function undoLastAnnotationExtracted(ctx: any): void {
        const scope = ctx.options.getScope();
        if (!scope) {
            return;
        }
        const removed = ctx.store.undoLast(scope);
        if (!removed) {
            return;
        }
        ctx.positions.delete(removed.id);
        if (ctx.provisionalId === removed.id) {
            ctx.provisionalId = undefined;
            ctx.closePopover();
        }
        ctx.refreshMarkers();
        ctx.syncAnnotateToolbar();
}

export function redoLastAnnotationExtracted(ctx: any): void {
        const scope = ctx.options.getScope();
        if (!scope) {
            return;
        }
        const restored = ctx.store.redoLast(scope);
        if (!restored) {
            return;
        }
        const frameRect = ctx.options.frame.getBoundingClientRect();
        ctx.positions.set(restored.id, {
            id: restored.id,
            clientX: restored.documentXRatio * frameRect.width,
            clientY: restored.documentYRatio * frameRect.height,
            unresolved: restored.unresolved,
        });
        ctx.refreshMarkers();
        ctx.scheduleReanchor();
        ctx.syncAnnotateToolbar();
}

export async function addAnnotationsToChatExtracted(ctx: any): Promise<void> {
        if (ctx.sendInFlight) {
            return;
        }
        const scope = ctx.options.getScope();
        if (!scope) {
            return;
        }
        // A typed-but-unconfirmed popover draft is the user's most recent intent — commit it
        // instead of silently dropping it when Send is tapped with the popover still open.
        ctx.popover?.commit();
        // Send every confirmed annotation of this conversation, not just the current route's:
        // SPA navigation between Confirm and Send must never turn Send into a silent no-op.
        const confirmed = ctx.listConfirmedForConversation(scope);
        if (confirmed.length === 0) {
            ctx.notifyUser(nls.localize(
                'qaap/preview/annotateNothingToAttach',
                'Confirm at least one annotation before adding to chat.',
            ), 'warn');
            return;
        }
        if (!ctx.options.commands.getCommand(QAAP_WORK_HUB_ATTACH_COMPOSER_CONTEXT_COMMAND)) {
            ctx.notifyUser(nls.localize(
                'qaap/preview/attachComposerUnavailable',
                'Work Hub composer attach is unavailable in this session.',
            ), 'warn');
            return;
        }
        const images = ctx.pendingChatImages.length > 0
            ? ctx.pendingChatImages.map(item => item.attachment)
            : undefined;
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
        ctx.sendInFlight = true;
        try {
            const sent = await ctx.options.commands.executeCommand(
                QAAP_WORK_HUB_ATTACH_COMPOSER_CONTEXT_COMMAND,
                attachArgs,
            );
            if (sent !== true) {
                ctx.notifyUser(nls.localize(
                    'qaap/preview/annotateSendFailed',
                    'Could not send annotations to chat. Open Work Hub and try again.',
                ), 'warn');
                return;
            }
            ctx.clearAnnotationsAfterSuccessfulSend(scope, annotationIds);
            ctx.notifyUser(ctx.formatAnnotationsSentToast(annotationIds.length));
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            ctx.notifyUser(nls.localize(
                'qaap/preview/annotateAttachFailed',
                'Could not attach annotations: {0}',
                detail,
            ), 'warn');
        } finally {
            ctx.sendInFlight = false;
        }
}

export function exitAnnotateModeExtracted(ctx: any): void {
        ctx.closePopover();
        if (ctx.provisionalId) {
            ctx.store.remove(ctx.provisionalId);
            ctx.positions.delete(ctx.provisionalId);
            ctx.provisionalId = undefined;
            ctx.refreshMarkers();
        }
        ctx.setComparingOriginal(false);
        if (ctx.mode === 'annotate') {
            ctx.setInteractionMode('browse');
        } else {
            ctx.syncAnnotateToolbar();
        }
}

export function clearAllAnnotationsExtracted(ctx: any): void {
        const scope = ctx.options.getScope();
        ctx.clearPendingChatImages();
        ctx.provisionalId = undefined;
        ctx.closePopover();
        ctx.setComparingOriginal(false);
        if (scope) {
            for (const item of ctx.store.listForConversation(
                scope.workspaceId,
                scope.threadId,
                scope.previewId ?? scope.previewUrl,
            )) {
                ctx.store.remove(item.id);
            }
            ctx.store.clearScope(scope);
        }
        ctx.positions.clear();
        ctx.refreshMarkers();
        ctx.syncAnnotateToolbar();
}

export async function confirmAndClearAllAnnotationsExtracted(ctx: any): Promise<void> {
        if (!ctx.hasClearableAnnotations()) {
            return;
        }
        const confirmed = await ctx.askDeleteAllConfirmation();
        if (!confirmed) {
            return;
        }
        ctx.clearAllAnnotations();
        ctx.exitAnnotateMode();
}

export async function askDeleteAllConfirmationExtracted(ctx: any): Promise<boolean> {
        if (ctx.options.confirmDeleteAllAnnotations) {
            return !!(await ctx.options.confirmDeleteAllAnnotations());
        }
        // Lazy-load so controller unit tests that never delete do not import Lumino widgets.
        const { ConfirmDialog } = await import('@theia/core/lib/browser/dialogs');
        return !!(await new ConfirmDialog({
            title: nls.localize('qaap/preview/annotateDeleteAll', 'Delete all annotations'),
            msg: nls.localize(
                'qaap/preview/annotateDeleteAllConfirm',
                'Are you sure you want to delete all annotations?',
            ),
        }).open());
}

export function hasClearableAnnotationsExtracted(ctx: any): boolean {
        const scope = ctx.options.getScope();
        if (!scope) {
            return ctx.pendingChatImages.length > 0 || !!ctx.provisionalId;
        }
        if (ctx.pendingChatImages.length > 0 || !!ctx.provisionalId) {
            return true;
        }
        return ctx.store.listForConversation(
            scope.workspaceId,
            scope.threadId,
            scope.previewId ?? scope.previewUrl,
        ).length > 0;
}

export function clearAnnotationsAfterSuccessfulSendExtracted(ctx: any, scope: PreviewAnnotationScope, sentIds: readonly string[]): void {
        ctx.clearPendingChatImages();
        ctx.provisionalId = undefined;
        ctx.closePopover();
        ctx.setComparingOriginal(false);
        for (const id of sentIds) {
            ctx.store.remove(id);
            ctx.positions.delete(id);
        }
        ctx.store.clearScope(scope);
        ctx.positions.clear();
        ctx.refreshMarkers();
        // Prefer browse so the URL toolbar returns; annotate can be started again empty.
        if (ctx.mode === 'annotate') {
            ctx.setInteractionMode('browse');
        } else {
            ctx.syncAnnotateToolbar();
        }
}

export function setPendingChatScreenshotExtracted(ctx: any, image: PreviewAnnotationChatImageAttachment | undefined): void {
        ctx.clearPendingChatImages();
        if (!image) {
            ctx.syncPopoverImages();
            return;
        }
        ctx.pendingChatImages.push({
            id: generateUuid(),
            previewUrl: `data:${image.mimeType};base64,${image.data}`,
            attachment: image,
        });
        ctx.syncPopoverImages();
}

export function listPopoverImagesExtracted(ctx: any): AnnotationPopoverPendingImage[] {
        return ctx.pendingChatImages.map(item => ({
            id: item.id,
            name: item.attachment.name,
            previewUrl: item.previewUrl,
        }));
}

export function clearPendingChatImagesExtracted(ctx: any): void {
        for (const item of ctx.pendingChatImages) {
            if (item.previewUrl.startsWith('blob:')) {
                try {
                    URL.revokeObjectURL(item.previewUrl);
                } catch { /* ignore */ }
            }
        }
        ctx.pendingChatImages = [];
}

export function removePendingChatImageExtracted(ctx: any, id: string): void {
        const next: typeof ctx.pendingChatImages = [];
        for (const item of ctx.pendingChatImages) {
            if (item.id === id) {
                if (item.previewUrl.startsWith('blob:')) {
                    try {
                        URL.revokeObjectURL(item.previewUrl);
                    } catch { /* ignore */ }
                }
                continue;
            }
            next.push(item);
        }
        ctx.pendingChatImages = next;
        ctx.syncPopoverImages();
}

export async function addPendingChatImageFromPasteExtracted(ctx: any, image: {
        readonly id: string;
        readonly file: File;
        readonly previewUrl: string;
        readonly name: string;
    }): Promise<void> {
        if (ctx.pendingChatImages.some(item => item.id === image.id)) {
            ctx.syncPopoverImages();
            return;
        }
        const data = await blobToBase64(image.file);
        ctx.pendingChatImages.push({
            id: image.id,
            previewUrl: image.previewUrl,
            attachment: {
                name: image.name,
                mimeType: image.file.type || 'image/png',
                data,
            },
        });
        ctx.syncPopoverImages();
}

export function formatAnnotationsSentToastExtracted(ctx: any, count: number): string {
        if (count === 1) {
            return nls.localize('qaap/preview/annotateSentOne', '1 annotation sent to chat');
        }
        return nls.localize('qaap/preview/annotateSentMany', '{0} annotations sent to chat', String(count));
}

export function notifyUserExtracted(ctx: any, message: string, kind: 'info' | 'warn' = 'info'): void {
        previewNotify(
            { messageService: ctx.options.messageService, notify: ctx.notify },
            message,
            kind,
        );
}

export function handleEscapeExtracted(ctx: any): boolean {
        // Agent/model picker (portaled above the annotation card) owns Escape first.
        if (document.querySelector(
            '.qaap-sticky-composer-sheet-popover, .theia-mobile-sticky-composer-sheet, .theia-mobile-projects-sticky-composer-sheet',
        )) {
            return false;
        }
        if (ctx.popover) {
            ctx.popover.dispose();
            ctx.popover = undefined;
            if (ctx.provisionalId) {
                ctx.store.remove(ctx.provisionalId);
                ctx.positions.delete(ctx.provisionalId);
                ctx.provisionalId = undefined;
                ctx.refreshMarkers();
                ctx.syncAnnotateToolbar();
            }
            return true;
        }
        if (ctx.mode === 'annotate') {
            ctx.setInteractionMode('browse');
            return true;
        }
        return false;
}

export function onFrameLoadExtracted(ctx: any): void {
        ctx.options.injectBridge();
        if (ctx.mode === 'annotate') {
            ctx.postSetMode('annotate');
        } else if (ctx.mode === 'select') {
            ctx.postSetMode('select');
        }
        ctx.scheduleReanchor();
}

export function installMessageListenerExtracted(ctx: any): void {
        if (ctx.listenerInstalled) {
            return;
        }
        ctx.listenerInstalled = true;
        const handler = (event: MessageEvent): void => ctx.onWindowMessage(event);
        window.addEventListener('message', handler);
        ctx.toDispose.push(Disposable.create(() => window.removeEventListener('message', handler)));
        const onKeyDown = (e: KeyboardEvent): void => {
            if (e.key === 'Escape' && ctx.handleEscape()) {
                e.preventDefault();
                e.stopPropagation();
            }
        };
        window.addEventListener('keydown', onKeyDown, true);
        ctx.toDispose.push(Disposable.create(() => window.removeEventListener('keydown', onKeyDown, true)));
}

export function onWindowMessageExtracted(ctx: any, event: Pick<MessageEvent, 'data' | 'source'> & Partial<Pick<MessageEvent, 'origin'>>): void {
        if (!event.data || typeof event.data !== 'object') {
            return;
        }
        if (ctx.options.isBridgeMessage) {
            if (!ctx.options.isBridgeMessage(event as Pick<MessageEvent, 'data' | 'source' | 'origin'>)) {
                return;
            }
        } else if (!ctx.options.frame.contentWindow || event.source !== ctx.options.frame.contentWindow) {
            return;
        }
        const data = event.data as { type?: string; payload?: unknown };
        if (data.type === ELEMENT_ANNOTATION_POINT_TYPE && data.payload) {
            ctx.handleAnnotationPoint(data.payload as AnnotationPointPayload);
        } else if (data.type === ELEMENT_ANNOTATION_REANCHOR_RESULT_TYPE && data.payload) {
            ctx.handleReanchorResult(data.payload as { items?: AnnotationReanchorResultItem[] });
        } else if (data.type === ELEMENT_ANNOTATION_CANCEL_TYPE) {
            if (ctx.mode === 'annotate') {
                ctx.setInteractionMode('browse');
            }
        }
}

