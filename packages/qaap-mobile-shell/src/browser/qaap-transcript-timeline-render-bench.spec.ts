// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { Disposable } from '@theia/core/lib/common/disposable';
import * as markdownit from '@theia/core/shared/markdown-it';
import type { QaapAgentConversationDTO, QaapAgentMessageSegmentDTO } from '../common/qaap-agent-conversation-client';
import { resetTimelineDetailsOpenStateForTesting } from './qaap-execution-event-timeline';
import {
    enableTranscriptRenderMetrics,
    getTranscriptRenderMetricsSnapshot,
    resetTranscriptRenderMetrics,
} from '../common/qaap-transcript-render-metrics';
import {
    MobileProjectsTranscriptMessagesArtifactsUi,
    type TranscriptActivityTimelineOptions,
} from '../browser/mobile-projects-transcript-messages-artifacts-ui';
import { MobileProjectsTranscriptMessagesContentUi } from '../browser/mobile-projects-transcript-messages-content-ui';
import { MobileProjectsTranscriptMessagesResolversUi } from '../browser/mobile-projects-transcript-messages-resolvers-ui';
import { MobileProjectsTranscriptMessagesToolUi } from '../browser/mobile-projects-transcript-messages-tool-ui';
import type { MobileProjectsTranscriptMessagesHost } from '../browser/mobile-projects-transcript-messages-ui';

type TranscriptTimelineSyncHarness = {
    resolveTranscriptActivityItemsForDisplay(
        segments: readonly QaapAgentMessageSegmentDTO[],
        options?: TranscriptActivityTimelineOptions,
    ): readonly unknown[];
    syncTranscriptActivityTimelineElement(
        timeline: HTMLElement,
        items: readonly unknown[],
        options?: TranscriptActivityTimelineOptions,
    ): void;
};

describe('qaap-transcript-timeline-render-bench', () => {

    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    beforeEach(() => {
        // Several specs below reuse tool-use ids (e.g. 'tool-read-page') across
        // `it()` blocks. `timelineDetailsOpenState` in qaap-execution-event-timeline.ts
        // is a deliberately process-lifetime-scoped module global (see its doc
        // comment), so a prior test's `<details>.open = true` mutation can leak
        // a "user opened this" record forward — via an async `toggle` event —
        // into a later test that expects a freshly created tool group to be
        // collapsed by default. Reset it before every test in this file.
        resetTimelineDetailsOpenStateForTesting();
    });

    function buildToolSegments(count: number, runningIndex: number): QaapAgentMessageSegmentDTO[] {
        const segments: QaapAgentMessageSegmentDTO[] = [{ type: 'thinking', content: 'Planning…' }];
        for (let index = 0; index < count; index++) {
            const finished = index < runningIndex;
            segments.push({
                type: 'tool',
                name: 'Read',
                toolUseId: `tool-${index}`,
                args: JSON.stringify({ path: `src/file-${index}.ts` }),
                result: finished ? 'ok' : undefined,
                finished,
            });
        }
        return segments;
    }

    function createArtifactsUi(): MobileProjectsTranscriptMessagesArtifactsUi {
        const host = {
            transcriptLastConv: undefined,
            transcriptUserScrollPinDispose: Disposable.NULL,
            transcriptLiveUi: {
                refreshTranscriptApprovals: async () => undefined,
                hasPendingTranscriptToolApproval: () => false,
            },
            projectRowsUi: {
                localizeActivityLabel: (label: string) => label,
            },
            transcriptMarkdownIt: markdownit({ linkify: false }),
        } as unknown as MobileProjectsTranscriptMessagesHost;
        const contentUi = new MobileProjectsTranscriptMessagesContentUi(host as never);
        const resolversUi = new MobileProjectsTranscriptMessagesResolversUi(host as never, contentUi);
        const toolUi = new MobileProjectsTranscriptMessagesToolUi(host as never, contentUi, resolversUi);
        return new MobileProjectsTranscriptMessagesArtifactsUi(host, contentUi, resolversUi, toolUi);
    }

    function createStreamingRow(artifactsUi: MobileProjectsTranscriptMessagesArtifactsUi, segments: QaapAgentMessageSegmentDTO[]): HTMLElement {
        const conv = {
            id: 'conv-bench',
            cwd: '/tmp/bench',
            agentId: 'codex',
            status: 'streaming',
            updatedAt: Date.now(),
            messages: [{
                id: 'agent-1',
                role: 'agent',
                content: '',
                segments,
            }],
        } as QaapAgentConversationDTO;
        return artifactsUi.createTranscriptAgentSegmentsRow(segments, undefined, conv, { streaming: true });
    }

    function createCompletedConv(segments: QaapAgentMessageSegmentDTO[]): QaapAgentConversationDTO {
        return {
            id: 'conv-bench',
            title: 'Bench',
            cwd: '/tmp/bench',
            agentId: 'codex',
            status: 'idle',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: [{
                id: 'agent-1',
                role: 'agent',
                content: '',
                segments,
            }],
        } as QaapAgentConversationDTO;
    }

    function createConvWithStatus(
        segments: QaapAgentMessageSegmentDTO[],
        status: QaapAgentConversationDTO['status'],
    ): QaapAgentConversationDTO {
        return {
            id: `conv-${status}`,
            title: 'Bench',
            cwd: '/tmp/bench',
            agentId: 'codex',
            status,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: [{
                id: 'agent-1',
                role: 'agent',
                content: '',
                segments,
                createdAt: Date.now(),
            }],
        } as QaapAgentConversationDTO;
    }

    it('folds short process prose into the Lobe-style workflow and keeps the final answer visible', () => {
        const artifactsUi = createArtifactsUi();
        const segments: QaapAgentMessageSegmentDTO[] = [
            { type: 'thinking', content: 'Need to review the pull request.' },
            {
                type: 'tool',
                name: 'Read',
                toolUseId: 'tool-read-1',
                args: JSON.stringify({ path: 'package.json' }),
                result: 'ok',
                finished: true,
            },
            { type: 'text', content: 'Let me check the recent commits and PR details.' },
            {
                type: 'tool',
                name: 'Read',
                toolUseId: 'tool-read-2',
                args: JSON.stringify({ path: 'src/app.ts' }),
                result: 'ok',
                finished: true,
            },
            { type: 'text', content: 'Let me read the key changed files to review the actual code changes.' },
            { type: 'text', content: 'PR Review: Fix critical bugs\n\nSummary\nThis PR changes the transcript rendering.' },
        ];
        const row = artifactsUi.createTranscriptAgentSegmentsRow(segments, undefined, createCompletedConv(segments));
        const visibleText = [...row.querySelectorAll<HTMLElement>('.theia-mobile-agent-transcript-content')]
            .map(element => element.textContent?.trim())
            .filter(Boolean)
            .join('\n');

        expect(visibleText).to.not.include('Let me check');
        expect(visibleText).to.not.include('Let me read');
        expect(visibleText).to.include('PR Review: Fix critical bugs');
    });

    it('skips execution event timeline DOM work during duplicate SSE frames', () => {
        enableTranscriptRenderMetrics(true);
        resetTranscriptRenderMetrics();
        const artifactsUi = createArtifactsUi();
        const row = createStreamingRow(artifactsUi, buildToolSegments(52, 40));
        for (let tick = 0; tick < 120; tick++) {
            const segments = buildToolSegments(52, 40);
            artifactsUi.patchStreamingActivityTimeline(row, segments);
        }
        const metrics = getTranscriptRenderMetricsSnapshot();
        expect(metrics.timeline_event_sync_skipped).to.equal(120);
        expect(metrics.timeline_event_patch).to.equal(0);
        expect(metrics.timeline_event_rebuild).to.equal(0);
    });

    it('patches the execution event timeline when tool state advances', () => {
        enableTranscriptRenderMetrics(true);
        resetTranscriptRenderMetrics();
        const artifactsUi = createArtifactsUi();
        const row = createStreamingRow(artifactsUi, buildToolSegments(52, 40));
        for (let tick = 0; tick < 12; tick++) {
            const runningIndex = 40 + tick + 1;
            artifactsUi.patchStreamingActivityTimeline(row, buildToolSegments(52, runningIndex));
        }
        const metrics = getTranscriptRenderMetricsSnapshot();
        expect(metrics.timeline_event_patch).to.be.greaterThan(0);
        expect(metrics.timeline_event_rebuild).to.equal(0);
    });

    it('patches timeline under ~250ms for 50 growing tool segments', () => {
        const artifactsUi = createArtifactsUi();
        let row = createStreamingRow(artifactsUi, buildToolSegments(1, 0));
        const start = performance.now();
        for (let count = 1; count <= 50; count++) {
            const segments = buildToolSegments(count, count - 1);
            artifactsUi.patchStreamingActivityTimeline(row, segments);
        }
        const elapsedMs = performance.now() - start;
        expect(elapsedMs).to.be.below(250);
    });

    it('syncs changed activity timeline items without reconstructing the whole list', () => {
        enableTranscriptRenderMetrics(true);
        resetTranscriptRenderMetrics();
        const artifactsUi = createArtifactsUi();
        const harness = artifactsUi as unknown as TranscriptTimelineSyncHarness;
        const initialSegments: QaapAgentMessageSegmentDTO[] = [
            {
                type: 'tool',
                name: 'Read',
                toolUseId: 'tool-read-package',
                args: JSON.stringify({ path: 'package.json' }),
                result: 'ok',
                finished: true,
            },
            {
                type: 'tool',
                name: 'Bash',
                toolUseId: 'tool-test',
                args: JSON.stringify({ command: 'npm test' }),
                result: undefined,
                finished: false,
            },
            {
                type: 'tool',
                name: 'Read',
                toolUseId: 'tool-read-src',
                args: JSON.stringify({ path: 'src/app.ts' }),
                result: 'ok',
                finished: true,
            },
        ];
        const timeline = artifactsUi.createTranscriptActivityTimeline(initialSegments, {
            streaming: true,
            segments: initialSegments,
        });
        expect(timeline).to.not.equal(undefined);

        const initialItems = harness.resolveTranscriptActivityItemsForDisplay(initialSegments, { streaming: true });
        harness.syncTranscriptActivityTimelineElement(timeline!, initialItems, {
            streaming: true,
            segments: initialSegments,
            cursorTrace: true,
        });
        const listBefore = timeline!.querySelector<HTMLOListElement>('.theia-mobile-agent-activity-list');
        const rowsBefore = [...listBefore!.querySelectorAll<HTMLElement>(':scope > li')];
        expect(rowsBefore.length).to.be.greaterThan(1);

        resetTranscriptRenderMetrics();
        const patchedSegments: QaapAgentMessageSegmentDTO[] = [
            initialSegments[0],
            {
                type: 'tool',
                name: 'Bash',
                toolUseId: 'tool-test',
                args: JSON.stringify({ command: 'npm test' }),
                result: 'passed',
                finished: true,
            },
            initialSegments[2],
        ];
        const patchedItems = harness.resolveTranscriptActivityItemsForDisplay(patchedSegments, { streaming: true });
        harness.syncTranscriptActivityTimelineElement(timeline!, patchedItems, {
            streaming: true,
            segments: patchedSegments,
            cursorTrace: true,
        });

        const metrics = getTranscriptRenderMetricsSnapshot();
        const listAfter = timeline!.querySelector<HTMLOListElement>('.theia-mobile-agent-activity-list');
        const rowsAfter = [...listAfter!.querySelectorAll<HTMLElement>(':scope > li')];
        expect(listAfter).to.equal(listBefore);
        expect(rowsAfter.length).to.equal(rowsBefore.length);
        rowsBefore.forEach((row, index) => expect(rowsAfter[index]).to.equal(row));
        expect(metrics.timeline_sync).to.equal(1);
        expect(metrics.timeline_item_sync_skipped + metrics.timeline_item_sync_light).to.be.greaterThan(0);
        expect(metrics.timeline_item_sync).to.be.lessThan(rowsAfter.length);
    });

    it('renders Codex-style execution event timeline with narrative and collapsed tool groups', () => {
        const artifactsUi = createArtifactsUi();
        const row = createStreamingRow(artifactsUi, [
            { type: 'thinking', content: 'Let me think about this step by step.' },
            {
                type: 'tool',
                name: 'Read',
                toolUseId: 'tool-read-page',
                args: JSON.stringify({ path: 'app/page.tsx' }),
                result: 'ok',
                finished: true,
            },
        ]);

        // The new Codex-style timeline should be present
        expect(row.querySelector('.theia-mobile-execution-timeline')).to.not.equal(null);
        // No old-style activity timeline elements
        expect(row.querySelector('.theia-mobile-agent-activity-timeline')).to.equal(null);
        expect(row.querySelector('.theia-mobile-agent-thought-brief')).to.equal(null);
        expect(row.querySelector('.theia-mobile-agent-technical-details')).to.equal(null);
        // Each event has a narrative and a collapsed tool group
        const events = row.querySelectorAll('.theia-mobile-execution-event');
        expect(events.length).to.be.greaterThan(0);
        const narrative = row.querySelector('.theia-mobile-execution-event-narrative');
        expect(narrative?.textContent).to.not.equal(null);
        const toolGroup = row.querySelector<HTMLDetailsElement>('.theia-mobile-tool-group');
        expect(toolGroup).to.not.equal(null);
        // Tool group is collapsed by default (Codex never auto-expands)
        expect(toolGroup?.open).to.equal(false);
        // The verb and meta are present
        expect(toolGroup?.querySelector('.theia-mobile-tool-group-verb')?.textContent).to.equal('Read');
        expect(toolGroup?.querySelector('.theia-mobile-tool-group-meta')?.textContent).to.equal('1 file');
    });

    it('rebuilds the execution event timeline across streaming patches preserving open state', () => {
        const artifactsUi = createArtifactsUi();
        const segmentsBefore: QaapAgentMessageSegmentDTO[] = [
            { type: 'thinking', content: 'Let me think about this step by step.' },
            {
                type: 'tool',
                name: 'Read',
                toolUseId: 'tool-read-page',
                args: JSON.stringify({ path: 'app/page.tsx' }),
                result: undefined,
                finished: false,
            },
        ];
        const row = createStreamingRow(artifactsUi, segmentsBefore);
        const toolGroupBefore = row.querySelector<HTMLDetailsElement>('.theia-mobile-tool-group');
        expect(toolGroupBefore).to.not.equal(null);
        // Expand the tool group to simulate user interaction
        toolGroupBefore!.open = true;

        // Patch with a changed segment (tool finished) to force a rebuild.
        const segmentsAfter: QaapAgentMessageSegmentDTO[] = [
            { type: 'thinking', content: 'Let me think about this step by step.' },
            {
                type: 'tool',
                name: 'Read',
                toolUseId: 'tool-read-page',
                args: JSON.stringify({ path: 'app/page.tsx' }),
                result: 'ok',
                finished: true,
            },
        ];
        artifactsUi.patchStreamingActivityTimeline(row, segmentsAfter);
        const toolGroupAfter = row.querySelector<HTMLDetailsElement>('.theia-mobile-tool-group');
        expect(toolGroupAfter).to.not.equal(null);
        // The open state should be preserved across the rebuild
        expect(toolGroupAfter?.open).to.equal(true);
    });

    it('respects user collapse of tool groups across streaming patches', () => {
        const artifactsUi = createArtifactsUi();
        const initialSegments: QaapAgentMessageSegmentDTO[] = [
            { type: 'thinking', content: 'Planning the work.' },
            {
                type: 'tool',
                name: 'Read',
                toolUseId: 'tool-read-page',
                args: JSON.stringify({ path: 'app/page.tsx' }),
                result: undefined,
                finished: false,
            },
        ];
        const row = createStreamingRow(artifactsUi, initialSegments);
        const toolGroup = row.querySelector<HTMLDetailsElement>('.theia-mobile-tool-group');
        expect(toolGroup).to.not.equal(null);
        // Default is collapsed
        expect(toolGroup?.open).to.equal(false);

        // Patch with changed content — the tool group should stay collapsed
        const patchedSegments: QaapAgentMessageSegmentDTO[] = [
            { type: 'thinking', content: 'Planning the work. Now let me read the file.' },
            {
                type: 'tool',
                name: 'Read',
                toolUseId: 'tool-read-page',
                args: JSON.stringify({ path: 'app/page.tsx' }),
                result: 'ok',
                finished: true,
            },
        ];
        artifactsUi.patchStreamingActivityTimeline(row, patchedSegments);
        const toolGroupAfterPatch = row.querySelector<HTMLDetailsElement>('.theia-mobile-tool-group');
        expect(toolGroupAfterPatch?.open).to.equal(false);
    });

    it('keeps tool groups collapsed by default during streaming', () => {
        const artifactsUi = createArtifactsUi();
        const initialSegments: QaapAgentMessageSegmentDTO[] = [
            { type: 'thinking', content: 'Planning the work.' },
            {
                type: 'tool',
                name: 'Read',
                toolUseId: 'tool-read-page',
                args: JSON.stringify({ path: 'app/page.tsx' }),
                result: undefined,
                finished: false,
            },
        ];
        const row = createStreamingRow(artifactsUi, initialSegments);
        const toolGroup = row.querySelector<HTMLDetailsElement>('.theia-mobile-tool-group');
        expect(toolGroup).to.not.equal(null);
        expect(toolGroup?.open).to.equal(false);

        // Patch with the same segments — should stay collapsed
        artifactsUi.patchStreamingActivityTimeline(row, initialSegments);
        const toolGroupAfterPatch = row.querySelector<HTMLDetailsElement>('.theia-mobile-tool-group');
        expect(toolGroupAfterPatch?.open).to.equal(false);
    });

    it('rebuilds timeline when the model starts writing its final response', () => {
        const artifactsUi = createArtifactsUi();
        const initialSegments: QaapAgentMessageSegmentDTO[] = [
            { type: 'thinking', content: 'Planning the work.' },
            {
                type: 'tool',
                name: 'Read',
                toolUseId: 'tool-read-page',
                args: JSON.stringify({ path: 'app/page.tsx' }),
                result: 'ok',
                finished: true,
            },
        ];
        const row = createStreamingRow(artifactsUi, initialSegments);

        // Patch with a text segment — the timeline should rebuild and the
        // text should appear as a rich content block (the agent's answer).
        const writingSegments: QaapAgentMessageSegmentDTO[] = [
            { type: 'thinking', content: 'Planning the work.' },
            {
                type: 'tool',
                name: 'Read',
                toolUseId: 'tool-read-page',
                args: JSON.stringify({ path: 'app/page.tsx' }),
                result: 'ok',
                finished: true,
            },
            { type: 'text', content: 'I have read the file and I am now writing the final summary for the user.' },
        ];
        artifactsUi.appendStreamingAgentTextSegment(row, writingSegments);
        // The timeline should still be present
        expect(row.querySelector('.theia-mobile-execution-timeline')).to.not.equal(null);
        // The final answer text should be rendered as rich content
        const contentBlocks = row.querySelectorAll('.theia-mobile-agent-transcript-content');
        expect(contentBlocks.length).to.be.greaterThan(0);
    });

    it('keeps tool groups collapsed while tools are still acting after thinking', () => {
        const artifactsUi = createArtifactsUi();
        const initialSegments: QaapAgentMessageSegmentDTO[] = [
            { type: 'thinking', content: 'Planning the work.' },
            {
                type: 'tool',
                name: 'Read',
                toolUseId: 'tool-read-page',
                args: JSON.stringify({ path: 'app/page.tsx' }),
                result: 'ok',
                finished: true,
            },
        ];
        const row = createStreamingRow(artifactsUi, initialSegments);
        const toolGroup = row.querySelector<HTMLDetailsElement>('.theia-mobile-tool-group');
        expect(toolGroup).to.not.equal(null);
        expect(toolGroup?.open).to.equal(false);

        // Patch with changed thinking content and an unfinished tool — the
        // model is still acting, tool group stays collapsed.
        const actingSegments: QaapAgentMessageSegmentDTO[] = [
            { type: 'thinking', content: 'Planning the work. Now let me read the file.' },
            {
                type: 'tool',
                name: 'Read',
                toolUseId: 'tool-read-page',
                args: JSON.stringify({ path: 'app/page.tsx' }),
                result: undefined,
                finished: false,
            },
        ];
        artifactsUi.patchStreamingActivityTimeline(row, actingSegments);
        const toolGroupAfterActing = row.querySelector<HTMLDetailsElement>('.theia-mobile-tool-group');
        expect(toolGroupAfterActing?.open).to.equal(false);
    });

    it('renders expandable grouped terminal steps with command details', () => {
        const artifactsUi = createArtifactsUi();
        const segments: QaapAgentMessageSegmentDTO[] = [
            {
                type: 'tool',
                name: 'Bash',
                toolUseId: 'tool-1',
                args: JSON.stringify({ command: 'find . -name "*.ts"' }),
                result: 'ok',
                finished: true,
            },
            {
                type: 'tool',
                name: 'Bash',
                toolUseId: 'tool-2',
                args: JSON.stringify({ command: 'npm test' }),
                result: 'ok',
                finished: true,
            },
        ];
        const timeline = artifactsUi.createTranscriptActivityTimeline(segments, {
            streaming: false,
            segments,
        });
        const grouped = timeline?.querySelector('.theia-mobile-agent-activity-item.theia-mod-expandable-step');
        expect(grouped).to.not.equal(null);
        const expand = grouped?.querySelector<HTMLDetailsElement>('.theia-mobile-agent-activity-expand');
        expect(expand).to.not.equal(null);
        expect(expand?.open).to.equal(false);
        expand!.open = true;
        const body = expand?.querySelector('.theia-mobile-agent-activity-expand-body');
        expect(body?.classList.contains('theia-mod-terminal-group')).to.equal(true);
        const panel = body?.querySelector('.theia-mobile-agent-activity-terminal-panel');
        expect(panel).to.not.equal(null);
        expect(panel?.querySelector('.theia-mobile-agent-premium-head.theia-mod-terminal')).to.not.equal(null);
        const stack = panel?.querySelector('.theia-mobile-agent-activity-terminal-stack');
        expect(stack).to.not.equal(null);
        const windows = stack?.querySelectorAll<HTMLDetailsElement>('.theia-mobile-agent-activity-terminal-window');
        expect(windows?.length).to.equal(2);
        expect(windows?.[0]?.querySelector('.theia-mobile-agent-shell-command code')?.textContent)
            .to.equal('find . -name "*.ts"');
        expect(windows?.[1]?.querySelector('.theia-mobile-agent-shell-command code')?.textContent)
            .to.equal('npm test');
        expect(windows?.[0]?.open).to.equal(true);
        expect(windows?.[1]?.open).to.equal(false);
    });

    it('renders terminal stdout inside premium expand cards', () => {
        const artifactsUi = createArtifactsUi();
        const segments: QaapAgentMessageSegmentDTO[] = [
            {
                type: 'tool',
                name: 'Bash',
                toolUseId: 'tool-stdout',
                args: JSON.stringify({ command: 'echo hello' }),
                result: 'hello\n',
                finished: true,
            },
        ];
        const timeline = artifactsUi.createTranscriptActivityTimeline(segments, {
            streaming: false,
            segments,
        });
        const step = timeline?.querySelector('.theia-mobile-agent-activity-item.theia-mod-expandable-step');
        const expand = step?.querySelector<HTMLDetailsElement>('.theia-mobile-agent-activity-expand');
        expand!.open = true;
        const output = expand?.querySelector('.theia-mobile-agent-activity-terminal-output');
        expect(output?.textContent).to.equal('hello');
        expect(expand?.querySelector('.theia-mobile-agent-activity-terminal-window')).to.not.equal(null);
        expect(expand?.querySelector('.theia-mobile-agent-activity-terminal-output-label')?.textContent).to.equal('Output');
    });

    it('renders premium todo checklist expand for Updated todo list', () => {
        const artifactsUi = createArtifactsUi();
        const segments: QaapAgentMessageSegmentDTO[] = [
            {
                type: 'tool',
                name: 'TodoWrite',
                toolUseId: 'todo-1',
                args: JSON.stringify({
                    todos: [
                        { content: 'Ship timeline expand', status: 'completed' },
                        { content: 'Polish error panel', status: 'in_progress' },
                        { content: 'Verify in browser', status: 'pending' },
                    ],
                }),
                result: 'ok',
                finished: true,
            },
        ];
        const timeline = artifactsUi.createTranscriptActivityTimeline(segments, {
            streaming: false,
            segments,
        });
        const step = timeline?.querySelector('.theia-mobile-agent-activity-item.theia-mod-expandable-step');
        const expand = step?.querySelector<HTMLDetailsElement>('.theia-mobile-agent-activity-expand');
        expand!.open = true;
        const panel = expand?.querySelector('.theia-mobile-agent-activity-todo-panel');
        expect(panel).to.not.equal(null);
        expect(panel?.querySelector('.theia-mobile-agent-activity-todo-progress-fill')).to.not.equal(null);
        const items = panel?.querySelectorAll('.theia-mobile-agent-todo-checklist.theia-mod-premium .theia-mobile-agent-todo-item');
        expect(items?.length).to.equal(3);
    });

    it('renders premium tool error panel for TodoWrite validation failures', () => {
        const artifactsUi = createArtifactsUi();
        const segments: QaapAgentMessageSegmentDTO[] = [
            {
                type: 'tool',
                name: 'TodoWrite',
                toolUseId: 'todo-fail',
                args: JSON.stringify({ todos: [] }),
                result: '<tool_use_error>InputValidationError: TodoWrite failed due to the following issue:\nThe `merge` field is required.',
                finished: true,
            },
        ];
        const timeline = artifactsUi.createTranscriptActivityTimeline(segments, {
            streaming: false,
            segments,
        });
        const errorItem = timeline?.querySelector('.theia-mobile-agent-activity-item.theia-mod-error');
        const panel = errorItem?.querySelector<HTMLDetailsElement>('.theia-mobile-agent-activity-error-panel');
        expect(panel).to.not.equal(null);
        expect(panel?.open).to.equal(false);
        expect(panel?.querySelector('.theia-mobile-agent-activity-error-panel-code')?.textContent)
            .to.equal('InputValidationError');
        expect(panel?.querySelector('.theia-mobile-agent-activity-error-panel-message')?.textContent)
            .to.include('merge');
        expect(panel?.querySelector('.theia-mobile-agent-activity-error-panel-action.theia-mod-hint')?.textContent)
            .to.equal('Copy fix hint');
    });

    it('renders premium read expand with syntax-highlighted clamped output', () => {
        const artifactsUi = createArtifactsUi();
        const longJson = `{\n${'  "line": true,\n'.repeat(12)}}`;
        const segments: QaapAgentMessageSegmentDTO[] = [
            {
                type: 'tool',
                name: 'Read',
                toolUseId: 'read-1',
                args: JSON.stringify({ path: 'package.json' }),
                result: longJson,
                finished: true,
            },
        ];
        const timeline = artifactsUi.createTranscriptActivityTimeline(segments, {
            streaming: false,
            segments,
        });
        const step = timeline?.querySelector('.theia-mobile-agent-activity-item.theia-mod-expandable-step');
        const expand = step?.querySelector<HTMLDetailsElement>('.theia-mobile-agent-activity-expand');
        expand!.open = true;
        const body = expand?.querySelector('.theia-mobile-agent-activity-expand-body');
        expect(body?.classList.contains('theia-mod-read')).to.equal(true);
        expect(body?.querySelector('.theia-mobile-agent-activity-read-window')).to.not.equal(null);
        expect(body?.querySelector('.theia-mobile-agent-code-view')).to.not.equal(null);
        expect(body?.querySelector('.theia-mobile-agent-clamp-toggle')).to.not.equal(null);
    });

    it('renders grouped edit expand with per-file diff stats rows', () => {
        const artifactsUi = createArtifactsUi();
        const diff = [
            '```diff',
            '--- a/src/foo.ts',
            '+++ b/src/foo.ts',
            '@@ -1,2 +1,3 @@',
            '+added',
            '-removed',
            '```',
        ].join('\n');
        const segments: QaapAgentMessageSegmentDTO[] = [
            {
                type: 'tool',
                name: 'edit_file',
                toolUseId: 'edit-1',
                args: JSON.stringify({ path: 'src/foo.ts' }),
                result: diff,
                finished: true,
            },
            {
                type: 'tool',
                name: 'edit_file',
                toolUseId: 'edit-2',
                args: JSON.stringify({ path: 'src/bar.ts' }),
                result: '1 file changed, 2 insertions(+), 1 deletion(-)',
                finished: true,
            },
        ];
        const timeline = artifactsUi.createTranscriptActivityTimeline(segments, {
            streaming: false,
            segments,
        });
        const grouped = timeline?.querySelector('.theia-mobile-agent-activity-item.theia-mod-expandable-step');
        const expand = grouped?.querySelector<HTMLDetailsElement>('.theia-mobile-agent-activity-expand');
        expand!.open = true;
        const body = expand?.querySelector('.theia-mobile-agent-activity-expand-body');
        expect(body?.classList.contains('theia-mod-edit-group')).to.equal(true);
        const rows = body?.querySelectorAll('.theia-mobile-agent-activity-edit-row');
        expect(rows?.length).to.equal(2);
        expect(rows?.[0]?.querySelector('.theia-mobile-agent-diff-stat.theia-mod-added')?.textContent).to.equal('+1');
        expect(rows?.[1]?.querySelector('.theia-mobile-agent-diff-stat.theia-mod-added')?.textContent).to.equal('+2');
    });

    it('marks changed-file rows as review-open actions when host supports review reveal', () => {
        const host = {
            transcriptLastConv: undefined,
            transcriptUserScrollPinDispose: Disposable.NULL,
            transcriptLiveUi: {
                refreshTranscriptApprovals: async () => undefined,
                hasPendingTranscriptToolApproval: () => false,
            },
            projectRowsUi: {
                localizeActivityLabel: (label: string) => label,
            },
            openTranscriptReviewFile: () => undefined,
        } as unknown as MobileProjectsTranscriptMessagesHost;
        const contentUi = new MobileProjectsTranscriptMessagesContentUi(host as never);
        const resolversUi = new MobileProjectsTranscriptMessagesResolversUi(host as never, contentUi);
        const toolUi = new MobileProjectsTranscriptMessagesToolUi(host as never, contentUi, resolversUi);
        const artifactsUi = new MobileProjectsTranscriptMessagesArtifactsUi(host, contentUi, resolversUi, toolUi);
        const segments: QaapAgentMessageSegmentDTO[] = [
            {
                type: 'tool',
                name: 'edit_file',
                toolUseId: 'edit-1',
                args: JSON.stringify({ path: 'src/foo.ts' }),
                result: '1 file changed, 1 insertion(+)',
                finished: true,
            },
        ];
        const card = artifactsUi.createTranscriptChangedFilesCard(segments);
        const row = card?.querySelector('.theia-mobile-agent-changed-file');
        expect(row?.classList.contains('theia-mod-clickable')).to.equal(true);
        expect(row?.getAttribute('role')).to.equal('button');
    });

    it('shows checkpoint restore CTA beside error panel when a checkpoint exists', () => {
        const host = {
            transcriptLastConv: {
                id: 'conv-checkpoint',
                status: 'idle',
                messages: [],
                checkpoints: [{
                    id: 'cp-before',
                    messageId: 'u1',
                    label: 'Before edit',
                    commit: 'abc123',
                    ref: 'refs/qaap/checkpoints/cp-before',
                    capturedAt: 1,
                }],
            },
            transcriptUserScrollPinDispose: Disposable.NULL,
            transcriptLiveUi: {
                refreshTranscriptApprovals: async () => undefined,
                hasPendingTranscriptToolApproval: () => false,
            },
            projectRowsUi: { localizeActivityLabel: (label: string) => label },
        } as unknown as MobileProjectsTranscriptMessagesHost;
        const contentUi = new MobileProjectsTranscriptMessagesContentUi(host as never);
        const resolversUi = new MobileProjectsTranscriptMessagesResolversUi(host as never, contentUi);
        const toolUi = new MobileProjectsTranscriptMessagesToolUi(host as never, contentUi, resolversUi);
        const artifactsUi = new MobileProjectsTranscriptMessagesArtifactsUi(host, contentUi, resolversUi, toolUi);
        const segments: QaapAgentMessageSegmentDTO[] = [
            {
                type: 'tool',
                name: 'TodoWrite',
                toolUseId: 'todo-fail',
                args: JSON.stringify({ todos: [] }),
                result: '<tool_use_error>InputValidationError: TodoWrite failed due to the following issue:\nThe `merge` field is required.',
                finished: true,
            },
        ];
        const timeline = artifactsUi.createTranscriptActivityTimeline(segments, {
            streaming: false,
            segments,
            conv: host.transcriptLastConv as QaapAgentConversationDTO,
        });
        const restore = timeline?.querySelector('.theia-mobile-agent-activity-error-panel .theia-mobile-agent-activity-checkpoint-restore');
        expect(restore?.textContent).to.equal('Restore to before this step');
    });

    it('shows inline mini diff for a single changed file while collapsed', () => {
        const artifactsUi = createArtifactsUi();
        const diff = [
            '```diff',
            '--- a/src/foo.ts',
            '+++ b/src/foo.ts',
            '@@ -1,2 +1,3 @@',
            '+added line',
            '-removed line',
            ' context',
            '```',
        ].join('\n');
        const segments: QaapAgentMessageSegmentDTO[] = [
            {
                type: 'tool',
                name: 'edit_file',
                toolUseId: 'edit-1',
                args: JSON.stringify({ path: 'src/foo.ts' }),
                result: diff,
                finished: true,
            },
        ];
        const card = artifactsUi.createTranscriptChangedFilesCard(segments);
        expect(card instanceof HTMLDetailsElement && card.open).to.equal(false);
        const miniDiff = card?.querySelector('.theia-mobile-agent-changed-files-mini-diff-line');
        expect(miniDiff).to.not.equal(null);
        expect(card?.querySelector('.theia-mobile-agent-changed-files-stats .theia-mod-added')?.textContent).to.equal('+1');
        expect(card?.querySelector('.theia-mobile-agent-changed-files-stats .theia-mod-removed')?.textContent).to.equal('−1');
    });

    it('shows per-file diff stats in collapsed changed-files preview', () => {
        const artifactsUi = createArtifactsUi();
        const diff = [
            '```diff',
            '--- a/src/foo.ts',
            '+++ b/src/foo.ts',
            '@@ -1,2 +1,3 @@',
            '+added line',
            '-removed line',
            ' context',
            '```',
        ].join('\n');
        const segments: QaapAgentMessageSegmentDTO[] = [
            {
                type: 'tool',
                name: 'edit_file',
                toolUseId: 'edit-1',
                args: JSON.stringify({ path: 'src/foo.ts' }),
                result: diff,
                finished: true,
            },
            {
                type: 'tool',
                name: 'edit_file',
                toolUseId: 'edit-2',
                args: JSON.stringify({ path: 'src/bar.ts' }),
                result: '1 file changed, 2 insertions(+), 1 deletion(-)',
                finished: true,
            },
        ];
        const card = artifactsUi.createTranscriptChangedFilesCard(segments);
        expect(card).to.not.equal(undefined);
        expect(card instanceof HTMLDetailsElement && card.open).to.equal(false);
        const preview = card?.querySelector('.theia-mobile-agent-changed-files-collapsed-preview');
        expect(preview).to.not.equal(null);
        const rows = preview?.querySelectorAll('.theia-mobile-agent-changed-file.theia-mod-compact');
        expect(rows?.length).to.equal(2);
        expect(rows?.[0]?.querySelector('.theia-mobile-agent-diff-stat.theia-mod-added')?.textContent).to.equal('+1');
        expect(rows?.[0]?.querySelector('.theia-mobile-agent-diff-stat.theia-mod-removed')?.textContent).to.equal('−1');
        expect(rows?.[1]?.querySelector('.theia-mobile-agent-diff-stat.theia-mod-added')?.textContent).to.equal('+2');
        expect(rows?.[1]?.querySelector('.theia-mobile-agent-diff-stat.theia-mod-removed')?.textContent).to.equal('−1');
        const expandedRow = card?.querySelector('.theia-mobile-agent-changed-files-list .theia-mobile-agent-changed-file:not(.theia-mod-compact)');
        expect(expandedRow?.querySelector('.theia-mobile-agent-changed-file-stats')).to.not.equal(null);
    });

    it('collapses the timeline after a completed turn', () => {
        const artifactsUi = createArtifactsUi();
        const segments: QaapAgentMessageSegmentDTO[] = [
            {
                type: 'tool',
                name: 'Read',
                toolUseId: 'tool-read-page',
                args: JSON.stringify({ path: 'app/page.tsx' }),
                result: 'export default function Page() { return null; }',
                finished: true,
            },
        ];
        const timeline = artifactsUi.createTranscriptActivityTimeline(segments, {
            streaming: false,
            segments,
        });
        expect(timeline).to.not.equal(undefined);
        expect(timeline instanceof HTMLDetailsElement && timeline.open).to.equal(false);
        expect(timeline?.querySelector('.theia-mobile-agent-activity-timeline-summary-label')?.textContent)
            .to.equal('Read 1 file');
        expect(timeline?.querySelector('.theia-mobile-agent-activity-result-preview')?.textContent)
            .to.equal('export default function Page() { return null; }');
    });

    it('renders verification as a compact progress group instead of a shell event', () => {
        const artifactsUi = createArtifactsUi();
        const segments: QaapAgentMessageSegmentDTO[] = [
            {
                type: 'tool',
                name: 'Bash',
                toolUseId: 'tool-test',
                args: JSON.stringify({ command: 'npm run test' }),
                result: 'ok',
                finished: true,
            },
        ];
        const timeline = artifactsUi.createTranscriptActivityTimeline(segments, {
            streaming: false,
            segments,
        });

        expect(timeline).to.not.equal(undefined);
        expect(timeline instanceof HTMLDetailsElement && timeline.open).to.equal(false);
        expect(timeline?.querySelector('.theia-mobile-agent-activity-narrative')?.textContent)
            .to.equal("I'm validating the implementation.");
        expect(timeline?.querySelector('.theia-mobile-agent-activity-verb')?.textContent).to.equal('Verification');
        expect(timeline?.querySelector('.theia-mobile-agent-activity-detail')?.textContent).to.equal('1 check');
        expect(timeline?.querySelector('.theia-mobile-agent-activity-expand') instanceof HTMLDetailsElement
            && timeline.querySelector<HTMLDetailsElement>('.theia-mobile-agent-activity-expand')?.open).to.equal(false);
    });

    it('separates verb and detail in Codex-style execution event rows', () => {
        const artifactsUi = createArtifactsUi();
        const row = createStreamingRow(artifactsUi, [
            {
                type: 'tool',
                name: 'Bash',
                toolUseId: 'tool-ls',
                args: JSON.stringify({ command: 'ls -la /workspace/repos/demo' }),
                result: 'ok',
                finished: true,
            },
            {
                type: 'tool',
                name: 'Read',
                toolUseId: 'tool-read-many',
                args: JSON.stringify({ path: 'index.html' }),
                result: 'ok',
                finished: true,
            },
            {
                type: 'tool',
                name: 'Read',
                toolUseId: 'tool-read-many-2',
                args: JSON.stringify({ path: 'style.css' }),
                result: 'ok',
                finished: true,
            },
            {
                type: 'tool',
                name: 'Read',
                toolUseId: 'tool-read-many-3',
                args: JSON.stringify({ path: 'script.js' }),
                result: 'ok',
                finished: true,
            },
            {
                type: 'tool',
                name: 'AskUserQuestion',
                toolUseId: 'tool-ask',
                args: '{}',
                result: 'ok',
                finished: true,
            },
            { type: 'text', content: 'Done.' },
        ]);

        // Codex-style timeline: each event has a verb + meta in the tool group summary
        const toolGroups = Array.from(row.querySelectorAll<HTMLDetailsElement>('.theia-mobile-tool-group'));
        expect(toolGroups.length).to.be.greaterThan(0);

        const bashGroup = toolGroups.find(el => el.querySelector('.theia-mobile-tool-group-verb')?.textContent === 'Run');
        expect(bashGroup?.querySelector('.theia-mobile-tool-group-verb')?.textContent).to.equal('Run');
        expect(bashGroup?.querySelector('.theia-mobile-tool-group-meta')?.textContent).to.equal('1 command');

        const readGroup = toolGroups.find(el => el.querySelector('.theia-mobile-tool-group-verb')?.textContent === 'Read');
        expect(readGroup?.querySelector('.theia-mobile-tool-group-verb')?.textContent).to.equal('Read');
        expect(readGroup?.querySelector('.theia-mobile-tool-group-meta')?.textContent).to.equal('3 files');

        const useGroup = toolGroups.find(el => el.querySelector('.theia-mobile-tool-group-verb')?.textContent === 'Use');
        expect(useGroup?.querySelector('.theia-mobile-tool-group-verb')?.textContent).to.equal('Use');
        expect(useGroup?.querySelector('.theia-mobile-tool-group-meta')?.textContent).to.equal('1 step');

        // All tool groups are collapsed by default
        toolGroups.forEach(group => expect(group.open).to.equal(false));
    });

    it('renders compact grep matches inside search expand', () => {
        const artifactsUi = createArtifactsUi();
        const segments: QaapAgentMessageSegmentDTO[] = [
            {
                type: 'tool',
                name: 'Grep',
                toolUseId: 'grep-expand',
                args: JSON.stringify({ pattern: 'resolvePinned' }),
                result: [
                    'Found 1 matching line',
                    'packages/qaap-mobile-shell/src/browser/foo.ts:42:  return resolvePinnedEditorContextVariable(',
                ].join('\n'),
                finished: true,
            },
        ];
        const timeline = artifactsUi.createTranscriptActivityTimeline(segments, {
            streaming: false,
            segments,
            cursorTrace: true,
        });
        const step = timeline?.querySelector('.theia-mobile-agent-activity-item.theia-mod-expandable-step');
        const expand = step?.querySelector<HTMLDetailsElement>('.theia-mobile-agent-activity-expand');
        expand!.open = true;
        const match = expand?.querySelector('.theia-mobile-agent-activity-search-match');
        expect(match).to.not.equal(null);
        expect(match?.querySelector('.theia-mobile-agent-activity-search-match-file')?.textContent)
            .to.equal('src/browser/foo.ts');
        expect(match?.querySelector('.theia-mobile-agent-activity-search-match-line')?.textContent)
            .to.equal('42');
        expect(match?.querySelector('.theia-mobile-agent-activity-search-match-snippet')?.textContent)
            .to.contain('resolvePinnedEditorContextVariable');
    });

    it('keeps the Codex execution event timeline as the only tool surface after settling', () => {
        const artifactsUi = createArtifactsUi();
        const segments: QaapAgentMessageSegmentDTO[] = [
            { type: 'thinking', content: 'Plan the work.' },
            {
                type: 'tool',
                name: 'Read',
                toolUseId: 'tool-read-page',
                args: '<path>/repo/app/page.tsx',
                result: 'ok',
                finished: true,
            },
            {
                type: 'tool',
                name: 'Bash',
                toolUseId: 'tool-run-status',
                args: JSON.stringify({ command: 'git status --short' }),
                result: 'ok',
                finished: true,
            },
        ];
        const conv = createCompletedConv(segments);
        const row = artifactsUi.createTranscriptAgentSegmentsRow(segments, undefined, conv);

        // Codex-style execution event timeline is present
        expect(row.querySelector('.theia-mobile-execution-timeline')).to.not.equal(null);
        // No old-style activity timeline or tool pills
        expect(row.querySelector('.theia-mobile-agent-activity-timeline')).to.equal(null);
        expect(row.querySelector('.theia-mobile-agent-tool-group, .theia-mobile-agent-tool-pill')).to.equal(null);
        // The narrative is present
        const narrative = row.querySelector('.theia-mobile-execution-event-narrative');
        expect(narrative?.textContent).to.not.equal(null);
        // The Read tool group has the correct verb and meta
        const readGroup = Array.from(row.querySelectorAll<HTMLDetailsElement>('.theia-mobile-tool-group'))
            .find(el => el.querySelector('.theia-mobile-tool-group-verb')?.textContent === 'Read');
        expect(readGroup?.querySelector('.theia-mobile-tool-group-meta')?.textContent).to.equal('1 file');

        // Finalize a streaming row — the timeline should be rebuilt, not replaced with old DOM
        const streamingRow = createStreamingRow(artifactsUi, segments);
        artifactsUi.finalizeStreamingAgentTrace(streamingRow, segments, conv);

        expect(streamingRow.querySelector('.theia-mobile-execution-timeline')).to.not.equal(null);
        expect(streamingRow.querySelector('.theia-mobile-agent-activity-timeline')).to.equal(null);
        expect(streamingRow.querySelector('.theia-mobile-agent-tool-group, .theia-mobile-agent-tool-pill')).to.equal(null);
        expect(streamingRow.querySelector('.theia-mobile-agent-technical-details')).to.equal(null);
    });

    it('appends the diff summary when a streaming turn with file changes settles', () => {
        const artifactsUi = createArtifactsUi();
        const segments: QaapAgentMessageSegmentDTO[] = [
            { type: 'thinking', content: 'Plan the work.' },
            {
                type: 'tool',
                name: 'Read',
                toolUseId: 'tool-read-page',
                args: JSON.stringify({ path: 'app/page.tsx' }),
                result: 'ok',
                finished: true,
            },
            {
                type: 'tool',
                name: 'Write',
                toolUseId: 'tool-write-page',
                args: JSON.stringify({ file_path: 'app/page.tsx' }),
                result: 'ok',
                finished: true,
            },
        ];
        const conv = createCompletedConv(segments);
        // Streaming row — no diff summary while streaming
        const streamingRow = createStreamingRow(artifactsUi, segments);
        expect(streamingRow.querySelector('.theia-mobile-diff-summary')).to.equal(null);
        // Finalize — the diff summary should now appear as the closing of the story
        artifactsUi.finalizeStreamingAgentTrace(streamingRow, segments, conv);
        const diffSummary = streamingRow.querySelector('.theia-mobile-diff-summary');
        expect(diffSummary).to.not.equal(null);
        expect(diffSummary?.querySelector('.theia-mobile-diff-summary-title')?.textContent).to.equal('1 File Changed');
    });

    it('renders a thought brief during the thinking phase when no tools are present', () => {
        const artifactsUi = createArtifactsUi();
        const segments: QaapAgentMessageSegmentDTO[] = [
            { type: 'thinking', content: 'Planning the approach before reading files.' },
        ];
        // Include a user message with createdAt 5s ago to exceed the 2s thinking grace period
        const conv = {
            id: 'conv-think',
            cwd: '/tmp/bench',
            agentId: 'codex',
            status: 'streaming',
            updatedAt: Date.now(),
            messages: [
                { id: 'user-1', role: 'user', content: 'Do the task', createdAt: Date.now() - 5000 },
                { id: 'agent-1', role: 'agent', content: '', segments },
            ],
        } as QaapAgentConversationDTO;
        const row = artifactsUi.createTranscriptAgentSegmentsRow(segments, undefined, conv, { streaming: true });
        // No execution event timeline yet (no tools)
        expect(row.querySelector('.theia-mobile-execution-timeline')).to.equal(null);
        // A thought brief should be visible so the user sees the thinking phase
        expect(row.querySelector('.theia-mobile-agent-thought-brief')).to.not.equal(null);
    });

    it('upgrades from thought brief to Codex-style timeline when a tool arrives during streaming', () => {
        const artifactsUi = createArtifactsUi();
        // Start with thinking only — no tools
        const thinkingSegments: QaapAgentMessageSegmentDTO[] = [
            { type: 'thinking', content: 'Planning the approach.' },
        ];
        const conv = {
            id: 'conv-think',
            cwd: '/tmp/bench',
            agentId: 'codex',
            status: 'streaming',
            updatedAt: Date.now(),
            messages: [
                { id: 'user-1', role: 'user', content: 'Do the task', createdAt: Date.now() - 5000 },
                { id: 'agent-1', role: 'agent', content: '', segments: thinkingSegments },
            ],
        } as QaapAgentConversationDTO;
        const row = artifactsUi.createTranscriptAgentSegmentsRow(thinkingSegments, undefined, conv, { streaming: true });
        expect(row.querySelector('.theia-mobile-agent-thought-brief')).to.not.equal(null);
        expect(row.querySelector('.theia-mobile-execution-timeline')).to.equal(null);

        // A tool segment arrives via streaming patch
        const segmentsWithTool: QaapAgentMessageSegmentDTO[] = [
            { type: 'thinking', content: 'Planning the approach.' },
            {
                type: 'tool',
                name: 'Read',
                toolUseId: 'tool-read-1',
                args: JSON.stringify({ path: 'app/page.tsx' }),
                result: 'ok',
                finished: true,
            },
        ];
        artifactsUi.patchStreamingActivityTimeline(row, segmentsWithTool, conv);

        // The thought brief should be gone, replaced by the Codex-style timeline
        expect(row.querySelector('.theia-mobile-agent-thought-brief')).to.equal(null);
        expect(row.querySelector('.theia-mobile-execution-timeline')).to.not.equal(null);
        // The tool group should be collapsed by default
        const toolGroup = row.querySelector<HTMLDetailsElement>('.theia-mobile-tool-group');
        expect(toolGroup).to.not.equal(null);
        expect(toolGroup?.open).to.equal(false);
    });

    it('upgrades to Codex-style timeline when finalizing a row that was never upgraded during streaming', () => {
        const artifactsUi = createArtifactsUi();
        // Simulate a row that was created during thinking and never received
        // a streaming patch with tools (e.g. tools arrived in a single batch)
        const segments: QaapAgentMessageSegmentDTO[] = [
            { type: 'thinking', content: 'Planning the approach.' },
            {
                type: 'tool',
                name: 'Read',
                toolUseId: 'tool-read-1',
                args: JSON.stringify({ path: 'app/page.tsx' }),
                result: 'ok',
                finished: true,
            },
        ];
        const conv = {
            id: 'conv-think',
            cwd: '/tmp/bench',
            agentId: 'codex',
            status: 'streaming',
            updatedAt: Date.now(),
            messages: [
                { id: 'user-1', role: 'user', content: 'Do the task', createdAt: Date.now() - 5000 },
                { id: 'agent-1', role: 'agent', content: '', segments: [segments[0]!] },
            ],
        } as QaapAgentConversationDTO;
        const row = artifactsUi.createTranscriptAgentSegmentsRow([segments[0]!], undefined, conv, { streaming: true });
        // Row starts with thought brief, no timeline
        expect(row.querySelector('.theia-mobile-agent-thought-brief')).to.not.equal(null);
        expect(row.querySelector('.theia-mobile-execution-timeline')).to.equal(null);

        // Finalize with the full segments (including the tool)
        const finalizedConv = { ...conv, status: 'idle' as const, messages: [
            conv.messages[0]!,
            { id: 'agent-1', role: 'agent', content: '', segments },
        ] } as QaapAgentConversationDTO;
        artifactsUi.finalizeStreamingAgentTrace(row, segments, finalizedConv);

        // Should now have the Codex-style timeline, not the thought brief
        expect(row.querySelector('.theia-mobile-execution-timeline')).to.not.equal(null);
        expect(row.querySelector('.theia-mobile-agent-thought-brief')).to.equal(null);
    });

    it('updates closing narrative text blocks when content grows during streaming', () => {
        enableTranscriptRenderMetrics(true);
        resetTranscriptRenderMetrics();
        const artifactsUi = createArtifactsUi();
        // Start with a tool and a short text segment (the agent's final answer)
        const initialSegments: QaapAgentMessageSegmentDTO[] = [
            { type: 'thinking', content: 'Planning the work.' },
            {
                type: 'tool',
                name: 'Read',
                toolUseId: 'tool-read-page',
                args: JSON.stringify({ path: 'app/page.tsx' }),
                result: 'ok',
                finished: true,
            },
            { type: 'text', content: 'I have read the file.' },
        ];
        const row = createStreamingRow(artifactsUi, initialSegments);

        // The closing narrative text block should be present
        const segmentsBody = row.querySelector<HTMLElement>('.theia-mobile-agent-transcript-segments');
        expect(segmentsBody).to.not.equal(null);
        const textBlock = segmentsBody!.querySelector<HTMLElement>('[data-transcript-segment-index="2"]');
        expect(textBlock).to.not.equal(null);
        expect(textBlock!.textContent).to.include('I have read the file.');

        // Simulate the text growing during streaming (same segment count, text grew)
        const grownSegments: QaapAgentMessageSegmentDTO[] = [
            { type: 'thinking', content: 'Planning the work.' },
            {
                type: 'tool',
                name: 'Read',
                toolUseId: 'tool-read-page',
                args: JSON.stringify({ path: 'app/page.tsx' }),
                result: 'ok',
                finished: true,
            },
            { type: 'text', content: 'I have read the file and I am now writing the final summary for the user.' },
        ];
        const patched = artifactsUi.patchStreamingAgentTextSegments(row, initialSegments, grownSegments);
        expect(patched).to.equal(true);
        artifactsUi.patchStreamingActivityTimeline(row, grownSegments);

        // The text block should now show the updated content
        const updatedBlock = segmentsBody!.querySelector<HTMLElement>('[data-transcript-segment-index="2"]');
        expect(updatedBlock).to.not.equal(null);
        expect(updatedBlock!.textContent).to.include('I am now writing the final summary');
        const metrics = getTranscriptRenderMetricsSnapshot();
        expect(metrics.timeline_event_patch).to.equal(0);
        expect(metrics.timeline_event_rebuild).to.equal(0);
        expect(metrics.timeline_event_sync_skipped).to.equal(0);
    });

    it('keeps the process accordion open while a visually settled turn is still finalizing', () => {
        const artifactsUi = createArtifactsUi();
        const segments: QaapAgentMessageSegmentDTO[] = [
            { type: 'thinking', content: 'Planning the work.' },
            {
                type: 'tool',
                name: 'Read',
                toolUseId: 'tool-read-page',
                args: JSON.stringify({ path: 'app/page.tsx' }),
                result: 'ok',
                finished: true,
            },
            { type: 'text', content: 'I have read the file and am preparing the final answer.' },
        ];
        for (const status of ['streaming', 'settled'] as const) {
            const conv = createConvWithStatus(segments, status);
            const row = artifactsUi.createTranscriptAgentSegmentsRow(segments, undefined, conv, { streaming: false });
            const accordion = row.querySelector<HTMLDetailsElement>('.theia-mobile-process-accordion');
            expect(accordion, status).to.not.equal(null);
            expect(accordion!.open, status).to.equal(true);
            expect(accordion!.classList.contains('theia-mod-working'), status).to.equal(true);
        }
    });

    it('keeps the thought brief open while a no-tool turn is still finalizing', () => {
        const artifactsUi = createArtifactsUi();
        const segments: QaapAgentMessageSegmentDTO[] = [
            { type: 'thinking', content: 'Reasoning about the request.' },
            { type: 'text', content: 'I am drafting the final response.' },
        ];
        for (const status of ['streaming', 'settled'] as const) {
            const conv = createConvWithStatus(segments, status);
            const row = artifactsUi.createTranscriptAgentSegmentsRow(segments, undefined, conv, { streaming: false });
            const thought = row.querySelector<HTMLDetailsElement>('.theia-mobile-agent-thought-brief');
            expect(thought, status).to.not.equal(null);
            expect(thought!.open, status).to.equal(true);
        }
    });

    it('re-renders closing narrative text blocks with final content on settle', () => {
        const artifactsUi = createArtifactsUi();
        // Start with a tool and a short text segment
        const initialSegments: QaapAgentMessageSegmentDTO[] = [
            { type: 'thinking', content: 'Planning the work.' },
            {
                type: 'tool',
                name: 'Read',
                toolUseId: 'tool-read-page',
                args: JSON.stringify({ path: 'app/page.tsx' }),
                result: 'ok',
                finished: true,
            },
            { type: 'text', content: 'I have read the file.' },
        ];
        const row = createStreamingRow(artifactsUi, initialSegments);

        // Finalize with grown text content (simulating a race where the
        // last streaming patch didn't apply before settle)
        const finalSegments: QaapAgentMessageSegmentDTO[] = [
            { type: 'thinking', content: 'Planning the work.' },
            {
                type: 'tool',
                name: 'Read',
                toolUseId: 'tool-read-page',
                args: JSON.stringify({ path: 'app/page.tsx' }),
                result: 'ok',
                finished: true,
            },
            { type: 'text', content: 'I have read the file and here is my complete final answer for the user.' },
        ];
        const conv = createCompletedConv(finalSegments);
        artifactsUi.finalizeStreamingAgentTrace(row, finalSegments, conv);

        // The text block should show the final content, not the stale initial content
        const segmentsBody = row.querySelector<HTMLElement>('.theia-mobile-agent-transcript-segments');
        const textBlock = segmentsBody?.querySelector<HTMLElement>('[data-transcript-segment-index="2"]');
        expect(textBlock).to.not.equal(null);
        expect(textBlock?.textContent).to.include('here is my complete final answer');
    });

    it('rebuilds the Codex timeline without creating legacy tool pills when a tool is appended to a settled row', () => {
        const artifactsUi = createArtifactsUi();
        // Create a streaming row with one tool, then finalize it so it settles
        // with a Codex-style timeline and no longer has the streaming class.
        const initialSegments: QaapAgentMessageSegmentDTO[] = [
            { type: 'thinking', content: 'Planning the work.' },
            {
                type: 'tool',
                name: 'Read',
                toolUseId: 'tool-read-1',
                args: JSON.stringify({ path: 'app/page.tsx' }),
                result: 'ok',
                finished: true,
            },
        ];
        const row = createStreamingRow(artifactsUi, initialSegments);
        const conv = createCompletedConv(initialSegments);
        artifactsUi.finalizeStreamingAgentTrace(row, initialSegments, conv);
        // The row should have the Codex-style timeline and no streaming class
        expect(row.querySelector('.theia-mobile-execution-timeline')).to.not.equal(null);
        expect(row.classList.contains('theia-mod-streaming')).to.equal(false);
        // No legacy tool pills should be present
        expect(row.querySelector('.theia-mobile-agent-tool-pills')).to.equal(null);

        // Simulate a late tool segment arriving after settle (e.g. a retry
        // or a rapid state transition). appendStreamingAgentToolSegment must
        // rebuild the Codex timeline, NOT fall through to the legacy path.
        const segmentsWithNewTool: QaapAgentMessageSegmentDTO[] = [
            ...initialSegments,
            {
                type: 'tool',
                name: 'Read',
                toolUseId: 'tool-read-2',
                args: JSON.stringify({ path: 'app/other.tsx' }),
                result: 'ok',
                finished: true,
            },
        ];
        const appended = artifactsUi.appendStreamingAgentToolSegment(row, segmentsWithNewTool, conv);
        expect(appended).to.equal(true);

        // The Codex-style timeline should still be present and reflect 2 tools
        expect(row.querySelector('.theia-mobile-execution-timeline')).to.not.equal(null);
        // No legacy tool pills should have been created
        expect(row.querySelector('.theia-mobile-agent-tool-pills')).to.equal(null);
        expect(row.querySelector('.theia-mobile-agent-tool-group')).to.equal(null);
        // The tool group should now show 2 files
        const toolGroup = row.querySelector<HTMLDetailsElement>('.theia-mobile-tool-group');
        expect(toolGroup?.querySelector('.theia-mobile-tool-group-meta')?.textContent).to.equal('2 files');
    });
});
