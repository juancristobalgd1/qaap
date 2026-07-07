// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import {
    createTranscriptCodeView,
    normalizeTranscriptCodeText,
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
});
