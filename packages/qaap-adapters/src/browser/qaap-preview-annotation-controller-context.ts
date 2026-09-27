// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// The shared contract between `QaapPreviewAnnotationController` and the extracted free functions in the
// `qaap-preview-annotation-controller-*.ts` cluster. Each extracted function receives the host typed as
// `QaapPreviewAnnotationControllerContext` instead of `any`. The contract is picked from the class over an explicit member
// list, so every member keeps the exact type the class declares. Members named here are `public`
// (+ `@internal` where they used to be `protected`) on the class.
// `import type` keeps this free of a runtime import cycle (the class imports every extracted module).

import type { QaapPreviewAnnotationController } from './qaap-preview-annotation-controller';

/** Members referenced by the extracted `qaap-preview-annotation-controller-*` modules. */
export type QaapPreviewAnnotationControllerContextMember =
    | 'addAnnotationsToChat'
    | 'addPendingChatImageFromPaste'
    | 'annotateChromeToolbar'
    | 'annotateCompareButton'
    | 'annotateDeleteButton'
    | 'annotateRedoButton'
    | 'annotateScreenshotButton'
    | 'annotateSendBadge'
    | 'annotateSendButton'
    | 'annotateToolbar'
    | 'annotateUndoButton'
    | 'annotateUrlField'
    | 'askDeleteAllConfirmation'
    | 'cancelScheduledReanchor'
    | 'captureScreenshotForChat'
    | 'clearAllAnnotations'
    | 'clearAnnotationsAfterSuccessfulSend'
    | 'clearPendingChatImages'
    | 'closePopover'
    | 'comparingOriginal'
    | 'composerSession'
    | 'confirmAndClearAllAnnotations'
    | 'countReadyAnnotations'
    | 'ensureAnnotateToolbar'
    | 'exitAnnotateMode'
    | 'formatAnnotationsSentToast'
    | 'frameTargetOrigin'
    | 'handleAnnotationPoint'
    | 'handleEscape'
    | 'handleReanchorResult'
    | 'hasClearableAnnotations'
    | 'listConfirmedForConversation'
    | 'listPopoverImages'
    | 'listenerInstalled'
    | 'markers'
    | 'mode'
    | 'notify'
    | 'notifyUser'
    | 'onFrameLoad'
    | 'onWindowMessage'
    | 'openPopoverFor'
    | 'options'
    | 'pendingChatImages'
    | 'popover'
    | 'positions'
    | 'postSetMode'
    | 'provisionalId'
    | 'reanchorRaf'
    | 'redoLastAnnotation'
    | 'refreshMarkers'
    | 'removePendingChatImage'
    | 'requestReanchor'
    | 'scheduleReanchor'
    | 'screenshotCaptureInFlight'
    | 'sendInFlight'
    | 'setComparingOriginal'
    | 'setInteractionMode'
    | 'store'
    | 'syncAnnotateToolbar'
    | 'syncPopoverImages'
    | 'takeScreenshot'
    | 'toDispose'
    | 'toolbarHost'
    | 'undoLastAnnotation';

/**
 * Members of {@link QaapPreviewAnnotationController} that the extracted helper functions
 * access through their `ctx` parameter.
 */
export interface QaapPreviewAnnotationControllerContext
    extends Pick<QaapPreviewAnnotationController, QaapPreviewAnnotationControllerContextMember> { }
