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
        const spacer = handle.root.querySelector('.qaap-preview-annotation-popover-actions-spacer') as HTMLElement;

        expect(input).to.exist;
        expect(input.rows).to.equal(1);
        expect(input.placeholder).to.equal('Describe the change');
        expect(mic).to.exist;
        expect(cancel).to.exist;
        expect(confirm).to.exist;
        expect(spacer).to.exist;
        expect(handle.root.classList.contains('qaap-preview-annotation-popover--expanded')).to.equal(false);

        // Empty pill: cancel is a compact × icon button; confirm is send.
        expect(cancel.classList.contains('qaap-preview-annotation-popover-icon-btn')).to.equal(true);
        expect(cancel.classList.contains('qaap-preview-annotation-popover-context-chip')).to.equal(false);
        const cancelGlyph = cancel.querySelector('svg.qaap-preview-annotation-popover-glyph') as SVGSVGElement;
        expect(cancelGlyph).to.exist;
        expect(cancelGlyph.querySelector('path')?.getAttribute('d') ?? '').to.match(/M4 4 L12 12/i);
        const confirmGlyph = confirm.querySelector('svg.qaap-preview-annotation-popover-glyph') as SVGSVGElement;
        expect(confirmGlyph).to.exist;
        // Confirm uses a checkmark path (not arrow-up).
        expect(confirmGlyph.querySelector('path')?.getAttribute('d') ?? '').to.match(/L6\.7 11\.2/i);
        expect(mic.querySelector('svg.qaap-preview-annotation-popover-glyph')).to.exist;

        expect(cancel.getAttribute('aria-label')).to.be.ok;
        expect(confirm.getAttribute('aria-label')).to.be.ok;
        expect(mic.getAttribute('aria-label')).to.be.ok;
        expect(cancel.title).to.be.ok;
        expect(confirm.title).to.be.ok;

        // DOM order: cancel × → spacer → mic → confirm (empty CSS hides cancel/send).
        const actions = handle.root.querySelector('.qaap-preview-annotation-popover-actions') as HTMLElement;
        const kids = Array.from(actions.children);
        expect(kids.indexOf(cancel)).to.be.lessThan(kids.indexOf(spacer));
        expect(kids.indexOf(spacer)).to.be.lessThan(kids.indexOf(mic));
        expect(kids.indexOf(mic)).to.be.lessThan(kids.indexOf(confirm));

        handle.dispose();
        expect(document.querySelector('.qaap-preview-annotation-popover')).to.not.exist;
    });

    it('commit() confirms a non-blank draft and reports false when blank', () => {
        const confirmed: string[] = [];
        const blankHandle = mountAnnotationCommentPopover({
            anchorClientX: 40,
            anchorClientY: 40,
            onConfirm: comment => { confirmed.push(comment); },
            onCancel: () => { /* */ },
        });
        expect(blankHandle.commit()).to.equal(false);
        expect(confirmed).to.have.length(0);
        expect(document.querySelector('.qaap-preview-annotation-popover')).to.exist;
        blankHandle.dispose();

        const handle = mountAnnotationCommentPopover({
            anchorClientX: 40,
            anchorClientY: 40,
            onConfirm: comment => { confirmed.push(comment); },
            onCancel: () => { /* */ },
        });
        const input = handle.root.querySelector('.qaap-preview-annotation-popover-input') as HTMLTextAreaElement;
        input.value = '  Make it darker  ';
        expect(handle.commit()).to.equal(true);
        expect(confirmed).to.deep.equal(['Make it darker']);
        // Confirm disposes the popover DOM.
        expect(document.querySelector('.qaap-preview-annotation-popover')).to.not.exist;
    });

    it('shows an element tag chip with target SVG when elementTagName is provided', () => {
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
        const icon = chip.querySelector('svg.qaap-preview-annotation-popover-chip-icon') as SVGSVGElement;
        expect(icon).to.exist;
        // Cursor-style: rounded frame + hollow triangular pointer (stroke, not fill).
        expect(icon.querySelector('rect[fill="none"]')).to.exist;
        const pointer = icon.querySelector('path') as SVGPathElement;
        expect(pointer).to.exist;
        expect(pointer.getAttribute('fill')).to.equal('none');
        expect(pointer.getAttribute('stroke')).to.equal('currentColor');
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
        expect(deleteBtn.querySelector('svg.qaap-preview-annotation-popover-glyph')).to.exist;
        deleteBtn.click();
        expect(deleted).to.equal(true);
        expect(document.querySelector('.qaap-preview-annotation-popover')).to.not.exist;
    });

    it('exposes speech recognition availability without throwing', () => {
        expect(() => getAnnotationSpeechRecognitionCtor()).to.not.throw();
        expect(canConfirmAnnotationComment('  ok  ')).to.equal(true);
        expect(canConfirmAnnotationComment('   ')).to.equal(false);
    });

    it('attaches optional composerSession agent controls in the expanded footer', () => {
        let attached = 0;
        let disposed = 0;
        const handle = mountAnnotationCommentPopover({
            anchorClientX: 10,
            anchorClientY: 10,
            initialComment: 'note',
            onConfirm: () => { /* */ },
            onCancel: () => { /* */ },
            composerSession: {
                attach: host => {
                    attached += 1;
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'theia-mobile-projects-sticky-composer-agent';
                    btn.textContent = 'Codex';
                    host.append(btn);
                    return {
                        dispose: () => {
                            disposed += 1;
                            host.replaceChildren();
                        },
                    };
                },
            },
        });

        expect(attached).to.equal(1);
        expect(handle.root.classList.contains('qaap-preview-annotation-popover--expanded')).to.equal(true);
        const session = handle.root.querySelector('.qaap-preview-annotation-popover-session') as HTMLElement;
        expect(session).to.exist;
        expect(session.querySelector('.theia-mobile-projects-sticky-composer-agent')?.textContent).to.equal('Codex');

        const actions = handle.root.querySelector('.qaap-preview-annotation-popover-actions') as HTMLElement;
        const cancel = handle.root.querySelector('.qaap-preview-annotation-popover-cancel') as HTMLElement;
        const spacer = handle.root.querySelector('.qaap-preview-annotation-popover-actions-spacer') as HTMLElement;
        const kids = Array.from(actions.children);
        expect(kids.indexOf(cancel)).to.be.lessThan(kids.indexOf(session));
        expect(kids.indexOf(session)).to.be.lessThan(kids.indexOf(spacer));

        handle.dispose();
        expect(disposed).to.equal(1);
    });

    it('ignores outside clicks that land on sticky composer agent sheets', async () => {
        let cancelled = 0;
        const handle = mountAnnotationCommentPopover({
            anchorClientX: 10,
            anchorClientY: 10,
            initialComment: 'keep open',
            onConfirm: () => { /* */ },
            onCancel: () => { cancelled += 1; },
        });

        // Outside listener is installed on the next frame / timeout (jsdom has no rAF).
        await new Promise<void>(resolve => {
            setTimeout(resolve, 0);
        });

        const sheet = document.createElement('div');
        sheet.className = 'theia-mobile-sticky-composer-sheet theia-mod-agent';
        document.body.append(sheet);

        sheet.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

        expect(cancelled).to.equal(0);
        expect(document.querySelector('.qaap-preview-annotation-popover')).to.exist;

        sheet.remove();

        const popoverSheet = document.createElement('div');
        popoverSheet.className = 'qaap-sticky-composer-sheet-popover theia-mod-agent-picker theia-mod-annotation-anchor';
        document.body.append(popoverSheet);
        popoverSheet.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

        expect(cancelled).to.equal(0);
        expect(document.querySelector('.qaap-preview-annotation-popover')).to.exist;

        popoverSheet.remove();
        handle.dispose();
    });

    it('ignores mousedown on the annotate toolbar so Send can commit the open draft', async () => {
        let cancelled = 0;
        const handle = mountAnnotationCommentPopover({
            anchorClientX: 10,
            anchorClientY: 10,
            initialComment: 'keep open',
            onConfirm: () => { /* */ },
            onCancel: () => { cancelled += 1; },
        });
        await new Promise<void>(resolve => {
            setTimeout(resolve, 0);
        });

        const toolbar = document.createElement('div');
        toolbar.className = 'qaap-preview-annotate-toolbar';
        const sendBtn = document.createElement('button');
        sendBtn.className = 'qaap-preview-annotate-toolbar-send';
        toolbar.append(sendBtn);
        document.body.append(toolbar);

        sendBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

        // No cancel and — critically — no blocking `window.confirm` discard prompt.
        expect(cancelled).to.equal(0);
        expect(document.querySelector('.qaap-preview-annotation-popover')).to.exist;

        toolbar.remove();
        handle.dispose();
    });
});
