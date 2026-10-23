// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import * as markdownit from '@theia/core/shared/markdown-it';
import {
    applyStreamingMarkdownHtmlPatch,
    TRANSCRIPT_STREAM_TAIL_CLASS,
} from '@theia/qaap-transcript-overlay/lib/browser/qaap-transcript-streaming-markdown-view';
import {
    enhanceTranscriptMarkdownRichContent,
    patchTranscriptMarkdownCodeBlockCard,
    TRANSCRIPT_CODE_BLOCK_CARD_CLASS,
} from './qaap-transcript-rich-content-ui';
import { patchTranscriptStreamingTailHtml } from './qaap-transcript-streaming-tail-patch';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

describe('patchTranscriptStreamingTailHtml', () => {

    useSuiteJSDOM();

    const md = markdownit();

    /** One streaming tick as the main thread runs it: apply the tail HTML, then enhance. */
    function tick(tail: HTMLElement, markdown: string): ReturnType<typeof patchTranscriptStreamingTailHtml> {
        const result = patchTranscriptStreamingTailHtml(tail, md.render(markdown));
        enhanceTranscriptMarkdownRichContent(tail);
        return result;
    }

    /** What a fresh `innerHTML` + enhance of the same markdown produces, ignoring inter-block whitespace. */
    function freshTailHtml(markdown: string): string {
        const reference = document.createElement('div');
        reference.innerHTML = md.render(markdown);
        enhanceTranscriptMarkdownRichContent(reference);
        return normalize(reference.innerHTML);
    }

    function normalize(html: string): string {
        return html.replace(/>\s+</g, '><').trim();
    }

    function createTail(): HTMLElement {
        const tail = document.createElement('div');
        tail.className = TRANSCRIPT_STREAM_TAIL_CLASS;
        document.body.append(tail);
        return tail;
    }

    function codeRows(card: Element): HTMLElement[] {
        return Array.from(card.querySelectorAll<HTMLElement>('.theia-mobile-agent-code-line'));
    }

    it('fully resets the tail on the first tick', () => {
        const tail = createTail();
        const result = tick(tail, 'Hello **world**');
        expect(result.fullReset).to.equal(true);
        expect(normalize(tail.innerHTML)).to.equal(freshTailHtml('Hello **world**'));
    });

    it('keeps the DOM of blocks whose HTML did not change and replaces only the growing one', () => {
        const tail = createTail();
        tick(tail, 'Intro paragraph.\n- first item');
        const intro = tail.children[0];
        const list = tail.children[1];
        const result = tick(tail, 'Intro paragraph.\n- first item\n- second item');
        expect(result).to.deep.equal({ reused: 1, codePatched: 0, replaced: 1, fullReset: false });
        expect(tail.children[0]).to.equal(intro);
        expect(tail.children[1]).to.not.equal(list);
        expect(normalize(tail.innerHTML)).to.equal(freshTailHtml('Intro paragraph.\n- first item\n- second item'));
    });

    it('grows a streaming code fence inside the existing card, keeping finished line rows', () => {
        const tail = createTail();
        const first = '```ts\nconst a = 1;\nconst b';
        tick(tail, first);
        expect(tail.querySelectorAll(`.${TRANSCRIPT_CODE_BLOCK_CARD_CLASS}`)).to.have.length(1);
        const card = tail.querySelector(`.${TRANSCRIPT_CODE_BLOCK_CARD_CLASS}`)!;
        const [firstRow] = codeRows(card);

        const second = '```ts\nconst a = 1;\nconst b = 2;\nconst c = 3;';
        const result = tick(tail, second);
        expect(result).to.deep.equal({ reused: 0, codePatched: 1, replaced: 0, fullReset: false });
        expect(tail.querySelector(`.${TRANSCRIPT_CODE_BLOCK_CARD_CLASS}`)).to.equal(card);
        const rows = codeRows(card);
        expect(rows).to.have.length(3);
        expect(rows[0]).to.equal(firstRow);
        expect(normalize(tail.innerHTML)).to.equal(freshTailHtml(second));
    });

    it('matches a fresh render after every tick of a mixed streamed answer', () => {
        const tail = createTail();
        const answer = 'Steps:\n- **one** with `code`\n- two\n```js\nfunction run(x) {\n  return x * 2;\n}\n```\nDone.';
        for (let end = 3; end <= answer.length; end += 3) {
            const markdown = answer.slice(0, end);
            tick(tail, markdown);
            expect(normalize(tail.innerHTML), `tick ending at ${end}`).to.equal(freshTailHtml(markdown));
        }
    });

    it('falls back to a full reset when a foreign element sits in the tail', () => {
        const tail = createTail();
        tick(tail, 'First paragraph.\nstill open');
        const chip = document.createElement('div');
        chip.className = 'foreign-chip';
        tail.append(chip);
        const result = tick(tail, 'First paragraph.\nstill open, longer');
        expect(result.fullReset).to.equal(true);
        expect(tail.querySelectorAll('.foreign-chip')).to.have.length(0);
    });

    it('removes blocks that disappear from the tail', () => {
        const tail = createTail();
        tick(tail, 'Para one.\n- item');
        const result = tick(tail, 'Para one.');
        expect(result.fullReset).to.equal(false);
        expect(tail.children).to.have.length(1);
        expect(normalize(tail.innerHTML)).to.equal(freshTailHtml('Para one.'));
    });

    it('is the tail applier applyStreamingMarkdownHtmlPatch uses when given', () => {
        const host = document.createElement('div');
        applyStreamingMarkdownHtmlPatch(host, { stableLength: 0, totalLength: 8, tailHtml: '<p>a</p>' }, patchTranscriptStreamingTailHtml);
        const tail = host.querySelector<HTMLElement>(`:scope > .${TRANSCRIPT_STREAM_TAIL_CLASS}`)!;
        const paragraph = tail.children[0];
        applyStreamingMarkdownHtmlPatch(host, { stableLength: 0, totalLength: 16, tailHtml: '<p>a</p>\n<p>b</p>' }, patchTranscriptStreamingTailHtml);
        expect(tail.children[0]).to.equal(paragraph);
        expect(tail.children).to.have.length(2);
    });
});

describe('patchTranscriptMarkdownCodeBlockCard', () => {

    useSuiteJSDOM();

    function enhancedCard(html: string): HTMLElement {
        const host = document.createElement('div');
        host.innerHTML = html;
        enhanceTranscriptMarkdownRichContent(host);
        return host.querySelector<HTMLElement>(`.${TRANSCRIPT_CODE_BLOCK_CARD_CLASS}`)!;
    }

    function pre(html: string): HTMLPreElement {
        const host = document.createElement('div');
        host.innerHTML = html;
        return host.querySelector('pre')!;
    }

    it('refuses another fence language without touching the card', () => {
        const card = enhancedCard('<pre><code class="language-ts">const a = 1;</code></pre>');
        const before = card.innerHTML;
        expect(patchTranscriptMarkdownCodeBlockCard(card, pre('<pre><code class="language-py">x = 1</code></pre>'))).to.equal(false);
        expect(card.innerHTML).to.equal(before);
    });

    it('refuses an empty fence', () => {
        const card = enhancedCard('<pre><code class="language-ts">const a = 1;</code></pre>');
        expect(patchTranscriptMarkdownCodeBlockCard(card, pre('<pre><code class="language-ts">  </code></pre>'))).to.equal(false);
    });

    it('refuses a code view whose inferred language changed as the fence grew', () => {
        // Without a fence hint the language is sniffed from the text: two JSON-ish lines flip it to json.
        const card = enhancedCard('<pre><code>hello</code></pre>');
        expect(patchTranscriptMarkdownCodeBlockCard(card, pre('<pre><code>{\n  "a": 1,\n  "b": 2\n}</code></pre>'))).to.equal(false);
    });
});
