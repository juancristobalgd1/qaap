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
import { createHoldToSeeOriginalIcon } from './qaap-preview-annotation-controller';

export function ensureAnnotateToolbarExtracted(ctx: any): void {
        if (ctx.annotateToolbar) {
            return;
        }
        const host = ctx.toolbarHost;
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
        ctx.annotateChromeToolbar = chrome;
        ctx.annotateUrlField = urlField;

        const bar = document.createElement('div');
        bar.className = 'qaap-preview-annotate-toolbar';
        bar.setAttribute('role', 'toolbar');
        bar.setAttribute('aria-label', nls.localize('qaap/preview/annotateToolbarLabel', 'Annotate'));

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'qaap-preview-annotate-toolbar-icon-btn codicon codicon-close';
        closeBtn.title = nls.localize('qaap/preview/annotateClose', 'Close annotate');
        closeBtn.setAttribute('aria-label', closeBtn.title);

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'qaap-preview-annotate-toolbar-icon-btn codicon codicon-trash';
        deleteBtn.title = nls.localize('qaap/preview/annotateDeleteAll', 'Delete all annotations');
        deleteBtn.setAttribute('aria-label', deleteBtn.title);

        const undoBtn = document.createElement('button');
        undoBtn.type = 'button';
        undoBtn.className = 'qaap-preview-annotate-toolbar-icon-btn codicon codicon-discard';
        undoBtn.title = nls.localize('qaap/preview/annotateUndo', 'Undo');
        undoBtn.setAttribute('aria-label', undoBtn.title);

        const redoBtn = document.createElement('button');
        redoBtn.type = 'button';
        redoBtn.className = 'qaap-preview-annotate-toolbar-icon-btn codicon codicon-redo';
        redoBtn.title = nls.localize('qaap/preview/annotateRedo', 'Redo');
        redoBtn.setAttribute('aria-label', redoBtn.title);

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

        bar.append(closeBtn, deleteBtn, undoBtn, redoBtn, hint, screenshotBtn, compareBtn, sendBtn);
        // Full-width sibling of URL / workbench / overflow — not nested in workbench-controls.
        chrome.append(bar);

        ctx.annotateToolbar = bar;
        ctx.annotateSendButton = sendBtn;
        ctx.annotateSendBadge = badge;
        ctx.annotateUndoButton = undoBtn;
        ctx.annotateRedoButton = redoBtn;
        ctx.annotateDeleteButton = deleteBtn;
        ctx.annotateScreenshotButton = screenshotBtn;
        ctx.annotateCompareButton = compareBtn;

        const onClose = (e: MouseEvent): void => {
            e.preventDefault();
            e.stopPropagation();
            ctx.exitAnnotateMode();
        };
        const onDelete = (e: MouseEvent): void => {
            e.preventDefault();
            e.stopPropagation();
            if (deleteBtn.disabled) {
                return;
            }
            void ctx.confirmAndClearAllAnnotations();
        };
        const onUndo = (e: MouseEvent): void => {
            e.preventDefault();
            e.stopPropagation();
            ctx.undoLastAnnotation();
        };
        const onRedo = (e: MouseEvent): void => {
            e.preventDefault();
            e.stopPropagation();
            ctx.redoLastAnnotation();
        };
        const onScreenshot = (e: MouseEvent): void => {
            e.preventDefault();
            e.stopPropagation();
            void ctx.takeScreenshot();
        };
        const onCompareDown = (e: PointerEvent): void => {
            e.preventDefault();
            e.stopPropagation();
            try {
                compareBtn.setPointerCapture(e.pointerId);
            } catch {
                /* capture optional */
            }
            ctx.setComparingOriginal(true);
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
            ctx.setComparingOriginal(false);
            compareBtn.setAttribute('aria-pressed', 'false');
        };
        const onSend = (e: MouseEvent): void => {
            e.preventDefault();
            e.stopPropagation();
            if (sendBtn.disabled) {
                ctx.notifyUser(nls.localize(
                    'qaap/preview/annotateNothingToAttach',
                    'Confirm at least one annotation before adding to chat.',
                ), 'warn');
                return;
            }
            void ctx.addAnnotationsToChat();
        };
        closeBtn.addEventListener('click', onClose);
        deleteBtn.addEventListener('click', onDelete);
        undoBtn.addEventListener('click', onUndo);
        redoBtn.addEventListener('click', onRedo);
        screenshotBtn.addEventListener('click', onScreenshot);
        const onCompareLostCapture = (): void => {
            ctx.setComparingOriginal(false);
            compareBtn.setAttribute('aria-pressed', 'false');
        };
        compareBtn.addEventListener('pointerdown', onCompareDown);
        compareBtn.addEventListener('pointerup', onCompareRelease);
        compareBtn.addEventListener('pointercancel', onCompareRelease);
        compareBtn.addEventListener('lostpointercapture', onCompareLostCapture);
        sendBtn.addEventListener('click', onSend);
        ctx.toDispose.push(Disposable.create(() => {
            ctx.setComparingOriginal(false);
            closeBtn.removeEventListener('click', onClose);
            deleteBtn.removeEventListener('click', onDelete);
            undoBtn.removeEventListener('click', onUndo);
            redoBtn.removeEventListener('click', onRedo);
            screenshotBtn.removeEventListener('click', onScreenshot);
            compareBtn.removeEventListener('pointerdown', onCompareDown);
            compareBtn.removeEventListener('pointerup', onCompareRelease);
            compareBtn.removeEventListener('pointercancel', onCompareRelease);
            compareBtn.removeEventListener('lostpointercapture', onCompareLostCapture);
            sendBtn.removeEventListener('click', onSend);
            bar.remove();
            ctx.annotateUrlField?.classList.remove('qaap-mod-annotate-hidden');
            ctx.annotateChromeToolbar?.classList.remove('qaap-mod-annotate-active');
            ctx.annotateToolbar = undefined;
            ctx.annotateUrlField = undefined;
            ctx.annotateChromeToolbar = undefined;
            ctx.annotateSendButton = undefined;
            ctx.annotateSendBadge = undefined;
            ctx.annotateUndoButton = undefined;
            ctx.annotateRedoButton = undefined;
            ctx.annotateDeleteButton = undefined;
            ctx.annotateScreenshotButton = undefined;
            ctx.annotateCompareButton = undefined;
        }));
        ctx.syncAnnotateToolbar();
}

export function syncAnnotateToolbarExtracted(ctx: any): void {
        const active = ctx.mode === 'annotate';
        if (!active) {
            ctx.setComparingOriginal(false);
        }
        ctx.annotateToolbar?.classList.toggle('qaap-mod-visible', active);
        ctx.annotateUrlField?.classList.toggle('qaap-mod-annotate-hidden', active);
        ctx.annotateChromeToolbar?.classList.toggle('qaap-mod-annotate-active', active);

        const scope = ctx.options.getScope();
        const readyCount = scope ? ctx.countReadyAnnotations(scope) : 0;
        const scopedCount = scope ? ctx.store.listScope(scope).length : 0;
        // An open comment popover counts as sendable: Send commits its draft first, so the
        // button must not stay disabled while the user is still typing the only annotation.
        const sendReady = readyCount > 0 || !!ctx.popover;

        if (ctx.annotateSendBadge) {
            ctx.annotateSendBadge.textContent = String(readyCount);
            ctx.annotateSendBadge.hidden = readyCount <= 0;
        }
        if (ctx.annotateSendButton) {
            ctx.annotateSendButton.disabled = !sendReady;
            ctx.annotateSendButton.classList.toggle('qaap-mod-disabled', !sendReady);
        }
        if (ctx.annotateUndoButton) {
            ctx.annotateUndoButton.disabled = scopedCount <= 0;
            ctx.annotateUndoButton.classList.toggle('qaap-mod-disabled', scopedCount <= 0);
        }
        if (ctx.annotateRedoButton) {
            const canRedo = scope ? ctx.store.canRedo(scope) : false;
            ctx.annotateRedoButton.disabled = !canRedo;
            ctx.annotateRedoButton.classList.toggle('qaap-mod-disabled', !canRedo);
        }
        if (ctx.annotateDeleteButton) {
            const canDelete = ctx.hasClearableAnnotations();
            ctx.annotateDeleteButton.disabled = !canDelete;
            ctx.annotateDeleteButton.classList.toggle('qaap-mod-disabled', !canDelete);
        }
        if (ctx.annotateScreenshotButton) {
            const captureBusy = !!ctx.screenshotCaptureInFlight;
            ctx.annotateScreenshotButton.disabled = captureBusy;
            ctx.annotateScreenshotButton.classList.toggle('qaap-mod-disabled', captureBusy);
            ctx.annotateScreenshotButton.setAttribute('aria-busy', captureBusy ? 'true' : 'false');
        }
}

export function countReadyAnnotationsExtracted(ctx: any, scope: PreviewAnnotationScope): number {
        // Mirror addAnnotationsToChat: Send covers every confirmed annotation of the
        // conversation, so the badge/enabled state must count the same set.
        return ctx.listConfirmedForConversation(scope).length;
}

