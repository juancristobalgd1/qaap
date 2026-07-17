// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

let disableJSDOM = enableJSDOM();

import { expect } from 'chai';
import {
    canConfirmAnnotationComment,
    getAnnotationSpeechRecognitionCtor,
    mountAnnotationCommentPopover,
} from './qaap-preview-annotation-popover';

disableJSDOM();

describe('qaap-preview-annotation-popover', () => {
    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM();
    });

    afterEach(() => {
        document.querySelectorAll('.qaap-preview-annotation-popover').forEach(node => node.remove());
    });

    it('mounts a compact pill with mic action and a single-line textarea', () => {
        const handle = mountAnnotationCommentPopover({
            anchorClientX: 40,
            anchorClientY: 40,
            onConfirm: () => { /* */ },
            onCancel: () => { /* */ },
        });

        const input = handle.root.querySelector('.qaap-preview-annotation-popover-input') as HTMLTextAreaElement;
        const mic = handle.root.querySelector('.qaap-preview-annotation-popover-mic') as HTMLButtonElement;
        const cancel = handle.root.querySelector('.qaap-preview-annotation-popover-cancel') as HTMLButtonElement;
        const confirm = handle.root.querySelector('.qaap-preview-annotation-popover-confirm') as HTMLButtonElement;

        expect(input).to.exist;
        expect(input.rows).to.equal(1);
        expect(input.placeholder).to.equal('Describe the change');
        expect(mic).to.exist;
        expect(cancel).to.exist;
        expect(confirm).to.exist;
        expect(handle.root.classList.contains('qaap-preview-annotation-popover--expanded')).to.equal(false);

        expect(cancel.textContent?.trim()).to.equal('');
        expect(confirm.textContent?.trim()).to.equal('');
        expect(cancel.querySelector('.codicon-close')).to.exist;
        expect(confirm.querySelector('.codicon-arrow-up')).to.exist;
        expect(mic.querySelector('.codicon-mic')).to.exist;

        expect(cancel.getAttribute('aria-label')).to.be.ok;
        expect(confirm.getAttribute('aria-label')).to.be.ok;
        expect(mic.getAttribute('aria-label')).to.be.ok;
        expect(cancel.title).to.be.ok;
        expect(confirm.title).to.be.ok;

        handle.dispose();
        expect(document.querySelector('.qaap-preview-annotation-popover')).to.not.exist;
    });

    it('shows an element tag chip when elementTagName is provided', () => {
        const handle = mountAnnotationCommentPopover({
            anchorClientX: 10,
            anchorClientY: 10,
            elementTagName: 'DIV',
            onConfirm: () => { /* */ },
            onCancel: () => { /* */ },
        });

        const chip = handle.root.querySelector('.qaap-preview-annotation-popover-chip') as HTMLElement;
        expect(chip).to.exist;
        expect(chip.textContent).to.contain('div');
        handle.dispose();
    });

    it('expands when the textarea has content and collapses when cleared', () => {
        const handle = mountAnnotationCommentPopover({
            anchorClientX: 10,
            anchorClientY: 10,
            onConfirm: () => { /* */ },
            onCancel: () => { /* */ },
        });

        const input = handle.root.querySelector('.qaap-preview-annotation-popover-input') as HTMLTextAreaElement;
        const fireInput = (): void => {
            const event = document.createEvent('Event');
            event.initEvent('input', true, true);
            input.dispatchEvent(event);
        };
        input.value = 'make the header smaller';
        fireInput();
        expect(handle.root.classList.contains('qaap-preview-annotation-popover--expanded')).to.equal(true);

        input.value = '';
        fireInput();
        expect(handle.root.classList.contains('qaap-preview-annotation-popover--expanded')).to.equal(false);
        handle.dispose();
    });

    it('starts expanded when initialComment is set', () => {
        const handle = mountAnnotationCommentPopover({
            anchorClientX: 10,
            anchorClientY: 10,
            initialComment: 'existing note',
            onConfirm: () => { /* */ },
            onCancel: () => { /* */ },
        });

        expect(handle.root.classList.contains('qaap-preview-annotation-popover--expanded')).to.equal(true);
        handle.dispose();
    });

    it('includes a delete icon when allowDelete is set', () => {
        let deleted = false;
        const handle = mountAnnotationCommentPopover({
            anchorClientX: 10,
            anchorClientY: 10,
            allowDelete: true,
            initialComment: 'keep me editable',
            onConfirm: () => { /* */ },
            onCancel: () => { /* */ },
            onDelete: () => { deleted = true; },
        });

        const deleteBtn = handle.root.querySelector('.qaap-preview-annotation-popover-delete') as HTMLButtonElement;
        expect(deleteBtn).to.exist;
        expect(deleteBtn.querySelector('.codicon-trash')).to.exist;
        deleteBtn.click();
        expect(deleted).to.equal(true);
        expect(document.querySelector('.qaap-preview-annotation-popover')).to.not.exist;
    });

    it('exposes speech recognition availability without throwing', () => {
        expect(() => getAnnotationSpeechRecognitionCtor()).to.not.throw();
        expect(canConfirmAnnotationComment('  ok  ')).to.equal(true);
        expect(canConfirmAnnotationComment('   ')).to.equal(false);
    });
});
