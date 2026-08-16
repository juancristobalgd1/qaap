// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import {
    clampTranscriptFilesTreeSize,
    defaultTranscriptFilesTreePosition,
    filterTranscriptFileTreeEntries,
    findTranscriptReadmeEntry,
    isTranscriptFilesTreeStacked,
    isTranscriptPreviewableTextFile,
    mountTranscriptFilesView,
    resolveTranscriptFilesTreePosition,
    resolveTranscriptFilesTreeVisible,
    shouldSkipTranscriptFilesDirectory,
    transcriptFileIconClass,
    writeStoredTranscriptFilesTreePosition,
    type TranscriptFileTreeEntry,
    type TranscriptFilesViewServices,
} from './qaap-transcript-files-view';

describe('qaap-transcript-files-view', () => {
    it('hides Files/Changes labels on narrow or coarse pointers', () => {
        const cssPath = path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'mobile-workbench-conversation.css');
        const css = fs.readFileSync(cssPath, 'utf8');
        expect(css).to.match(/@media \(max-width: 767px\),\s*\(pointer: coarse\)[\s\S]*?\.theia-mobile-transcript-files-view-mode-btn-label\s*\{\s*display:\s*none;/);
    });

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

    it('does not reuse an old desktop split preference on a narrow viewport', () => {
        window.localStorage.removeItem('qaap.transcriptFiles.treePosition.narrow');
        window.localStorage.removeItem('qaap.transcriptFiles.treePosition.wide');
        window.localStorage.setItem('qaap.transcriptFiles.treePosition', 'side');

        expect(resolveTranscriptFilesTreePosition(480)).to.equal('bottom');
        expect(resolveTranscriptFilesTreePosition(1024)).to.equal('side');

        window.localStorage.removeItem('qaap.transcriptFiles.treePosition');
    });

    it('resolves stacked layout from tree position', () => {
        expect(isTranscriptFilesTreeStacked('bottom')).to.be.true;
        expect(isTranscriptFilesTreeStacked('side')).to.be.false;
    });

    describe('clampTranscriptFilesTreeSize', () => {
        it('never returns less than the minimum pane size', () => {
            expect(clampTranscriptFilesTreeSize(150, 200, 1000)).to.equal(120);
            expect(clampTranscriptFilesTreeSize(150, 5000, 1000)).to.equal(120);
        });

        it('never returns more than maxRatio of the layout size', () => {
            // layout = 1000 → max = 0.78 * 1000 = 780
            expect(clampTranscriptFilesTreeSize(150, -1000, 1000)).to.equal(780);
        });

        it('tracks startSize - delta within bounds', () => {
            expect(clampTranscriptFilesTreeSize(300, 50, 1000)).to.equal(250);
            expect(clampTranscriptFilesTreeSize(300, -50, 1000)).to.equal(350);
        });
    });

    it('writes the narrow-scoped key when persisting a position at a narrow viewport', () => {
        window.localStorage.removeItem('qaap.transcriptFiles.treePosition.narrow');
        writeStoredTranscriptFilesTreePosition('bottom', 480);
        expect(window.localStorage.getItem('qaap.transcriptFiles.treePosition.narrow')).to.equal('bottom');
        window.localStorage.removeItem('qaap.transcriptFiles.treePosition.narrow');
    });

    it('keeps the Files layout contract in CSS: side grid tracks, side/bottom tree borders', () => {
        const cssPath = path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'mobile-workbench-conversation.css');
        const css = fs.readFileSync(cssPath, 'utf8');
        expect(css).to.include('minmax(0, 1fr) 5px minmax(120px');
        expect(css).to.match(/\.theia-mobile-transcript-files-layout\.theia-mod-tree-side\s*>\s*\.theia-mobile-transcript-files-tree\s*\{\s*border-left:/);
        expect(css).to.match(/\.theia-mobile-transcript-files-layout\.theia-mod-tree-bottom\s*>\s*\.theia-mobile-transcript-files-tree\s*\{\s*border-top:/);
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
                window.sessionStorage.removeItem('qaap.transcriptFiles.viewMode');
                window.sessionStorage.removeItem('qaap.transcriptFiles.pendingViewMode');
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

        it('mounts the file tree below the preview on mobile despite a legacy desktop preference', () => {
            const originalInnerWidth = window.innerWidth;
            const host = document.createElement('div');
            document.body.append(host);
            Object.defineProperty(window, 'innerWidth', { configurable: true, value: 480 });
            window.localStorage.removeItem('qaap.transcriptFiles.treePosition.narrow');
            window.localStorage.removeItem('qaap.transcriptFiles.treePosition.wide');
            window.localStorage.setItem('qaap.transcriptFiles.treePosition', 'side');

            const mount = mountTranscriptFilesView(host, '/repo', createServices());
            try {
                const layout = host.querySelector('.theia-mobile-transcript-files-layout');
                expect(layout?.classList.contains('theia-mod-tree-bottom')).to.be.true;
                expect(layout?.classList.contains('theia-mod-tree-side')).to.be.false;
            } finally {
                mount.dispose.dispose();
                window.localStorage.removeItem('qaap.transcriptFiles.treePosition');
                Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
            }
        });

        it('mounts the file tree beside the preview on a wide viewport', () => {
            const originalInnerWidth = window.innerWidth;
            const host = document.createElement('div');
            document.body.append(host);
            Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
            window.localStorage.removeItem('qaap.transcriptFiles.treePosition.narrow');
            window.localStorage.removeItem('qaap.transcriptFiles.treePosition.wide');

            const mount = mountTranscriptFilesView(host, '/repo', createServices());
            try {
                const layout = host.querySelector('.theia-mobile-transcript-files-layout');
                expect(layout?.classList.contains('theia-mod-tree-side')).to.be.true;
                expect(layout?.classList.contains('theia-mod-tree-bottom')).to.be.false;
            } finally {
                mount.dispose.dispose();
                Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
            }
        });

        it('re-resolves tree position on resize across the narrow/wide breakpoint without persisting', () => {
            const originalInnerWidth = window.innerWidth;
            const host = document.createElement('div');
            document.body.append(host);
            window.localStorage.removeItem('qaap.transcriptFiles.treePosition.narrow');
            window.localStorage.removeItem('qaap.transcriptFiles.treePosition.wide');
            Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });

            const mount = mountTranscriptFilesView(host, '/repo', createServices());
            try {
                const layout = host.querySelector('.theia-mobile-transcript-files-layout');
                expect(layout?.classList.contains('theia-mod-tree-side')).to.be.true;

                Object.defineProperty(window, 'innerWidth', { configurable: true, value: 480 });
                // Prefer `window.Event` — jsdom rejects cross-realm `Event` on `dispatchEvent`.
                // `onWindowResize` falls back to sync layout when rAF is missing (common in jsdom).
                window.dispatchEvent(new window.Event('resize'));

                expect(layout?.classList.contains('theia-mod-tree-bottom')).to.be.true;
                // Resize only re-resolves visually — it must not write the scoped storage.
                expect(window.localStorage.getItem('qaap.transcriptFiles.treePosition.narrow')).to.be.null;
            } finally {
                mount.dispose.dispose();
                window.localStorage.removeItem('qaap.transcriptFiles.treePosition.narrow');
                window.localStorage.removeItem('qaap.transcriptFiles.treePosition.wide');
                Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
            }
        });

        it('keeps the preview | split-handle | tree DOM order (no reordering)', () => {
            const host = document.createElement('div');
            document.body.append(host);
            const mount = mountTranscriptFilesView(host, '/repo', createServices());

            try {
                const layout = host.querySelector<HTMLElement>('.theia-mobile-transcript-files-layout');
                const children = layout ? Array.from(layout.children) : [];
                expect(children.map(child => child.className)).to.deep.equal([
                    'theia-mobile-transcript-files-preview',
                    'theia-mobile-transcript-files-split-handle',
                    'theia-mobile-transcript-files-tree',
                ]);
            } finally {
                mount.dispose.dispose();
            }
        });

        it('omits preview breadcrumb; keeps lock and toolbar actions left-aligned', () => {
            const host = document.createElement('div');
            document.body.append(host);
            mountTranscriptFilesView(host, '/repo', createServices());

            expect(host.querySelector('.theia-mobile-transcript-files-breadcrumb')).to.be.null;
            const header = host.querySelector('.theia-mobile-transcript-files-preview-header');
            const actions = host.querySelector('.theia-mobile-transcript-files-preview-actions');
            const fileBreadcrumb = host.querySelector('.theia-mobile-transcript-files-file-breadcrumb');
            expect(header).to.exist;
            expect(actions).to.exist;
            // File breadcrumb (icon + name) sits left of the actions in the header.
            expect(fileBreadcrumb).to.exist;
            expect(header?.firstElementChild).to.equal(fileBreadcrumb);
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
            const mount = mountTranscriptFilesView(host, '/repo', createServices());

            const layout = host.querySelector<HTMLElement>('.theia-mobile-transcript-files-layout');
            const tree = host.querySelector<HTMLElement>('.theia-mobile-transcript-files-tree');
            const treeToggle = host.querySelector<HTMLButtonElement>('.theia-mobile-transcript-files-tree-toggle');
            try {
                expect(layout?.classList.contains('theia-mod-tree-hidden')).to.be.false;

                treeToggle?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
                expect(layout?.classList.contains('theia-mod-tree-hidden')).to.be.true;
                expect(treeToggle?.getAttribute('aria-pressed')).to.equal('false');
                expect(treeToggle?.getAttribute('aria-label')).to.equal('Show file tree');

                treeToggle?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
                expect(layout?.classList.contains('theia-mod-tree-hidden')).to.be.false;
                expect(treeToggle?.getAttribute('aria-pressed')).to.equal('true');
                expect(treeToggle?.getAttribute('aria-label')).to.equal('Hide file tree');
                expect(tree?.isConnected).to.equal(true);
                expect(host.querySelector('.theia-mobile-transcript-files-tree')).to.equal(tree);
                expect(host.querySelector('.theia-mobile-transcript-files-empty')).to.exist;
                expect(layout?.style.getPropertyValue('--qaap-files-tree-height')).to.equal('');
            } finally {
                mount.dispose.dispose();
            }
        });

        it('restores the file tree after hide then show on a narrow viewport', () => {
            const originalInnerWidth = window.innerWidth;
            Object.defineProperty(window, 'innerWidth', { configurable: true, value: 480 });
            const host = document.createElement('div');
            document.body.append(host);
            const mount = mountTranscriptFilesView(host, '/repo', {
                ...createServices(),
                listDirectory: async () => [entry('README.md', 'README.md')],
            });

            const layout = host.querySelector<HTMLElement>('.theia-mobile-transcript-files-layout');
            const tree = host.querySelector<HTMLElement>('.theia-mobile-transcript-files-tree');
            const treeToggle = host.querySelector<HTMLButtonElement>('.theia-mobile-transcript-files-tree-toggle');

            try {
                expect(layout?.classList.contains('theia-mod-tree-bottom')).to.equal(true);
                expect(layout?.classList.contains('theia-mod-tree-hidden')).to.equal(false);
                expect(tree).to.exist;

                treeToggle?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
                expect(layout?.classList.contains('theia-mod-tree-hidden')).to.equal(true);

                treeToggle?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
                expect(layout?.classList.contains('theia-mod-tree-hidden')).to.equal(false);
                expect(layout?.classList.contains('theia-mod-tree-bottom')).to.equal(true);
                expect(tree?.isConnected).to.equal(true);
                expect(host.querySelector('.theia-mobile-transcript-files-tree')).to.equal(tree);
                expect(host.querySelector('.theia-mobile-transcript-files-empty')).to.exist;
            } finally {
                mount.dispose.dispose();
                Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
            }
        });

        it('restores the file tree after switching from Changes back to Files', () => {
            const host = document.createElement('div');
            document.body.append(host);
            const mount = mountTranscriptFilesView(host, '/repo', {
                ...createServices(),
                canShowChanges: true,
                mountChangesView: async changesHost => {
                    const pane = document.createElement('div');
                    pane.className = 'qaap-test-changes-pane';
                    changesHost.append(pane);
                },
                unmountChangesView: () => undefined,
            });

            const root = host.querySelector<HTMLElement>('.theia-mobile-transcript-files');
            const layout = host.querySelector<HTMLElement>('.theia-mobile-transcript-files-layout');
            const tree = host.querySelector<HTMLElement>('.theia-mobile-transcript-files-tree');
            const changesHost = host.querySelector<HTMLElement>('.theia-mobile-transcript-files-changes-host');
            const modeButtons = host.querySelectorAll<HTMLButtonElement>('.theia-mobile-transcript-files-view-mode-btn');
            const filesBtn = modeButtons[0];
            const changesBtn = modeButtons[1];

            try {
                expect(root).to.exist;
                expect(layout?.hidden).to.equal(false);
                expect(tree).to.exist;
                expect(layout?.classList.contains('theia-mod-tree-hidden')).to.equal(false);
                expect(host.querySelector('.theia-mobile-transcript-files-empty')).to.exist;
                expect(filesBtn.getAttribute('aria-label')).to.equal('Files');
                expect(changesBtn.getAttribute('aria-label')).to.equal('Changes');
                expect(filesBtn.querySelector('.theia-mobile-transcript-files-view-mode-btn-icon')).to.exist;
                expect(changesBtn.querySelector('.theia-mobile-transcript-files-view-mode-btn-icon')).to.exist;
                expect(filesBtn.querySelector('.theia-mobile-transcript-files-view-mode-btn-label')?.textContent).to.equal('Files');
                expect(changesBtn.querySelector('.theia-mobile-transcript-files-view-mode-btn-label')?.textContent).to.equal('Changes');

                changesBtn.click();
                expect(root?.classList.contains('theia-mod-files-view-changes')).to.equal(true);
                expect(layout?.hidden).to.equal(true);
                expect(changesHost?.hidden).to.equal(false);

                filesBtn.click();
                expect(root?.classList.contains('theia-mod-files-view-changes')).to.equal(false);
                expect(layout?.hidden).to.equal(false);
                expect(changesHost?.hidden).to.equal(true);
                expect(layout?.classList.contains('theia-mod-tree-hidden')).to.equal(false);
                expect(tree?.isConnected).to.equal(true);
                expect(host.querySelector('.theia-mobile-transcript-files-tree')).to.equal(tree);
                expect(host.querySelector('.theia-mobile-transcript-files-empty')).to.exist;
            } finally {
                mount.dispose.dispose();
            }
        });

        it('opens the more menu when requestAnimationFrame is missing', () => {
            const originalRaf = window.requestAnimationFrame;
            delete (window as { requestAnimationFrame?: typeof window.requestAnimationFrame }).requestAnimationFrame;
            const host = document.createElement('div');
            document.body.append(host);
            const mount = mountTranscriptFilesView(host, '/repo', createServices());

            try {
                const moreBtn = host.querySelector<HTMLButtonElement>('.theia-mobile-transcript-files-more');
                moreBtn?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
                expect(document.querySelector('.theia-mobile-transcript-files-menu:not(.theia-mod-create)')).to.exist;
            } finally {
                mount.dispose.dispose();
                window.requestAnimationFrame = originalRaf;
            }
        });
    });
});
