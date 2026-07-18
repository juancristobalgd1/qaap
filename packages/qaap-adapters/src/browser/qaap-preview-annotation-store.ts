// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { generateUuid } from '@theia/core/lib/common/uuid';
import {
    buildPreviewAnnotationScopeKey,
    type PreviewAnnotation,
    type PreviewAnnotationScope,
    type PreviewAnnotationStatus,
} from './qaap-preview-annotation-types';

export const QAAP_PREVIEW_ANNOTATIONS_STORAGE_KEY = 'qaap.preview.annotations.v1';
const MAX_COMMENT_LENGTH = 2000;

export function sanitizeAnnotationComment(raw: string): string {
    return raw
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        // A line of backticks would terminate the fenced previewFeedback block in the outbound
        // prompt and truncate every following annotation — neutralize fence markers.
        .replace(/^(\s*)`{3,}/gm, '$1')
        .trim()
        .slice(0, MAX_COMMENT_LENGTH);
}

export function isBlankAnnotationComment(raw: string | undefined): boolean {
    return !sanitizeAnnotationComment(raw ?? '');
}

export function createPreviewAnnotation(
    scope: PreviewAnnotationScope,
    partial: Omit<PreviewAnnotation, 'id' | 'previewId' | 'threadId' | 'workspaceId' | 'previewUrl' | 'route' | 'viewport' | 'createdAt' | 'status'> & {
        readonly status?: PreviewAnnotationStatus;
        readonly createdAt?: number;
        readonly id?: string;
    },
): PreviewAnnotation {
    return {
        id: partial.id ?? generateUuid(),
        previewId: scope.previewId ?? scope.previewUrl,
        threadId: scope.threadId,
        workspaceId: scope.workspaceId,
        previewUrl: scope.previewUrl,
        route: scope.route,
        comment: sanitizeAnnotationComment(partial.comment),
        viewport: {
            mode: scope.viewportMode,
            width: scope.viewportWidth,
            height: scope.viewportHeight,
        },
        anchor: partial.anchor,
        documentXRatio: partial.documentXRatio,
        documentYRatio: partial.documentYRatio,
        element: partial.element,
        status: partial.status ?? 'draft',
        createdAt: partial.createdAt ?? Date.now(),
        unresolved: partial.unresolved,
    };
}

export class PreviewAnnotationStore {
    protected readonly byId = new Map<string, PreviewAnnotation>();

    constructor(protected readonly storage: Storage | undefined = typeof sessionStorage === 'undefined' ? undefined : sessionStorage) {
        this.hydrate();
    }

    list(): readonly PreviewAnnotation[] {
        return [...this.byId.values()].sort((a, b) => a.createdAt - b.createdAt);
    }

    listScope(scope: Pick<PreviewAnnotationScope, 'workspaceId' | 'threadId' | 'previewUrl' | 'route'>): PreviewAnnotation[] {
        const key = buildPreviewAnnotationScopeKey(scope);
        return this.list().filter(item => buildPreviewAnnotationScopeKey(item) === key);
    }

    listForConversation(workspaceId: string, threadId: string, previewId?: string): PreviewAnnotation[] {
        return this.list().filter(item => item.workspaceId === workspaceId
            && item.threadId === threadId
            && (previewId === undefined || item.previewId === previewId));
    }

    listVisibleMarkers(scope: Pick<PreviewAnnotationScope, 'workspaceId' | 'threadId' | 'previewUrl' | 'route'>): PreviewAnnotation[] {
        return this.listScope(scope).filter(item => item.status === 'confirmed' || item.status === 'draft' || item.status === 'attached');
    }

    get(id: string): PreviewAnnotation | undefined {
        return this.byId.get(id);
    }

    add(annotation: PreviewAnnotation): PreviewAnnotation {
        this.byId.set(annotation.id, annotation);
        this.persist();
        return annotation;
    }

    update(id: string, patch: Partial<Pick<PreviewAnnotation, 'comment' | 'status' | 'unresolved' | 'documentXRatio' | 'documentYRatio' | 'element'>>): PreviewAnnotation | undefined {
        const current = this.byId.get(id);
        if (!current) {
            return undefined;
        }
        const next: PreviewAnnotation = {
            ...current,
            ...patch,
            comment: patch.comment !== undefined ? sanitizeAnnotationComment(patch.comment) : current.comment,
        };
        this.byId.set(id, next);
        this.persist();
        return next;
    }

    remove(id: string): boolean {
        const ok = this.byId.delete(id);
        if (ok) {
            this.persist();
        }
        return ok;
    }

    /** Removes the most recently created annotation in the scope (undo). */
    undoLast(scope: Pick<PreviewAnnotationScope, 'workspaceId' | 'threadId' | 'previewUrl' | 'route'>): PreviewAnnotation | undefined {
        const items = this.listScope(scope);
        const last = items[items.length - 1];
        if (!last) {
            return undefined;
        }
        this.remove(last.id);
        return last;
    }

    markAttached(ids: readonly string[]): void {
        let changed = false;
        for (const id of ids) {
            const current = this.byId.get(id);
            if (current && current.status === 'confirmed') {
                this.byId.set(id, { ...current, status: 'attached' });
                changed = true;
            }
        }
        if (changed) {
            this.persist();
        }
    }

    /** Removes every annotation in the scope (draft, confirmed, attached). */
    clearScope(scope: Pick<PreviewAnnotationScope, 'workspaceId' | 'threadId' | 'previewUrl' | 'route'>): number {
        const ids = this.listScope(scope).map(item => item.id);
        if (ids.length === 0) {
            return 0;
        }
        for (const id of ids) {
            this.byId.delete(id);
        }
        this.persist();
        return ids.length;
    }

    protected hydrate(): void {
        if (!this.storage) {
            return;
        }
        try {
            const raw = this.storage.getItem(QAAP_PREVIEW_ANNOTATIONS_STORAGE_KEY);
            if (!raw) {
                return;
            }
            const parsed = JSON.parse(raw) as unknown;
            if (!Array.isArray(parsed)) {
                return;
            }
            for (const item of parsed) {
                if (!isPreviewAnnotationRecord(item)) {
                    continue;
                }
                this.byId.set(item.id, {
                    ...item,
                    previewId: typeof item.previewId === 'string' ? item.previewId : item.previewUrl,
                });
            }
        } catch {
            /* corrupt session payload */
        }
    }

    protected persist(): void {
        if (!this.storage) {
            return;
        }
        try {
            this.storage.setItem(QAAP_PREVIEW_ANNOTATIONS_STORAGE_KEY, JSON.stringify(this.list()));
        } catch {
            /* quota / private mode */
        }
    }
}

function isPreviewAnnotationRecord(value: unknown): value is PreviewAnnotation {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const record = value as Partial<PreviewAnnotation>;
    return typeof record.id === 'string'
        && (record.previewId === undefined || typeof record.previewId === 'string')
        && typeof record.threadId === 'string'
        && typeof record.workspaceId === 'string'
        && typeof record.previewUrl === 'string'
        && typeof record.route === 'string'
        && typeof record.comment === 'string'
        && typeof record.createdAt === 'number'
        && !!record.anchor
        && typeof record.documentXRatio === 'number'
        && typeof record.documentYRatio === 'number';
}
