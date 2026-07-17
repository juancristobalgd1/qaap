// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { PreviewAnnotation } from './qaap-preview-annotation-types';

export interface AnnotationMarkerPosition {
    readonly id: string;
    readonly clientX: number;
    readonly clientY: number;
    readonly unresolved?: boolean;
}

export interface PreviewAnnotationMarkersHandle {
    readonly host: HTMLElement;
    sync(annotations: readonly PreviewAnnotation[], positions: readonly AnnotationMarkerPosition[]): void;
    setVisible(visible: boolean): void;
    dispose(): void;
}

export function mountPreviewAnnotationMarkers(
    frameSlot: HTMLElement,
    options: {
        readonly onMarkerActivate: (id: string, clientX: number, clientY: number) => void;
    },
): PreviewAnnotationMarkersHandle {
    const host = document.createElement('div');
    host.className = 'qaap-preview-annotation-markers';
    host.setAttribute('aria-hidden', 'false');
    frameSlot.append(host);

    const sync = (annotations: readonly PreviewAnnotation[], positions: readonly AnnotationMarkerPosition[]): void => {
        const byId = new Map(positions.map(item => [item.id, item]));
        const numbered = annotations.filter(item => item.status !== 'draft' || !!item.comment || true);
        host.replaceChildren();
        let index = 0;
        for (const annotation of numbered) {
            const pos = byId.get(annotation.id);
            if (!pos) {
                continue;
            }
            index += 1;
            const marker = document.createElement('button');
            marker.type = 'button';
            marker.className = 'qaap-preview-annotation-marker';
            if (annotation.status === 'draft') {
                marker.classList.add('qaap-preview-annotation-marker--draft');
            }
            if (pos.unresolved || annotation.unresolved) {
                marker.classList.add('qaap-preview-annotation-marker--unresolved');
            }
            marker.textContent = String(index);
            marker.style.left = `${Math.round(pos.clientX)}px`;
            marker.style.top = `${Math.round(pos.clientY)}px`;
            marker.title = annotation.comment || `#${index}`;
            marker.addEventListener('click', (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                const rect = marker.getBoundingClientRect();
                options.onMarkerActivate(annotation.id, rect.left + rect.width / 2, rect.top + rect.height / 2);
            });
            host.append(marker);
        }
    };

    return {
        host,
        sync,
        setVisible: (visible: boolean) => {
            host.hidden = !visible;
        },
        dispose: () => host.remove(),
    };
}
