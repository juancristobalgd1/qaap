// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import {
    readComposerDeliveryMode,
    renderQaapDeliveryModeMenu,
    writeComposerDeliveryMode,
    type QaapComposerDeliveryMode,
} from './qaap-delivery-mode-strip';
import {
    markStickyComposerPopoverAnchor,
    mountStickyComposerBottomSheet,
    mountStickyComposerSheetPopover,
    scheduleStickyComposerPopoverPosition,
} from './qaap-sticky-composer-popover';

export function teardownDeliveryModeSheetPopover(ctx: any): void {
    ctx.deliveryModePopoverCleanup?.();
    ctx.deliveryModePopoverCleanup = undefined;
    if (ctx.deliveryModeSheetAnchor) {
        markStickyComposerPopoverAnchor(ctx.deliveryModeSheetAnchor, false);
        ctx.deliveryModeSheetAnchor = undefined;
    }
}

export function isDeliveryModeSheetPopoverAnchoredTo(ctx: any, anchor?: HTMLElement): boolean {
    return anchor !== undefined && ctx.deliveryModeSheetAnchor === anchor;
}

export function mountDeliveryModeSheetPresentation(
    ctx: any,
    panel: HTMLElement,
    options: {
        readonly anchor?: HTMLElement;
        readonly transcriptOverlay: boolean;
        readonly onClose: () => void;
    },
): HTMLElement {
    ctx.deliveryModePopoverAlign = 'start';
    const anchor = options.anchor;
    if (anchor && ctx.shouldUseAgentPickerPopover(anchor)) {
        const mounted = mountStickyComposerSheetPopover(panel, {
            anchor,
            onClose: options.onClose,
            align: ctx.deliveryModePopoverAlign,
            transcriptOverlay: options.transcriptOverlay,
            modifierClasses: ['theia-mod-delivery-mode-picker'],
        });
        ctx.deliveryModeSheetAnchor = anchor;
        ctx.deliveryModePopoverCleanup = mounted.cleanup;
        scheduleStickyComposerPopoverPosition(mounted.root, anchor, ctx.deliveryModePopoverAlign);
        return mounted.root;
    }
    return mountStickyComposerBottomSheet(panel, {
        sheetClassName: options.transcriptOverlay
            ? 'theia-mobile-sticky-composer-sheet theia-mod-delivery-mode theia-mod-transcript-overlay'
            : 'theia-mobile-sticky-composer-sheet theia-mod-delivery-mode',
        onClose: options.onClose,
    });
}

export function openComposerDeliveryModeSheet(ctx: any, options: {
    readonly selectedMode: QaapComposerDeliveryMode;
    readonly anchor?: HTMLElement;
    readonly transcriptOverlay: boolean;
    readonly closeTitle: string;
    readonly onClose: () => void;
    readonly onSelect: (mode: QaapComposerDeliveryMode) => void;
    readonly assignSheet: (sheet: HTMLElement) => void;
    readonly isOpen?: () => boolean;
}): void {
    const usePopover = ctx.shouldUseAgentPickerPopover(options.anchor);
    if (usePopover
        && isDeliveryModeSheetPopoverAnchoredTo(ctx, options.anchor)
        && options.isOpen?.()) {
        options.onClose();
        return;
    }
    options.onClose();

    const panel = document.createElement('section');
    panel.className = 'theia-mobile-sticky-composer-sheet-panel';

    const header = document.createElement('header');
    header.className = 'theia-mobile-sticky-composer-sheet-header';
    const title = document.createElement('h2');
    title.textContent = nls.localize(
        'qaap/mobileProjects/stickyComposerPickDelivery',
        'Choose send mode',
    );
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'theia-mobile-sticky-composer-sheet-close codicon codicon-close';
    close.title = options.closeTitle;
    close.setAttribute('aria-label', options.closeTitle);
    close.addEventListener('click', options.onClose);
    header.append(title, close);

    const list = renderQaapDeliveryModeMenu({
        selected: options.selectedMode,
        onChoose: mode => options.onSelect(mode),
    });
    panel.append(header, list);
    const root = mountDeliveryModeSheetPresentation(ctx, panel, {
        anchor: options.anchor,
        transcriptOverlay: options.transcriptOverlay,
        onClose: options.onClose,
    });
    document.body.append(root);
    options.assignSheet(root);
}

export function openStickyComposerDeliveryModeSheet(ctx: any, anchor?: HTMLElement): void {
    const selected = readComposerDeliveryMode();
    openComposerDeliveryModeSheet(ctx, {
        selectedMode: selected,
        anchor,
        transcriptOverlay: ctx.shouldElevateComposerSheets(),
        closeTitle: nls.localize('qaap/mobileAgentComposer/close', 'Close'),
        onClose: () => ctx.closeAllComposerSheets(),
        isOpen: () => ctx.host.stickyComposerDeliveryModeSheet !== undefined,
        assignSheet: sheet => { ctx.host.stickyComposerDeliveryModeSheet = sheet; },
        onSelect: mode => {
            writeComposerDeliveryMode(mode);
            ctx.closeAllComposerSheets();
            ctx.host.stickyComposerRenderUi.renderStickyComposer();
        },
    });
}
