// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export function textareaCaretLineColumn(textarea: HTMLTextAreaElement): { line: number; column: number } {
    const value = textarea.value;
    const pos = textarea.selectionStart;
    let line = 1;
    let column = 1;
    for (let i = 0; i < pos; i++) {
        if (value[i] === '\n') {
            line++;
            column = 1;
        } else {
            column++;
        }
    }
    return { line, column };
}

export function isTextareaCaretAtBeginning(textarea: HTMLTextAreaElement): boolean {
    const { line, column } = textareaCaretLineColumn(textarea);
    return line === 1 && column === 1;
}

export function isTextareaCaretAtEnd(textarea: HTMLTextAreaElement): boolean {
    return textarea.selectionEnd === textarea.value.length;
}

export function isStickyComposerMentionPopoverOpen(input: HTMLTextAreaElement): boolean {
    const wrap = input.closest('.theia-mobile-projects-sticky-composer-input-wrap');
    return wrap?.classList.contains('theia-mod-mention-popover-open') ?? false;
}
