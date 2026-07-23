// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import type { QaapAppearanceMode } from '../common/qaap-appearance-mode';

export interface QaapAppearanceModeSwitchController {
    readonly root: HTMLElement;
    getValue(): QaapAppearanceMode;
    setValue(mode: QaapAppearanceMode): void;
}

const SEGMENTS: ReadonlyArray<{
    readonly id: QaapAppearanceMode;
    readonly labelKey: string;
    readonly defaultLabel: string;
    readonly icon: () => SVGSVGElement;
}> = [
    {
        id: 'light',
        labelKey: 'qaap/appearance/light',
        defaultLabel: 'Light',
        icon: createSunIcon,
    },
    {
        id: 'dark',
        labelKey: 'qaap/appearance/dark',
        defaultLabel: 'Dark',
        icon: createMoonIcon,
    },
    {
        id: 'system',
        labelKey: 'qaap/appearance/system',
        defaultLabel: 'System',
        icon: createMonitorIcon,
    },
];

/** Pill segmented control: Light / Dark / System (sun · moon · monitor). */
export function createQaapAppearanceModeSwitch(options: {
    readonly value: QaapAppearanceMode;
    readonly onChange: (mode: QaapAppearanceMode) => void;
}): QaapAppearanceModeSwitchController {
    const root = document.createElement('div');
    root.className = 'theia-qaap-appearance-mode-switch';
    root.setAttribute('role', 'radiogroup');
    root.setAttribute('aria-label', nls.localize('qaap/appearance/label', 'Appearance'));

    const buttons: HTMLButtonElement[] = [];
    let current = options.value;

    const sync = (): void => {
        for (const btn of buttons) {
            const selected = btn.dataset.mode === current;
            btn.classList.toggle('theia-mod-selected', selected);
            btn.setAttribute('aria-checked', selected ? 'true' : 'false');
        }
    };

    for (const segment of SEGMENTS) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theia-qaap-appearance-mode-switch-option';
        btn.dataset.mode = segment.id;
        btn.setAttribute('role', 'radio');
        const label = nls.localize(segment.labelKey, segment.defaultLabel);
        btn.title = label;
        btn.setAttribute('aria-label', label);
        btn.append(segment.icon());
        btn.addEventListener('click', ev => {
            ev.preventDefault();
            ev.stopPropagation();
            if (current === segment.id) {
                // Re-apply so the active Qaap Light/Dark theme is restored if it drifted.
                options.onChange(segment.id);
                return;
            }
            current = segment.id;
            sync();
            options.onChange(segment.id);
        });
        buttons.push(btn);
        root.append(btn);
    }
    sync();

    return {
        root,
        getValue: () => current,
        setValue: (mode: QaapAppearanceMode) => {
            current = mode;
            sync();
        },
    };
}

function createSunIcon(): SVGSVGElement {
    return svgIcon(
        '0 0 16 16',
        '<circle cx="8" cy="8" r="2.5" fill="currentColor"/>'
        + '<path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M3.4 12.6l1.3-1.3M11.3 4.7l1.3-1.3" '
        + 'stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none"/>',
    );
}

function createMoonIcon(): SVGSVGElement {
    return svgIcon(
        '0 0 16 16',
        '<path d="M11.2 10.6A4.8 4.8 0 0 1 5.4 4.8c0-.4 0-.8.1-1.1A5.5 5.5 0 1 0 12.3 10.5c-.35.07-.72.1-1.1.1z" fill="currentColor"/>',
    );
}

function createMonitorIcon(): SVGSVGElement {
    return svgIcon(
        '0 0 16 16',
        '<rect x="2.25" y="2.75" width="11.5" height="8" rx="1.4" stroke="currentColor" stroke-width="1.4" fill="none"/>'
        + '<path d="M6 13.25h4M8 10.75v2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
    );
}

function svgIcon(viewBox: string, innerHtml: string): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', viewBox);
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('theia-qaap-appearance-mode-switch-icon');
    svg.innerHTML = innerHtml;
    return svg;
}
