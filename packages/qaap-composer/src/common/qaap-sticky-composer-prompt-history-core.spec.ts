// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import {
    isTextareaCaretAtBeginning,
    isTextareaCaretAtEnd,
    textareaCaretLineColumn,
} from './qaap-sticky-composer-prompt-history-core';
import { useSuiteJSDOM } from '../browser/test/qaap-jsdom-suite';

disableImportJSDOM();

describe('qaap-sticky-composer-prompt-history-core', () => {

    useSuiteJSDOM();

    function createTextarea(value: string, start: number, end = start): HTMLTextAreaElement {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        if (typeof textarea.setSelectionRange === 'function') {
            textarea.setSelectionRange(start, end);
        } else {
            Object.defineProperty(textarea, 'selectionStart', { value: start, configurable: true });
            Object.defineProperty(textarea, 'selectionEnd', { value: end, configurable: true });
        }
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
