// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { ImageContextVariable, IMAGE_CONTEXT_VARIABLE } from '@theia/ai-chat/lib/common/image-context-variable';
import {
    buildPendingComposerContextArg,
    type StickyComposerContextEntry,
} from '../common/qaap-composer-context-entry';
import {
    applyComposerContextEntryPreview,
    collectComposerImagePreviews,
    renderStickyComposerContextStrip,
    resolveStickyComposerContextChip,
    resolveStickyComposerContextEntry,
    resolveDocumentIconClasses,
} from '../browser/qaap-sticky-composer-context-ui';

describe('qaap-sticky-composer-context-ui', () => {

    it('resolveDocumentIconClasses maps common document types', () => {
        expect(resolveDocumentIconClasses('report.pdf')).to.equal('codicon codicon-file-pdf');
        expect(resolveDocumentIconClasses('notes.md')).to.equal('codicon codicon-markdown');
        expect(resolveDocumentIconClasses('archive.zip')).to.equal('codicon codicon-file-zip');
        expect(resolveDocumentIconClasses('readme.txt')).to.equal('codicon codicon-file');
    });

    it('resolveStickyComposerContextChip renders image attachments with preview metadata', () => {
        const request = ImageContextVariable.createRequest({
            name: 'screenshot.png',
            mimeType: 'image/png',
            data: btoa('fake'),
        });
        const view = resolveStickyComposerContextChip(request);
        expect(view.attachmentKind).to.equal('image');
        expect(view.title).to.equal('screenshot.png');
        expect(view.previewSrc).to.equal('data:image/png;base64,ZmFrZQ==');
        expect(view.subtitle).to.equal('PNG');
    });

    it('resolveStickyComposerContextChip renders file attachments with basename title', () => {
        const view = resolveStickyComposerContextChip({
            variable: {
                id: 'file-provider',
                name: 'file',
                label: 'File',
                description: 'File',
            },
            arg: 'docs/spec/report.pdf',
        });
        expect(view.attachmentKind).to.equal('file');
        expect(view.title).to.equal('report.pdf');
        expect(view.iconClasses).to.equal('codicon codicon-file-pdf');
    });

    it('resolveStickyComposerContextChip treats image files as image attachments', () => {
        const view = resolveStickyComposerContextChip({
            variable: {
                id: 'file-provider',
                name: 'file',
                label: 'File',
                description: 'File',
            },
            arg: 'uploads/photo.jpg',
        });
        expect(view.attachmentKind).to.equal('image');
        expect(view.title).to.equal('photo.jpg');
    });

    it('resolveStickyComposerContextChip keeps generic context chips separate from attachments', () => {
        const view = resolveStickyComposerContextChip({
            variable: {
                id: 'editorContext',
                name: 'editorContext',
                label: 'Editor',
                description: 'Editor',
            },
            arg: 'src/app.ts',
        });
        expect(view.attachmentKind).to.equal('context');
        expect(view.kind).to.equal('editorContext');
    });

    it('resolveStickyComposerContextEntry renders pending image entries with local blob preview', () => {
        const entry: StickyComposerContextEntry = {
            id: 'img-pending',
            pending: true,
            displayName: 'screenshot.png',
            localPreviewSrc: 'blob:local-preview',
            request: {
                variable: {
                    id: 'imageContext',
                    name: 'imageContext',
                    label: 'Image',
                    description: 'Image',
                },
                arg: buildPendingComposerContextArg('img-pending'),
            },
        };
        const view = resolveStickyComposerContextEntry(entry);
        expect(view.attachmentKind).to.equal('image');
        expect(view.pending).to.equal(true);
        expect(view.title).to.equal('screenshot.png');
        expect(view.previewSrc).to.equal('blob:local-preview');
    });

    it('resolveStickyComposerContextEntry renders pending document files without preview', () => {
        const entry: StickyComposerContextEntry = {
            id: 'doc-pending',
            pending: true,
            displayName: 'spec.pdf',
            request: {
                variable: {
                    id: 'file-provider',
                    name: 'file',
                    label: 'File',
                    description: 'File',
                },
                arg: buildPendingComposerContextArg('doc-pending'),
            },
        };
        const view = resolveStickyComposerContextEntry(entry);
        expect(view.attachmentKind).to.equal('file');
        expect(view.pending).to.equal(true);
        expect(view.title).to.equal('spec.pdf');
        expect(view.iconClasses).to.equal('codicon codicon-file-pdf');
        expect(view.previewSrc).to.equal(undefined);
    });

    it('resolveStickyComposerContextEntry treats pending image files as image attachments', () => {
        const entry: StickyComposerContextEntry = {
            id: 'photo-pending',
            pending: true,
            displayName: 'photo.heic',
            localPreviewSrc: 'blob:heic-preview',
            request: {
                variable: {
                    id: 'file-provider',
                    name: 'file',
                    label: 'File',
                    description: 'File',
                },
                arg: buildPendingComposerContextArg('photo-pending'),
            },
        };
        const view = resolveStickyComposerContextEntry(entry);
        expect(view.attachmentKind).to.equal('image');
        expect(view.pending).to.equal(true);
        expect(view.previewSrc).to.equal('blob:heic-preview');
    });

    it('resolveStickyComposerContextEntry resolves finalized entries like plain requests', () => {
        const request = ImageContextVariable.createRequest({
            name: 'done.png',
            mimeType: 'image/png',
            data: btoa('ok'),
        });
        const entry: StickyComposerContextEntry = {
            id: 'done',
            request,
        };
        const fromEntry = resolveStickyComposerContextEntry(entry);
        const fromRequest = resolveStickyComposerContextChip(request);
        expect(fromEntry).to.deep.equal(fromRequest);
    });

    it('collectComposerImagePreviews returns preview metadata for image attachments', async () => {
        const request = ImageContextVariable.createRequest({
            name: 'shot.png',
            mimeType: 'image/png',
            data: btoa('ok'),
        });
        const entry: StickyComposerContextEntry = {
            id: 'img-1',
            request,
            localPreviewSrc: 'blob:local-preview',
        };
        expect(await collectComposerImagePreviews([entry])).to.deep.equal([
            { src: 'data:image/png;base64,b2s=', fileName: 'shot.png' },
        ]);
    });

    it('collectComposerImagePreviews resolves path-based workspace SVG previews on submit', async () => {
        const request = ImageContextVariable.createPathBasedRequest('assets/logo.svg', 'logo.svg');
        const entry: StickyComposerContextEntry = { id: 'svg-1', request };
        const resolvePreview = async (): Promise<string> => 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
        expect(await collectComposerImagePreviews([entry], resolvePreview)).to.deep.equal([
            { src: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', fileName: 'logo.svg' },
        ]);
    });

    describe('applyComposerContextEntryPreview', () => {
        function pendingImageEntry(): StickyComposerContextEntry {
            return {
                id: 'img-1',
                pending: true,
                displayName: 'photo.png',
                localPreviewSrc: 'blob:local-preview',
                request: { variable: IMAGE_CONTEXT_VARIABLE, arg: buildPendingComposerContextArg('img-1') },
            };
        }

        it('restores the local blob miniature onto a request-only provider chip (the attach bug)', () => {
            // Simulate exactly what MobileProjectsStickyComposerContextUi.formatComposerContextEntry does
            // in production: the host provider resolves from entry.request alone (no preview), then the
            // entry state is merged back in.
            const entry = pendingImageEntry();
            const providerChip = resolveStickyComposerContextChip(entry.request);
            expect(providerChip.previewSrc).to.equal(undefined); // provider cannot see the blob url

            const view = applyComposerContextEntryPreview(providerChip, entry);
            expect(view.attachmentKind).to.equal('image');
            expect(view.previewSrc).to.equal('blob:local-preview');
            expect(view.pending).to.equal(true);
            expect(view.title).to.equal('photo.png');
        });

        it('does not overwrite a preview the provider already resolved', () => {
            const view = applyComposerContextEntryPreview(
                { title: 'screenshot.png', iconClasses: '', kind: 'imageContext', attachmentKind: 'image', previewSrc: 'data:image/png;base64,ZmFrZQ==' },
                { id: 'x', pending: true, localPreviewSrc: 'blob:should-not-win', request: { variable: IMAGE_CONTEXT_VARIABLE, arg: '' } },
            );
            expect(view.previewSrc).to.equal('data:image/png;base64,ZmFrZQ==');
        });

        it('leaves a finalized entry (no local preview) untouched', () => {
            const providerChip = { title: 'a.txt', iconClasses: 'codicon codicon-file', kind: 'file', attachmentKind: 'file' as const };
            const view = applyComposerContextEntryPreview(providerChip, { id: 'y', request: { variable: IMAGE_CONTEXT_VARIABLE, arg: '' } });
            expect(view.previewSrc).to.equal(undefined);
            expect(view.pending).to.equal(undefined);
            expect(view.title).to.equal('a.txt');
        });
    });

    describe('renderStickyComposerContextStrip', () => {
        let disableJSDOM: () => void;

        before(() => {
            disableJSDOM = enableJSDOM();
            const style = document.createElement('style');
            style.textContent = `
                .theia-mobile-projects-sticky-composer-context-body {
                    display: flex;
                }
                .theia-mobile-projects-sticky-composer-context-body[hidden] {
                    display: none !important;
                }
            `;
            document.head.append(style);
        });

        after(() => {
            disableJSDOM();
        });

        it('collapses attachment previews when the header toggle is clicked', () => {
            const request = ImageContextVariable.createRequest({
                name: 'screenshot.png',
                mimeType: 'image/png',
                data: btoa('img'),
            });
            const entry: StickyComposerContextEntry = { id: 'img-1', request };
            let expanded = true;

            const strip = renderStickyComposerContextStrip({
                items: [entry],
                formatChip: resolveStickyComposerContextEntry,
                onRemoveItem: () => undefined,
                onClearAll: () => undefined,
                filesExpanded: expanded,
                onFilesExpandedChange: value => { expanded = value; },
            });
            document.body.append(strip);

            const toggle = strip.querySelector<HTMLButtonElement>(
                '.theia-mobile-projects-sticky-composer-context-files-toggle',
            );
            const body = strip.querySelector<HTMLElement>(
                '.theia-mobile-projects-sticky-composer-context-body',
            );
            expect(toggle).to.exist;
            expect(body).to.exist;
            expect(toggle!.getAttribute('aria-expanded')).to.equal('true');
            expect(body!.hidden).to.equal(false);
            expect(window.getComputedStyle(body!).display).to.equal('flex');

            toggle!.click();

            expect(expanded).to.equal(false);
            expect(toggle!.getAttribute('aria-expanded')).to.equal('false');
            expect(toggle!.classList.contains('theia-mod-collapsed')).to.equal(true);
            expect(strip.classList.contains('theia-mod-attachments-collapsed')).to.equal(true);
            expect(body!.hidden).to.equal(true);
            expect(window.getComputedStyle(body!).display).to.equal('none');
        });
    });
});
