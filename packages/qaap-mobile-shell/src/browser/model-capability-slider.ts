// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import {
    CAPABILITY_LEVELS,
    clampModelCapabilityLevel,
    modelCapabilityLevelFraction,
    resolveCapabilityLevelLabel,
    snapModelCapabilityFraction,
    type ModelCapabilityLevelValue,
} from '../common/qaap-sticky-composer-model-capability';

export interface ModelCapabilitySliderOptions {
    readonly level: ModelCapabilityLevelValue;
    readonly onPreview?: (level: ModelCapabilityLevelValue) => void;
    readonly onCommit: (level: ModelCapabilityLevelValue) => void;
}

export interface ModelCapabilitySliderHandle {
    readonly root: HTMLElement;
    setLevel(level: ModelCapabilityLevelValue, options?: { commit?: boolean }): void;
    getLevel(): ModelCapabilityLevelValue;
    dispose(): void;
}

export function createModelCapabilitySlider(options: ModelCapabilitySliderOptions): ModelCapabilitySliderHandle {
    let committedLevel = clampModelCapabilityLevel(options.level);
    let previewLevel = committedLevel;
    let dragging = false;
    let pointerId: number | undefined;
    let keyboardFocus = false;

    const root = document.createElement('div');
    root.className = 'qaap-model-capability-slider';

    const track = document.createElement('div');
    track.className = 'qaap-model-capability-slider-track';

    const fill = document.createElement('div');
    fill.className = 'qaap-model-capability-slider-fill';

    const marksHost = document.createElement('div');
    marksHost.className = 'qaap-model-capability-slider-marks';

    const markButtons: HTMLButtonElement[] = [];
    for (const level of CAPABILITY_LEVELS) {
        const mark = document.createElement('button');
        mark.type = 'button';
        mark.className = 'qaap-model-capability-slider-mark';
        mark.dataset.level = String(level.value);
        mark.title = level.label;
        mark.setAttribute('aria-label', level.label);
        mark.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            setPreviewLevel(level.value);
            commitLevel(level.value);
        });
        markButtons.push(mark);
        marksHost.append(mark);
    }

    const thumb = document.createElement('div');
    thumb.className = 'qaap-model-capability-slider-thumb';
    thumb.setAttribute('aria-hidden', 'true');

    track.append(fill, marksHost, thumb);
    root.append(track);

    const syncAria = (): void => {
        root.setAttribute('role', 'slider');
        root.setAttribute('tabindex', '0');
        root.setAttribute('aria-label', nls.localize('qaap/mobileProjects/modelCapabilityAria', 'Capacidad del modelo'));
        root.setAttribute('aria-valuemin', '0');
        root.setAttribute('aria-valuemax', String(CAPABILITY_LEVELS.length - 1));
        root.setAttribute('aria-valuenow', String(previewLevel));
        root.setAttribute('aria-valuetext', resolveCapabilityLevelLabel(previewLevel));
    };

    const applyVisualLevel = (level: ModelCapabilityLevelValue): void => {
        const fraction = modelCapabilityLevelFraction(level);
        const percent = `${fraction * 100}%`;
        fill.style.width = percent;
        thumb.style.left = percent;
        for (const mark of markButtons) {
            const markLevel = Number(mark.dataset.level);
            mark.classList.toggle('theia-mod-active', markLevel === level);
            mark.classList.toggle('theia-mod-filled', markLevel <= level);
        }
        root.classList.toggle('theia-mod-keyboard-focus', keyboardFocus);
        syncAria();
    };

    const setPreviewLevel = (level: ModelCapabilityLevelValue): void => {
        previewLevel = clampModelCapabilityLevel(level);
        applyVisualLevel(previewLevel);
        options.onPreview?.(previewLevel);
    };

    const commitLevel = (level: ModelCapabilityLevelValue): void => {
        const next = clampModelCapabilityLevel(level);
        if (next === committedLevel) {
            previewLevel = next;
            applyVisualLevel(previewLevel);
            return;
        }
        committedLevel = next;
        previewLevel = next;
        applyVisualLevel(previewLevel);
        options.onCommit(next);
    };

    const fractionFromClientX = (clientX: number): number => {
        const rect = track.getBoundingClientRect();
        if (rect.width <= 0) {
            return modelCapabilityLevelFraction(previewLevel);
        }
        return (clientX - rect.left) / rect.width;
    };

    const onPointerMove = (event: PointerEvent): void => {
        if (!dragging || event.pointerId !== pointerId) {
            return;
        }
        event.preventDefault();
        setPreviewLevel(snapModelCapabilityFraction(fractionFromClientX(event.clientX)));
    };

    const endDrag = (event: PointerEvent): void => {
        if (!dragging || event.pointerId !== pointerId) {
            return;
        }
        dragging = false;
        pointerId = undefined;
        root.classList.remove('theia-mod-dragging');
        try {
            track.releasePointerCapture(event.pointerId);
        } catch {
            /* ignore */
        }
        commitLevel(previewLevel);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', endDrag);
        window.removeEventListener('pointercancel', endDrag);
    };

    const startDrag = (event: PointerEvent): void => {
        if (event.button !== 0) {
            return;
        }
        event.preventDefault();
        dragging = true;
        pointerId = event.pointerId;
        root.classList.add('theia-mod-dragging');
        setPreviewLevel(snapModelCapabilityFraction(fractionFromClientX(event.clientX)));
        track.setPointerCapture(event.pointerId);
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', endDrag);
        window.addEventListener('pointercancel', endDrag);
    };

    track.addEventListener('pointerdown', startDrag);
    root.addEventListener('keydown', event => {
        keyboardFocus = true;
        root.classList.add('theia-mod-keyboard-focus');
        let next = previewLevel;
        switch (event.key) {
            case 'ArrowLeft':
            case 'ArrowDown':
                event.preventDefault();
                next = clampModelCapabilityLevel(previewLevel - 1);
                break;
            case 'ArrowRight':
            case 'ArrowUp':
                event.preventDefault();
                next = clampModelCapabilityLevel(previewLevel + 1);
                break;
            case 'Home':
                event.preventDefault();
                next = 0;
                break;
            case 'End':
                event.preventDefault();
                next = 3;
                break;
            default:
                return;
        }
        setPreviewLevel(next);
        commitLevel(next);
    });
    root.addEventListener('blur', () => {
        keyboardFocus = false;
        root.classList.remove('theia-mod-keyboard-focus');
    });

    applyVisualLevel(previewLevel);

    return {
        root,
        setLevel(level: ModelCapabilityLevelValue, commitOptions?: { commit?: boolean }): void {
            if (commitOptions?.commit) {
                commitLevel(level);
                return;
            }
            committedLevel = clampModelCapabilityLevel(level);
            setPreviewLevel(committedLevel);
        },
        getLevel(): ModelCapabilityLevelValue {
            return committedLevel;
        },
        dispose(): void {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', endDrag);
            window.removeEventListener('pointercancel', endDrag);
            root.remove();
        },
    };
}
