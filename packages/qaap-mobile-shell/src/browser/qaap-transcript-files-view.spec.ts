// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import {
    defaultTranscriptFilesTreePosition,
    filterTranscriptFileTreeEntries,
    findTranscriptReadmeEntry,
    isTranscriptFilesTreeStacked,
    isTranscriptPreviewableTextFile,
    mountTranscriptFilesView,
    resolveTranscriptFilesTreeVisible,
    shouldSkipTranscriptFilesDirectory,
    transcriptFileIconClass,
    type TranscriptFileTreeEntry,
    type TranscriptFilesViewServices,
} from './qaap-transcript-files-view';

describe('qaap-transcript-files-view', () => {
    const entry = (name: string, relativePath: string, isDirectory = false): TranscriptFileTreeEntry => ({
        name,
        resourcePath: `file:///repo/${relativePath}`,
        relativePath,
        isDirectory,
    });

    it('skips heavy workspace directories', () => {
        expect(shouldSkipTranscriptFilesDirectory('node_modules')).to.be.true;
        expect(shouldSkipTranscriptFilesDirectory('src')).to.be.false;
    });

    it('filters files by name or relative path', () => {
        const entries = [
            entry('README.md', 'README.md'),
            entry('index.ts', 'src/index.ts'),
            entry('styles.css', 'src/styles.css'),
        ];
        expect(filterTranscriptFileTreeEntries(entries, 'readme')).to.deep.equal([entries[0]]);
        expect(filterTranscriptFileTreeEntries(entries, 'src/')).to.deep.equal([entries[1], entries[2]]);
    });

    it('maps common extensions to codicons', () => {
        // package.json gets the dedicated JSON codicon (special filename)
        expect(transcriptFileIconClass('package.json')).to.equal('codicon-json');
        expect(transcriptFileIconClass('README.md')).to.equal('codicon-markdown');
        expect(transcriptFileIconClass('src/index.ts')).to.equal('codicon-file-code');
    });

    it('detects previewable text files', () => {
        expect(isTranscriptPreviewableTextFile('README.md')).to.be.true;
        expect(isTranscriptPreviewableTextFile('image.png')).to.be.false;
    });

    it('defaults tree position by viewport width', () => {
        expect(defaultTranscriptFilesTreePosition(1024)).to.equal('side');
        expect(defaultTranscriptFilesTreePosition(480)).to.equal('bottom');
    });

    it('resolves stacked layout from tree position', () => {
        expect(isTranscriptFilesTreeStacked('bottom')).to.be.true;
        expect(isTranscriptFilesTreeStacked('side')).to.be.false;
    });

    it('defaults file tree to visible', () => {
        expect(resolveTranscriptFilesTreeVisible()).to.be.true;
    });

    it('finds README at workspace root by known names', () => {
        const entries = [
            entry('package.json', 'package.json'),
            entry('README.md', 'README.md'),
            entry('src', 'src', true),
        ];
        expect(findTranscriptReadmeEntry(entries)?.name).to.equal('README.md');
    });

    it('falls back to readme* files when no exact candidate matches', () => {
        const entries = [
            entry('readme.txt', 'readme.txt'),
            entry('index.ts', 'index.ts'),
        ];
        expect(findTranscriptReadmeEntry(entries)?.name).to.equal('readme.txt');
    });

    it('ignores directories when searching for README', () => {
        const entries = [entry('readme', 'readme', true)];
        expect(findTranscriptReadmeEntry(entries)).to.be.undefined;
    });

    describe('mountTranscriptFilesView tree toggle', () => {
        let disableJSDOM: (() => void) | undefined;

        before(() => {
            disableJSDOM = enableJSDOM();
        });

        after(() => {
            disableJSDOM?.();
            disableJSDOM = undefined;
        });

        beforeEach(() => {
            disableJSDOM?.();
            disableJSDOM = enableJSDOM();
            if (typeof PointerEvent === 'undefined') {
                class PointerEventPolyfill extends MouseEvent {
                    constructor(type: string, params: MouseEventInit = {}) {
                        super(type, params);
                    }
                }
                (globalThis as typeof globalThis & { PointerEvent: typeof PointerEvent }).PointerEvent =
                    PointerEventPolyfill as unknown as typeof PointerEvent;
            }
            document.body.innerHTML = '';
            try {
                window.localStorage.removeItem('qaap.transcriptFiles.treeVisible');
            } catch {
                /* session-only */
            }
        });

        const createServices = (): TranscriptFilesViewServices => ({
            resolveRootUri: () => 'file:///repo',
            listDirectory: async () => [],
            relativePathForResource: (_resourcePath, rootUri) => _resourcePath.slice(`${rootUri}/`.length),
            readFile: async () => '',
            localize: (_key, defaultValue) => defaultValue,
        });

        it('omits preview breadcrumb; keeps lock and toolbar actions left-aligned', () => {
            const host = document.createElement('div');
            document.body.append(host);
            mountTranscriptFilesView(host, '/repo', createServices());

            expect(host.querySelector('.theia-mobile-transcript-files-breadcrumb')).to.be.null;
            const header = host.querySelector('.theia-mobile-transcript-files-preview-header');
            const actions = host.querySelector('.theia-mobile-transcript-files-preview-actions');
            expect(header).to.exist;
            expect(actions).to.exist;
            expect(header?.firstElementChild).to.equal(actions);
            expect(host.querySelector('.theia-mobile-transcript-files-edit-toggle.codicon-lock')).to.exist;
            expect(host.querySelector('.theia-mobile-transcript-files-tree-toggle')).to.exist;
            // ⋯ defaults to preview actions until Work Hub relocates it via attachMoreActionsHost.
            expect(host.querySelector('.theia-mobile-transcript-files-preview-actions .theia-mobile-transcript-files-more')).to.exist;
        });

        it('exposes file tree toggle in preview actions, not overflow menu', () => {
            const host = document.createElement('div');
            document.body.append(host);
            mountTranscriptFilesView(host, '/repo', createServices());

            const treeToggle = host.querySelector('.theia-mobile-transcript-files-tree-toggle');
            expect(treeToggle).to.exist;
            expect(treeToggle?.classList.contains('codicon-list-tree')).to.be.true;
            expect(treeToggle?.getAttribute('aria-pressed')).to.equal('true');
            expect(treeToggle?.getAttribute('aria-label')).to.equal('Hide file tree');

            const moreBtn = host.querySelector<HTMLButtonElement>('.theia-mobile-transcript-files-more');
            moreBtn?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            const overflowMenu = document.querySelector('.theia-mobile-transcript-files-menu:not(.theia-mod-create)');
            expect(overflowMenu).to.exist;
            expect(overflowMenu?.textContent ?? '').to.not.include('Show file tree');
            expect(overflowMenu?.textContent ?? '').to.not.include('Hide file tree');
            expect(overflowMenu?.querySelector('.codicon-list-tree')).to.be.null;
        });

        it('relocates more-actions button to an external Work Hub header host', () => {
            const host = document.createElement('div');
            document.body.append(host);
            const headerHost = document.createElement('div');
            document.body.append(headerHost);
            const mount = mountTranscriptFilesView(host, '/repo', createServices());

            expect(mount.attachMoreActionsHost).to.be.a('function');
            mount.attachMoreActionsHost?.(headerHost);

            expect(headerHost.querySelector('.theia-mobile-transcript-files-more')).to.exist;
            expect(headerHost.querySelector('.theia-mobile-transcript-files-more--header')).to.exist;
            expect(host.querySelector('.theia-mobile-transcript-files-preview-actions .theia-mobile-transcript-files-more')).to.be.null;

            const moreBtn = headerHost.querySelector<HTMLButtonElement>('.theia-mobile-transcript-files-more');
            moreBtn?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            expect(document.querySelector('.theia-mobile-transcript-files-menu:not(.theia-mod-create)')).to.exist;

            mount.attachMoreActionsHost?.(undefined);
            expect(host.querySelector('.theia-mobile-transcript-files-preview-actions .theia-mobile-transcript-files-more')).to.exist;
            expect(headerHost.querySelector('.theia-mobile-transcript-files-more')).to.be.null;
        });

        it('toggles file tree visibility from the toolbar button', () => {
            const host = document.createElement('div');
            document.body.append(host);
            mountTranscriptFilesView(host, '/repo', createServices());

            const layout = host.querySelector('.theia-mobile-transcript-files-layout');
            const treeToggle = host.querySelector<HTMLButtonElement>('.theia-mobile-transcript-files-tree-toggle');
            expect(layout?.classList.contains('theia-mod-tree-hidden')).to.be.false;

            treeToggle?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            expect(layout?.classList.contains('theia-mod-tree-hidden')).to.be.true;
            expect(treeToggle?.getAttribute('aria-pressed')).to.equal('false');
            expect(treeToggle?.getAttribute('aria-label')).to.equal('Show file tree');

            treeToggle?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            expect(layout?.classList.contains('theia-mod-tree-hidden')).to.be.false;
            expect(treeToggle?.getAttribute('aria-pressed')).to.equal('true');
            expect(treeToggle?.getAttribute('aria-label')).to.equal('Hide file tree');
        });
    });
});
