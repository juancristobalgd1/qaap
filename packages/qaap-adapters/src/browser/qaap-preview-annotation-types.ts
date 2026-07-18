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
    element?: PreviewAnnotationElementMeta;
    status: PreviewAnnotationStatus;
    readonly createdAt: number;
    unresolved?: boolean;
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
