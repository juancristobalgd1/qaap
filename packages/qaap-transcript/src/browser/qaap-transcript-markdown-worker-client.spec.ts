// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    shouldApplyTranscriptMarkdownWorkerResult,
    type TranscriptMarkdownWorkerRequest,
    type TranscriptMarkdownWorkerResponse,
} from './qaap-transcript-markdown-worker-protocol';
import {
    enableTranscriptRenderMetrics,
    getTranscriptRenderMetricsSnapshot,
    resetTranscriptRenderMetrics,
} from '@theia/qaap-transcript-overlay/lib/common/qaap-transcript-render-metrics';

describe('qaap-transcript-markdown-worker-client', () => {
    class TestWorker {
        static latest: TestWorker | undefined;

        readonly posted: TranscriptMarkdownWorkerRequest[] = [];
        onmessage: ((event: MessageEvent<TranscriptMarkdownWorkerResponse>) => void) | null = null;
        onerror: (() => void) | null = null;

        constructor(_url: URL) {
            TestWorker.latest = this;
        }

        postMessage(message: TranscriptMarkdownWorkerRequest): void {
            this.posted.push(message);
        }

        terminate(): void {
            // Test worker has no background process.
        }

        emit(message: TranscriptMarkdownWorkerResponse): void {
            this.onmessage?.({ data: message } as MessageEvent<TranscriptMarkdownWorkerResponse>);
        }
    }

    describe('shouldApplyTranscriptMarkdownWorkerResult', () => {
        it('accepts a result when the host generation still matches', () => {
            expect(shouldApplyTranscriptMarkdownWorkerResult(3, 3)).to.equal(true);
        });

        it('rejects stale worker results after a newer parse was requested', () => {
            expect(shouldApplyTranscriptMarkdownWorkerResult(4, 3)).to.equal(false);
        });

        it('rejects results when the host has no active generation', () => {
            expect(shouldApplyTranscriptMarkdownWorkerResult(undefined, 1)).to.equal(false);
        });
    });

    it('keeps only the latest queued snapshot per host', async () => {
        enableTranscriptRenderMetrics(true);
        resetTranscriptRenderMetrics();
        const runtime = globalThis as unknown as {
            Worker?: typeof Worker;
            location?: { href: string };
        };
        const previousWorker = runtime.Worker;
        const previousLocation = runtime.location;
        runtime.Worker = TestWorker as unknown as typeof Worker;
        runtime.location = { href: 'http://localhost/' };

        try {
            const { QaapTranscriptMarkdownWorkerClient } = await import('./qaap-transcript-markdown-worker-client');
            QaapTranscriptMarkdownWorkerClient.resetForTests();
            const client = QaapTranscriptMarkdownWorkerClient.get();
            const host = {} as HTMLElement;
            const applied: string[] = [];

            client.requestParse(host, 'first', (_target, html) => applied.push(html), () => undefined);
            client.requestParse(host, 'second', (_target, html) => applied.push(html), () => undefined);
            expect(getTranscriptRenderMetricsSnapshot().markdown_worker_coalesced).to.equal(1);

            const worker = TestWorker.latest;
            expect(worker?.posted.length).to.equal(1);
            const first = worker?.posted[0];
            expect(first?.type).to.equal('parse');

            worker?.emit({
                type: 'result',
                requestId: first!.requestId,
                generation: first!.generation,
                html: '<p>first</p>',
                cleanLength: 5,
            });

            expect(worker?.posted.length).to.equal(2);
            const second = worker?.posted[1];
            expect(second?.type).to.equal('parse');
            expect(second && 'content' in second ? second.content : undefined).to.equal('second');

            worker?.emit({
                type: 'result',
                requestId: second!.requestId,
                generation: second!.generation,
                html: '<p>second</p>',
                cleanLength: 6,
            });
            expect(applied).to.deep.equal(['<p>second</p>']);
        } finally {
            const { QaapTranscriptMarkdownWorkerClient } = await import('./qaap-transcript-markdown-worker-client');
            QaapTranscriptMarkdownWorkerClient.resetForTests();
            if (previousWorker) {
                runtime.Worker = previousWorker;
            } else {
                delete runtime.Worker;
            }
            if (previousLocation) {
                runtime.location = previousLocation;
            } else {
                delete runtime.location;
            }
            resetTranscriptRenderMetrics();
            enableTranscriptRenderMetrics(false);
        }
    });

    it('paints superseded stream results instead of starving the host while the reveal ticks every frame', async () => {
        const runtime = globalThis as unknown as { Worker?: typeof Worker; location?: { href: string } };
        const previousWorker = runtime.Worker;
        const previousLocation = runtime.location;
        runtime.Worker = TestWorker as unknown as typeof Worker;
        runtime.location = { href: 'http://localhost/' };
        const { QaapTranscriptMarkdownWorkerClient } = await import('./qaap-transcript-markdown-worker-client');
        try {
            QaapTranscriptMarkdownWorkerClient.resetForTests();
            const client = QaapTranscriptMarkdownWorkerClient.get();
            const host = { dataset: {} as DOMStringMap } as HTMLElement;
            const painted: number[] = [];
            const apply = (target: HTMLElement, patch: { stableLength: number; totalLength: number }): void => {
                painted.push(patch.totalLength);
                target.dataset.qaapStreamStableLength = String(patch.stableLength);
                target.dataset.qaapStreamTotalLength = String(patch.totalLength);
            };
            const request = (content: string): void => client.requestStreamingPatch(
                host, content, Number(host.dataset.qaapStreamStableLength ?? '-1'), Number(host.dataset.qaapStreamTotalLength ?? '-1'),
                apply, () => undefined);
            const respond = (index: number, totalLength: number): void => {
                const posted = TestWorker.latest!.posted[index];
                TestWorker.latest!.emit({
                    type: 'stream_result', requestId: posted.requestId, generation: posted.generation,
                    stableLength: 0, totalLength, tailHtml: `<p>${totalLength}</p>`, cleanLength: totalLength,
                });
            };

            // Each worker response lands only after the next frame already asked for a newer snapshot.
            request('a'.repeat(10));
            request('a'.repeat(20));
            respond(0, 10);
            request('a'.repeat(30));
            respond(1, 20);
            request('a'.repeat(40));
            respond(2, 30);

            expect(painted, 'every superseded-but-newer prefix paints').to.deep.equal([10, 20, 30]);
            const next = TestWorker.latest!.posted[3];
            expect(next.type === 'parse_stream' ? next.previousTotalLength : undefined,
                'the queued request diffs against what was painted, not what was shown at enqueue').to.equal(30);
        } finally {
            QaapTranscriptMarkdownWorkerClient.resetForTests();
            if (previousWorker) {
                runtime.Worker = previousWorker;
            } else {
                delete runtime.Worker;
            }
            if (previousLocation) {
                runtime.location = previousLocation;
            } else {
                delete runtime.location;
            }
        }
    });

    it('does not paint a superseded stream result over a queued final parse', async () => {
        const runtime = globalThis as unknown as { Worker?: typeof Worker; location?: { href: string } };
        const previousWorker = runtime.Worker;
        const previousLocation = runtime.location;
        runtime.Worker = TestWorker as unknown as typeof Worker;
        runtime.location = { href: 'http://localhost/' };
        const { QaapTranscriptMarkdownWorkerClient } = await import('./qaap-transcript-markdown-worker-client');
        try {
            QaapTranscriptMarkdownWorkerClient.resetForTests();
            const client = QaapTranscriptMarkdownWorkerClient.get();
            const host = { dataset: {} as DOMStringMap } as HTMLElement;
            const painted: string[] = [];
            client.requestStreamingPatch(host, 'partial', -1, -1, () => painted.push('stream'), () => undefined);
            client.requestParse(host, 'final answer', (_target, html) => painted.push(html), () => undefined);
            const posted = TestWorker.latest!.posted[0];
            TestWorker.latest!.emit({
                type: 'stream_result', requestId: posted.requestId, generation: posted.generation,
                stableLength: 0, totalLength: 7, tailHtml: '<p>partial</p>', cleanLength: 7,
            });
            expect(painted).to.deep.equal([]);
        } finally {
            QaapTranscriptMarkdownWorkerClient.resetForTests();
            if (previousWorker) {
                runtime.Worker = previousWorker;
            } else {
                delete runtime.Worker;
            }
            if (previousLocation) {
                runtime.location = previousLocation;
            } else {
                delete runtime.location;
            }
        }
    });
});
