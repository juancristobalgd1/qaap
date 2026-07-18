// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { listPreviewAnnotationElements, type PreviewAnnotation } from './qaap-preview-annotation-types';

/** Command implemented by qaap-mobile-shell — attach chip; pass `submit: true` to also send. */
export const QAAP_WORK_HUB_ATTACH_COMPOSER_CONTEXT_COMMAND = 'qaap.workHub.attachComposerContext';

/** Inline image payload forwarded with annotate Send (base64, no workspace upload). */
export interface PreviewAnnotationChatImageAttachment {
    readonly name: string;
    readonly mimeType: string;
    readonly data: string;
}

export interface PreviewAnnotationChatAttachArgs {
    readonly chipTitle: string;
    readonly contextBody: string;
    readonly dedupeKey: string;
    readonly submit: true;
    readonly images?: readonly PreviewAnnotationChatImageAttachment[];
}

export function buildAnnotateChatAttachArgs(
    confirmed: readonly PreviewAnnotation[],
    route: string,
    viewportMode: 'desktop' | 'mobile',
    images?: readonly PreviewAnnotationChatImageAttachment[],
): PreviewAnnotationChatAttachArgs | undefined {
    if (confirmed.length === 0) {
        return undefined;
    }
    const chipTitle = formatPreviewFeedbackChipTitle(confirmed, route, viewportMode);
    const contextBody = formatPreviewFeedbackAgentContext(confirmed);
    const dedupeKey = buildPreviewFeedbackDedupeKey(confirmed[0]!, confirmed.map(item => item.id));
    const args: PreviewAnnotationChatAttachArgs = {
        chipTitle,
        contextBody,
        dedupeKey,
        submit: true,
    };
    if (images?.length) {
        return { ...args, images };
    }
    return args;
}

export function formatPreviewFeedbackChipTitle(
    annotations: readonly PreviewAnnotation[],
    route: string,
    viewportMode: 'desktop' | 'mobile',
): string {
    const count = annotations.length;
    const countLabel = nls.localize(
        'qaap/preview/feedbackChipCount',
        '{0} annotations',
        String(count),
    );
    const routeLabel = route || '/';
    const viewportLabel = viewportMode === 'mobile'
        ? nls.localize('qaap/preview/viewportMobile', 'Mobile')
        : nls.localize('qaap/preview/viewportDesktop', 'Desktop');
    return nls.localize(
        'qaap/preview/feedbackChipTitle',
        'Preview feedback · {0} · {1} · {2}',
        countLabel,
        routeLabel,
        viewportLabel,
    );
}

export function formatPreviewFeedbackAgentContext(annotations: readonly PreviewAnnotation[]): string {
    const lines: string[] = [
        'Preview feedback annotations (compact context — not full DOM):',
    ];
    annotations.forEach((item, index) => {
        lines.push('');
        lines.push(`Annotation ${index + 1}:`);
        lines.push(`- Comment: ${item.comment}`);
        lines.push(`- Route: ${item.route}`);
        lines.push(`- Viewport: ${item.viewport.mode} ${item.viewport.width}x${item.viewport.height}`);
        if (item.anchor.kind === 'element') {
            lines.push(`- Selector: ${item.anchor.selector}`);
            lines.push(`- Position in element: x=${item.anchor.xRatio.toFixed(3)}, y=${item.anchor.yRatio.toFixed(3)}`);
        } else {
            lines.push(`- Page position: x=${item.anchor.documentXRatio.toFixed(3)}, y=${item.anchor.documentYRatio.toFixed(3)}`);
        }
        lines.push(`- Document position: x=${item.documentXRatio.toFixed(3)}, y=${item.documentYRatio.toFixed(3)}`);
        const elements = listPreviewAnnotationElements(item);
        if (elements.length > 1) {
            lines.push(`- Elements (${elements.length}):`);
            elements.forEach((el, elIndex) => {
                const label = el.idHint ? `<${el.tagName}> #${el.idHint}` : `<${el.tagName}>`;
                lines.push(`  ${elIndex + 1}. ${label}`);
                if (el.selector) {
                    lines.push(`     Selector: ${el.selector}`);
                }
                if (el.text) {
                    lines.push(`     Text: ${el.text}`);
                }
                if (el.sourceFile) {
                    const line = el.sourceLine !== undefined ? `:${el.sourceLine}` : '';
                    lines.push(`     Source: ${el.sourceFile}${line}`);
                } else if (el.component) {
                    lines.push(`     Component: ${el.component}`);
                }
            });
        } else {
            const primary = elements[0] ?? item.element;
            if (primary?.tagName) {
                lines.push(`- Element: <${primary.tagName}>`);
            }
            if (primary?.text) {
                lines.push(`- Text: ${primary.text}`);
            }
            if (primary?.sourceFile) {
                const line = primary.sourceLine !== undefined ? `:${primary.sourceLine}` : '';
                lines.push(`- Source: ${primary.sourceFile}${line}`);
            } else if (primary?.component) {
                lines.push(`- Component: ${primary.component}`);
            }
        }
        if (item.unresolved) {
            lines.push('- Note: anchor unresolved (element missing; using last document ratios)');
        }
    });
    return lines.join('\n');
}

export function buildPreviewFeedbackDedupeKey(
    scope: Pick<PreviewAnnotation, 'workspaceId' | 'threadId' | 'previewUrl' | 'route'>,
    annotationIds: readonly string[],
): string {
    return [
        'previewFeedback',
        scope.workspaceId,
        scope.threadId,
        scope.previewUrl,
        scope.route,
        [...annotationIds].sort().join(','),
    ].join('|');
}

export function confirmedAnnotationsForChat(annotations: readonly PreviewAnnotation[]): PreviewAnnotation[] {
    return annotations.filter(item => item.status === 'confirmed' || item.status === 'attached');
}
