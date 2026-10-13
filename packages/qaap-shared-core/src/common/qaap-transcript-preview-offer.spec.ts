// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversationDTO } from './qaap-agent-conversation-client';
import {
    conversationShouldProbeDefaultDevPreviewPorts,
    resolveReadyTranscriptPreviewUrlFromProbe,
    transcriptPreviewProbeBackoffMs,
    transcriptPreviewProbeBelongsToScope,
    transcriptPreviewProbePorts,
    type TranscriptPreviewPortProbeResult,
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

describe('transcript preview port ownership', () => {
    const previewRequest = conversation([
        { id: 'u1', role: 'user', content: 'Run the app and open the preview', createdAt: 1 },
    ]);
    const url = (port: number): string => `http://localhost:3000/qaap-dev/${port}/`;
    const sweep = (
        conv: QaapAgentConversationDTO,
        claims: Record<number, Omit<TranscriptPreviewPortProbeResult, 'ready' | 'previewUrl'>>,
    ): Promise<string | undefined> => resolveReadyTranscriptPreviewUrlFromProbe(conv, async port => ({
        ready: port in claims,
        previewUrl: url(port),
        ...claims[port],
    }));

    it('does not adopt the port another conversation claimed', async () => {
        expect(await sweep(previewRequest, {
            5173: { previewId: 'p-sibling', conversationId: 'conv-sibling', root: '/repo' },
        })).to.equal(undefined);
    });

    it('skips a sibling claim and adopts its own claim further down the sweep', async () => {
        expect(await sweep(previewRequest, {
            5173: { previewId: 'p-sibling', conversationId: 'conv-sibling', root: '/repo' },
            5174: { previewId: 'p-own', conversationId: 'conv-1', root: '/repo' },
        })).to.equal(url(5174));
    });

    it('adopts an unclaimed external server', async () => {
        expect(await sweep(previewRequest, { 5173: {} })).to.equal(url(5173));
    });

    it('matches a claim without a section by the root the thread previews from', async () => {
        const worktreeThread = {
            ...previewRequest,
            cwd: '/tmp/qaap-worktrees/alice/e895ac21',
            parallelBaseCwd: '/repo',
            worktreeBranch: 'qaap/e895ac21',
        };
        expect(await sweep(worktreeThread, { 5173: { previewId: 'p-main', root: '/repo' } })).to.equal(undefined);
        expect(await sweep(worktreeThread, {
            5173: { previewId: 'p-wt', root: '/tmp/qaap-worktrees/alice/e895ac21/' },
        })).to.equal(url(5173));
        expect(await sweep(previewRequest, { 5173: { previewId: 'p-main', root: '/repo' } })).to.equal(url(5173));
    });

    it('compares Windows claim roots case-insensitively and accepts claims from older backends', () => {
        expect(transcriptPreviewProbeBelongsToScope(
            { previewId: 'p', root: 'C:\\Users\\Alice\\repo' },
            { conversationId: 'conv-1', root: 'c:/users/alice/repo/' },
        )).to.equal(true);
        expect(transcriptPreviewProbeBelongsToScope({ previewId: 'p' }, { conversationId: 'conv-1', root: '/repo' })).to.equal(true);
    });
});
