// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { Disposable } from '@theia/core/lib/common/disposable';
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
            transcriptLiveUi: { refreshTranscriptApprovals: async () => undefined },
            projectRowsUi: {
                localizeActivityLabel: (label: string) => label,
            },
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
        expect(row.querySelector('.theia-mobile-agent-activity-timeline-summary-label')?.textContent).to.equal('Read page.tsx');
        expect(row.querySelector<HTMLDetailsElement>('.theia-mobile-agent-activity-timeline')?.open).to.equal(true);
        expect(row.querySelector('.theia-mobile-agent-activity-icon.codicon-thinking')).to.not.equal(null);
        const verbs = Array.from(row.querySelectorAll('.theia-mobile-agent-activity-verb')).map(el => el.textContent);
        expect(verbs).to.deep.equal(['Thinking', 'Read']);
        expect(row.querySelector('.theia-mobile-agent-activity-thinking')).to.not.equal(null);
        expect(row.querySelector<HTMLDetailsElement>('.theia-mobile-agent-activity-thinking')?.open).to.equal(false);
        const thinkingSummary = row.querySelector('.theia-mobile-agent-activity-thinking-summary');
        expect(thinkingSummary?.querySelector('.theia-mobile-agent-activity-detail')).to.equal(null);
        expect(thinkingSummary?.querySelector('.theia-mobile-agent-activity-tail')).to.equal(null);
        expect(row.querySelector('.theia-mobile-agent-activity-thinking-body')?.textContent).to.include('Let me think about this step by step.');
        expect(row.querySelector('.theia-mobile-agent-activity-detail.theia-mod-pill')?.textContent).to.equal('page.tsx');
        expect(row.querySelector('.theia-mobile-agent-activity-detail.theia-mod-pill .theia-mobile-agent-activity-file-chip .codicon-file-code')).to.not.equal(null);
        expect(row.querySelector('.theia-mobile-agent-activity-file-chip-label')?.textContent).to.equal('page.tsx');
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
            .to.equal('Read page.tsx');
        expect(timeline?.querySelector('.theia-mobile-agent-activity-result-preview')?.textContent)
            .to.equal('export default function Page() { return null; }');
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
            .find(el => el.querySelector('.theia-mobile-agent-activity-verb')?.textContent === 'Ran');
        expect(bashRow?.textContent).to.match(/^Ran\s+ls -la/);
        expect(bashRow?.querySelector('.theia-mobile-agent-activity-detail.theia-mod-command')).to.not.equal(null);
        expect(bashRow?.querySelector('.theia-mobile-agent-activity-detail.theia-mod-pill')).to.equal(null);

        const readRow = Array.from(row.querySelectorAll('.theia-mobile-agent-activity-row'))
            .find(el => el.querySelector('.theia-mobile-agent-activity-verb')?.textContent === 'Read'
                && el.textContent?.includes('files'));
        expect(readRow?.textContent).to.match(/^Read\s+3 files/);

        const askRow = Array.from(row.querySelectorAll('.theia-mobile-agent-activity-row'))
            .find(el => el.querySelector('.theia-mobile-agent-activity-verb')?.textContent === 'Asked');
        expect(askRow?.textContent).to.equal('Asked a question');

        const writingRow = Array.from(row.querySelectorAll('.theia-mobile-agent-activity-row'))
            .find(el => el.querySelector('.theia-mobile-agent-activity-verb')?.textContent === 'Writing');
        expect(writingRow?.textContent).to.equal('Writing response');
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
        expect(row.querySelector('.theia-mobile-agent-activity-file-chip-label')?.textContent).to.equal('page.tsx');

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
