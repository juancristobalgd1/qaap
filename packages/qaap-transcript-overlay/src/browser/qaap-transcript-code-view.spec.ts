// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import {
    createTranscriptCodeView,
    normalizeTranscriptCodeText,
    patchTranscriptCodeView,
    resolveTranscriptCodeLanguage,
} from './qaap-transcript-code-view';

describe('qaap-transcript-code-view', () => {
    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    it('resolves json from file extension', () => {
        expect(resolveTranscriptCodeLanguage('package.json')).to.equal('json');
    });

    it('resolves shell from markdown fence language hint', () => {
        expect(resolveTranscriptCodeLanguage(undefined, undefined, 'bash')).to.equal('shell');
        expect(resolveTranscriptCodeLanguage(undefined, undefined, 'BASH')).to.equal('shell');
        expect(resolveTranscriptCodeLanguage(undefined, undefined, 'sh')).to.equal('shell');
    });

    it('resolves grep output from content shape', () => {
        const text = [
            'src/index.ts:12:const value = 1',
            'src/util.ts:4:export function run()',
        ].join('\n');
        expect(resolveTranscriptCodeLanguage(undefined, text)).to.equal('grep');
    });

    it('pretty-prints json before rendering', () => {
        const normalized = normalizeTranscriptCodeText('{"name":"match-pro"}', 'json');
        expect(normalized).to.equal('{\n  "name": "match-pro"\n}');
    });

    it('prefers grep language for ripgrep-style paths', () => {
        expect(resolveTranscriptCodeLanguage('package.json', 'src/index.ts:12:const value = 1')).to.equal('json');
        expect(resolveTranscriptCodeLanguage(undefined, 'src/index.ts:12:const value = 1\nsrc/util.ts:4:export function run()')).to.equal('grep');
    });

    it('resolves json fragments from command output', () => {
        const output = [
            '"scripts": {',
            '  "dev": "pnpm dev",',
            '  "typecheck": "tsc"',
            '}',
        ].join('\n');
        expect(resolveTranscriptCodeLanguage(undefined, output)).to.equal('json');
    });

    it('highlights inline TypeScript comments, calls, and operators', () => {
        const view = createTranscriptCodeView('const x = useStore.setState(resolved); // raw setter', 'typescript');

        expect(view.querySelector('.theia-mobile-agent-token.theia-mod-function')?.textContent).to.equal('setState');
        expect(view.querySelector('.theia-mobile-agent-token.theia-mod-operator')?.textContent).to.equal('=');
        expect(view.querySelector('.theia-mobile-agent-token.theia-mod-comment')?.textContent).to.equal('// raw setter');
    });

    it('highlights TypeScript call arguments as parameters', () => {
        const view = createTranscriptCodeView('if (skipHistory) skipNextHistory();\nsetHistory(updates);', 'typescript');

        expect([...view.querySelectorAll('.theia-mobile-agent-token.theia-mod-function')].map(node => node.textContent)).to.deep.equal([
            'skipNextHistory',
            'setHistory',
        ]);
        expect([...view.querySelectorAll('.theia-mobile-agent-token.theia-mod-parameter')].map(node => node.textContent)).to.deep.equal([
            'skipHistory',
            'updates',
        ]);
    });

    it('highlights shell commands, flags, paths, and separators', () => {
        const view = createTranscriptCodeView('npx vitest run src/store.test.ts --run 2>&1 | tail -60', 'shell');

        expect(view.querySelector('.theia-mobile-agent-token.theia-mod-keyword')?.textContent).to.equal('npx');
        expect([...view.querySelectorAll('.theia-mobile-agent-token.theia-mod-path')].map(node => node.textContent)).to.include('src/store.test.ts');
        expect([...view.querySelectorAll('.theia-mobile-agent-token.theia-mod-sep')].map(node => node.textContent?.trim())).to.include('|');
    });

    describe('patchTranscriptCodeView', () => {

        it('appends new lines without touching unchanged line nodes', () => {
            const view = createTranscriptCodeView('line one\nline two', 'log');
            const firstRow = view.querySelectorAll('.theia-mobile-agent-code-line')[0];

            expect(patchTranscriptCodeView(view, 'line one\nline two\nline three', 'log')).to.equal(true);

            const rows = view.querySelectorAll('.theia-mobile-agent-code-line');
            expect(rows.length).to.equal(3);
            expect(rows[0]).to.equal(firstRow);
            expect(rows[2]?.querySelector('.theia-mobile-agent-code-gutter')?.textContent).to.equal('3');
            expect(rows[2]?.querySelector('.theia-mobile-agent-code-text')?.textContent).to.equal('line three');
        });

        it('re-tokenizes only the lines that changed', () => {
            const view = createTranscriptCodeView('first line\nsecond line', 'log');
            const rows = view.querySelectorAll('.theia-mobile-agent-code-line');
            const firstCode = rows[0]?.querySelector('.theia-mobile-agent-code-text');
            const secondCode = rows[1]?.querySelector('.theia-mobile-agent-code-text');

            expect(patchTranscriptCodeView(view, 'first line\nsecond line CHANGED', 'log')).to.equal(true);

            expect(rows[0]?.querySelector('.theia-mobile-agent-code-text')).to.equal(firstCode);
            expect(rows[1]?.querySelector('.theia-mobile-agent-code-text')).to.equal(secondCode);
            expect(secondCode?.textContent).to.equal('second line CHANGED');
        });

        it('removes trailing lines when the content shrinks', () => {
            const view = createTranscriptCodeView('a\nb\nc', 'log');

            expect(patchTranscriptCodeView(view, 'a\nb', 'log')).to.equal(true);

            expect(view.querySelectorAll('.theia-mobile-agent-code-line').length).to.equal(2);
        });

        it('bails without mutating when the language changes', () => {
            const view = createTranscriptCodeView('$ npm test', 'shell');
            const before = view.innerHTML;

            expect(patchTranscriptCodeView(view, '{"a": 1}', 'json')).to.equal(false);

            expect(view.innerHTML).to.equal(before);
        });

        it('bails on elements it did not create', () => {
            const foreign = document.createElement('div');
            expect(patchTranscriptCodeView(foreign, 'text', 'log')).to.equal(false);
        });

        it('leaves the view rendering the patched text (round-trip with create)', () => {
            const view = createTranscriptCodeView('one', 'log');

            expect(patchTranscriptCodeView(view, 'one\ntwo', 'log')).to.equal(true);
            expect(patchTranscriptCodeView(view, 'one\ntwo', 'log')).to.equal(true);

            const fresh = createTranscriptCodeView('one\ntwo', 'log');
            expect(view.textContent).to.equal(fresh.textContent);
        });
    });
});
