// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { Disposable } from '@theia/core/lib/common/disposable';
import type { QaapAgentConversationDTO, QaapAgentMessageSegmentDTO } from '../common/qaap-agent-conversation-client';
import { MobileProjectsTranscriptMessagesArtifactsUi } from './mobile-projects-transcript-messages-artifacts-ui';
import { MobileProjectsTranscriptMessagesContentUi } from './mobile-projects-transcript-messages-content-ui';
import { MobileProjectsTranscriptMessagesResolversUi } from './mobile-projects-transcript-messages-resolvers-ui';
import { MobileProjectsTranscriptMessagesToolUi } from './mobile-projects-transcript-messages-tool-ui';
import type { MobileProjectsTranscriptMessagesHost } from './mobile-projects-transcript-messages-ui';

describe('mobile-projects-transcript-agent-trace-ui', () => {

    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    function createUi(): {
        artifactsUi: MobileProjectsTranscriptMessagesArtifactsUi;
        toolUi: MobileProjectsTranscriptMessagesToolUi;
    } {
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
            transcriptPreviewUi: {},
        } as unknown as MobileProjectsTranscriptMessagesHost;
        const contentUi = new MobileProjectsTranscriptMessagesContentUi(host as never);
        const resolversUi = new MobileProjectsTranscriptMessagesResolversUi(host as never, contentUi);
        const toolUi = new MobileProjectsTranscriptMessagesToolUi(host as never, contentUi, resolversUi);
        const artifactsUi = new MobileProjectsTranscriptMessagesArtifactsUi(host, contentUi, resolversUi, toolUi);
        return { artifactsUi, toolUi };
    }

    function conversation(
        segments: QaapAgentMessageSegmentDTO[],
        status: QaapAgentConversationDTO['status'] = 'streaming',
    ): QaapAgentConversationDTO {
        return {
            id: 'conv-trace-ui',
            cwd: '/workspace',
            agentId: 'codex',
            title: 'Trace UI',
            status,
            createdAt: 1,
            updatedAt: Date.now(),
            messages: [{
                id: 'agent-1',
                role: 'agent',
                content: '',
                createdAt: 1,
                segments,
            }],
        };
    }

    function toolSegment(
        id: string,
        name: string,
        args: object,
        options?: { readonly finished?: boolean; readonly result?: string },
    ): Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }> {
        return {
            type: 'tool',
            toolUseId: id,
            name,
            args: JSON.stringify(args),
            finished: options?.finished ?? false,
            result: options?.result,
        };
    }

    function createStreamingTraceHost(artifactsUi: MobileProjectsTranscriptMessagesArtifactsUi, segments: QaapAgentMessageSegmentDTO[]): HTMLElement {
        const row = document.createElement('div');
        row.className = 'theia-mobile-agent-transcript-msg theia-mod-agent theia-mod-streaming';
        const body = document.createElement('div');
        body.className = 'theia-mobile-agent-transcript-segments';
        const timeline = artifactsUi.createTranscriptActivityTimeline([...segments], {
            streaming: true,
            expanded: true,
            segments,
        });
        if (timeline) {
            body.append(timeline);
        }
        row.append(body);
        document.body.append(row);
        return row;
    }

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('shows terminal result previews in compact tool pill summaries', () => {
        const { artifactsUi } = createUi();
        const segments = [
            toolSegment('term-1', 'bash', { command: 'npm test' }, {
                finished: true,
                result: '$ npm test\n\n218 passing\n',
            }),
        ];
        const row = artifactsUi.createTranscriptAgentSegmentsRow(segments, undefined, conversation(segments, 'idle'));

        const preview = row.querySelector<HTMLElement>('.theia-mobile-agent-tool-pill-result-preview');
        expect(preview?.textContent).to.equal('output: 218 passing');
    });

    it('shows live trace status on initial streaming render', () => {
        const { artifactsUi } = createUi();
        const segments = [
            toolSegment('term-1', 'bash', { command: 'npm test' }),
        ];
        const row = artifactsUi.createTranscriptAgentSegmentsRow(segments, undefined, conversation(segments), { streaming: true });

        const status = row.querySelector<HTMLElement>('.theia-mobile-agent-trace-status');
        expect(status).to.not.equal(null);
        expect(status?.hidden).to.equal(false);
        expect(status?.textContent).to.equal('Running shell · 1s');
        expect(status?.classList.contains('theia-mod-live')).to.equal(true);
    });

    it('keeps activity row aria labels in sync with recovery context and navigation hints', () => {
        const { artifactsUi } = createUi();
        const initialSegments = [
            toolSegment('term-1', 'bash', { command: 'npm start' }),
        ];
        const row = createStreamingTraceHost(artifactsUi, initialSegments);
        artifactsUi.patchStreamingActivityTimeline(row, initialSegments, conversation(initialSegments));

        const retrySegments = [
            toolSegment('term-1', 'bash', { command: 'npm start' }, {
                finished: true,
                result: 'Error: port in use',
            }),
            toolSegment('term-2', 'bash', { command: 'npm start' }),
        ];
        artifactsUi.patchStreamingActivityTimeline(row, retrySegments, conversation(retrySegments));

        const retry = row.querySelector<HTMLElement>('.theia-mobile-agent-activity-item.theia-mod-retrying');
        expect(retry?.getAttribute('role')).to.equal('button');
        expect(retry?.getAttribute('aria-label')).to.contain('Retrying: Running: npm start');
        expect(retry?.getAttribute('aria-label')).to.contain('Recovery: Retrying after: Error: port in use');
        expect(retry?.getAttribute('aria-label')).to.contain('Open terminal');
    });

    it('removes stale button semantics when a recycled activity row becomes non-navigable', () => {
        const { artifactsUi } = createUi();
        const terminalSegments = [
            toolSegment('term-1', 'bash', { command: 'npm test' }),
        ];
        const row = createStreamingTraceHost(artifactsUi, terminalSegments);
        artifactsUi.patchStreamingActivityTimeline(row, terminalSegments, conversation(terminalSegments));

        const item = row.querySelector<HTMLElement>('.theia-mobile-agent-activity-item');
        expect(item?.getAttribute('role')).to.equal('button');
        expect(item?.getAttribute('tabindex')).to.equal('0');
        expect(item?.dataset.transcriptActivityAction).to.equal('terminal');

        const otherSegments = [
            toolSegment('other-1', 'custom_tool', { value: 'noop' }),
        ];
        artifactsUi.patchStreamingActivityTimeline(row, otherSegments, conversation(otherSegments));

        const recycled = row.querySelector<HTMLElement>('.theia-mobile-agent-activity-item');
        expect(recycled?.getAttribute('role')).to.equal(null);
        expect(recycled?.getAttribute('tabindex')).to.equal(null);
        expect(recycled?.dataset.transcriptActivityAction).to.equal(undefined);
        expect(recycled?.getAttribute('aria-label')).to.equal('custom tool');
    });
});
