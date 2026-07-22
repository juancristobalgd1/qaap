// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import type { QaapAgentMessageSegmentDTO } from '../common/qaap-agent-conversation-client';
import {
    buildMobileExecutionEvents,
    createMobileClosingErrorCardElement,
    createMobileDiffSummaryElement,
    resolveMobileDiffFileLanguageBadge,
    createMobileExecutionEventTimeline,
    createMobileLineDiffSummaryElement,
    createMobileProcessAccordion,
    findMobileProcessAccordion,
    formatMobileEventSummary,
    hasMobileExecutionEventTimeline,
    hasMobileProcessAccordion,
    MOBILE_CLOSING_ERROR_CARD_CLASS,
    MOBILE_EXECUTION_TIMELINE_CLASS,
    MOBILE_PROCESS_ACCORDION_CLASS,
    refreshMobileExecutionEventTimeline,
    resolveMobileActivityVerb,
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
            expect(timeline.events[0]?.id).to.equal('m-event-tool-1');
            expect(timeline.events[1]?.kind).to.equal('run');
            expect(timeline.events[1]?.tools).to.have.length(1);
            expect(timeline.events[1]?.id).to.equal('m-event-tool-3');
        });

        it('does not merge consecutive run/verification tools (avoids kind-flip rebuilds)', () => {
            const timeline = buildMobileExecutionEvents([
                toolSegment('Bash', 'tool-1', JSON.stringify({ command: 'npm run build' })),
                toolSegment('Bash', 'tool-2', JSON.stringify({ command: 'npm run test' })),
            ]);
            expect(timeline.events).to.have.length(2);
            expect(timeline.events[0]?.id).to.equal('m-event-tool-1');
            expect(timeline.events[1]?.id).to.equal('m-event-tool-2');
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

            // Run/verification tools stay one event per tool (stable ids; no kind-flip rebuilds).
            expect(timeline.events).to.have.length(2);
            expect(timeline.events[0]?.kind).to.equal('verification');
            expect(timeline.events[1]?.kind).to.equal('verification');
            expect(timeline.events[0]?.id).to.equal('m-event-tool-1');
            expect(timeline.events[1]?.id).to.equal('m-event-tool-2');
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

        it('does not repeat the group verb in file detail rows', () => {
            const el = createMobileExecutionEventTimeline([
                toolSegment('Read', 'tool-1', JSON.stringify({ path: 'src/store.tsx' })),
            ]);

            const detailRow = el.querySelector<HTMLElement>('.theia-mobile-tool-detail');
            expect(detailRow).to.not.equal(null);
            expect(detailRow?.querySelector('.theia-mobile-tool-detail-label')).to.equal(null);
            expect(detailRow?.textContent).to.equal('store.tsx');
        });

        it('shows Read basenames from target_file / filePath / partial streaming args', () => {
            const el = createMobileExecutionEventTimeline([
                toolSegment('Read', 'tool-1', JSON.stringify({ target_file: 'packages/core/src/app.ts' })),
                toolSegment('Read', 'tool-2', JSON.stringify({ filePath: 'src/auth.ts', offset: 10, limit: 20 })),
                toolSegment('Read', 'tool-3', 'partial {"file_path":"mobile-projects-panel.ts"'),
            ]);
            const details = [...el.querySelectorAll('.theia-mobile-tool-detail-detail')].map(node => node.textContent);
            expect(details).to.deep.equal(['app.ts', 'auth.ts L10-29', 'mobile-projects-panel.ts']);
        });

        it('recovers Read file path from <path> in the tool result when args are empty', () => {
            const el = createMobileExecutionEventTimeline([
                toolSegment(
                    'Read',
                    'tool-1',
                    '{}',
                    true,
                    false,
                    '<path>/repo/src/store.tsx</path>\n<content>\n1: export {}\n</content>',
                ),
            ]);
            const detail = el.querySelector<HTMLElement>('.theia-mobile-tool-detail-detail');
            expect(detail?.textContent).to.equal('store.tsx');
            expect(detail?.dataset.qaapToolFilePath).to.equal('/repo/src/store.tsx');
        });

        it('never renders the bare tool name as a Read file detail', () => {
            const el = createMobileExecutionEventTimeline([
                toolSegment('Read', 'tool-1', '{}'),
            ]);
            const detail = el.querySelector<HTMLElement>('.theia-mobile-tool-detail-detail');
            expect(detail?.textContent).to.equal('file');
            expect(detail?.textContent).to.not.equal('Read');
        });

        it('shows Glob/Grep search patterns instead of repeating the tool name', () => {
            const el = createMobileExecutionEventTimeline([
                toolSegment('Glob', 'tool-1', JSON.stringify({ glob_pattern: '**/*.tsx' })),
                toolSegment('Grep', 'tool-2', JSON.stringify({ pattern: 'extractToolDetail' })),
            ]);
            const details = [...el.querySelectorAll('.theia-mobile-tool-detail-detail')].map(node => node.textContent);
            expect(details).to.deep.equal(['**/*.tsx', 'extractToolDetail']);
        });

        it('skips trivial Glob ** patterns and shows the search path instead', () => {
            const el = createMobileExecutionEventTimeline([
                toolSegment('Glob', 'tool-1', JSON.stringify({ pattern: '**', path: 'packages/qaap-mobile-shell/src/browser' })),
            ]);
            const detail = el.querySelector('.theia-mobile-tool-detail-detail');
            expect(detail?.textContent).to.equal('packages/qaap-mobile-shell/src/browser');
            expect(detail?.textContent).to.not.equal('**');
        });

        it('shows Task/Agent descriptions instead of the bare tool name', () => {
            const taskEl = createMobileExecutionEventTimeline([
                toolSegment('Task', 'tool-1', JSON.stringify({ description: 'Find the auth bug' })),
            ]);
            const agentEl = createMobileExecutionEventTimeline([
                toolSegment('Agent', 'tool-2', JSON.stringify({ prompt: 'Explore the mobile shell package' })),
            ]);
            expect(taskEl.querySelector('.theia-mobile-tool-detail-detail')?.textContent).to.equal('Find the auth bug');
            expect(taskEl.querySelector('.theia-mobile-tool-group-verb')?.textContent).to.equal('Task');
            expect(agentEl.querySelector('.theia-mobile-tool-detail-detail')?.textContent).to.equal('Explore the mobile shell package');
            expect(agentEl.querySelector('.theia-mobile-tool-group-verb')?.textContent).to.equal('Agent');
        });

        it('renders non-deleted file details as links with the full file path', () => {
            const el = createMobileExecutionEventTimeline([
                toolSegment('Read', 'tool-1', JSON.stringify({ path: 'src/store.tsx' })),
            ]);
            const link = el.querySelector<HTMLElement>('.theia-mobile-tool-detail-detail');
            const opened: string[] = [];
            el.addEventListener('qaap-mobile-tool-file-open', event => {
                opened.push((event as CustomEvent<{ readonly filePath: string }>).detail.filePath);
            });

            expect(link?.classList.contains('theia-mod-file-link')).to.equal(true);
            expect(link?.getAttribute('role')).to.equal('link');
            expect(link?.dataset.qaapToolFilePath).to.equal('src/store.tsx');
            link?.click();
            expect(opened).to.deep.equal(['src/store.tsx']);
        });

        it('does not make deleted file details clickable', () => {
            const el = createMobileExecutionEventTimeline([
                toolSegment('rm', 'tool-1', JSON.stringify({ path: 'src/old.ts' })),
            ]);
            const detail = el.querySelector<HTMLElement>('.theia-mobile-tool-detail-detail');

            expect(detail?.textContent).to.equal('old.ts');
            expect(detail?.classList.contains('theia-mod-file-link')).to.equal(false);
            expect(detail?.getAttribute('role')).to.equal(null);
        });

        it('does not repeat the group verb in terminal detail cards', () => {
            const el = createMobileExecutionEventTimeline([
                toolSegment('Bash', 'tool-1', JSON.stringify({ command: 'npm run test' }), true, false, 'ok\n'),
            ]);

            const terminal = el.querySelector<HTMLElement>('.theia-mobile-terminal-output');
            expect(terminal).to.not.equal(null);
            expect(terminal?.querySelector('.theia-mobile-terminal-output-label')).to.equal(null);
            expect(terminal?.querySelector('.theia-mobile-terminal-output-detail')?.textContent).to.equal('npm run test');
            expect(terminal?.querySelector('.theia-mobile-terminal-output-detail .theia-mobile-agent-token.theia-mod-keyword')?.textContent).to.equal('npm');
        });

        it('terminal detail renders full command text without truncation (no ellipsis)', () => {
            const longCommand = 'ls -F openwiki/projects/some/very/deeply/nested/directory/structure/that/is/quite/long';
            const el = createMobileExecutionEventTimeline([
                toolSegment('Bash', 'tool-1', JSON.stringify({ command: longCommand }), true, false, 'done\n'),
            ]);

            const detail = el.querySelector<HTMLElement>('.theia-mobile-terminal-output-detail');
            expect(detail).to.not.equal(null);
            // Full text must be present in the DOM — no truncation at the data level
            expect(detail?.textContent).to.equal(longCommand);
            // The summary must exist and contain the detail as a child
            const summary = el.querySelector<HTMLElement>('.theia-mobile-terminal-output-summary');
            expect(summary?.contains(detail!)).to.equal(true);
        });

        it('marks active tool group header text for shimmer while running', () => {
            const el = createMobileExecutionEventTimeline([
                toolSegment('Read', 'tool-1', JSON.stringify({ path: 'src/store.tsx' }), false),
            ]);

            const group = el.querySelector<HTMLElement>('.theia-mobile-tool-group');
            expect(group?.classList.contains('running')).to.equal(true);
            expect(group?.querySelector('.theia-mobile-tool-group-verb')?.classList.contains('theia-mod-shimmer')).to.equal(true);
            expect(group?.querySelector('.theia-mobile-tool-group-meta')?.classList.contains('theia-mod-shimmer')).to.equal(true);
        });

        it('animates tool group kind icons while running and settles when finished', () => {
            const segmentsBody = document.createElement('div');
            segmentsBody.className = 'theia-mobile-agent-transcript-segments';
            const pending = [
                toolSegment('Edit', 'tool-edit', JSON.stringify({ path: 'a.ts' }), false),
                toolSegment('Write', 'tool-write', JSON.stringify({ path: 'b.ts' }), false),
                toolSegment('Grep', 'tool-search', JSON.stringify({ pattern: 'foo' }), false),
                toolSegment('Read', 'tool-read', JSON.stringify({ path: 'c.ts' }), false),
            ];
            segmentsBody.append(createMobileExecutionEventTimeline(pending));

            const icons = Array.from(segmentsBody.querySelectorAll<HTMLElement>('.theia-mobile-tool-group-icon'));
            expect(icons.length).to.be.at.least(4);
            for (const icon of icons) {
                expect(icon.classList.contains('theia-mod-tool-motion')).to.equal(true);
            }
            expect(icons.some(icon => icon.classList.contains('theia-mod-tool-motion-edit'))).to.equal(true);
            expect(icons.some(icon => icon.classList.contains('theia-mod-tool-motion-write'))).to.equal(true);
            expect(icons.some(icon => icon.classList.contains('theia-mod-tool-motion-search'))).to.equal(true);
            expect(icons.some(icon => icon.classList.contains('theia-mod-tool-motion-read'))).to.equal(true);

            refreshMobileExecutionEventTimeline(segmentsBody, [
                toolSegment('Edit', 'tool-edit', JSON.stringify({ path: 'a.ts' }), true),
                toolSegment('Write', 'tool-write', JSON.stringify({ path: 'b.ts' }), true),
                toolSegment('Grep', 'tool-search', JSON.stringify({ pattern: 'foo' }), true),
                toolSegment('Read', 'tool-read', JSON.stringify({ path: 'c.ts' }), true),
            ]);
            const settled = segmentsBody.querySelectorAll<HTMLElement>('.theia-mobile-tool-group-icon');
            for (const icon of Array.from(settled)) {
                expect(icon.classList.contains('theia-mod-tool-motion')).to.equal(false);
            }
        });

        it('renders log terminal output as highlighted code view and strips ANSI escape sequences', () => {
            const rawOutput = '\u001b[32mPASS\u001b[0m src/foo.test.ts 12ms';
            const el = createMobileExecutionEventTimeline([
                toolSegment('Bash', 'tool-1', JSON.stringify({ command: 'echo' }), true, false, rawOutput),
            ]);

            // Terminal output code view is built lazily on first open (collapsed
            // by default) -- expand it before asserting on its content.
            const terminal = el.querySelector<HTMLDetailsElement>('.theia-mobile-terminal-output');
            terminal!.open = true;
            // Use the jsdom window's Event constructor — Node's own global
            // `Event` class produces an object jsdom's dispatchEvent rejects.
            terminal!.dispatchEvent(new window.Event('toggle'));

            const codeView = el.querySelector<HTMLElement>('.theia-mobile-terminal-output-code-view.theia-mod-log');
            expect(codeView).to.not.equal(null);
            // ANSI CSI and OSC sequences must be removed
            expect(codeView?.textContent).to.include('PASS');
            expect(codeView?.textContent).to.include('src/foo.test.ts');
            expect(codeView?.textContent).to.not.include('\u001b');
            expect(codeView?.querySelector('.theia-mobile-agent-token.theia-mod-keyword')?.textContent).to.equal('PASS');
            expect(codeView?.querySelector('.theia-mobile-agent-token.theia-mod-path')?.textContent).to.equal('src/foo.test.ts');
        });

        it('renders verification JSON output with highlighted code view when expanded', () => {
            const el = createMobileExecutionEventTimeline([
                toolSegment(
                    'Bash',
                    'tool-1',
                    JSON.stringify({ command: 'cat package.json | grep -A 20 "\\"scripts\\""' }),
                    true,
                    false,
                    '"scripts": {\n  "dev": "pnpm dev",\n  "typecheck": "tsc"\n}',
                ),
            ]);

            const terminal = el.querySelector<HTMLDetailsElement>('.theia-mobile-terminal-output');
            terminal!.open = true;
            terminal!.dispatchEvent(new window.Event('toggle'));

            const codeView = el.querySelector<HTMLElement>('.theia-mobile-terminal-output-code-view.theia-mod-json');
            expect(codeView).to.not.equal(null);
            expect(codeView?.querySelector('.theia-mobile-agent-token.theia-mod-key')?.textContent).to.equal('"scripts"');
            expect(el.querySelector('.theia-mobile-terminal-output-pre')).to.equal(null);
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

        it('removes tool group header shimmer when a running tool finishes', () => {
            const segmentsBody = document.createElement('div');
            segmentsBody.className = 'theia-mobile-agent-transcript-segments';
            const pending = [toolSegment('Read', 'tool-1', JSON.stringify({ path: 'src/store.tsx' }), false)];
            const timeline = createMobileExecutionEventTimeline(pending);
            segmentsBody.append(timeline);
            const pendingGroup = timeline.querySelector<HTMLElement>('.theia-mobile-tool-group');
            expect(pendingGroup?.querySelector('.theia-mobile-tool-group-verb')?.classList.contains('theia-mod-shimmer')).to.equal(true);

            refreshMobileExecutionEventTimeline(segmentsBody, [
                toolSegment('Read', 'tool-1', JSON.stringify({ path: 'src/store.tsx' }), true),
            ]);

            const finishedGroup = segmentsBody.querySelector<HTMLElement>('.theia-mobile-tool-group');
            expect(finishedGroup?.classList.contains('finished')).to.equal(true);
            expect(finishedGroup?.querySelector('.theia-mobile-tool-group-verb')?.classList.contains('theia-mod-shimmer')).to.equal(false);
            expect(finishedGroup?.querySelector('.theia-mobile-tool-group-meta')?.classList.contains('theia-mod-shimmer')).to.equal(false);
        });

        it('patches run→verification kind flips in place without rebuilding the timeline node', () => {
            const segmentsBody = document.createElement('div');
            segmentsBody.className = 'theia-mobile-agent-transcript-segments';
            const pending = [toolSegment('Bash', 'tool-1', JSON.stringify({ command: 'npm run' }), false)];
            const timeline = createMobileExecutionEventTimeline(pending);
            segmentsBody.append(timeline);
            const beforeNode = segmentsBody.querySelector(`.${MOBILE_EXECUTION_TIMELINE_CLASS}`);

            const after = refreshMobileExecutionEventTimeline(segmentsBody, [
                toolSegment('Bash', 'tool-1', JSON.stringify({ command: 'npm run test' }), false),
            ]);

            expect(after).to.equal(beforeNode);
            expect(after.querySelector('.theia-mobile-tool-group')?.classList.contains('running')).to.equal(true);
        });

        it('preserves web-search group class across streaming patches', () => {
            const segmentsBody = document.createElement('div');
            segmentsBody.className = 'theia-mobile-agent-transcript-segments';
            const pending = [toolSegment('WebSearch', 'tool-1', JSON.stringify({ query: 'qaap' }), false)];
            const timeline = createMobileExecutionEventTimeline(pending);
            segmentsBody.append(timeline);
            expect(timeline.querySelector('.theia-mobile-tool-group')?.classList.contains('theia-mod-web-search')).to.equal(true);

            refreshMobileExecutionEventTimeline(segmentsBody, [
                toolSegment('WebSearch', 'tool-1', JSON.stringify({ query: 'qaap timeline' }), false),
            ]);

            expect(segmentsBody.querySelector('.theia-mobile-tool-group')?.classList.contains('theia-mod-web-search')).to.equal(true);
        });

    });

    describe('createMobileDiffSummaryElement', () => {

        it('renders the localized plural header without aggregate stats', () => {
            const el = createMobileDiffSummaryElement(3, 1, 1, 1, [
                { name: 'a.ts', type: 'add', added: 10 },
                { name: 'b.ts', type: 'modify', added: 4, removed: 2 },
                { name: 'c.ts', type: 'delete', removed: 8 },
            ]);

            expect(el.classList.contains('theia-mobile-diff-summary')).to.equal(true);
            expect(el.querySelector('.theia-mobile-diff-summary-title')?.textContent).to.equal('3 Files Changed');
            expect(el.querySelector('.theia-mobile-diff-summary-header .theia-mobile-diff-summary-stat')).to.equal(null);
            expect(el.querySelectorAll('.theia-mobile-diff-summary-file').length).to.equal(3);
        });

        it('renders the localized singular header', () => {
            const el = createMobileDiffSummaryElement(1, 0, 1, 0, [
                { name: 'only.ts', type: 'modify' },
            ]);
            expect(el.querySelector('.theia-mobile-diff-summary-title')?.textContent).to.equal('1 File Changed');
        });

        it('renders an actionable localized Review control when provided', () => {
            let reviewed = false;
            const el = createMobileDiffSummaryElement(1, 0, 1, 0, [
                { name: 'only.ts', type: 'modify' },
            ], () => reviewed = true);

            const review = el.querySelector<HTMLButtonElement>('.theia-mobile-diff-summary-review');
            expect(review?.textContent).to.equal('Review');
            expect(review?.type).to.equal('button');
            review?.click();
            expect(reviewed).to.equal(true);
        });

        it('aligns real per-file stats in the tail and omits redundant status', () => {
            const el = createMobileDiffSummaryElement(2, 1, 1, 0, [
                { name: 'added.ts', type: 'add', added: 67, removed: 0 },
                { name: 'edited.ts', type: 'modify', added: 130, removed: 21 },
            ]);
            const tails = el.querySelectorAll('.theia-mobile-diff-summary-file-tail');

            expect(tails[0]?.textContent).to.equal('+67');
            expect(tails[1]?.textContent).to.equal('+130−21');
            expect(tails[0]?.querySelector('.theia-mobile-diff-summary-file-stat.theia-mod-added')?.textContent)
                .to.equal('+67');
            expect(tails[1]?.querySelector('.theia-mobile-diff-summary-file-stat.theia-mod-added')?.textContent)
                .to.equal('+130');
            expect(tails[1]?.querySelector('.theia-mobile-diff-summary-file-stat.theia-mod-deleted')?.textContent)
                .to.equal('−21');
            expect(el.querySelector('.theia-mobile-diff-summary-file-type')).to.equal(null);
        });

        it('renders language badges and a right-aligned Review control for the files card', () => {
            expect(resolveMobileDiffFileLanguageBadge('qaap-execution-event-timeline.ts')).to.equal('TS');
            expect(resolveMobileDiffFileLanguageBadge('mobile-workbench.css')).to.equal('#');

            const el = createMobileDiffSummaryElement(2, 0, 2, 0, [
                { name: 'qaap-execution-event-timeline.ts', type: 'modify', added: 36 },
                { name: 'mobile-workbench.css', type: 'modify', added: 10, removed: 1 },
            ], () => undefined);

            expect(el.classList.contains('theia-mod-files')).to.equal(true);
            const badges = [...el.querySelectorAll('.theia-mobile-diff-summary-file-badge')]
                .map(node => node.textContent);
            expect(badges).to.deep.equal(['TS', '#']);
            expect(el.querySelector('.theia-mobile-diff-summary-header .theia-mobile-diff-summary-review')?.textContent)
                .to.equal('Review');
            expect(el.querySelector('.theia-mobile-diff-summary-file-icon')).to.equal(null);
        });

        it('uses a discreet file status only when stats are unavailable', () => {
            const el = createMobileDiffSummaryElement(1, 0, 1, 0, [
                { name: 'unknown.ts', type: 'modify' },
            ]);

            expect(el.querySelector('.theia-mobile-diff-summary-file-stat')).to.equal(null);
            expect(el.querySelector('.theia-mobile-diff-summary-file-type')?.textContent).to.equal('modified');
        });

        it('preserves a long filename for tooltip while allowing CSS ellipsis', () => {
            const longName = 'an-extremely-long-filename-that-must-not-expand-the-summary-card.ts';
            const el = createMobileDiffSummaryElement(1, 0, 1, 0, [
                { name: longName, type: 'modify', added: 2 },
            ]);
            const name = el.querySelector<HTMLElement>('.theia-mobile-diff-summary-file-name');

            expect(name?.textContent).to.equal(longName);
            expect(name?.title).to.equal(longName);
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
            expect(el.querySelector('.theia-mobile-diff-summary-stat.theia-mod-deleted')?.textContent).to.equal('−12');
        });

        it('omits the added stat when linesAdded is zero', () => {
            const el = createMobileLineDiffSummaryElement(0, 5);
            expect(el.querySelector('.theia-mobile-diff-summary-stat.theia-mod-added')).to.equal(null);
            expect(el.querySelector('.theia-mobile-diff-summary-stat.theia-mod-deleted')?.textContent).to.equal('−5');
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

        it('keeps the ThinkingOrb in the header while the agent is working', () => {
            const segments = [toolSegment('read', 't1', '{}', false)];
            const accordion = createMobileProcessAccordion(segments, {
                isWorking: true, isError: false, elapsedMs: 21_000, activityVerb: 'Read',
            });
            const header = accordion.querySelector('.theia-mobile-process-accordion-header');
            const logo = header?.querySelector('.theia-mobile-process-accordion-logo.qaap-thinking-orb-indicator');
            expect(logo).to.not.equal(null);
            expect(header?.firstElementChild).to.equal(logo);

            syncMobileProcessAccordionState(accordion, {
                isWorking: true, isError: false, elapsedMs: 22_000, activityVerb: 'Read',
            });
            expect(header?.querySelector('.theia-mobile-process-accordion-logo')).to.equal(logo);

            syncMobileProcessAccordionState(accordion, { isWorking: false, isError: false, settled: true, elapsedMs: 22_000 });
            expect(header?.querySelector('.theia-mobile-process-accordion-logo')).to.equal(null);
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

        it('shows the "<Verb>… Xs" label when working with a known activityVerb', () => {
            const segments = [toolSegment('read', 't1', '{}', false)];
            const accordion = createMobileProcessAccordion(
                segments, { isWorking: true, isError: false, elapsedMs: 45000, activityVerb: 'Read' },
            );
            const label = accordion.querySelector('.theia-mobile-process-accordion-label');
            expect(label?.textContent).to.equal('Read… 45s');
        });

        it('falls back to the generic "Processing… Xs" label when no activityVerb is given', () => {
            const segments = [toolSegment('read', 't1', '{}', false)];
            const accordion = createMobileProcessAccordion(segments, { isWorking: true, isError: false, elapsedMs: 45000 });
            const label = accordion.querySelector('.theia-mobile-process-accordion-label');
            expect(label?.textContent).to.equal('Processing… 45s');
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

        it('shows "Stopped after Xs" label and theia-mod-cancelled class when the user stopped the turn', () => {
            const segments = [toolSegment('read', 't1', '{}', true)];
            const accordion = createMobileProcessAccordion(
                segments, { isWorking: false, isError: false, isCancelled: true, elapsedMs: 15000 },
            );
            const label = accordion.querySelector('.theia-mobile-process-accordion-label');
            expect(label?.textContent).to.equal('Stopped after 15s');
            expect(accordion.classList.contains('theia-mod-cancelled')).to.be.true;
            expect(accordion.classList.contains('theia-mod-error')).to.be.false;
            expect(accordion.classList.contains('theia-mod-complete')).to.be.false;
        });

        it('shows "Stopped" label (no elapsed) when cancelled without a known duration', () => {
            const segments = [toolSegment('read', 't1', '{}', true)];
            const accordion = createMobileProcessAccordion(segments, { isWorking: false, isError: false, isCancelled: true });
            const label = accordion.querySelector('.theia-mobile-process-accordion-label');
            expect(label?.textContent).to.equal('Stopped');
        });

        it('shows "Failed after Xs" label when the turn ended in error', () => {
            const segments = [toolSegment('read', 't1', '{}', true)];
            const accordion = createMobileProcessAccordion(segments, { isWorking: false, isError: true, elapsedMs: 147000 });
            const label = accordion.querySelector('.theia-mobile-process-accordion-label');
            expect(label?.textContent).to.equal('Failed after 2m 27s');
        });

        it('is open when cancelled, and stays open on a settled sync (leaves evidence visible)', () => {
            const segments = [toolSegment('read', 't1', '{}', true)];
            const accordion = createMobileProcessAccordion(segments, { isWorking: false, isError: false, isCancelled: true });
            expect((accordion as HTMLDetailsElement).open).to.be.true;
            syncMobileProcessAccordionState(accordion, { isWorking: false, isError: false, isCancelled: true, settled: true });
            expect((accordion as HTMLDetailsElement).open).to.be.true;
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

        it('collapses a settled rebuild immediately instead of inheriting mid-stream open state', () => {
            const segments = [toolSegment('read', 't1', '{}', true)];
            // Streaming render: accordion opens and records sticky state for the turn.
            const streaming = createMobileProcessAccordion(segments, { isWorking: true, isError: false, turnStartMs: 987654321 }) as HTMLDetailsElement;
            expect(streaming.open).to.be.true;
            // A transient non-working rebuild is not enough to collapse.
            const paused = createMobileProcessAccordion(segments, { isWorking: false, isError: false, turnStartMs: 987654321 }) as HTMLDetailsElement;
            expect(paused.open).to.be.true;
            // Settle arrives as a full rebuild: the final response is committed,
            // so the new element must collapse without waiting for a timer.
            const rebuilt = createMobileProcessAccordion(segments, { isWorking: false, isError: false, turnStartMs: 987654321, settled: true }) as HTMLDetailsElement;
            expect(rebuilt.open).to.be.false;
        });

        it('preserves open state across a non-settled rebuild during a quiet pause between tools', () => {
            const segments = [toolSegment('read', 't1', '{}', true)];
            const streaming = createMobileProcessAccordion(segments, { isWorking: true, isError: false, turnStartMs: 987654322 }) as HTMLDetailsElement;
            expect(streaming.open).to.be.true;
            const rebuilt = createMobileProcessAccordion(segments, { isWorking: false, isError: false, turnStartMs: 987654322 }) as HTMLDetailsElement;
            expect(rebuilt.open).to.be.true;
        });

        it('stays open on a working rebuild even if sticky state was poisoned closed by detach', () => {
            const segments = [toolSegment('read', 't1', '{}', true)];
            const streaming = createMobileProcessAccordion(segments, {
                isWorking: true,
                isError: false,
                turnStartMs: 987654323,
            }) as HTMLDetailsElement;
            expect(streaming.open).to.be.true;
            // Simulate browser detach: open details removed from DOM can fire
            // toggle(open=false) while disconnected and used to poison sticky state.
            streaming.open = false;
            streaming.dispatchEvent(new window.Event('toggle'));
            const rebuilt = createMobileProcessAccordion(segments, {
                isWorking: true,
                isError: false,
                turnStartMs: 987654323,
            }) as HTMLDetailsElement;
            expect(rebuilt.open).to.be.true;
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

        it('collapses on final successful settle even after the user manually expanded it', () => {
            const segments = [toolSegment('read', 't1', '{}', true)];
            const accordion = createMobileProcessAccordion(segments, { isWorking: true, isError: false });
            accordion.setAttribute('data-user-toggled', '1');
            (accordion as HTMLDetailsElement).open = true;
            syncMobileProcessAccordionState(accordion, { isWorking: false, isError: false, settled: true });
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

        it('shows the live verb label on a sync while working', () => {
            const segments = [toolSegment('read', 't1', '{}', false)];
            const accordion = createMobileProcessAccordion(segments, { isWorking: true, isError: false, elapsedMs: 5000 });
            syncMobileProcessAccordionState(accordion, { isWorking: true, isError: false, elapsedMs: 8000, activityVerb: 'Explore' });
            const label = accordion.querySelector('.theia-mobile-process-accordion-label');
            expect(label?.textContent).to.equal('Explore… 8s');
        });

    });

    describe('resolveMobileActivityVerb', () => {

        it('returns the verb of the last event that still has pending tools', () => {
            const segments = [
                toolSegment('read', 't1', '{}', true),
                textSegment('Now building the project.'),
                toolSegment('bash', 't2', '{"command":"npm run build"}', false),
            ];
            const { events } = buildMobileExecutionEvents(segments);
            expect(resolveMobileActivityVerb(events)).to.equal('Run');
        });

        it('returns undefined when nothing is pending', () => {
            const segments = [toolSegment('read', 't1', '{}', true)];
            const { events } = buildMobileExecutionEvents(segments);
            expect(resolveMobileActivityVerb(events)).to.be.undefined;
        });

        it('returns undefined for an empty event list', () => {
            expect(resolveMobileActivityVerb([])).to.be.undefined;
        });

    });

    describe('createMobileClosingErrorCardElement', () => {

        it('renders the icon and message without a retry button by default', () => {
            const card = createMobileClosingErrorCardElement('Something went wrong');
            expect(card.classList.contains(MOBILE_CLOSING_ERROR_CARD_CLASS)).to.be.true;
            expect(card.querySelector('.theia-mobile-closing-error-card-message')?.textContent).to.equal('Something went wrong');
            expect(card.querySelector('.theia-mobile-closing-error-card-retry')).to.equal(null);
        });

        it('renders a Retry button when onRetry is provided', () => {
            const card = createMobileClosingErrorCardElement('Boom', () => { /* noop */ });
            const retryBtn = card.querySelector<HTMLButtonElement>('.theia-mobile-closing-error-card-retry');
            expect(retryBtn).to.not.equal(null);
            expect(retryBtn?.textContent).to.equal('Retry');
        });

        it('calls onRetry exactly once and disables the button after click', () => {
            let calls = 0;
            const card = createMobileClosingErrorCardElement('Boom', () => { calls++; });
            const retryBtn = card.querySelector<HTMLButtonElement>('.theia-mobile-closing-error-card-retry')!;
            retryBtn.click();
            retryBtn.click();
            expect(calls).to.equal(1);
            expect(retryBtn.disabled).to.be.true;
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

    // ─── Open-state persistence across virtual-list rematerialization ────────
    // Long transcripts virtualize: a row scrolled out of view is fully
    // removed (`row.remove()`), and scrolling back builds a brand-new row
    // from scratch — a fresh `createMobileExecutionEventTimeline` call with
    // no relationship to the previous DOM. These tests simulate that by
    // creating a second, independent timeline from the same segments and
    // checking that a manually-opened terminal card / tool group is still
    // open (and, for the terminal, that its content is already rendered).

    describe('global open-state persistence across virtual-list rematerialization', () => {

        it('restores a user-opened terminal card, with its output already rendered, in a freshly created timeline', () => {
            const segments = [
                toolSegment('Bash', 'persist-terminal-1', JSON.stringify({ command: 'echo hi' }), true, false, 'hello output'),
            ];

            // First mount: user expands the terminal card.
            const first = createMobileExecutionEventTimeline(segments);
            const terminal = first.querySelector<HTMLDetailsElement>('.theia-mobile-terminal-output');
            terminal!.open = true;
            // Use the jsdom window's Event constructor — see the note in the
            // ANSI-stripping test above.
            terminal!.dispatchEvent(new window.Event('toggle'));

            // Simulate the virtual list dropping the row entirely (scrolled
            // out of view) and rebuilding it from scratch on scroll-back: a
            // brand new element tree, unrelated to `first`.
            const second = createMobileExecutionEventTimeline(segments);
            const restoredTerminal = second.querySelector<HTMLDetailsElement>('.theia-mobile-terminal-output');
            expect(restoredTerminal).to.not.equal(null);
            expect(restoredTerminal?.open).to.equal(true);
            // The lazy code view must be rendered eagerly at creation time, since
            // a programmatic `open = true` never fires the lazy first-open
            // 'toggle' handler.
            const output = restoredTerminal?.querySelector('.theia-mobile-terminal-output-code-view');
            expect(output).to.not.equal(null);
            expect(output?.textContent).to.include('hello output');
        });

        it('restores a user-opened tool group in a freshly created timeline', () => {
            const segments = [
                toolSegment('Read', 'persist-group-1', JSON.stringify({ path: 'a.ts' })),
            ];

            const first = createMobileExecutionEventTimeline(segments);
            const group = first.querySelector<HTMLDetailsElement>('.theia-mobile-tool-group');
            group!.open = true;
            group!.dispatchEvent(new window.Event('toggle'));

            const second = createMobileExecutionEventTimeline(segments);
            const restoredGroup = second.querySelector<HTMLDetailsElement>('.theia-mobile-tool-group');
            expect(restoredGroup).to.not.equal(null);
            expect(restoredGroup?.open).to.equal(true);
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
