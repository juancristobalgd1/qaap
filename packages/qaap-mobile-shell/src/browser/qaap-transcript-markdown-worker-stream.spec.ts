// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { computeTranscriptStreamingMarkdownPatch } from './qaap-transcript-markdown-worker-stream';

describe('qaap-transcript-markdown-worker-stream', () => {

    it('computeTranscriptStreamingMarkdownPatch returns undefined on identical lengths', () => {
        const content = `${'Closed.\n\n'.repeat(8)}Tail`;
        const stable = computeTranscriptStreamingMarkdownPatch(content, -1, -1, md => md)?.stableLength ?? 0;
        const again = computeTranscriptStreamingMarkdownPatch(
            content,
            stable,
            content.length,
            md => `<p>${md.length}</p>`,
        );
        expect(again).to.equal(undefined);
    });

    it('computeTranscriptStreamingMarkdownPatch re-renders only the tail when stable boundary is unchanged', () => {
        const prefix = `${'Stable block.\n\n'.repeat(12)}Tail `;
        const first = computeTranscriptStreamingMarkdownPatch(prefix + 'one', -1, -1, md => `<span>${md}</span>`);
        expect(first).to.not.equal(undefined);
        const second = computeTranscriptStreamingMarkdownPatch(
            prefix + 'one-two',
            first!.stableLength,
            prefix.length + 3,
            md => `<span>${md}</span>`,
        );
        expect(second?.frozenHtml).to.equal(undefined);
        expect(second?.tailHtml).to.contain('one-two');
    });

    it('parses only the new frozen segment when a matching frozenCache is supplied (O(n) accumulation)', () => {
        const blockA = 'Alpha block.\n\n';
        const blockB = 'Beta block.\n\n';
        // First frozen boundary sits after blockA.
        const first = computeTranscriptStreamingMarkdownPatch(`${blockA}tail`, -1, -1, md => `[${md}]`);
        expect(first?.frozenHtml).to.equal(`[${blockA}]`);
        expect(first?.nextFrozenCache).to.deep.equal({ stableLength: blockA.length, frozenHtml: `[${blockA}]` });

        // Boundary advances past blockB; with the cache, renderHtml must only see the new segment.
        const seen: string[] = [];
        const second = computeTranscriptStreamingMarkdownPatch(
            `${blockA}${blockB}tail2`,
            first!.stableLength,
            `${blockA}tail`.length,
            md => {
                seen.push(md);
                return `[${md}]`;
            },
            first!.nextFrozenCache,
        );
        // The frozen segment passed to renderHtml is ONLY blockB, not blockA+blockB.
        expect(seen).to.include(blockB);
        expect(seen).to.not.include(`${blockA}${blockB}`);
        // Accumulated frozen HTML equals cached prefix + new segment render.
        expect(second?.frozenHtml).to.equal(`[${blockA}][${blockB}]`);
        expect(second?.nextFrozenCache?.stableLength).to.equal(`${blockA}${blockB}`.length);
    });

    it('falls back to a full prefix render when the cache boundary does not match previousStableLength', () => {
        const blockA = 'Alpha block.\n\n';
        const blockB = 'Beta block.\n\n';
        const seen: string[] = [];
        const patch = computeTranscriptStreamingMarkdownPatch(
            `${blockA}${blockB}tail`,
            -1,
            -1,
            md => {
                seen.push(md);
                return `[${md}]`;
            },
            // Stale cache from a boundary that no longer matches previousStableLength (-1).
            { stableLength: blockA.length, frozenHtml: 'STALE' },
        );
        // Mismatch → full prefix render, never trusts the stale cached HTML.
        expect(patch?.frozenHtml).to.equal(`[${blockA}${blockB}]`);
        expect(seen).to.include(`${blockA}${blockB}`);
    });
});
