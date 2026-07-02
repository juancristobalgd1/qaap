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
    formatMobileEventSummary,
    hasMobileExecutionEventTimeline,
    refreshMobileExecutionEventTimeline,
    MOBILE_EXECUTION_TIMELINE_CLASS,
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
