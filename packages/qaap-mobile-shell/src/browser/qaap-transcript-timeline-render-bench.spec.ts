// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { Disposable } from '@theia/core/lib/common/disposable';
import * as markdownit from '@theia/core/shared/markdown-it';
import type { QaapAgentConversationDTO, QaapAgentMessageSegmentDTO } from '../common/qaap-agent-conversation-client';
import {
    enableTranscriptRenderMetrics,
    getTranscriptRenderMetricsSnapshot,
    resetTranscriptRenderMetrics,
} from '../common/qaap-transcript-render-metrics';
import { MobileProjectsTranscriptMessagesArtifactsUi } from '../browser/mobile-projects-transcript-messages-artifacts-ui';
import { MobileProjectsTranscriptMessagesContentUi } from '../browser/mobile-projects-transcript-messages-content-ui';
import { MobileProjectsTranscriptMessagesResolversUi } from '../browser/mobile-projects-transcript-messages-resolvers-ui';
import { MobileProjectsTranscriptMessagesToolUi } from '../browser/mobile-projects-transcript-messages-tool-ui';
import type { MobileProjectsTranscriptMessagesHost } from '../browser/mobile-projects-transcript-messages-ui';

describe('qaap-transcript-timeline-render-bench', () => {

    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
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

    it('skips redundant timeline syncs during duplicate SSE frames', () => {
        enableTranscriptRenderMetrics(true);
        resetTranscriptRenderMetrics();
        const artifactsUi = createArtifactsUi();
        const row = createStreamingRow(artifactsUi, buildToolSegments(52, 40));
        for (let tick = 0; tick < 120; tick++) {
            const segments = buildToolSegments(52, 40);
            artifactsUi.patchStreamingActivityTimeline(row, segments);
        }
        const metrics = getTranscriptRenderMetricsSnapshot();
        expect(metrics.timeline_sync).to.be.greaterThan(0);
        expect(metrics.timeline_sync_skipped).to.be.greaterThan(80);
    });

    it('skips per-item DOM work when only the active step advances', () => {
        enableTranscriptRenderMetrics(true);
        resetTranscriptRenderMetrics();
        const artifactsUi = createArtifactsUi();
        const row = createStreamingRow(artifactsUi, buildToolSegments(52, 40));
        for (let tick = 0; tick < 60; tick++) {
            const runningIndex = 40 + (tick % 3);
            artifactsUi.patchStreamingActivityTimeline(row, buildToolSegments(52, runningIndex));
        }
        const metrics = getTranscriptRenderMetricsSnapshot();
        expect(metrics.timeline_item_sync).to.be.greaterThan(0);
        expect(metrics.timeline_item_sync_skipped).to.be.greaterThan(50);
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

    it('renders assistant-style reasoning trace chrome with descriptive tool rows', () => {
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

        expect(row.querySelector('.theia-mobile-agent-thought-brief')).to.equal(null);
        expect(row.querySelector('.theia-mobile-agent-technical-details')).to.equal(null);
        expect(row.querySelector('.theia-mobile-agent-activity-timeline-summary-icon.theia-mobile-agent-trace-glyph')).to.not.equal(null);
        expect(row.querySelector('.theia-mobile-agent-activity-timeline-summary-label')?.textContent).to.equal('Read 1 file');
        expect(row.querySelector<HTMLDetailsElement>('.theia-mobile-agent-activity-timeline')?.open).to.equal(false);
        expect(row.querySelector('.theia-mobile-agent-activity-icon.codicon-thinking')).to.not.equal(null);
        const verbs = Array.from(row.querySelectorAll('.theia-mobile-agent-activity-verb')).map(el => el.textContent);
        expect(verbs).to.deep.equal(['Thinking', 'Read']);
        expect(row.querySelector('.theia-mobile-agent-activity-narrative')?.textContent).to.equal("I'm checking the relevant files.");
        expect(row.querySelector('.theia-mobile-agent-activity-thinking')).to.not.equal(null);
        expect(row.querySelector<HTMLDetailsElement>('.theia-mobile-agent-activity-thinking')?.open).to.equal(false);
        const thinkingSummary = row.querySelector('.theia-mobile-agent-activity-thinking-summary');
        // Thinking excerpt preview is shown in the summary when the details is collapsed
        const thinkingExcerpt = thinkingSummary?.querySelector('.theia-mobile-agent-activity-detail.theia-mod-thinking-excerpt');
        expect(thinkingExcerpt).to.not.equal(null);
        expect(thinkingExcerpt?.textContent).to.include('Let me think about this step by step.');
        expect(thinkingSummary?.querySelector('.theia-mobile-agent-activity-tail')).to.equal(null);
        expect(row.querySelector('.theia-mobile-agent-activity-thinking-body')?.textContent).to.include('Let me think about this step by step.');
        const readRow = Array.from(row.querySelectorAll('.theia-mobile-agent-activity-row'))
            .find(el => el.querySelector('.theia-mobile-agent-activity-verb')?.textContent === 'Read');
        expect(readRow?.querySelector('.theia-mobile-agent-activity-detail')?.textContent).to.equal('1 file');
        expect(row.querySelector('.theia-mobile-agent-activity-detail.theia-mod-pill')).to.equal(null);
    });

    it('preserves the thinking excerpt element across streaming patches', () => {
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
        const excerptBefore = row.querySelector<HTMLElement>(
            '.theia-mobile-agent-activity-thinking-summary .theia-mobile-agent-activity-detail.theia-mod-thinking-excerpt',
        );
        expect(excerptBefore).to.not.equal(null);

        // Patch with a changed segment (tool finished) to force a real sync.
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
        const excerptAfter = row.querySelector<HTMLElement>(
            '.theia-mobile-agent-activity-thinking-summary .theia-mobile-agent-activity-detail.theia-mod-thinking-excerpt',
        );
        expect(excerptAfter).to.not.equal(null);
        // The excerpt element should be reused, not removed and recreated.
        expect(excerptAfter).to.equal(excerptBefore);
        expect(excerptAfter?.textContent).to.include('Let me think about this step by step.');
    });

    it('respects user collapse of previously-live thinking across streaming patches', () => {
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
        const details = row.querySelector<HTMLDetailsElement>('.theia-mobile-agent-activity-thinking');
        expect(details).to.not.equal(null);

        // Simulate the state that occurs after the thinking was auto-expanded
        // live and then the user collapsed it:
        // - `thinkingWasLive='1'`: the sync previously auto-expanded it.
        // - `thinkingUserToggled='1'`: the user manually collapsed it.
        // - `open=false`: the details is currently collapsed.
        // The old code cleared `thinkingUserExpanded` on close, so the next
        // sync would re-open because `thinkingWasLive='1'`. The new code uses
        // `thinkingUserToggled` which is never cleared, so the user's choice
        // is respected.
        details!.dataset.thinkingWasLive = '1';
        details!.dataset.thinkingUserToggled = '1';
        details!.open = false;

        // Patch with changed thinking content to force a per-item sync.
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
        const detailsAfterPatch = row.querySelector<HTMLDetailsElement>('.theia-mobile-agent-activity-thinking');
        // The user's collapse must be respected — no re-open.
        expect(detailsAfterPatch?.open).to.equal(false);
        expect(detailsAfterPatch?.dataset.thinkingUserToggled).to.equal('1');
        // The copy element should reflect the closed state.
        const copyAfterPatch = row.querySelector<HTMLElement>('.theia-mobile-agent-activity-copy');
        expect(copyAfterPatch?.classList.contains('theia-mod-thinking-open')).to.equal(false);
    });

    it('auto-expands thinking with thinkingWasLive and no user toggle', () => {
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
        const details = row.querySelector<HTMLDetailsElement>('.theia-mobile-agent-activity-thinking');
        expect(details).to.not.equal(null);

        // Simulate: thinking was previously live (auto-expanded), user has NOT
        // toggled. The sync should auto-expand it.
        details!.dataset.thinkingWasLive = '1';
        details!.open = false;

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
        const detailsAfterPatch = row.querySelector<HTMLDetailsElement>('.theia-mobile-agent-activity-thinking');
        expect(detailsAfterPatch?.open).to.equal(true);
        const copyAfterPatch = row.querySelector<HTMLElement>('.theia-mobile-agent-activity-copy');
        expect(copyAfterPatch?.classList.contains('theia-mod-thinking-open')).to.equal(true);
    });

    it('auto-collapses thinking when the model starts writing its final response', () => {
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
        const details = row.querySelector<HTMLDetailsElement>('.theia-mobile-agent-activity-thinking');
        expect(details).to.not.equal(null);

        // Simulate: thinking was previously live (auto-expanded), user has NOT
        // toggled. The thinking should currently be expanded.
        details!.dataset.thinkingWasLive = '1';
        details!.open = true;

        // Patch with a text segment that exceeds the short-preamble threshold
        // (TRANSCRIPT_TEXT_PREAMBLE_MAX_CHARS = 40). This transitions the
        // message into the "writing" phase, so the chain of thought should
        // auto-collapse to give the summary focus.
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
        artifactsUi.patchStreamingActivityTimeline(row, writingSegments);
        const detailsAfterWriting = row.querySelector<HTMLDetailsElement>('.theia-mobile-agent-activity-thinking');
        // The thinking should auto-collapse when writing starts.
        expect(detailsAfterWriting?.open).to.equal(false);
        expect(detailsAfterWriting?.dataset.thinkingCollapsedForWriting).to.equal('1');
        const copyAfterWriting = row.querySelector<HTMLElement>('.theia-mobile-agent-activity-copy');
        expect(copyAfterWriting?.classList.contains('theia-mod-thinking-open')).to.equal(false);
    });

    it('keeps thinking expanded while tools are still acting after thinking', () => {
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
        const details = row.querySelector<HTMLDetailsElement>('.theia-mobile-agent-activity-thinking');
        expect(details).to.not.equal(null);

        // Simulate: thinking was previously live (auto-expanded). Also sync
        // the copy class to match the open state (as the real sync would).
        details!.dataset.thinkingWasLive = '1';
        details!.open = true;
        const copy = row.querySelector<HTMLElement>('.theia-mobile-agent-activity-copy');
        copy?.classList.add('theia-mod-thinking-open');

        // Patch with changed thinking content and an unfinished tool — the
        // model is still acting, so the thinking should stay expanded.
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
        const detailsAfterActing = row.querySelector<HTMLDetailsElement>('.theia-mobile-agent-activity-thinking');
        expect(detailsAfterActing?.open).to.equal(true);
        expect(detailsAfterActing?.dataset.thinkingCollapsedForWriting).to.equal(undefined);
        const copyAfterActing = row.querySelector<HTMLElement>('.theia-mobile-agent-activity-copy');
        expect(copyAfterActing?.classList.contains('theia-mod-thinking-open')).to.equal(true);
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

    it('separates verb and detail in cursor-trace rows', () => {
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

        const bashRow = Array.from(row.querySelectorAll('.theia-mobile-agent-activity-row'))
            .find(el => el.querySelector('.theia-mobile-agent-activity-verb')?.textContent === 'Run');
        expect(bashRow?.textContent).to.match(/^Run\s+1 command/);
        expect(bashRow?.querySelector('.theia-mobile-agent-activity-detail.theia-mod-command')).to.not.equal(null);
        expect(bashRow?.querySelector('.theia-mobile-agent-activity-detail.theia-mod-pill')).to.equal(null);

        const readRow = Array.from(row.querySelectorAll('.theia-mobile-agent-activity-row'))
            .find(el => el.querySelector('.theia-mobile-agent-activity-verb')?.textContent === 'Read'
                && el.textContent?.includes('files'));
        expect(readRow?.textContent).to.match(/^Read\s+3 files/);

        const askRow = Array.from(row.querySelectorAll('.theia-mobile-agent-activity-row'))
            .find(el => el.querySelector('.theia-mobile-agent-activity-verb')?.textContent === 'Use');
        expect(askRow?.textContent).to.equal('Use 1 tool');

        expect(row.querySelector('.theia-mobile-agent-activity-item.theia-mod-result .theia-mobile-agent-activity-label')?.textContent)
            .to.equal('Preparing the response');
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

    it('keeps reasoning as the only tool execution surface after settling', () => {
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

        expect(row.querySelector('.theia-mobile-agent-activity-timeline')).to.not.equal(null);
        expect(row.querySelector('.theia-mobile-agent-tool-group, .theia-mobile-agent-tool-pill')).to.equal(null);
        expect(row.querySelector('.theia-mobile-agent-activity-narrative')?.textContent).to.equal("I'm checking the relevant files.");
        const readRow = Array.from(row.querySelectorAll('.theia-mobile-agent-activity-row'))
            .find(el => el.querySelector('.theia-mobile-agent-activity-verb')?.textContent === 'Read');
        expect(readRow?.querySelector('.theia-mobile-agent-activity-detail')?.textContent).to.equal('1 file');

        const streamingRow = createStreamingRow(artifactsUi, segments);
        const artifacts = document.createElement('div');
        artifacts.className = 'theia-mobile-agent-transcript-artifacts';
        const duplicate = document.createElement('details');
        duplicate.className = 'theia-mobile-agent-tool-group';
        artifacts.append(duplicate);
        streamingRow.querySelector('.theia-mobile-agent-transcript-segments')?.append(artifacts);
        artifactsUi.finalizeStreamingAgentTrace(streamingRow, segments, conv);

        expect(streamingRow.querySelector('.theia-mobile-agent-activity-timeline')).to.not.equal(null);
        expect(streamingRow.querySelector('.theia-mobile-agent-tool-group, .theia-mobile-agent-tool-pill')).to.equal(null);
        expect(streamingRow.querySelector('.theia-mobile-agent-technical-details')).to.equal(null);
    });
});
