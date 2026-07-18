// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { PanelLayout } from '@theia/core/lib/browser/widgets/widget';
import { MiniBrowser } from '@theia/mini-browser/lib/browser/mini-browser';
import { QaapMiniBrowserContent } from './qaap-mini-browser-content';
import { QaapPreviewFramePicker, QaapPreviewFramePickerFactory } from './qaap-preview-frame-picker';
import { qaapPreviewFrameMatchesUrl } from './qaap-preview-surface-match';

export interface QaapPreviewSurfaceHandle {
    readonly frame: HTMLIFrameElement;
    readonly picker: QaapPreviewFramePicker;
    readonly kind: 'embedded' | 'mini-browser';
    readonly focusRoot: HTMLElement;
    readonly lastActivatedAt: number;
    isConnected(): boolean;
    activate(): void;
}

@injectable()
export class QaapPreviewSurfaceRegistry {

    @inject(QaapPreviewFramePickerFactory)
    protected readonly pickerFactory: QaapPreviewFramePickerFactory;

    protected readonly surfaces: QaapPreviewSurfaceHandle[] = [];
    protected activationSequence = 0;

    registerEmbedded(frame: HTMLIFrameElement, toDispose: DisposableCollection, focusRoot: HTMLElement = frame): QaapPreviewSurfaceHandle {
        const picker = this.pickerFactory.create(frame, toDispose);
        return this.registerSurface(frame, picker, 'embedded', focusRoot, toDispose);
    }

    registerMiniBrowserContent(content: QaapMiniBrowserContent, toDispose: DisposableCollection): QaapPreviewSurfaceHandle {
        const frame = content.previewFrame;
        const picker = content.getPreviewFramePicker();
        return this.registerSurface(frame, picker, 'mini-browser', content.node, toDispose, () => content.node.isConnected);
    }

    protected registerSurface(
        frame: HTMLIFrameElement,
        picker: QaapPreviewFramePicker,
        kind: QaapPreviewSurfaceHandle['kind'],
        focusRoot: HTMLElement,
        toDispose: DisposableCollection,
        isConnected: () => boolean = () => frame.isConnected,
    ): QaapPreviewSurfaceHandle {
        let lastActivatedAt = ++this.activationSequence;
        const handle: QaapPreviewSurfaceHandle = {
            frame,
            picker,
            kind,
            focusRoot,
            get lastActivatedAt(): number { return lastActivatedAt; },
            isConnected,
            activate: () => { lastActivatedAt = ++this.activationSequence; },
        };
        const activate = (): void => handle.activate();
        focusRoot.addEventListener('pointerdown', activate, true);
        focusRoot.addEventListener('focusin', activate, true);
        frame.addEventListener('focus', activate);
        toDispose.push(Disposable.create(() => {
            focusRoot.removeEventListener('pointerdown', activate, true);
            focusRoot.removeEventListener('focusin', activate, true);
            frame.removeEventListener('focus', activate);
        }));
        this.surfaces.push(handle);
        toDispose.push(Disposable.create(() => this.removeSurface(handle)));
        return handle;
    }

    hasActiveSurface(): boolean {
        return this.getActiveSurface() !== undefined;
    }

    getActiveSurface(): QaapPreviewSurfaceHandle | undefined {
        const connected = this.getConnectedSurfaces();
        if (!connected.length) {
            return undefined;
        }
        const activeElement = typeof document === 'undefined' ? undefined : document.activeElement;
        const focused = activeElement
            ? connected.filter(surface => surface.frame === activeElement || surface.focusRoot.contains(activeElement))
            : [];
        const candidates = focused.length > 0 ? focused : connected;
        return [...candidates].sort((left, right) => right.lastActivatedAt - left.lastActivatedAt)[0];
    }

    getConnectedSurfaces(): readonly QaapPreviewSurfaceHandle[] {
        return this.surfaces.filter(surface => surface.isConnected());
    }

    /** Returns the newest connected surface serving the requested project preview URL. */
    getSurfaceForPreviewUrl(expectedUrl: string): QaapPreviewSurfaceHandle | undefined {
        const matches = [...this.getConnectedSurfaces()].reverse()
            .filter(surface => qaapPreviewFrameMatchesUrl(surface.frame, expectedUrl));
        return matches.find(surface => surface.kind === 'mini-browser') ?? matches[0];
    }

    getSurfaceForFrame(frame: HTMLIFrameElement | undefined): QaapPreviewSurfaceHandle | undefined {
        if (!frame) {
            return undefined;
        }
        return [...this.getConnectedSurfaces()].reverse().find(surface => surface.frame === frame);
    }

    activateElementPicker(): { started: boolean; message: string } {
        const surface = this.getActiveSurface();
        if (!surface) {
            return {
                started: false,
                message: 'No preview open. Open a dev preview first, then pick an element.',
            };
        }
        surface.picker.startElementPicker();
        return {
            started: true,
            message: 'Element picker active — click an element in the preview.',
        };
    }

    async toggleElementInspector(): Promise<void> {
        const surface = this.getActiveSurface();
        if (surface) {
            await surface.picker.openElementInspector();
        }
    }

    protected removeSurface(handle: QaapPreviewSurfaceHandle): void {
        const index = this.surfaces.indexOf(handle);
        if (index >= 0) {
            this.surfaces.splice(index, 1);
        }
    }
}

export function findQaapMiniBrowserContentFromWidgets(widgets: Iterable<unknown>): QaapMiniBrowserContent | undefined {
    for (const widget of widgets) {
        if (!(widget instanceof MiniBrowser)) {
            continue;
        }
        const child = (widget.layout as PanelLayout).widgets[0];
        if (child instanceof QaapMiniBrowserContent) {
            return child;
        }
    }
    return undefined;
}
