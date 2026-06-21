// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    isTextareaCaretAtBeginning,
    isTextareaCaretAtEnd,
    textareaCaretLineColumn,
} from '../common/qaap-sticky-composer-prompt-history-core';

describe('qaap-sticky-composer-prompt-history-core', () => {
    function createTextarea(value: string, start: number, end = start): HTMLTextAreaElement {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.setSelectionRange(start, end);
        return textarea;
    }

    it('detects caret line and column in multiline textareas', () => {
        expect(textareaCaretLineColumn(createTextarea('hello', 0))).to.deep.equal({ line: 1, column: 1 });
        expect(textareaCaretLineColumn(createTextarea('hello\nworld', 7))).to.deep.equal({ line: 2, column: 2 });
    });

    it('detects beginning and end caret positions', () => {
        const value = 'line one\nline two';
        const start = createTextarea(value, 0);
        const end = createTextarea(value, value.length);
        expect(isTextareaCaretAtBeginning(start)).to.equal(true);
        expect(isTextareaCaretAtEnd(end)).to.equal(true);
        expect(isTextareaCaretAtBeginning(end)).to.equal(false);
        expect(isTextareaCaretAtEnd(start)).to.equal(false);
    });
});
