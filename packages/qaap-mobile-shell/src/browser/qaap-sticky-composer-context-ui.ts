// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { AIVariableResolutionRequest } from '@theia/ai-core';
import { ImageContextVariable } from '@theia/ai-chat/lib/common/image-context-variable';
import { nls } from '@theia/core/lib/common/nls';
import type { LabelProvider } from '@theia/core/lib/browser';
import { installMobileHorizontalTouchScroll } from './mobile-horizontal-touch-scroll';
import { isImageAttachmentFileName } from '../common/qaap-sticky-composer-attachment-utils';
import {
    isPendingComposerContextArg,
    type StickyComposerContextEntry,
} from '../common/qaap-composer-context-entry';
import {
    isPreviewFeedbackRequest,
    parsePreviewFeedbackArg,
    QAAP_PREVIEW_FEEDBACK_VARIABLE_NAME,
} from '../common/qaap-preview-feedback-context';
import {
    isQuotedTextRequest,
    QAAP_QUOTED_TEXT_VARIABLE_NAME,
    truncateQuotedTextForSubtitle,
} from '../common/qaap-quoted-text-context';
import type { QaapTranscriptUserImagePreview } from '../common/qaap-transcript-user-image-preview';
import { bindStickyComposerControlClick } from '../common/qaap-sticky-composer-control-click';

export type StickyComposerAttachmentKind = 'image' | 'file' | 'context';

export interface StickyComposerContextChipView {
    title: string;
    subtitle?: string;
    iconClasses: string;
    kind: string;
    attachmentKind: StickyComposerAttachmentKind;
    previewSrc?: string;
    pending?: boolean;
}

const FILE_VARIABLE_NAME = 'file';
const IMAGE_CONTEXT_VARIABLE_NAME = 'imageContext';

export function resolveStickyComposerContextEntry(
    entry: StickyComposerContextEntry,
    labelProvider?: LabelProvider,
): StickyComposerContextChipView {
    const request = entry.request;
    if (ImageContextVariable.isImageContextRequest(request)) {
        const view = resolveImageContextChip(request, labelProvider, entry);
        if (entry.localPreviewSrc && !view.previewSrc) {
            view.previewSrc = entry.localPreviewSrc;
        }
        if (entry.pending) {
            view.pending = true;
        }
        return view;
    }
    if (request.variable.name === FILE_VARIABLE_NAME) {
        const view = resolveFileContextChip(request, labelProvider, entry);
        if (entry.localPreviewSrc && !view.previewSrc) {
            view.previewSrc = entry.localPreviewSrc;
        }
        if (entry.pending) {
            view.pending = true;
        }
        return view;
    }
    const view = resolveStickyComposerContextChip(request, labelProvider);
    if (entry.displayName?.trim()) {
        view.title = entry.displayName.trim();
    }
    if (entry.pending) {
        view.pending = true;
    }
    return view;
}

/**
 * Merge optimistic-entry state (blob thumbnail, pending flag, device file name) onto a chip view
 * that was resolved from the entry's `request` alone. A host-level chip provider only receives the
 * `AIVariableResolutionRequest` — for a freshly attached file the request arg is just a pending
 * sentinel, so the provider can't see `entry.localPreviewSrc`. Without this merge the composer shows
 * a placeholder icon instead of the attachment miniature until the upload finalizes.
 */
export function applyComposerContextEntryPreview(
    view: StickyComposerContextChipView,
    entry: StickyComposerContextEntry,
): StickyComposerContextChipView {
    if (entry.localPreviewSrc && !view.previewSrc) {
        view.previewSrc = entry.localPreviewSrc;
    }
    if (entry.pending) {
        view.pending = true;
    }
    if (entry.displayName?.trim()) {
        view.title = entry.displayName.trim();
    }
    return view;
}

/** Snapshot attachment previews from composer context before submit clears entries. */
export async function collectComposerImagePreviews(
    entries: readonly StickyComposerContextEntry[],
    resolvePreview?: (item: AIVariableResolutionRequest) => Promise<string | undefined>,
): Promise<QaapTranscriptUserImagePreview[]> {
    const previews: QaapTranscriptUserImagePreview[] = [];
    for (const entry of entries) {
        const view = resolveStickyComposerContextEntry(entry);
        if (view.attachmentKind !== 'image') {
            continue;
        }
        let src = view.previewSrc;
        if (!src && resolvePreview) {
            src = await resolvePreview(entry.request);
        }
        if (src) {
            previews.push({ src, fileName: view.title });
        }
    }
    return previews;
}

export function resolveStickyComposerContextChip(
    request: AIVariableResolutionRequest,
    labelProvider?: LabelProvider,
): StickyComposerContextChipView {
    if (ImageContextVariable.isImageContextRequest(request)) {
        return resolveImageContextChip(request, labelProvider);
    }
    if (request.variable.name === FILE_VARIABLE_NAME) {
        return resolveFileContextChip(request, labelProvider);
    }
    if (isPreviewFeedbackRequest(request)) {
        const parsed = parsePreviewFeedbackArg(request.arg);
        return {
            title: parsed?.t?.trim()
                || nls.localize('qaap/preview/feedbackChipFallback', 'Preview feedback'),
            iconClasses: 'codicon codicon-comment',
            kind: QAAP_PREVIEW_FEEDBACK_VARIABLE_NAME,
            attachmentKind: 'context',
        };
    }
    if (isQuotedTextRequest(request)) {
        return {
            title: nls.localize('qaap/mobileProjects/quotedText', 'Quoted text'),
            subtitle: truncateQuotedTextForSubtitle(request.arg ?? ''),
            iconClasses: 'codicon codicon-quote',
            kind: QAAP_QUOTED_TEXT_VARIABLE_NAME,
            attachmentKind: 'context',
        };
    }
    const variable = request.variable;
    const title = (labelProvider?.getName(request) ?? variable.label ?? variable.name ?? '').trim();
    const rawDetails = labelProvider?.getDetails(request) ?? request.arg;
    const subtitle = rawDetails?.trim() ? truncateContextDetail(rawDetails.trim()) : undefined;
    const iconFromProvider = labelProvider?.getIcon(request);
    const iconClasses = typeof iconFromProvider === 'string' && iconFromProvider.length > 0
        ? iconFromProvider
        : (variable.iconClasses?.join(' ') ?? 'codicon codicon-symbol-variable');
    return {
        title,
        subtitle,
        iconClasses,
        kind: variable.name ?? 'context',
        attachmentKind: 'context',
    };
}

function resolveImageContextChip(
    request: AIVariableResolutionRequest,
    labelProvider?: LabelProvider,
    entry?: StickyComposerContextEntry,
): StickyComposerContextChipView {
    if (entry?.pending || isPendingComposerContextArg(request.arg)) {
        return {
            title: entry?.displayName ?? nls.localize('qaap/mobileProjects/stickyComposerAttachmentImage', 'Image'),
            iconClasses: 'codicon codicon-file-media',
            kind: IMAGE_CONTEXT_VARIABLE_NAME,
            attachmentKind: 'image',
            previewSrc: entry?.localPreviewSrc,
            pending: true,
        };
    }
    const parsed = parseImageContextArg(request.arg);
    const title = parsed?.name
        ?? parsed?.wsRelativePath?.split('/').pop()
        ?? labelProvider?.getName(request)
        ?? nls.localize('qaap/mobileProjects/stickyComposerAttachmentImage', 'Image');
    const subtitle = parsed?.wsRelativePath
        ? truncateContextDetail(parsed.wsRelativePath)
        : parsed?.mimeType?.replace('image/', '').toUpperCase();
    const previewSrc = parsed && ImageContextVariable.isResolved(parsed)
        ? `data:${parsed.mimeType};base64,${parsed.data}`
        : undefined;
    return {
        title,
        subtitle,
        iconClasses: 'codicon codicon-file-media',
        kind: IMAGE_CONTEXT_VARIABLE_NAME,
        attachmentKind: 'image',
        previewSrc,
    };
}

function resolveFileContextChip(
    request: AIVariableResolutionRequest,
    labelProvider?: LabelProvider,
    entry?: StickyComposerContextEntry,
): StickyComposerContextChipView {
    if (entry?.pending || isPendingComposerContextArg(request.arg)) {
        const fileName = entry?.displayName ?? nls.localizeByDefault('File');
        const isImageFile = isImageAttachmentFileName(fileName);
        return {
            title: fileName,
            iconClasses: isImageFile ? 'codicon codicon-file-media' : resolveDocumentIconClasses(fileName),
            kind: isImageFile ? IMAGE_CONTEXT_VARIABLE_NAME : FILE_VARIABLE_NAME,
            attachmentKind: isImageFile ? 'image' : 'file',
            previewSrc: entry?.localPreviewSrc,
            pending: true,
        };
    }
    const path = request.arg?.trim() ?? '';
    const fileName = path.split('/').pop() ?? path;
    const title = (labelProvider?.getName(request) ?? fileName) || nls.localizeByDefault('File');
    const subtitle = path && fileName !== path ? truncateContextDetail(path) : undefined;
    const iconFromProvider = labelProvider?.getIcon(request);
    const iconClasses = typeof iconFromProvider === 'string' && iconFromProvider.length > 0
        ? iconFromProvider
        : resolveDocumentIconClasses(fileName);
    const isImageFile = isImageAttachmentFileName(fileName);
    return {
        title,
        subtitle: isImageFile ? undefined : subtitle,
        iconClasses,
        kind: FILE_VARIABLE_NAME,
        attachmentKind: isImageFile ? 'image' : 'file',
    };
}

function parseImageContextArg(arg: string | undefined): ImageContextVariable | undefined {
    if (!arg?.trim()) {
        return undefined;
    }
    try {
        return ImageContextVariable.parseArg(arg);
    } catch {
        return undefined;
    }
}

export function resolveDocumentIconClasses(fileName: string): string {
    const extension = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() ?? '' : '';
    switch (extension) {
        case 'pdf':
            return 'codicon codicon-file-pdf';
        case 'md':
        case 'markdown':
            return 'codicon codicon-markdown';
        case 'json':
        case 'jsonc':
            return 'codicon codicon-json';
        case 'ts':
        case 'tsx':
        case 'js':
        case 'jsx':
            return 'codicon codicon-file-code';
        case 'png':
        case 'jpg':
        case 'jpeg':
        case 'gif':
        case 'webp':
        case 'svg':
            return 'codicon codicon-file-media';
        case 'zip':
        case 'tar':
        case 'gz':
            return 'codicon codicon-file-zip';
        default:
            return 'codicon codicon-file';
    }
}

export function truncateContextDetail(text: string, maxLen = 40): string {
    if (text.length <= maxLen) {
        return text;
    }
    const slash = text.lastIndexOf('/');
    if (slash >= 0) {
        const file = text.slice(slash + 1);
        const prefix = text.slice(0, slash);
        if (file.length <= maxLen - 5) {
            const shortPrefix = prefix.length > 12 ? `…${prefix.slice(-10)}` : prefix;
            return `${shortPrefix}/${file}`;
        }
    }
    const head = Math.ceil((maxLen - 1) * 0.42);
    const tail = maxLen - 1 - head;
    return `${text.slice(0, head)}…${text.slice(-tail)}`;
}

interface ContextStripEntry {
    item: StickyComposerContextEntry;
    index: number;
    view: StickyComposerContextChipView;
}

function buildAttachmentHeadLabel(imageCount: number, fileCount: number): string {
    const parts: string[] = [];
    if (imageCount > 0) {
        parts.push(nls.localize(
            'qaap/mobileProjects/stickyComposerImagesCount',
            '{0} image(s)',
            String(imageCount),
        ));
    }
    if (fileCount > 0) {
        parts.push(nls.localize(
            'qaap/mobileProjects/stickyComposerFilesCountShort',
            '{0} file(s)',
            String(fileCount),
        ));
    }
    return parts.join(' · ');
}

function createContextRemoveButton(onRemove: () => void): HTMLButtonElement {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'theia-mobile-projects-sticky-composer-context-remove codicon codicon-close';
    remove.title = nls.localize('qaap/mobileProjects/stickyComposerContextRemove', 'Remove from context');
    remove.setAttribute('aria-label', remove.title);
    bindStickyComposerControlClick(remove, ev => {
        ev.stopPropagation();
        onRemove();
    });
    return remove;
}

function mountImagePreview(
    preview: HTMLElement,
    entry: ContextStripEntry,
    resolvePreview?: (item: AIVariableResolutionRequest) => Promise<string | undefined>,
): void {
    if (entry.view.previewSrc) {
        preview.classList.remove('theia-mod-loading');
        showImagePreviewSrc(preview, entry, entry.view.previewSrc);
        return;
    }

    preview.classList.add('theia-mod-loading');

    const showPlaceholder = (): void => {
        preview.classList.remove('theia-mod-loading');
        preview.classList.remove('theia-mod-ready');
        preview.replaceChildren();
        const placeholder = document.createElement('span');
        placeholder.className = 'theia-mobile-projects-sticky-composer-context-image-placeholder codicon codicon-file-media';
        placeholder.setAttribute('aria-hidden', 'true');
        preview.append(placeholder);
        appendImageCaption(preview, entry.view.title);
    };

    const showSrc = (src: string): void => {
        showImagePreviewSrc(preview, entry, src);
    };

    if (!resolvePreview) {
        showPlaceholder();
        return;
    }

    void resolvePreview(entry.item.request).then(src => {
        if (!preview.isConnected) {
            return;
        }
        if (src) {
            showSrc(src);
        } else {
            showPlaceholder();
        }
    });
}

function showImagePreviewSrc(preview: HTMLElement, entry: ContextStripEntry, src: string): void {
    preview.replaceChildren();
    if (entry.view.pending) {
        preview.classList.add('theia-mod-pending');
    } else {
        preview.classList.remove('theia-mod-pending');
    }
    const img = document.createElement('img');
    img.className = 'theia-mobile-projects-sticky-composer-context-image-thumb';
    img.alt = entry.view.title;
    img.decoding = 'async';
    img.loading = 'lazy';
    img.addEventListener('load', () => {
        preview.classList.remove('theia-mod-loading');
        preview.classList.add('theia-mod-ready');
    }, { once: true });
    img.addEventListener('error', () => {
        preview.classList.remove('theia-mod-loading', 'theia-mod-ready', 'theia-mod-pending');
        const placeholder = document.createElement('span');
        placeholder.className = 'theia-mobile-projects-sticky-composer-context-image-placeholder codicon codicon-file-media';
        placeholder.setAttribute('aria-hidden', 'true');
        preview.append(placeholder);
        appendImageCaption(preview, entry.view.title);
    }, { once: true });
    preview.append(img);
    appendImageCaption(preview, entry.view.title);
    img.src = src;
}

function appendImageCaption(preview: HTMLElement, title: string): void {
    const caption = document.createElement('div');
    caption.className = 'theia-mobile-projects-sticky-composer-context-image-caption';
    caption.textContent = title;
    preview.append(caption);
}

/** Unified carousel: images and files share a single horizontal scrollable row. */
function renderAttachmentCarousel(
    imageEntries: readonly ContextStripEntry[],
    fileEntries: readonly ContextStripEntry[],
    onRemoveItem: (index: number) => void,
    resolvePreview?: (item: AIVariableResolutionRequest) => Promise<string | undefined>,
): HTMLElement {
    const row = document.createElement('div');
    row.className = 'theia-mobile-projects-sticky-composer-context-images theia-mod-attachments';
    row.setAttribute('role', 'list');

    for (const entry of imageEntries) {
        const card = document.createElement('div');
        card.className = 'theia-mobile-projects-sticky-composer-context-image';
        card.setAttribute('role', 'listitem');
        card.title = entry.view.subtitle
            ? `${entry.view.title} — ${entry.view.subtitle}`
            : entry.view.title;

        const preview = document.createElement('div');
        preview.className = 'theia-mobile-projects-sticky-composer-context-image-preview';
        mountImagePreview(preview, entry, resolvePreview);

        card.append(preview, createContextRemoveButton(() => onRemoveItem(entry.index)));
        row.append(card);
    }

    for (const entry of fileEntries) {
        const fileCard = document.createElement('div');
        fileCard.className = 'theia-mobile-projects-sticky-composer-context-file theia-mod-document theia-mod-card';
        if (entry.view.pending) {
            fileCard.classList.add('theia-mod-pending');
        }
        fileCard.setAttribute('role', 'listitem');
        fileCard.title = entry.view.subtitle
            ? `${entry.view.title} — ${entry.view.subtitle}`
            : entry.view.title;

        const preview = document.createElement('div');
        preview.className = 'theia-mobile-projects-sticky-composer-context-file-preview';

        const icon = document.createElement('span');
        icon.className = `theia-mobile-projects-sticky-composer-context-file-icon ${entry.view.iconClasses}`;
        icon.setAttribute('aria-hidden', 'true');
        preview.append(icon);

        if (entry.view.pending) {
            const pending = document.createElement('span');
            pending.className = 'theia-mobile-projects-sticky-composer-context-file-pending codicon codicon-loading';
            pending.setAttribute('aria-hidden', 'true');
            preview.append(pending);
        }

        const caption = document.createElement('span');
        caption.className = 'theia-mobile-projects-sticky-composer-context-file-caption';
        caption.textContent = entry.view.title;

        fileCard.append(preview, caption, createContextRemoveButton(() => onRemoveItem(entry.index)));
        row.append(fileCard);
    }

    installMobileHorizontalTouchScroll(row);
    return row;
}

function renderContextChipRow(
    entries: readonly ContextStripEntry[],
    onRemoveItem: (index: number) => void,
): HTMLElement {
    const chips = document.createElement('div');
    chips.className = 'theia-mobile-projects-sticky-composer-context-chips';
    chips.setAttribute('role', 'list');

    for (const entry of entries) {
        const view = entry.view;
        const chip = document.createElement('div');
        chip.className = 'theia-mobile-projects-sticky-composer-context-chip';
        chip.classList.add(`theia-mod-kind-${sanitizeContextKindClass(view.kind)}`);
        chip.setAttribute('role', 'listitem');
        chip.title = view.subtitle ? `${view.title} — ${view.subtitle}` : view.title;

        const icon = document.createElement('span');
        icon.className = `theia-mobile-projects-sticky-composer-context-chip-icon ${view.iconClasses}`;
        icon.setAttribute('aria-hidden', 'true');

        const body = document.createElement('div');
        body.className = 'theia-mobile-projects-sticky-composer-context-chip-body';

        const title = document.createElement('span');
        title.className = 'theia-mobile-projects-sticky-composer-context-chip-title';
        title.textContent = view.title;
        body.append(title);

        if (view.subtitle) {
            const subtitle = document.createElement('span');
            subtitle.className = 'theia-mobile-projects-sticky-composer-context-chip-subtitle';
            subtitle.textContent = view.subtitle;
            body.append(subtitle);
        }

        chip.append(icon, body, createContextRemoveButton(() => onRemoveItem(entry.index)));
        chips.append(chip);
    }

    installMobileHorizontalTouchScroll(chips);
    return chips;
}

export function renderStickyComposerContextStrip(options: {
    items: readonly StickyComposerContextEntry[];
    formatChip: (item: StickyComposerContextEntry) => StickyComposerContextChipView;
    onRemoveItem: (index: number) => void;
    onClearAll: () => void;
    filesExpanded?: boolean;
    onFilesExpandedChange?: (expanded: boolean) => void;
    resolveAttachmentPreview?: (item: AIVariableResolutionRequest) => Promise<string | undefined>;
}): HTMLElement {
    const strip = document.createElement('div');
    strip.className = 'theia-mobile-projects-sticky-composer-context-strip';

    const entries: ContextStripEntry[] = options.items.map((item, index) => ({
        item,
        index,
        view: options.formatChip(item),
    }));
    const imageEntries = entries.filter(entry => entry.view.attachmentKind === 'image');
    const fileEntries = entries.filter(entry => entry.view.attachmentKind === 'file');
    const otherEntries = entries.filter(entry => entry.view.attachmentKind === 'context');
    const attachmentCount = imageEntries.length + fileEntries.length;
    const attachmentsOnly = attachmentCount > 0 && otherEntries.length === 0;

    let attachmentsExpanded = options.filesExpanded ?? true;
    let attachmentBodyHost: HTMLElement | undefined;
    let attachmentsToggle: HTMLButtonElement | undefined;

    const syncAttachmentsExpanded = (): void => {
        attachmentsToggle?.setAttribute('aria-expanded', attachmentsExpanded ? 'true' : 'false');
        attachmentsToggle?.classList.toggle('theia-mod-collapsed', !attachmentsExpanded);
        strip.classList.toggle('theia-mod-attachments-collapsed', attachmentsOnly && !attachmentsExpanded);
        options.onFilesExpandedChange?.(attachmentsExpanded);
        if (attachmentBodyHost) {
            attachmentBodyHost.hidden = !attachmentsExpanded;
        }
    };

    const head = document.createElement('div');
    head.className = 'theia-mobile-projects-sticky-composer-context-head';

    const headMain = document.createElement('div');
    headMain.className = 'theia-mobile-projects-sticky-composer-context-head-main';

    if (attachmentsOnly && attachmentCount > 0) {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'theia-mobile-projects-sticky-composer-context-files-toggle';
        attachmentsToggle = toggle;

        const chevron = document.createElement('span');
        chevron.className = 'codicon codicon-chevron-down';
        chevron.setAttribute('aria-hidden', 'true');

        const text = document.createElement('span');
        text.className = 'theia-mobile-projects-sticky-composer-context-head-label';
        text.textContent = attachmentCount === 1 && imageEntries.length === 1 && fileEntries.length === 0
            ? nls.localize('qaap/mobileProjects/stickyComposerAttachmentSingleImage', '1 image attached')
            : attachmentCount === 1 && fileEntries.length === 1 && imageEntries.length === 0
                ? nls.localize('qaap/mobileProjects/stickyComposerAttachmentSingleFile', '1 file attached')
                : nls.localize(
                    'qaap/mobileProjects/stickyComposerAttachmentsHeading',
                    'Attachments · {0}',
                    buildAttachmentHeadLabel(imageEntries.length, fileEntries.length),
                );

        toggle.append(chevron, text);
        bindStickyComposerControlClick(toggle, ev => {
            ev.preventDefault();
            ev.stopPropagation();
            attachmentsExpanded = !attachmentsExpanded;
            syncAttachmentsExpanded();
        });
        headMain.append(toggle);
    } else {
        const label = document.createElement('span');
        label.className = 'theia-mobile-projects-sticky-composer-context-head-label';
        label.textContent = attachmentCount > 0
            ? nls.localize('qaap/mobileProjects/stickyComposerContextWithAttachments', 'Context & attachments')
            : nls.localize('qaap/mobileProjects/stickyComposerContextHeading', 'Context');

        const count = document.createElement('span');
        count.className = 'theia-mobile-projects-sticky-composer-context-count';
        count.textContent = String(options.items.length);
        count.setAttribute('aria-label', nls.localize(
            'qaap/mobileProjects/stickyComposerContextCount',
            '{0} context item(s)',
            String(options.items.length),
        ));
        headMain.append(label, count);
    }

    const clearAll = document.createElement('button');
    clearAll.type = 'button';
    clearAll.className = 'theia-mobile-projects-sticky-composer-context-clear-all';
    clearAll.textContent = nls.localize('qaap/mobileProjects/stickyComposerContextClear', 'Clear all');
    bindStickyComposerControlClick(clearAll, ev => {
        ev.stopPropagation();
        options.onClearAll();
    });

    head.append(headMain, clearAll);
    strip.append(head);

    if (imageEntries.length > 0 || fileEntries.length > 0 || otherEntries.length > 0) {
        const body = document.createElement('div');
        body.className = 'theia-mobile-projects-sticky-composer-context-body';
        attachmentBodyHost = body;

        if (imageEntries.length > 0 || fileEntries.length > 0) {
            body.append(renderAttachmentCarousel(
                imageEntries,
                fileEntries,
                options.onRemoveItem,
                options.resolveAttachmentPreview,
            ));
        }
        if (otherEntries.length > 0) {
            body.append(renderContextChipRow(otherEntries, options.onRemoveItem));
        }

        strip.append(body);
        if (attachmentsOnly) {
            syncAttachmentsExpanded();
        }
    }

    if (attachmentCount > 0) {
        strip.classList.add('theia-mod-has-attachments');
    }
    if (imageEntries.length > 0) {
        strip.classList.add('theia-mod-has-images');
    }
    if (fileEntries.length > 0) {
        strip.classList.add('theia-mod-has-files');
    }

    return strip;
}

function sanitizeContextKindClass(kind: string | undefined): string {
    return (kind ?? 'context').replace(/[^a-zA-Z0-9_-]+/g, '-');
}
