// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export type { PreviewInteractionMode } from '@theia/qaap-element-inspector/lib/browser/element-inspector-types';

export type PreviewAnnotationStatus = 'draft' | 'confirmed' | 'attached';

export type PreviewAnnotationAnchor =
    | { kind: 'element'; selector: string; xRatio: number; yRatio: number }
    | { kind: 'page'; documentXRatio: number; documentYRatio: number };

export interface PreviewAnnotationElementMeta {
    readonly tagName: string;
    /** Stable selector used for dedupe and agent context (when available). */
    readonly selector?: string;
    /** Short id/hash hint shown next to the tag in the popover chip (e.g. DOM id). */
    readonly idHint?: string;
    readonly text?: string;
    readonly ariaLabel?: string;
    readonly component?: string;
    readonly sourceFile?: string;
    readonly sourceLine?: number;
}

export interface PreviewAnnotation {
    readonly id: string;
    /** Execution identity; keeps two focused preview tabs from sharing marker/send state. */
    readonly previewId: string;
    readonly threadId: string;
    readonly workspaceId: string;
    readonly previewUrl: string;
    readonly route: string;
    comment: string;
    readonly viewport: { mode: 'desktop' | 'mobile'; width: number; height: number };
    readonly anchor: PreviewAnnotationAnchor;
    /** Last known document ratios for unresolved fallback after re-anchor. */
    documentXRatio: number;
    documentYRatio: number;
    /**
     * Primary element reference (first selected). Kept for backward compatibility;
     * prefer {@link elements} when reading multi-select annotate drafts.
     */
    element?: PreviewAnnotationElementMeta;
    /** All element references attached to this annotation (multi-select annotate). */
    elements?: PreviewAnnotationElementMeta[];
    status: PreviewAnnotationStatus;
    readonly createdAt: number;
    unresolved?: boolean;
}

/** Elements attached to an annotation (multi-select, with legacy `element` fallback). */
export function listPreviewAnnotationElements(annotation: Pick<PreviewAnnotation, 'element' | 'elements'>): PreviewAnnotationElementMeta[] {
    if (annotation.elements && annotation.elements.length > 0) {
        return [...annotation.elements];
    }
    return annotation.element ? [annotation.element] : [];
}

/** Stable key for deduplicating element references in an annotate draft. */
export function previewAnnotationElementKey(meta: Pick<PreviewAnnotationElementMeta, 'tagName' | 'selector' | 'idHint' | 'text' | 'ariaLabel'>): string {
    const selector = meta.selector?.trim();
    if (selector) {
        return `sel:${selector}`;
    }
    const idHint = meta.idHint?.trim();
    if (idHint) {
        return `id:${meta.tagName.toLowerCase()}#${idHint}`;
    }
    return `tag:${meta.tagName.toLowerCase()}|${meta.text ?? ''}|${meta.ariaLabel ?? ''}`;
}

export interface PreviewAnnotationScope {
    /** Optional for legacy callers; new Work Hub previews always provide the execution previewId. */
    readonly previewId?: string;
    readonly workspaceId: string;
    readonly threadId: string;
    readonly previewUrl: string;
    readonly route: string;
    readonly viewportMode: 'desktop' | 'mobile';
    readonly viewportWidth: number;
    readonly viewportHeight: number;
}

export function buildPreviewAnnotationScopeKey(scope: Pick<PreviewAnnotationScope, 'workspaceId' | 'threadId' | 'previewUrl' | 'route'>): string {
    const previewId = 'previewId' in scope && typeof scope.previewId === 'string'
        ? scope.previewId
        : scope.previewUrl;
    return [scope.workspaceId, scope.threadId, previewId, scope.route].join('::');
}
