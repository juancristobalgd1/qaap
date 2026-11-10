// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { PREVIEW_STARTING_STALL_TIMEOUT_MS } from '@theia/qaap-shared-core/lib/common/qaap-transcript-turn-status';
import { type PreviewStartingTimers, QaapPreviewStartingWatchdog } from './qaap-preview-starting-watchdog';

/** A manual timer: callbacks fire only when the test advances time, so no real waiting happens. */
class ManualTimers implements PreviewStartingTimers {
    now = 0;
    protected pending = new Map<number, { readonly at: number; readonly callback: () => void }>();
    protected nextId = 1;

    setTimeout(callback: () => void, ms: number): unknown {
        const id = this.nextId++;
        this.pending.set(id, { at: this.now + ms, callback });
        return id;
    }

    clearTimeout(handle: unknown): void {
        this.pending.delete(handle as number);
    }

    advance(ms: number): void {
        this.now += ms;
        for (const [id, entry] of [...this.pending]) {
            if (entry.at <= this.now) {
                this.pending.delete(id);
                entry.callback();
            }
        }
    }

    get scheduled(): number {
        return this.pending.size;
    }
}

describe('QaapPreviewStartingWatchdog', () => {
    let timers: ManualTimers;
    let stalls: number;
    let watchdog: QaapPreviewStartingWatchdog;

    beforeEach(() => {
        timers = new ManualTimers();
        stalls = 0;
        watchdog = new QaapPreviewStartingWatchdog(timers, () => { stalls++; });
    });

    it('retires the request after the stall timeout with no URL and no progress', () => {
        watchdog.arm();
        timers.advance(PREVIEW_STARTING_STALL_TIMEOUT_MS - 1);
        expect(stalls).to.equal(0);
        timers.advance(1);
        expect(stalls).to.equal(1);
        expect(timers.scheduled).to.equal(0);
    });

    it('restarts the window on every progress event while armed', () => {
        watchdog.arm();
        timers.advance(PREVIEW_STARTING_STALL_TIMEOUT_MS - 1);
        watchdog.progress();
        timers.advance(PREVIEW_STARTING_STALL_TIMEOUT_MS - 1);
        expect(stalls).to.equal(0);
        timers.advance(1);
        expect(stalls).to.equal(1);
    });

    it('never fires after disarm, even past the timeout', () => {
        watchdog.arm();
        watchdog.disarm();
        timers.advance(PREVIEW_STARTING_STALL_TIMEOUT_MS * 3);
        expect(stalls).to.equal(0);
        expect(timers.scheduled).to.equal(0);
    });

    it('ignores progress when it was never armed', () => {
        watchdog.progress();
        timers.advance(PREVIEW_STARTING_STALL_TIMEOUT_MS * 2);
        expect(stalls).to.equal(0);
    });

    it('fires once per arm', () => {
        watchdog.arm();
        timers.advance(PREVIEW_STARTING_STALL_TIMEOUT_MS);
        timers.advance(PREVIEW_STARTING_STALL_TIMEOUT_MS);
        expect(stalls).to.equal(1);
    });
});
