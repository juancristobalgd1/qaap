// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable } from '@theia/core/lib/common/disposable';

export interface MobilePanelResizeDragEvent {
    readonly clientX: number;
    readonly clientY: number;
    readonly startClientX: number;
    readonly startClientY: number;
}

export interface MobilePanelResizeDragOptions {
    readonly handle: HTMLElement;
    readonly enabled?: () => boolean;
    readonly onStart?: () => void;
    readonly onMove: (event: MobilePanelResizeDragEvent) => void;
    readonly onEnd?: () => void;
}

/**
 * Cross-platform resize drag for panel split handles.
 *
 * Pointer capture is used when available, but the move/end listeners also live on the
 * document. This is important for WebKit and older browsers where capture can be
 * unavailable or can be lost while the pointer leaves a narrow handle. Environments
 * without Pointer Events use document-level mouse/touch listeners instead.
 */
export function installMobilePanelResizeDrag(options: MobilePanelResizeDragOptions): Disposable {
    const { handle, onMove, onStart, onEnd, enabled = () => true } = options;
    const supportsPointerEvents = typeof window !== 'undefined'
        && (typeof window.PointerEvent === 'function' || typeof globalThis.PointerEvent === 'function');

    let activePointerId: number | undefined;
    let activeTouchId: number | undefined;
    let activeMouse = false;
    let startClientX = 0;
    let startClientY = 0;

    const isActive = (): boolean => activePointerId !== undefined || activeTouchId !== undefined || activeMouse;

    const finish = (): void => {
        if (!isActive()) {
            return;
        }
        const pointerId = activePointerId;
        activePointerId = undefined;
        activeTouchId = undefined;
        activeMouse = false;
        if (pointerId !== undefined) {
            try {
                handle.releasePointerCapture(pointerId);
            } catch {
                /* Safari may already have released capture */
            }
        }
        onEnd?.();
    };

    const emitMove = (clientX: number, clientY: number): void => {
        onMove({
            clientX,
            clientY,
            startClientX,
            startClientY,
        });
    };

    const begin = (
        clientX: number,
        clientY: number,
        pointerId?: number,
        touchId?: number,
        mouse = false,
    ): boolean => {
        if (!enabled() || isActive()) {
            return false;
        }
        startClientX = clientX;
        startClientY = clientY;
        activePointerId = pointerId;
        activeTouchId = touchId;
        activeMouse = mouse;
        onStart?.();
        if (pointerId !== undefined) {
            try {
                handle.setPointerCapture(pointerId);
            } catch {
                /* capture is best-effort; document listeners still receive moves */
            }
        }
        return true;
    };

    const onPointerDown = (event: PointerEvent): void => {
        if (!enabled() || event.isPrimary === false) {
            return;
        }
        if (event.pointerType === 'mouse' && event.button !== 0) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        begin(event.clientX, event.clientY, event.pointerId);
    };

    const onPointerMove = (event: PointerEvent): void => {
        if (activePointerId === undefined || event.pointerId !== activePointerId) {
            return;
        }
        event.preventDefault();
        emitMove(event.clientX, event.clientY);
    };

    const onPointerEnd = (event: PointerEvent): void => {
        if (activePointerId === undefined || event.pointerId !== activePointerId) {
            return;
        }
        finish();
    };

    const onMouseDown = (event: MouseEvent): void => {
        if (!enabled() || event.button !== 0 || isActive()) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        begin(event.clientX, event.clientY, undefined, undefined, true);
    };

    const onMouseMove = (event: MouseEvent): void => {
        if (!activeMouse) {
            return;
        }
        event.preventDefault();
        emitMove(event.clientX, event.clientY);
    };

    const onMouseUp = (event: MouseEvent): void => {
        if (!activeMouse || event.button !== 0) {
            return;
        }
        finish();
    };

    const onTouchStart = (event: TouchEvent): void => {
        if (!enabled() || isActive() || event.touches.length !== 1) {
            return;
        }
        const touch = event.touches[0];
        if (event.cancelable) {
            event.preventDefault();
        }
        event.stopPropagation();
        begin(touch.clientX, touch.clientY, undefined, touch.identifier);
    };

    const onTouchMove = (event: TouchEvent): void => {
        if (activeTouchId === undefined) {
            return;
        }
        const touch = Array.from(event.touches).find(entry => entry.identifier === activeTouchId);
        if (!touch) {
            return;
        }
        if (event.cancelable) {
            event.preventDefault();
        }
        emitMove(touch.clientX, touch.clientY);
    };

    const onTouchEnd = (event: TouchEvent): void => {
        if (activeTouchId === undefined) {
            return;
        }
        const ended = Array.from(event.changedTouches).some(entry => entry.identifier === activeTouchId);
        if (ended) {
            finish();
        }
    };

    handle.addEventListener('pointerdown', onPointerDown);
    if (supportsPointerEvents) {
        document.addEventListener('pointermove', onPointerMove, true);
        document.addEventListener('pointerup', onPointerEnd, true);
        document.addEventListener('pointercancel', onPointerEnd, true);
    } else {
        handle.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mousemove', onMouseMove, true);
        document.addEventListener('mouseup', onMouseUp, true);
        handle.addEventListener('touchstart', onTouchStart, { passive: false });
        document.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
        document.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });
        document.addEventListener('touchcancel', onTouchEnd, { capture: true, passive: true });
    }

    return Disposable.create(() => {
        handle.removeEventListener('pointerdown', onPointerDown);
        if (supportsPointerEvents) {
            document.removeEventListener('pointermove', onPointerMove, true);
            document.removeEventListener('pointerup', onPointerEnd, true);
            document.removeEventListener('pointercancel', onPointerEnd, true);
        } else {
            handle.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('mousemove', onMouseMove, true);
            document.removeEventListener('mouseup', onMouseUp, true);
            handle.removeEventListener('touchstart', onTouchStart);
            document.removeEventListener('touchmove', onTouchMove, true);
            document.removeEventListener('touchend', onTouchEnd, true);
            document.removeEventListener('touchcancel', onTouchEnd, true);
        }
        finish();
    });
}
