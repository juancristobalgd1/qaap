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
        }
    });
});
