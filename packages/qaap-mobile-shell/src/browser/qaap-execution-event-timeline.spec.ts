// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import type { QaapAgentMessageSegmentDTO } from '../common/qaap-agent-conversation-client';
import {
    buildMobileExecutionEvents,
    createMobileDiffSummaryElement,
    createMobileExecutionEventTimeline,
    createMobileLineDiffSummaryElement,
    createMobileProcessAccordion,
    findMobileProcessAccordion,
    formatMobileEventSummary,
    hasMobileExecutionEventTimeline,
    hasMobileProcessAccordion,
    MOBILE_EXECUTION_TIMELINE_CLASS,
    MOBILE_PROCESS_ACCORDION_CLASS,
    refreshMobileExecutionEventTimeline,
    syncMobileProcessAccordionState,
    wrapMobileProcessAccordion,
} from './qaap-execution-event-timeline';

describe('qaap-execution-event-timeline', () => {

    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    describe('buildMobileExecutionEvents', () => {

        it('groups consecutive tool calls of the same kind into one event', () => {
            const timeline = buildMobileExecutionEvents([
                toolSegment('Read', 'tool-1', JSON.stringify({ path: 'a.ts' })),
                toolSegment('Read', 'tool-2', JSON.stringify({ path: 'b.ts' })),
                toolSegment('Bash', 'tool-3', JSON.stringify({ command: 'ls' })),
            ]);

            expect(timeline.events).to.have.length(2);
            expect(timeline.events[0]?.kind).to.equal('read');
            expect(timeline.events[0]?.tools).to.have.length(2);
            expect(timeline.events[1]?.kind).to.equal('run');
            expect(timeline.events[1]?.tools).to.have.length(1);
        });

        it('uses agent text as the event narrative', () => {
            const timeline = buildMobileExecutionEvents([
                textSegment("I'm inspecting the repository."),
                toolSegment('Grep', 'tool-1', '{}'),
            ]);

            expect(timeline.events[0]?.narrative).to.equal("I'm inspecting the repository.");
            expect(timeline.events[0]?.narrativeSource).to.equal('agent');
        });

        it('generates synthetic narrative when no text precedes tools', () => {
            const timeline = buildMobileExecutionEvents([
                toolSegment('Grep', 'tool-1', '{}'),
            ]);

            expect(timeline.events[0]?.narrativeSource).to.equal('synthetic');
            expect(timeline.events[0]?.narrative).to.not.equal('');
        });

        it('uses thinking content as narrative when no text is available', () => {
            const timeline = buildMobileExecutionEvents([
                thinkingSegment('Planning the approach.'),
                toolSegment('Read', 'tool-1', '{}'),
            ]);

            expect(timeline.events[0]?.narrative).to.equal('Planning the approach.');
            expect(timeline.events[0]?.narrativeSource).to.equal('agent');
        });

        it('starts a new event when the tool kind changes', () => {
            const timeline = buildMobileExecutionEvents([
                toolSegment('Grep', 'tool-1', '{}'),
                toolSegment('Bash', 'tool-2', '{}'),
                toolSegment('Edit', 'tool-3', '{}'),
            ]);

            expect(timeline.events).to.have.length(3);
            expect(timeline.events[0]?.kind).to.equal('explore');
            expect(timeline.events[1]?.kind).to.equal('run');
            expect(timeline.events[2]?.kind).to.equal('edit');
        });

        it('classifies verification commands as verification events', () => {
            const timeline = buildMobileExecutionEvents([
                toolSegment('Bash', 'tool-1', JSON.stringify({ command: 'npm run test' })),
                toolSegment('Bash', 'tool-2', JSON.stringify({ command: 'pnpm lint' })),
            ]);

            expect(timeline.events).to.have.length(1);
            expect(timeline.events[0]?.kind).to.equal('verification');
        });

        it('captures trailing text as closing narrative', () => {
            const timeline = buildMobileExecutionEvents([
                toolSegment('Read', 'tool-1', '{}'),
                textSegment('Done with the task.'),
            ]);

            expect(timeline.closingNarrative).to.equal('Done with the task.');
        });

        it('accumulates multiple consecutive text segments into one event narrative without dropping any', () => {
            const timeline = buildMobileExecutionEvents([
                textSegment("Let me explain the approach."),
                textSegment("I'll start by reading the file."),
                toolSegment('Read', 'tool-1', '{}'),
            ]);

            expect(timeline.events).to.have.length(1);
            expect(timeline.events[0]?.narrativeSource).to.equal('agent');
            expect(timeline.events[0]?.narrative).to.include("Let me explain the approach.");
            expect(timeline.events[0]?.narrative).to.include("I'll start by reading the file.");
        });

        it('accumulates multiple trailing text segments as closing narrative without dropping any', () => {
            const timeline = buildMobileExecutionEvents([
                toolSegment('Read', 'tool-1', '{}'),
                textSegment('Done with the implementation.'),
                textSegment("Here's a summary of changes."),
            ]);

            expect(timeline.closingNarrative).to.include("Done with the implementation.");
            expect(timeline.closingNarrative).to.include("Here's a summary of changes.");
        });

        it('accumulates text segments between tool groups as narrative for the next event', () => {
            const timeline = buildMobileExecutionEvents([
                toolSegment('Read', 'tool-1', '{}'),
                textSegment("I found the rendering pipeline."),
                textSegment("Now let me check the tests."),
                toolSegment('Read', 'tool-2', '{}'),
            ]);

            expect(timeline.events).to.have.length(2);
            expect(timeline.events[1]?.narrativeSource).to.equal('agent');
            expect(timeline.events[1]?.narrative).to.include("I found the rendering pipeline.");
            expect(timeline.events[1]?.narrative).to.include("Now let me check the tests.");
        });

        it('propagates pending and error state to the event level', () => {
            const timeline = buildMobileExecutionEvents([
                toolSegment('Bash', 'tool-1', '{}', false),
                toolSegment('Read', 'tool-2', '{}', true, true),
            ]);

            expect(timeline.events[0]?.hasPending).to.equal(true);
            expect(timeline.events[1]?.hasError).to.equal(true);
        });

        it('formatMobileEventSummary produces count + noun', () => {
            const timeline = buildMobileExecutionEvents([
                toolSegment('Read', 'tool-1', '{}'),
                toolSegment('Read', 'tool-2', '{}'),
            ]);
            expect(formatMobileEventSummary(timeline.events[0]!)).to.equal('2 files');
        });

    });

    describe('createMobileExecutionEventTimeline', () => {

        it('renders a container with execution events', () => {
            const el = createMobileExecutionEventTimeline([
                toolSegment('Read', 'tool-1', JSON.stringify({ path: 'a.ts' })),
            ]);

            expect(el.classList.contains(MOBILE_EXECUTION_TIMELINE_CLASS)).to.equal(true);
            expect(el.querySelectorAll('.theia-mobile-execution-event').length).to.be.greaterThan(0);
        });

        it('renders collapsed tool groups by default', () => {
            const el = createMobileExecutionEventTimeline([
                toolSegment('Read', 'tool-1', JSON.stringify({ path: 'a.ts' })),
            ]);

            const group = el.querySelector<HTMLDetailsElement>('.theia-mobile-tool-group');
            expect(group).to.not.equal(null);
            expect(group?.open).to.equal(false);
        });

        it('renders terminal tools as collapsible terminal output cards', () => {
            const el = createMobileExecutionEventTimeline([
                toolSegment('Bash', 'tool-1', JSON.stringify({ command: 'echo hello' }), true, false, 'hello\n'),
            ]);

            const terminal = el.querySelector<HTMLDetailsElement>('.theia-mobile-terminal-output');
            expect(terminal).to.not.equal(null);
            expect(terminal?.open).to.equal(false);
        });

        it('strips ANSI escape sequences from terminal output', () => {
            const rawOutput = '\u001b[32msuccess\u001b[0m\n\u001b]0;title\u0007done';
            const el = createMobileExecutionEventTimeline([
                toolSegment('Bash', 'tool-1', JSON.stringify({ command: 'echo' }), true, false, rawOutput),
            ]);

            // Terminal output <pre> is built lazily on first open (collapsed
            // by default) -- expand it before asserting on its content.
            const terminal = el.querySelector<HTMLDetailsElement>('.theia-mobile-terminal-output');
            terminal!.open = true;
            // Use the jsdom window's Event constructor — Node's own global
            // `Event` class produces an object jsdom's dispatchEvent rejects.
            terminal!.dispatchEvent(new window.Event('toggle'));

            const pre = el.querySelector<HTMLPreElement>('.theia-mobile-terminal-output-pre');
            expect(pre).to.not.equal(null);
            // ANSI CSI and OSC sequences must be removed
            expect(pre?.textContent).to.equal('success\ndone');
        });

        it('does not render closing narrative (caller handles it)', () => {
            const el = createMobileExecutionEventTimeline([
                toolSegment('Read', 'tool-1', '{}'),
                textSegment('Final answer.'),
            ]);

            expect(el.querySelector('.theia-mobile-execution-timeline-closing')).to.equal(null);
        });

    });

    describe('hasMobileExecutionEventTimeline', () => {

        it('returns true when the row contains an execution event timeline', () => {
            const row = document.createElement('div');
            const body = document.createElement('div');
            body.className = 'theia-mobile-agent-transcript-segments';
            const timeline = createMobileExecutionEventTimeline([
                toolSegment('Read', 'tool-1', '{}'),
            ]);
            body.append(timeline);
            row.append(body);

            expect(hasMobileExecutionEventTimeline(row)).to.equal(true);
        });

        it('returns false when the row has no execution event timeline', () => {
            const row = document.createElement('div');
            expect(hasMobileExecutionEventTimeline(row)).to.equal(false);
        });

    });

    describe('refreshMobileExecutionEventTimeline', () => {

        it('replaces the existing timeline and preserves open state', () => {
            const segmentsBody = document.createElement('div');
            segmentsBody.className = 'theia-mobile-agent-transcript-segments';
            const timeline = createMobileExecutionEventTimeline([
                toolSegment('Read', 'tool-1', '{}'),
            ]);
            segmentsBody.append(timeline);

            // Expand the tool group
            const group = segmentsBody.querySelector<HTMLDetailsElement>('.theia-mobile-tool-group');
            group!.open = true;

            // Refresh with updated segments
            refreshMobileExecutionEventTimeline(segmentsBody, [
                toolSegment('Read', 'tool-1', '{}'),
                toolSegment('Read', 'tool-2', '{}'),
            ]);

            // The timeline should be replaced, but the open state preserved
            const newGroup = segmentsBody.querySelector<HTMLDetailsElement>('.theia-mobile-tool-group');
            expect(newGroup).to.not.equal(null);
            expect(newGroup?.open).to.equal(true);
        });

        it('preserves terminal output open state across refreshes', () => {
            const segmentsBody = document.createElement('div');
            segmentsBody.className = 'theia-mobile-agent-transcript-segments';
            const timeline = createMobileExecutionEventTimeline([
                toolSegment('Bash', 'tool-1', JSON.stringify({ command: 'echo hello' }), true, false, 'hello\n'),
            ]);
            segmentsBody.append(timeline);

            // Expand both the tool group and the terminal output
            const group = segmentsBody.querySelector<HTMLDetailsElement>('.theia-mobile-tool-group');
            group!.open = true;
            const terminal = segmentsBody.querySelector<HTMLDetailsElement>('.theia-mobile-terminal-output');
            terminal!.open = true;

            // Refresh with updated segments
            refreshMobileExecutionEventTimeline(segmentsBody, [
                toolSegment('Bash', 'tool-1', JSON.stringify({ command: 'echo hello' }), true, false, 'hello\n'),
            ]);

            // Both open states should be preserved
            const newGroup = segmentsBody.querySelector<HTMLDetailsElement>('.theia-mobile-tool-group');
            expect(newGroup?.open).to.equal(true);
            const newTerminal = segmentsBody.querySelector<HTMLDetailsElement>('.theia-mobile-terminal-output');
            expect(newTerminal).to.not.equal(null);
            expect(newTerminal?.open).to.equal(true);
        });

        it('appends a new timeline when none exists', () => {
            const segmentsBody = document.createElement('div');
            segmentsBody.className = 'theia-mobile-agent-transcript-segments';

            refreshMobileExecutionEventTimeline(segmentsBody, [
                toolSegment('Read', 'tool-1', '{}'),
            ]);

            expect(segmentsBody.querySelector(`.${MOBILE_EXECUTION_TIMELINE_CLASS}`)).to.not.equal(null);
        });

    });

    describe('createMobileDiffSummaryElement', () => {

        it('renders file count and stats', () => {
            const el = createMobileDiffSummaryElement(3, 1, 1, 1, [
                { name: 'a.ts', type: 'add' },
                { name: 'b.ts', type: 'modify' },
                { name: 'c.ts', type: 'delete' },
            ]);

            expect(el.classList.contains('theia-mobile-diff-summary')).to.equal(true);
            expect(el.querySelector('.theia-mobile-diff-summary-title')?.textContent).to.equal('3 files changed');
            expect(el.querySelector('.theia-mobile-diff-summary-stat.theia-mod-added')?.textContent).to.equal('+1');
            expect(el.querySelectorAll('.theia-mobile-diff-summary-file').length).to.equal(3);
        });

        it('limits file list to 6 entries with a more indicator', () => {
            const files = Array.from({ length: 8 }, (_, i) => ({ name: `file-${i}.ts`, type: 'modify' as const }));
            const el = createMobileDiffSummaryElement(8, 0, 8, 0, files);

            expect(el.querySelectorAll('.theia-mobile-diff-summary-file').length).to.equal(6);
            expect(el.querySelector('.theia-mobile-diff-summary-more')?.textContent).to.equal('+2 more');
        });

    });

    describe('createMobileLineDiffSummaryElement', () => {

        it('renders line-level stats without claiming a file count', () => {
            const el = createMobileLineDiffSummaryElement(50, 12);

            expect(el.classList.contains('theia-mobile-diff-summary')).to.equal(true);
            // Title must NOT say "N files changed" — it's a line-level summary
            const title = el.querySelector('.theia-mobile-diff-summary-title');
            expect(title?.textContent).to.not.match(/file/i);
            // Stats show the actual line counts
            expect(el.querySelector('.theia-mobile-diff-summary-stat.theia-mod-added')?.textContent).to.equal('+50');
            expect(el.querySelector('.theia-mobile-diff-summary-stat.theia-mod-deleted')?.textContent).to.equal('-12');
        });

        it('omits the added stat when linesAdded is zero', () => {
            const el = createMobileLineDiffSummaryElement(0, 5);
            expect(el.querySelector('.theia-mobile-diff-summary-stat.theia-mod-added')).to.equal(null);
            expect(el.querySelector('.theia-mobile-diff-summary-stat.theia-mod-deleted')?.textContent).to.equal('-5');
        });

        it('omits the removed stat when linesRemoved is zero', () => {
            const el = createMobileLineDiffSummaryElement(7, 0);
            expect(el.querySelector('.theia-mobile-diff-summary-stat.theia-mod-added')?.textContent).to.equal('+7');
            expect(el.querySelector('.theia-mobile-diff-summary-stat.theia-mod-deleted')).to.equal(null);
        });

        it('does not render a file list', () => {
            const el = createMobileLineDiffSummaryElement(10, 2);
            expect(el.querySelector('.theia-mobile-diff-summary-files')).to.equal(null);
        });

    });

    // ─── Process Accordion ───────────────────────────────────────────────────

    describe('createMobileProcessAccordion', () => {

        it('creates a <details> with the process accordion class', () => {
            const segments = [textSegment('Thinking...'), toolSegment('read', 't1', '{}', true)];
            const accordion = createMobileProcessAccordion(segments, { isWorking: true, isError: false });
            expect(accordion.tagName).to.equal('DETAILS');
            expect(accordion.classList.contains(MOBILE_PROCESS_ACCORDION_CLASS)).to.be.true;
        });

        it('is open when working', () => {
            const segments = [toolSegment('read', 't1', '{}', true)];
            const accordion = createMobileProcessAccordion(segments, { isWorking: true, isError: false });
            expect((accordion as HTMLDetailsElement).open).to.be.true;
        });

        it('is open when error', () => {
            const segments = [toolSegment('read', 't1', '{}', true)];
            const accordion = createMobileProcessAccordion(segments, { isWorking: false, isError: true });
            expect((accordion as HTMLDetailsElement).open).to.be.true;
        });

        it('is collapsed when complete (not working, not error)', () => {
            const segments = [toolSegment('read', 't1', '{}', true)];
            const accordion = createMobileProcessAccordion(segments, { isWorking: false, isError: false });
            expect((accordion as HTMLDetailsElement).open).to.be.false;
        });

        it('contains the execution timeline inside', () => {
            const segments = [toolSegment('read', 't1', '{}', true)];
            const accordion = createMobileProcessAccordion(segments, { isWorking: false, isError: false });
            expect(accordion.querySelector(`.${MOBILE_EXECUTION_TIMELINE_CLASS}`)).to.not.equal(null);
        });

        it('shows "Processing…" label when working without elapsed', () => {
            const segments = [toolSegment('read', 't1', '{}', false)];
            const accordion = createMobileProcessAccordion(segments, { isWorking: true, isError: false });
            const label = accordion.querySelector('.theia-mobile-process-accordion-label');
            expect(label?.textContent).to.equal('Processing…');
        });

        it('shows "Processed in Xs" label when complete with elapsed', () => {
            const segments = [toolSegment('read', 't1', '{}', true)];
            const accordion = createMobileProcessAccordion(segments, { isWorking: false, isError: false, elapsedMs: 45000 });
            const label = accordion.querySelector('.theia-mobile-process-accordion-label');
            expect(label?.textContent).to.equal('Processed in 45s');
        });

        it('shows "Processing… Xm Ys" label when working with elapsed', () => {
            const segments = [toolSegment('read', 't1', '{}', false)];
            const accordion = createMobileProcessAccordion(segments, { isWorking: true, isError: false, elapsedMs: 125000 });
            const label = accordion.querySelector('.theia-mobile-process-accordion-label');
            expect(label?.textContent).to.equal('Processing… 2m 5s');
        });

        it('applies theia-mod-working class when working', () => {
            const segments = [toolSegment('read', 't1', '{}', false)];
            const accordion = createMobileProcessAccordion(segments, { isWorking: true, isError: false });
            expect(accordion.classList.contains('theia-mod-working')).to.be.true;
            expect(accordion.classList.contains('theia-mod-complete')).to.be.false;
        });

        it('applies theia-mod-error class when error', () => {
            const segments = [toolSegment('read', 't1', '{}', true)];
            const accordion = createMobileProcessAccordion(segments, { isWorking: false, isError: true });
            expect(accordion.classList.contains('theia-mod-error')).to.be.true;
        });

        it('applies theia-mod-complete class when complete', () => {
            const segments = [toolSegment('read', 't1', '{}', true)];
            const accordion = createMobileProcessAccordion(segments, { isWorking: false, isError: false });
            expect(accordion.classList.contains('theia-mod-complete')).to.be.true;
        });

        it('marks user-toggled only on summary clicks, not on content clicks', () => {
            const segments = [toolSegment('read', 't1', '{}', true)];
            const accordion = createMobileProcessAccordion(segments, { isWorking: true, isError: false });
            // Click on the content area should NOT set user-toggled
            const content = accordion.querySelector('.theia-mobile-process-accordion-content') as HTMLElement;
            content.click();
            expect(accordion.getAttribute('data-user-toggled')).to.equal(null);
            // Click on the summary header SHOULD set user-toggled
            const header = accordion.querySelector('.theia-mobile-process-accordion-header') as HTMLElement;
            header.click();
            expect(accordion.getAttribute('data-user-toggled')).to.equal('1');
        });

    });

    describe('syncMobileProcessAccordionState', () => {

        it('collapses when transitioning from working to settled complete', () => {
            const segments = [toolSegment('read', 't1', '{}', true)];
            const accordion = createMobileProcessAccordion(segments, { isWorking: true, isError: false });
            expect((accordion as HTMLDetailsElement).open).to.be.true;
            syncMobileProcessAccordionState(accordion, { isWorking: false, isError: false, settled: true });
            expect((accordion as HTMLDetailsElement).open).to.be.false;
        });

        it('collapses an orphaned-open settled rebuild after the confirmation delay', function (done: Mocha.Done): void {
            this.timeout(4000);
            const segments = [toolSegment('read', 't1', '{}', true)];
            // Streaming render: accordion opens and records sticky state for the turn.
            const streaming = createMobileProcessAccordion(segments, { isWorking: true, isError: false, turnStartMs: 987654321 }) as HTMLDetailsElement;
            expect(streaming.open).to.be.true;
            // Settle arrives as a full rebuild: fresh element inherits open from
            // the sticky state, and no sync will ever run afterwards.
            const rebuilt = createMobileProcessAccordion(segments, { isWorking: false, isError: false, turnStartMs: 987654321 }) as HTMLDetailsElement;
            expect(rebuilt.open).to.be.true;
            document.body.append(rebuilt);
            // The orphaned-open guard must fold it after the confirmation delay.
            setTimeout(() => {
                try {
                    expect(rebuilt.open).to.be.false;
                    rebuilt.remove();
                    done();
                } catch (error) {
                    rebuilt.remove();
                    done(error);
                }
            }, 2200);
        });

        it('stays open on a transient non-working sync until the turn settles', () => {
            const segments = [toolSegment('read', 't1', '{}', true)];
            const accordion = createMobileProcessAccordion(segments, { isWorking: true, isError: false });
            expect((accordion as HTMLDetailsElement).open).to.be.true;
            // Mid-stream status flicker: working briefly reads false but the
            // turn has not settled — the accordion must NOT collapse.
            syncMobileProcessAccordionState(accordion, { isWorking: false, isError: false });
            expect((accordion as HTMLDetailsElement).open).to.be.true;
            // Working resumes: still open, no oscillation.
            syncMobileProcessAccordionState(accordion, { isWorking: true, isError: false });
            expect((accordion as HTMLDetailsElement).open).to.be.true;
            // Real settle with the final summary in the DOM: now it collapses.
            syncMobileProcessAccordionState(accordion, { isWorking: false, isError: false, settled: true });
            expect((accordion as HTMLDetailsElement).open).to.be.false;
        });

        it('expands when transitioning to error', () => {
            const segments = [toolSegment('read', 't1', '{}', true)];
            const accordion = createMobileProcessAccordion(segments, { isWorking: false, isError: false });
            expect((accordion as HTMLDetailsElement).open).to.be.false;
            syncMobileProcessAccordionState(accordion, { isWorking: false, isError: true });
            expect((accordion as HTMLDetailsElement).open).to.be.true;
        });

        it('updates the label when elapsed changes', () => {
            const segments = [toolSegment('read', 't1', '{}', true)];
            const accordion = createMobileProcessAccordion(segments, { isWorking: true, isError: false, elapsedMs: 5000 });
            syncMobileProcessAccordionState(accordion, { isWorking: false, isError: false, elapsedMs: 30000 });
            const label = accordion.querySelector('.theia-mobile-process-accordion-label');
            expect(label?.textContent).to.equal('Processed in 30s');
        });

        it('respects user toggle — does not auto-collapse after user interaction', () => {
            const segments = [toolSegment('read', 't1', '{}', true)];
            const accordion = createMobileProcessAccordion(segments, { isWorking: true, isError: false });
            // Simulate user click (sets data-user-toggled)
            accordion.setAttribute('data-user-toggled', '1');
            (accordion as HTMLDetailsElement).open = false;
            syncMobileProcessAccordionState(accordion, { isWorking: false, isError: false });
            // Should stay collapsed because user toggled
            expect((accordion as HTMLDetailsElement).open).to.be.false;
        });

        it('respects user toggle — does not auto-expand after user interaction', () => {
            const segments = [toolSegment('read', 't1', '{}', true)];
            const accordion = createMobileProcessAccordion(segments, { isWorking: false, isError: false });
            // User manually expands
            accordion.setAttribute('data-user-toggled', '1');
            (accordion as HTMLDetailsElement).open = true;
            syncMobileProcessAccordionState(accordion, { isWorking: true, isError: false });
            // Should stay expanded because user toggled
            expect((accordion as HTMLDetailsElement).open).to.be.true;
        });

        it('still updates the label even when user toggled', () => {
            const segments = [toolSegment('read', 't1', '{}', true)];
            const accordion = createMobileProcessAccordion(segments, { isWorking: true, isError: false, elapsedMs: 1000 });
            accordion.setAttribute('data-user-toggled', '1');
            syncMobileProcessAccordionState(accordion, { isWorking: false, isError: false, elapsedMs: 60000 });
            const label = accordion.querySelector('.theia-mobile-process-accordion-label');
            expect(label?.textContent).to.equal('Processed in 1m 0s');
        });

        it('updates modifier classes on sync', () => {
            const segments = [toolSegment('read', 't1', '{}', true)];
            const accordion = createMobileProcessAccordion(segments, { isWorking: true, isError: false });
            syncMobileProcessAccordionState(accordion, { isWorking: false, isError: true });
            expect(accordion.classList.contains('theia-mod-working')).to.be.false;
            expect(accordion.classList.contains('theia-mod-error')).to.be.true;
            expect(accordion.classList.contains('theia-mod-complete')).to.be.false;
        });

    });

    describe('hasMobileProcessAccordion', () => {

        it('returns true when a row contains a process accordion', () => {
            const segments = [toolSegment('read', 't1', '{}', true)];
            const accordion = createMobileProcessAccordion(segments, { isWorking: false, isError: false });
            const row = document.createElement('div');
            row.append(accordion);
            expect(hasMobileProcessAccordion(row)).to.be.true;
        });

        it('returns false when a row has no process accordion', () => {
            const row = document.createElement('div');
            expect(hasMobileProcessAccordion(row)).to.be.false;
        });

    });

    describe('findMobileProcessAccordion', () => {

        it('finds the accordion element within a segments body', () => {
            const segments = [toolSegment('read', 't1', '{}', true)];
            const accordion = createMobileProcessAccordion(segments, { isWorking: false, isError: false });
            const body = document.createElement('div');
            body.append(accordion);
            const found = findMobileProcessAccordion(body);
            expect(found).to.not.equal(undefined);
            expect(found?.classList.contains(MOBILE_PROCESS_ACCORDION_CLASS)).to.be.true;
        });

        it('returns undefined when no accordion is present', () => {
            const body = document.createElement('div');
            expect(findMobileProcessAccordion(body)).to.equal(undefined);
        });

    });

    describe('wrapMobileProcessAccordion', () => {

        it('wraps an existing timeline element', () => {
            const timeline = createMobileExecutionEventTimeline([toolSegment('read', 't1', '{}', true)]);
            const accordion = wrapMobileProcessAccordion(timeline, { isWorking: true, isError: false });
            expect(accordion.classList.contains(MOBILE_PROCESS_ACCORDION_CLASS)).to.be.true;
            expect(accordion.querySelector(`.${MOBILE_EXECUTION_TIMELINE_CLASS}`)).to.not.equal(null);
        });

    });

    describe('refreshMobileExecutionEventTimeline with accordion', () => {

        it('preserves the accordion wrapper when refreshing', () => {
            const segments1 = [toolSegment('read', 't1', '{}', true)];
            const accordion = createMobileProcessAccordion(segments1, { isWorking: true, isError: false });
            const body = document.createElement('div');
            body.append(accordion);
            // Refresh with new segments
            const segments2 = [toolSegment('read', 't1', '{}', true), toolSegment('write', 't2', '{}', true)];
            refreshMobileExecutionEventTimeline(body, segments2);
            // Accordion should still be present
            expect(body.querySelector(`.${MOBILE_PROCESS_ACCORDION_CLASS}`)).to.not.equal(null);
            // Timeline should be refreshed inside the accordion
            const timeline = body.querySelector(`.${MOBILE_EXECUTION_TIMELINE_CLASS}`);
            expect(timeline).to.not.equal(null);
        });

    });

    // ─── File icons in tool details and diff summary ──────────────────────────

    describe('file icons', () => {

        it('renders a file icon in tool details for read tools with a file path', () => {
            const segments = [toolSegment('read', 't1', JSON.stringify({ file_path: 'src/Canvas.tsx' }), true)];
            const timeline = createMobileExecutionEventTimeline(segments);
            const fileIcon = timeline.querySelector('.theia-mobile-tool-detail-file-icon');
            expect(fileIcon).to.not.equal(null);
            expect(fileIcon?.classList.contains('codicon-file-code')).to.be.true;
        });

        it('renders a file icon in tool details for write tools with a file path', () => {
            const segments = [toolSegment('write', 't1', JSON.stringify({ path: 'config.json' }), true)];
            const timeline = createMobileExecutionEventTimeline(segments);
            const fileIcon = timeline.querySelector('.theia-mobile-tool-detail-file-icon');
            expect(fileIcon).to.not.equal(null);
            expect(fileIcon?.classList.contains('codicon-json')).to.be.true;
        });

        it('does not render a file icon for run/terminal tools', () => {
            const segments = [toolSegment('bash', 't1', JSON.stringify({ command: 'npm test' }), true)];
            const timeline = createMobileExecutionEventTimeline(segments);
            const fileIcon = timeline.querySelector('.theia-mobile-tool-detail-file-icon');
            expect(fileIcon).to.equal(null);
        });

        it('renders a file icon in the diff summary file list', () => {
            const summary = createMobileDiffSummaryElement(2, 1, 1, 0, [
                { name: 'Canvas.tsx', type: 'add' },
                { name: 'README.md', type: 'modified' },
            ]);
            const icons = summary.querySelectorAll('.theia-mobile-diff-summary-file-icon');
            expect(icons.length).to.equal(2);
            expect(icons[0].classList.contains('codicon-file-code')).to.be.true;
            expect(icons[1].classList.contains('codicon-markdown')).to.be.true;
        });

    });

});

function toolSegment(
    name: string,
    toolUseId: string,
    args: string,
    finished = true,
    isError = false,
    result = 'ok',
): Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }> {
    return {
        type: 'tool',
        name,
        toolUseId,
        args,
        finished,
        result: isError ? `<tool_use_error>${result}</tool_use_error>` : result,
    };
}

function textSegment(content: string): Extract<QaapAgentMessageSegmentDTO, { type: 'text' }> {
    return { type: 'text', content };
}

function thinkingSegment(content: string): Extract<QaapAgentMessageSegmentDTO, { type: 'thinking' }> {
    return { type: 'thinking', content };
}
