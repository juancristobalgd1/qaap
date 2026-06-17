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
});
