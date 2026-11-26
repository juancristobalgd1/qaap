// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversationDTO, QaapAgentMessageSegmentDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import {
    createMobilePreviewToolCardElement,
    findLatestPreviewToolResultInSegments,
    findLatestReadyPreviewToolUrl,
    MOBILE_PREVIEW_TOOL_CARD_CLASS,
    parseMobilePreviewToolResult,
} from './mobile-preview-tool-card';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

describe('mobile-preview-tool-card', () => {
    useSuiteJSDOM();

    const tool = (name: string, result: string, extra: Partial<Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>> = {}): QaapAgentMessageSegmentDTO => ({
        type: 'tool',
        toolUseId: 'tu-1',
        name,
        args: '{}',
        finished: true,
        result,
        ...extra,
    });

    it('parses MCP and CLI preview tool results and finds the latest ready URL', () => {
        const readyJson = JSON.stringify({
            previewId: 'p1',
            status: 'ready',
            url: '/qaap-preview/p1/',
            httpStatus: 200,
            command: 'npm run start',
            cwd: '.',
            ownership: 'agent',
        });
        expect(parseMobilePreviewToolResult(readyJson)?.status).to.equal('ready');
        expect(parseMobilePreviewToolResult(`log line\n${readyJson}`)?.url).to.equal('/qaap-preview/p1/');

        const conv = {
            id: 'c1',
            status: 'idle',
            messages: [
                { role: 'user', content: 'start it' },
                { role: 'agent', content: 'Up.', segments: [tool('mcp__qaaq_0123456789abcdef__preview_start', readyJson)] },
            ],
        } as unknown as QaapAgentConversationDTO;
        expect(findLatestReadyPreviewToolUrl(conv)).to.deep.equal({
            url: '/qaap-preview/p1/',
            toolUseId: 'tu-1',
            httpStatus: 200,
        });

        const cliConv = {
            id: 'c2',
            status: 'idle',
            messages: [
                { role: 'agent', content: 'Up.', segments: [tool('Bash', readyJson, { toolUseId: 'tu-cli', args: '{"command":"qaaq-preview start"}' })] },
            ],
        } as unknown as QaapAgentConversationDTO;
        expect(findLatestReadyPreviewToolUrl(cliConv)?.url).to.equal('/qaap-preview/p1/');
    });

    it('renders a ready card with an Open preview button and a failed card with collapsible logs', () => {
        const opened: string[] = [];
        const readyCard = createMobilePreviewToolCardElement({
            previewId: 'p1',
            status: 'ready',
            url: '/qaap-preview/p1/',
            httpStatus: 200,
            command: 'npm run start',
            cwd: '.',
            ownership: 'agent',
        }, { onOpenPreview: url => opened.push(url) });
        expect(readyCard.classList.contains(MOBILE_PREVIEW_TOOL_CARD_CLASS)).to.equal(true);
        expect(readyCard.classList.contains('theia-mod-ready')).to.equal(true);
        expect(readyCard.querySelector(`.${MOBILE_PREVIEW_TOOL_CARD_CLASS}-title`)?.textContent).to.contain('200');
        readyCard.querySelector<HTMLButtonElement>(`.${MOBILE_PREVIEW_TOOL_CARD_CLASS}-open`)!.click();
        expect(opened).to.deep.equal(['/qaap-preview/p1/']);

        const failedCard = createMobilePreviewToolCardElement({
            previewId: 'p1',
            status: 'failed',
            command: 'npm run start',
            cwd: '.',
            ownership: 'agent',
            failure: { kind: 'process-exit', message: 'Missing API_KEY_X' },
            logTail: ['Error: Missing API_KEY_X'],
        });
        expect(failedCard.classList.contains('theia-mod-failed')).to.equal(true);
        expect(failedCard.querySelector(`.${MOBILE_PREVIEW_TOOL_CARD_CLASS}-open`)).to.equal(null);
        expect(failedCard.querySelector(`details.${MOBILE_PREVIEW_TOOL_CARD_CLASS}-logs`)).to.not.equal(null);
        expect(failedCard.querySelector(`.${MOBILE_PREVIEW_TOOL_CARD_CLASS}-logs-body`)?.textContent).to.equal('Error: Missing API_KEY_X');

        const found = findLatestPreviewToolResultInSegments([
            tool('qaaq_0123456789abcdef_preview_restart', JSON.stringify({ previewId: 'p1', status: 'stopped', command: 'npm start', cwd: '.', ownership: 'agent' })),
        ]);
        expect(found?.operation).to.equal('restart');
        expect(found?.state.status).to.equal('stopped');
    });
});
