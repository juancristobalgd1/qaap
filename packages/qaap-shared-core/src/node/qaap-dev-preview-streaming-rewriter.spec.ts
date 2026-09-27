// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapDevPreviewStreamingRewriter } from './qaap-dev-preview-streaming-rewriter';
import { devPreviewBodyUrlRule, nextPreviewDocumentRule } from './qaap-dev-preview-endpoint-timeline';

/** Deterministic PRNG so failures are reproducible. */
function random(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state * 1103515245 + 12345) % 2147483648;
        return state / 2147483648;
    };
}

function streamThrough(rewriter: QaapDevPreviewStreamingRewriter, bytes: Buffer, next: () => number, maxChunk: number): string {
    let output = '';
    for (let offset = 0; offset < bytes.length;) {
        const size = 1 + Math.floor(next() * maxChunk);
        output += rewriter.write(bytes.subarray(offset, offset + size));
        offset += size;
    }
    return output + rewriter.end();
}

const FRAGMENTS = [
    '<img src="/a.png">', '<a href=\'/b\'>b</a>', '<form action="/c">', '<p>é ü 漢字 🚀</p>',
    '<script type="module">import x, { y as z } from "/m.js"; export * from "/n.js";</script>',
    '<style>.x{background:url( "/bg.png")}</style>', 'fetch("/api"); new URL(`/w.js`, import.meta.url);',
    '{"BASE_URL": "/"}', '__webpack_require__.p = "/_next/";', 'ximport "/nope"', 'src="//cdn/x"',
    'href="/qaap-dev/1/x"', 'import(\'/lazy.js\')', '<div>plain text without urls</div>', '\n  ',
];

describe('QaapDevPreviewStreamingRewriter', () => {
    const prefix = '/qaap-preview/u-alice-w-site-p-site-x-run-abc1234';

    it('matches the buffered rewrite on a large document split at random chunk sizes', () => {
        const next = random(42);
        const parts: string[] = [];
        for (let length = 0; length < 400_000;) {
            const fragment = FRAGMENTS[Math.floor(next() * FRAGMENTS.length)];
            parts.push(fragment);
            length += fragment.length;
        }
        const document = parts.join('');
        const bytes = Buffer.from(document, 'utf8');
        for (const rule of [devPreviewBodyUrlRule(prefix), nextPreviewDocumentRule(prefix)]) {
            const expected = document.replace(rule.pattern, rule.replace);
            for (const [overlap, maxChunk] of [[64, 7], [256, 1000], [4096, 65536], [65536, 16384]]) {
                expect(streamThrough(new QaapDevPreviewStreamingRewriter(rule, overlap), bytes, next, maxChunk), `${overlap}/${maxChunk}`)
                    .to.equal(expected);
            }
        }
    });

    it('keeps word-boundary context and multi-byte characters across chunks', () => {
        const rule = devPreviewBodyUrlRule(prefix);
        const rewriter = new QaapDevPreviewStreamingRewriter(rule, 16);
        const bytes = Buffer.from('aaaaaaaaxximport "/y"; 🚀import "/z"', 'utf8');
        let output = '';
        for (const byte of bytes) {
            output += rewriter.write(Buffer.from([byte]));
        }
        output += rewriter.end();
        expect(output).to.equal(`aaaaaaaaxximport "/y"; 🚀import "${prefix}/z"`);
    });
});
