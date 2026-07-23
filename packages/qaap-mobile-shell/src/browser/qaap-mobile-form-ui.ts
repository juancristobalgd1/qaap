// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { createExecutionSurfaceIconElement } from '../common/qaap-scm-changes-icon';

export interface QaapSegmentedOption<T extends string = string> {
    readonly id: T;
    readonly label: string;
    /**
     * Icon class: a `codicon-*` glyph, or a custom Qaap SVG host such as
     * `qaap-icon-message-circle`.
     */
    readonly iconClass?: string;
}

export interface QaapSegmentedFieldController<T extends string = string> {
    readonly root: HTMLElement;
    readonly hiddenInput: HTMLInputElement;
    getValue(): T;
    setValue(value: T): void;
}

/** Segmented control used by QAAP mobile forms. */
export function createSegmentedField<T extends string>(options: {
    readonly label?: string;
    readonly segments: readonly QaapSegmentedOption<T>[];
    readonly value: T;
    readonly onChange?: (value: T) => void;
    /** Render segment labels as icons only (labels become `title` / `aria-label`). */
    readonly iconOnly?: boolean;
}): QaapSegmentedFieldController<T> {
    const root = document.createElement('div');
    root.className = 'theia-qaap-segmented-field';

    if (options.label) {
        const labelEl = document.createElement('div');
        labelEl.className = 'theia-qaap-segmented-label';
        labelEl.textContent = options.label;
        root.append(labelEl);
    }

    const bar = document.createElement('div');
    bar.className = 'theia-qaap-segmented-bar';
    if (options.iconOnly) {
        bar.classList.add('theia-mod-icon-only');
    }
    bar.setAttribute('role', 'tablist');

    const hiddenInput = document.createElement('input');
    hiddenInput.type = 'hidden';
    let current = options.value;
    hiddenInput.value = current;

    const buttons: HTMLButtonElement[] = [];

    const syncSelection = (): void => {
        for (const btn of buttons) {
            const selected = btn.dataset.segmentId === current;
            btn.classList.toggle('theia-mod-selected', selected);
            btn.setAttribute('aria-selected', selected ? 'true' : 'false');
        }
        hiddenInput.value = current;
    };

    for (const segment of options.segments) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theia-qaap-segmented-option';
        btn.dataset.segmentId = segment.id;
        btn.title = segment.label;
        btn.setAttribute('aria-label', segment.label);
        btn.setAttribute('role', 'tab');
        if (segment.iconClass) {
            btn.append(createExecutionSurfaceIconElement(segment.iconClass, ''));
            if (!options.iconOnly) {
                const text = document.createElement('span');
                text.className = 'theia-qaap-segmented-option-label';
                text.textContent = segment.label;
                btn.append(text);
            }
        } else {
            btn.textContent = segment.label;
        }
        btn.addEventListener('click', () => {
            if (current === segment.id) {
                return;
            }
            current = segment.id;
            syncSelection();
            options.onChange?.(current);
        });
        buttons.push(btn);
        bar.append(btn);
    }

    syncSelection();
    root.append(bar, hiddenInput);

    return {
        root,
        hiddenInput,
        getValue: () => current,
        setValue: value => {
            current = value;
            syncSelection();
        },
    };
}

export function createFormFieldLabel(text: string, options?: { readonly id?: string }): HTMLElement {
    const label = document.createElement('label');
    label.className = 'theia-qaap-form-field-label';
    label.textContent = text;
    if (options?.id) {
        label.id = options.id;
    }
    return label;
}

/** Associates a visual field label with its control for assistive tech. */
export function wireFormFieldLabel(label: HTMLElement, control: HTMLElement): void {
    if (!label.id) {
        label.id = `qaap-form-label-${Math.random().toString(36).slice(2, 10)}`;
    }
    if (!control.id) {
        control.id = `${label.id}-control`;
    }
    if (label instanceof HTMLLabelElement) {
        label.htmlFor = control.id;
    }
    control.setAttribute('aria-labelledby', label.id);
}
