// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import {
    isAllowedQaapUiHref,
    isQaapUiFenceLanguage,
    parseQaapUiSpec,
    QaapUiNode,
    renderQaapUi,
} from './qaap-json-render-ui';

disableImportJSDOM();

/** Parses `node` as the only child of a root Stack, so an Unsupported node is inspected instead of the whole spec failing. */
function parseAsChild(node: unknown): unknown {
    const root = parseQaapUiSpec(JSON.stringify({ type: 'Stack', children: [node] })) as Extract<QaapUiNode, { kind: 'Stack' }>;
    return root.children[0];
}

describe('parseQaapUiSpec', () => {

    it('parses a bare root node and a { root } wrapper', () => {
        const bare = parseQaapUiSpec('{"type":"Text","props":{"text":"hi","tone":"success"}}');
        expect(bare).to.deep.equal({ kind: 'Text', text: 'hi', tone: 'success' });
        const wrapped = parseQaapUiSpec('{"root":{"type":"Divider"}}');
        expect(wrapped).to.deep.equal({ kind: 'Divider' });
    });

    it('returns undefined for invalid JSON, non-objects and unknown root types', () => {
        expect(parseQaapUiSpec('{"type":')).to.equal(undefined);
        expect(parseQaapUiSpec('"text"')).to.equal(undefined);
        expect(parseQaapUiSpec('[1,2]')).to.equal(undefined);
        expect(parseQaapUiSpec('')).to.equal(undefined);
        expect(parseQaapUiSpec('{"type":"Iframe","props":{"src":"https://example.com"}}')).to.equal(undefined);
    });

    it('keeps an unknown child as an Unsupported node and renders its siblings', () => {
        const root = parseQaapUiSpec(JSON.stringify({
            type: 'Stack',
            children: [{ type: 'Video', props: {} }, { type: 'Heading', props: { text: 'After' } }],
        })) as Extract<QaapUiNode, { kind: 'Stack' }>;
        expect(root.children).to.deep.equal([
            { kind: 'Unsupported', name: 'Video' },
            { kind: 'Heading', level: 2, text: 'After' },
        ]);
    });

    it('marks a node with invalid props as Unsupported instead of failing the whole spec', () => {
        const root = parseQaapUiSpec(JSON.stringify({
            type: 'Stack',
            children: [
                { type: 'Progress', props: { value: 150 } },
                { type: 'Heading', props: { text: 'x', level: 7 } },
                { type: 'Badge', props: { text: 'x', tone: 'neon' } },
                { type: 'Divider', children: ['not allowed on a leaf'] },
            ],
        })) as Extract<QaapUiNode, { kind: 'Stack' }>;
        expect(root.children.map(child => typeof child === 'object' ? child.kind : child)).to.deep.equal([
            'Unsupported', 'Unsupported', 'Unsupported', 'Unsupported',
        ]);
    });

    it('treats a string child as a text paragraph', () => {
        const root = parseQaapUiSpec('{"type":"Card","props":{"title":"T"},"children":["plain"]}') as Extract<QaapUiNode, { kind: 'Card' }>;
        expect(root.title).to.equal('T');
        expect(root.children).to.deep.equal(['plain']);
    });

    it('rejects a spec deeper than 12 levels', () => {
        let node: Record<string, unknown> = { type: 'Divider' };
        for (let level = 0; level < 12; level++) {
            node = { type: 'Stack', children: [node] };
        }
        expect(parseQaapUiSpec(JSON.stringify(node))).to.equal(undefined);
        // Depth 12 exactly (root plus 11 nested stacks around the leaf) is still accepted.
        let accepted: Record<string, unknown> = { type: 'Divider' };
        for (let level = 0; level < 11; level++) {
            accepted = { type: 'Stack', children: [accepted] };
        }
        expect(parseQaapUiSpec(JSON.stringify(accepted))).to.not.equal(undefined);
    });

    it('rejects a spec with more than 500 nodes', () => {
        const children = Array.from({ length: 600 }, (_, index) => ({ type: 'Text', props: { text: `${index}` } }));
        expect(parseQaapUiSpec(JSON.stringify({ type: 'Stack', children }))).to.equal(undefined);
    });

    it('rejects a spec longer than 200k characters', () => {
        const text = 'x'.repeat(200_001);
        expect(parseQaapUiSpec(JSON.stringify({ type: 'Text', props: { text } }))).to.equal(undefined);
    });

    it('truncates strings longer than 10k characters', () => {
        const long = 'a'.repeat(12_000);
        const node = parseQaapUiSpec(JSON.stringify({ type: 'Text', props: { text: long } })) as Extract<QaapUiNode, { kind: 'Text' }>;
        expect(node.text.length).to.equal(10_000);
    });

    it('validates Progress range and Heading level', () => {
        expect(parseQaapUiSpec('{"type":"Progress","props":{"value":0}}')).to.deep.equal({ kind: 'Progress', value: 0, label: undefined });
        expect(parseQaapUiSpec('{"type":"Progress","props":{"value":100}}')).to.deep.equal({ kind: 'Progress', value: 100, label: undefined });
        expect(parseAsChild({ type: 'Progress', props: { value: -1 } })).to.deep.equal({ kind: 'Unsupported', name: 'Progress' });
        expect(parseQaapUiSpec('{"type":"Heading","props":{"text":"t","level":3}}')).to.deep.equal({ kind: 'Heading', level: 3, text: 't' });
    });

    it('coerces numeric table cells to strings and rejects other cell types', () => {
        const table = parseQaapUiSpec(JSON.stringify({
            type: 'Table',
            props: { columns: ['Name', 'Count'], rows: [['a', 3], ['b', 4.5]] },
        }));
        expect(table).to.deep.equal({ kind: 'Table', columns: ['Name', 'Count'], rows: [['a', '3'], ['b', '4.5']] });
        expect(parseAsChild({ type: 'Table', props: { columns: ['x'], rows: [[{ a: 1 }]] } }))
            .to.deep.equal({ kind: 'Unsupported', name: 'Table' });
    });

    it('requires an https image source and a non-empty alt text', () => {
        expect(parseQaapUiSpec('{"type":"Image","props":{"src":"https://example.com/a.png","alt":"chart"}}'))
            .to.deep.equal({ kind: 'Image', src: 'https://example.com/a.png', alt: 'chart' });
        expect(parseAsChild({ type: 'Image', props: { src: 'http://example.com/a.png', alt: 'chart' } }))
            .to.deep.equal({ kind: 'Unsupported', name: 'Image' });
        expect(parseAsChild({ type: 'Image', props: { src: 'javascript:alert(1)', alt: 'x' } }))
            .to.deep.equal({ kind: 'Unsupported', name: 'Image' });
        expect(parseAsChild({ type: 'Image', props: { src: 'https://example.com/a.png' } }))
            .to.deep.equal({ kind: 'Unsupported', name: 'Image' });
        expect(parseAsChild({ type: 'Image', props: { src: 'https://example.com/a.png', alt: '  ' } }))
            .to.deep.equal({ kind: 'Unsupported', name: 'Image' });
    });

    it('filters link schemes through isAllowedQaapUiHref', () => {
        const link = (href: string): unknown => parseAsChild({ type: 'Link', props: { text: 't', href } });
        expect(link('https://example.com/docs')).to.deep.equal({ kind: 'Link', text: 't', href: 'https://example.com/docs' });
        expect(link('http://localhost:3000/preview')).to.deep.equal({ kind: 'Link', text: 't', href: 'http://localhost:3000/preview' });
        expect(link('/docs/start')).to.deep.equal({ kind: 'Link', text: 't', href: '/docs/start' });
        expect(link('javascript:alert(1)')).to.deep.equal({ kind: 'Unsupported', name: 'Link' });
        expect(link('data:text/html,<script>x</script>')).to.deep.equal({ kind: 'Unsupported', name: 'Link' });
        expect(link('http://example.com')).to.deep.equal({ kind: 'Unsupported', name: 'Link' });
        expect(link('//evil.example.com/x')).to.deep.equal({ kind: 'Unsupported', name: 'Link' });
    });
});

describe('isAllowedQaapUiHref', () => {

    it('accepts https, localhost http and same-origin relative references only', () => {
        expect(isAllowedQaapUiHref('https://a.example/x?y=1')).to.equal(true);
        expect(isAllowedQaapUiHref('http://localhost:5173')).to.equal(true);
        expect(isAllowedQaapUiHref('./notes.md')).to.equal(true);
        expect(isAllowedQaapUiHref('#section')).to.equal(true);
        expect(isAllowedQaapUiHref('http://a.example')).to.equal(false);
        expect(isAllowedQaapUiHref('ftp://a.example')).to.equal(false);
        expect(isAllowedQaapUiHref('vbscript:msgbox')).to.equal(false);
        expect(isAllowedQaapUiHref('https://a.example/ with space')).to.equal(false);
        expect(isAllowedQaapUiHref('/\\evil.example')).to.equal(false);
    });
});

describe('isQaapUiFenceLanguage', () => {

    it('recognises both fence names case-insensitively and nothing else', () => {
        expect(isQaapUiFenceLanguage('qaap-ui')).to.equal(true);
        expect(isQaapUiFenceLanguage('json-render')).to.equal(true);
        expect(isQaapUiFenceLanguage('QAAP-UI')).to.equal(true);
        expect(isQaapUiFenceLanguage('json')).to.equal(false);
        expect(isQaapUiFenceLanguage(undefined)).to.equal(false);
    });
});

describe('renderQaapUi', () => {

    let disableJSDOM: () => void;

    beforeEach(() => {
        disableJSDOM = enableJSDOM();
    });

    afterEach(() => {
        disableJSDOM();
    });

    function render(text: string): HTMLElement {
        const spec = parseQaapUiSpec(text);
        if (!spec) {
            throw new Error('spec should parse: ' + text);
        }
        return renderQaapUi(spec, document);
    }

    it('renders structure with classes and text content', () => {
        const root = render(JSON.stringify({
            type: 'Card',
            props: { title: 'Build', subtitle: 'main' },
            children: [
                { type: 'Heading', props: { text: 'Status', level: 1 } },
                { type: 'Badge', props: { text: 'passing', tone: 'success' } },
                { type: 'Progress', props: { value: 40, label: 'Tests' } },
            ],
        }));
        expect(root.classList.contains('theia-mobile-agent-json-ui')).to.equal(true);
        expect(root.querySelector('.theia-mobile-agent-json-ui-card-title')?.textContent).to.equal('Build');
        expect(root.querySelector('.theia-mobile-agent-json-ui-card-subtitle')?.textContent).to.equal('main');
        const heading = root.querySelector('h1.theia-mobile-agent-json-ui-heading-1');
        expect(heading?.textContent).to.equal('Status');
        const badge = root.querySelector('.theia-mobile-agent-json-ui-badge');
        expect(badge?.textContent).to.equal('passing');
        expect(badge?.classList.contains('theia-mobile-agent-json-ui-tone-success')).to.equal(true);
        const bar = root.querySelector('progress') as HTMLProgressElement | null;
        expect(bar?.value).to.equal(40);
        expect(bar?.max).to.equal(100);
        expect(root.querySelector('.theia-mobile-agent-json-ui-progress-label')?.textContent).to.equal('Tests');
    });

    it('renders stack direction and gap as classes', () => {
        const root = render('{"type":"Stack","props":{"direction":"row","gap":"lg"},"children":["a"]}');
        const stack = root.querySelector('.theia-mobile-agent-json-ui-stack');
        expect(stack?.classList.contains('theia-mobile-agent-json-ui-stack-row')).to.equal(true);
        expect(stack?.classList.contains('theia-mobile-agent-json-ui-gap-lg')).to.equal(true);
    });

    it('renders tables with headers and cells', () => {
        const root = render('{"type":"Table","props":{"columns":["Name","Status"],"rows":[["api","ok"],["web",2]]}}');
        const headers = Array.from(root.querySelectorAll('th')).map(th => th.textContent);
        const cells = Array.from(root.querySelectorAll('td')).map(td => td.textContent);
        expect(headers).to.deep.equal(['Name', 'Status']);
        expect(cells).to.deep.equal(['api', 'ok', 'web', '2']);
    });

    it('renders key value rows and ordered lists', () => {
        const root = render('{"type":"Stack","children":[{"type":"KeyValue","props":{"items":[{"label":"Branch","value":"main"}]}},{"type":"List","props":{"items":["one","two"],"ordered":true}}]}');
        expect(root.querySelector('dt')?.textContent).to.equal('Branch');
        expect(root.querySelector('dd')?.textContent).to.equal('main');
        expect(root.querySelector('ol')).to.not.equal(null);
        expect(Array.from(root.querySelectorAll('li')).map(li => li.textContent)).to.deep.equal(['one', 'two']);
    });

    it('renders links with a safe target and rel', () => {
        const root = render('{"type":"Link","props":{"text":"Docs","href":"https://example.com/docs"}}');
        const anchor = root.querySelector('a');
        expect(anchor?.getAttribute('href')).to.equal('https://example.com/docs');
        expect(anchor?.getAttribute('target')).to.equal('_blank');
        expect(anchor?.getAttribute('rel')).to.equal('noopener noreferrer');
        expect(anchor?.textContent).to.equal('Docs');
    });

    it('calls openLink instead of navigating when provided', () => {
        const opened: string[] = [];
        const spec = parseQaapUiSpec('{"type":"Link","props":{"text":"Docs","href":"https://example.com/docs"}}');
        const root = renderQaapUi(spec!, document, { openLink: href => opened.push(href) });
        const anchor = root.querySelector('a')!;
        anchor.dispatchEvent(new document.defaultView!.MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(opened).to.deep.equal(['https://example.com/docs']);
    });

    it('renders images with https source and alt text', () => {
        const root = render('{"type":"Image","props":{"src":"https://example.com/chart.png","alt":"Chart"}}');
        const image = root.querySelector('img');
        expect(image?.getAttribute('src')).to.equal('https://example.com/chart.png');
        expect(image?.getAttribute('alt')).to.equal('Chart');
    });

    it('renders an unsupported note without throwing', () => {
        const root = render('{"type":"Stack","children":[{"type":"Video","props":{}}]}');
        const note = root.querySelector('.theia-mobile-agent-json-ui-unsupported');
        expect(note?.textContent).to.contain('Video');
    });

    it('keeps markup in text as text (no script or element injection)', () => {
        const payload = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
        const root = render(JSON.stringify({
            type: 'Stack',
            children: [
                { type: 'Text', props: { text: payload } },
                { type: 'Heading', props: { text: payload } },
                { type: 'Code', props: { code: payload, language: payload } },
                { type: 'KeyValue', props: { items: [{ label: payload, value: payload }] } },
            ],
        }));
        expect(root.querySelector('img')).to.equal(null);
        expect(root.querySelector('script')).to.equal(null);
        expect(root.innerHTML).to.not.contain('<img');
        expect(root.innerHTML).to.not.contain('<script');
        expect(root.querySelector('p')?.textContent).to.equal(payload);
        expect(root.querySelector('code')?.textContent).to.equal(payload);
    });
});
