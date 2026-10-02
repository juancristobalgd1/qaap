// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversationDTO } from './qaap-agent-conversation-client';
import {
    conversationShouldProbeDefaultDevPreviewPorts,
    transcriptPreviewProbeBackoffMs,
    transcriptPreviewProbePorts,
} from './qaap-transcript-preview-offer';

function conversation(messages: QaapAgentConversationDTO['messages']): QaapAgentConversationDTO {
    return {
        id: 'conv-1',
        cwd: '/repo',
        agentId: 'codex',
        title: 'Preview',
        status: 'streaming',
        createdAt: 1,
        updatedAt: 2,
        messages,
    };
}

describe('transcript preview offer polling', () => {

    it('does not sweep common ports because an older turn requested a preview', () => {
        const conv = conversation([
            { id: 'u1', role: 'user', content: 'Run the app and open the preview', createdAt: 1 },
            { id: 'a1', role: 'agent', content: 'Done.', createdAt: 2 },
            { id: 'u2', role: 'user', content: 'Explain this function', createdAt: 3 },
        ]);

        expect(conversationShouldProbeDefaultDevPreviewPorts(conv)).to.equal(false);
        expect(transcriptPreviewProbePorts(conv)).to.deep.equal([]);
    });

    it('sweeps common ports for a current preview request and backs off exponentially', () => {
        const conv = conversation([
            { id: 'u1', role: 'user', content: 'Run the app and open the preview', createdAt: 1 },
        ]);
        expect(conversationShouldProbeDefaultDevPreviewPorts(conv)).to.equal(true);
        expect(transcriptPreviewProbePorts(conv)).to.include(5173);
        expect(transcriptPreviewProbeBackoffMs(0)).to.equal(900);
        expect(transcriptPreviewProbeBackoffMs(1)).to.equal(1_800);
        expect(transcriptPreviewProbeBackoffMs(2)).to.equal(3_600);
        expect(transcriptPreviewProbeBackoffMs(8)).to.equal(30_000);
    });
});
