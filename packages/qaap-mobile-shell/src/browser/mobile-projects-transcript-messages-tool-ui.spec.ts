// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import { expect } from 'chai';
import {
    formatTranscriptExecutionTime,
    syncTranscriptToolExecutionTime,
} from './mobile-projects-transcript-messages-tool-ui';

describe('mobile-projects-transcript-messages-tool-ui', () => {

    describe('formatTranscriptExecutionTime', () => {
        it('formats sub-second durations as milliseconds', () => {
            expect(formatTranscriptExecutionTime(0)).to.equal('0ms');
            expect(formatTranscriptExecutionTime(1)).to.equal('1ms');
            expect(formatTranscriptExecutionTime(999)).to.equal('999ms');
        });

        it('formats sub-minute durations as seconds with one decimal', () => {
            expect(formatTranscriptExecutionTime(1000)).to.equal('1.0s');
            expect(formatTranscriptExecutionTime(1500)).to.equal('1.5s');
            expect(formatTranscriptExecutionTime(12345)).to.equal('12.3s');
            expect(formatTranscriptExecutionTime(59999)).to.equal('60.0s');
        });

        it('formats minute-and-second durations as XminYs', () => {
            expect(formatTranscriptExecutionTime(60000)).to.equal('1min0s');
            expect(formatTranscriptExecutionTime(65000)).to.equal('1min5s');
            expect(formatTranscriptExecutionTime(125000)).to.equal('2min5s');
            expect(formatTranscriptExecutionTime(3600000)).to.equal('60min0s');
        });
    });

    describe('syncTranscriptToolExecutionTime', () => {
        let parent: HTMLElement;
        let chevron: HTMLElement;

        beforeEach(() => {
            parent = document.createElement('summary');
            chevron = document.createElement('span');
            chevron.className = 'theia-mobile-agent-tool-pill-chevron';
            parent.append(chevron);
            document.body.append(parent);
        });

        afterEach(() => {
            parent.remove();
        });

        it('does not mount a chip when not running', () => {
            syncTranscriptToolExecutionTime(parent, chevron, Date.now() - 500, false);
            expect(parent.querySelector('.theia-mobile-agent-lobe-exec-time')).to.equal(null);
        });

        it('does not mount a chip when startedAt is undefined', () => {
            syncTranscriptToolExecutionTime(parent, chevron, undefined, true);
            expect(parent.querySelector('.theia-mobile-agent-lobe-exec-time')).to.equal(null);
        });

        it('mounts a chip before the chevron when running', () => {
            const startedAt = Date.now() - 250;
            syncTranscriptToolExecutionTime(parent, chevron, startedAt, true);
            const chip = parent.querySelector<HTMLElement>('.theia-mobile-agent-lobe-exec-time');
            expect(chip).to.not.equal(null);
            expect(chip?.textContent).to.match(/^\(\d+ms\)$/);
            // Chip must sit before the chevron.
            expect(chip?.nextElementSibling).to.equal(chevron);
        });

        it('appends the chip when beforeEl is not a child of parent', () => {
            const orphan = document.createElement('span');
            syncTranscriptToolExecutionTime(parent, orphan, Date.now(), true);
            const chip = parent.querySelector<HTMLElement>('.theia-mobile-agent-lobe-exec-time');
            expect(chip).to.not.equal(null);
            expect(chip?.nextElementSibling).to.equal(null);
        });

        it('removes the chip and clears the timer when transitioning to finished', () => {
            const startedAt = Date.now() - 300;
            syncTranscriptToolExecutionTime(parent, chevron, startedAt, true);
            const chip = parent.querySelector('.theia-mobile-agent-lobe-exec-time');
            expect(chip).to.not.equal(null);
            syncTranscriptToolExecutionTime(parent, chevron, startedAt, false);
            expect(parent.querySelector('.theia-mobile-agent-lobe-exec-time')).to.equal(null);
        });

        it('updates elapsed text on interval tick', done => {
            const startedAt = Date.now();
            syncTranscriptToolExecutionTime(parent, chevron, startedAt, true);
            const chip = parent.querySelector<HTMLElement>('.theia-mobile-agent-lobe-exec-time');
            expect(chip).to.not.equal(null);
            // Wait >100ms for at least one tick.
            setTimeout(() => {
                const tickedText = chip?.textContent ?? '';
                expect(tickedText).to.not.equal('');
                // The chip should still show a parenthesised duration.
                expect(tickedText).to.match(/^\(\d+(\.\d)?(ms|s|min\d+s)\)$/);
                // Clean up.
                syncTranscriptToolExecutionTime(parent, chevron, startedAt, false);
                done();
            }, 180);
        });

        it('self-cleans the timer when the chip is removed from the DOM', done => {
            const startedAt = Date.now();
            syncTranscriptToolExecutionTime(parent, chevron, startedAt, true);
            const chip = parent.querySelector<HTMLElement>('.theia-mobile-agent-lobe-exec-time');
            expect(chip).to.not.equal(null);
            // Remove the chip from the DOM without going through sync.
            chip?.remove();
            // Wait >100ms — the interval should detect disconnection and stop.
            setTimeout(() => {
                // No throw, no lingering chip. Re-syncing should still work.
                syncTranscriptToolExecutionTime(parent, chevron, startedAt, false);
                expect(parent.querySelector('.theia-mobile-agent-lobe-exec-time')).to.equal(null);
                done();
            }, 180);
        });

        it('re-bases the timer when re-synced with a new startedAt', done => {
            const firstStart = Date.now() - 1000;
            syncTranscriptToolExecutionTime(parent, chevron, firstStart, true);
            const chip = parent.querySelector<HTMLElement>('.theia-mobile-agent-lobe-exec-time');
            expect(chip?.textContent).to.match(/^\(1\.0s\)$/);
            // Re-sync with a much earlier start — elapsed should jump.
            const earlierStart = Date.now() - 5000;
            syncTranscriptToolExecutionTime(parent, chevron, earlierStart, true);
            const chip2 = parent.querySelector<HTMLElement>('.theia-mobile-agent-lobe-exec-time');
            expect(chip2?.textContent).to.match(/^\(5\.0s\)$/);
            syncTranscriptToolExecutionTime(parent, chevron, earlierStart, false);
            done();
        });
    });
});
