// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    resolveTranscriptStreamingCoalesceDelayMs,
    TRANSCRIPT_STREAMING_DESKTOP_OFF_BOTTOM_COALESCE_MS,
    TRANSCRIPT_STREAMING_NEAR_BOTTOM_COALESCE_MS,
    TRANSCRIPT_STREAMING_OFF_BOTTOM_COALESCE_MS,
} from './qaap-transcript-streaming-coalesce';

describe('qaap-transcript-streaming-coalesce', () => {

    it('resolveTranscriptStreamingCoalesceDelayMs throttles near the bottom to ~60 fps', () => {
        expect(resolveTranscriptStreamingCoalesceDelayMs(true)).to.equal(TRANSCRIPT_STREAMING_NEAR_BOTTOM_COALESCE_MS);
    });

    it('resolveTranscriptStreamingCoalesceDelayMs throttles off-bottom desktop to ~60 fps', () => {
        (global as unknown as { window: typeof globalThis }).window = globalThis;
        const originalMatchMedia = globalThis.matchMedia;
        Object.defineProperty(globalThis, 'matchMedia', {
            configurable: true,
            value: (query: string) => ({
                matches: false,
                media: query,
                addEventListener: () => undefined,
                removeEventListener: () => undefined,
            }),
        });
        try {
            expect(resolveTranscriptStreamingCoalesceDelayMs(false)).to.equal(TRANSCRIPT_STREAMING_DESKTOP_OFF_BOTTOM_COALESCE_MS);
        } finally {
            if (originalMatchMedia) {
                Object.defineProperty(globalThis, 'matchMedia', {
                    configurable: true,
                    value: originalMatchMedia,
                });
            }
        }
    });

    it('resolveTranscriptStreamingCoalesceDelayMs caps off-bottom updates on coarse pointers', () => {
        (global as unknown as { window: typeof globalThis }).window = globalThis;
        const originalMatchMedia = globalThis.matchMedia;
        Object.defineProperty(globalThis, 'matchMedia', {
            configurable: true,
            value: (query: string) => ({
                matches: query === '(pointer: coarse)',
                media: query,
                addEventListener: () => undefined,
                removeEventListener: () => undefined,
            }),
        });
        try {
            expect(resolveTranscriptStreamingCoalesceDelayMs(false)).to.equal(TRANSCRIPT_STREAMING_OFF_BOTTOM_COALESCE_MS);
        } finally {
            if (originalMatchMedia) {
                Object.defineProperty(globalThis, 'matchMedia', {
                    configurable: true,
                    value: originalMatchMedia,
                });
            }
        }
    });
});
