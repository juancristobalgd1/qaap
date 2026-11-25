// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversationDTO } from './qaap-agent-conversation-client';
import {
    conversationShouldProbeDefaultDevPreviewPorts,
    conversationShouldWatchDevPreview,
    findTranscriptPreviewPortHint,
    findTranscriptPreviewUrlFromConversation,
    noteTranscriptPreviewHintProbe,
    resetTranscriptPreviewHintStateForTests,
    retireTranscriptPreviewPortHint,
    TRANSCRIPT_PREVIEW_DEAD_HINT_GRACE_MS,
    messageRequestsDevPreview,
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

describe('dev preview intent', () => {

    it('recognises everyday Spanish requests to start the server', () => {
        for (const text of [
            'levanta el servidor',
            'levántame la app',
            'Levanta la aplicación',
            'arranca el proyecto',
            'inicia el servidor de nuevo',
            'ponme en marcha la web',
            'start the server',
        ]) {
            expect(messageRequestsDevPreview(text), text).to.equal(true);
        }
    });

    it('ignores messages that only mention the server', () => {
        for (const text of ['hola', 'el servidor da un 500 en /login, arréglalo', 'revisa el código del servidor']) {
            expect(messageRequestsDevPreview(text), text).to.equal(false);
        }
    });
});

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

    it('adopts the port a sibling conversation claimed on the same root, since the project shares one dev server', async () => {
        expect(await sweep(previewRequest, {
            5173: { previewId: 'p-sibling', conversationId: 'conv-sibling', root: '/repo' },
        })).to.equal(url(5173));
    });

    it('skips a sibling claim of another root and adopts its own claim further down the sweep', async () => {
        expect(await sweep(previewRequest, {
            5173: { previewId: 'p-sibling', conversationId: 'conv-sibling', root: '/other-repo' },
            5174: { previewId: 'p-own', conversationId: 'conv-1', root: '/repo' },
        })).to.equal(url(5174));
    });

    it('adopts an unclaimed external server only on the port the conversation named', async () => {
        const named = conversation([
            { id: 'u1', role: 'user', content: 'Run the app, it listens on http://localhost:5173', createdAt: 1 },
        ]);
        expect(await sweep(named, { 5173: {} })).to.equal(url(5173));
    });

    it('never adopts an unclaimed server found by the default sweep (another project on 3000)', async () => {
        expect(await sweep(previewRequest, { 3000: {} })).to.equal(undefined);
        expect(await sweep(previewRequest, {
            3000: {},
            5174: { previewId: 'p-own', conversationId: 'conv-1', root: '/repo' },
        })).to.equal(url(5174));
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

    it('treats the macOS realpath of a worktree claim (/private/var) as the thread\'s /var root', () => {
        const scope = { conversationId: 'conv-1', root: '/var/folders/cv/T/qaap-worktrees/_dev/3e63c785' };
        expect(transcriptPreviewProbeBelongsToScope(
            { previewId: 'p', conversationId: 'conv-2', root: '/private/var/folders/cv/T/qaap-worktrees/_dev/3e63c785' },
            scope,
        )).to.equal(true);
        expect(transcriptPreviewProbeBelongsToScope(
            { previewId: 'p', root: '/private/var/folders/cv/T/qaap-worktrees/_dev/other' },
            scope,
        )).to.equal(false);
    });
});

describe('stale transcript preview port hints', () => {
    afterEach(() => resetTranscriptPreviewHintStateForTests());

    const url = (port: number): string => `http://localhost:3000/qaap-dev/${port}/`;
    /** The QA task: the agent tested its own server on 3002; the preview later ran on 3001. */
    const testedOn3002 = (status: QaapAgentConversationDTO['status']): QaapAgentConversationDTO => ({
        ...conversation([
            { id: 'u1', role: 'user', content: 'Run the app and open the preview', createdAt: 1 },
            {
                id: 'a1', role: 'agent', createdAt: 2,
                content: 'Checked it with PORT=3002 node server.js: Todo app running on http://localhost:3002',
            },
        ]),
        status,
    });
    const probeLog = (claims: Record<number, Omit<TranscriptPreviewPortProbeResult, 'ready' | 'previewUrl'>>, log: number[]) =>
        async (port: number): Promise<TranscriptPreviewPortProbeResult> => {
            log.push(port);
            return { ready: port in claims, previewUrl: url(port), ...claims[port] };
        };

    it('retires a dead, unclaimed named port once the conversation\'s claimed preview is found on another port', async () => {
        const conv = testedOn3002('streaming');
        expect(findTranscriptPreviewPortHint(conv)).to.equal(3002);
        const first: number[] = [];
        const ready = await resolveReadyTranscriptPreviewUrlFromProbe(conv, probeLog({
            3001: { previewId: 'p-own', conversationId: 'conv-1', root: '/repo' },
        }, first));
        expect(ready).to.equal(url(3001));
        expect(first[0]).to.equal(3002);

        // Next tick: 3002 is no longer the hint, so it is not probed first (nor at all).
        expect(findTranscriptPreviewPortHint(conv)).to.equal(undefined);
        expect(findTranscriptPreviewUrlFromConversation(conv)).to.equal(undefined);
        const second: number[] = [];
        expect(await resolveReadyTranscriptPreviewUrlFromProbe(conv, probeLog({
            3001: { previewId: 'p-own', conversationId: 'conv-1', root: '/repo' },
        }, second))).to.equal(url(3001));
        expect(second).not.to.include(3002);
    });

    it('keeps a named port that is not up yet while the turn streams (server still booting)', async () => {
        const conv = testedOn3002('streaming');
        const t0 = 1_000;
        expect(noteTranscriptPreviewHintProbe(conv, 3002, { ready: false }, t0)).to.equal(true);
        noteTranscriptPreviewHintProbe(conv, 3002, { ready: false }, t0 + 10 * TRANSCRIPT_PREVIEW_DEAD_HINT_GRACE_MS);
        expect(findTranscriptPreviewPortHint(conv)).to.equal(3002);
        // Nothing else answers: the hint is not retired by the sweep either.
        await resolveReadyTranscriptPreviewUrlFromProbe(conv, probeLog({}, []));
        expect(findTranscriptPreviewPortHint(conv)).to.equal(3002);
    });

    it('retires a named port that stays dead and unclaimed for the grace after the turn ended', () => {
        const conv = testedOn3002('idle');
        const t0 = 1_000;
        noteTranscriptPreviewHintProbe(conv, 3002, { ready: false }, t0);
        noteTranscriptPreviewHintProbe(conv, 3002, { ready: false }, t0 + TRANSCRIPT_PREVIEW_DEAD_HINT_GRACE_MS - 1);
        expect(findTranscriptPreviewPortHint(conv)).to.equal(3002);
        noteTranscriptPreviewHintProbe(conv, 3002, { ready: false }, t0 + TRANSCRIPT_PREVIEW_DEAD_HINT_GRACE_MS);
        expect(findTranscriptPreviewPortHint(conv)).to.equal(undefined);
    });

    it('restarts the grace when the named port answers or is claimed in between', () => {
        const conv = testedOn3002('idle');
        noteTranscriptPreviewHintProbe(conv, 3002, { ready: false }, 0);
        expect(noteTranscriptPreviewHintProbe(conv, 3002, { ready: false, previewId: 'p' }, 1)).to.equal(false);
        noteTranscriptPreviewHintProbe(conv, 3002, { ready: false }, TRANSCRIPT_PREVIEW_DEAD_HINT_GRACE_MS);
        expect(findTranscriptPreviewPortHint(conv)).to.equal(3002);
    });

    it('stops the idle preview watch once the only signal was the retired port', () => {
        const conv: QaapAgentConversationDTO = {
            ...conversation([
                { id: 'u1', role: 'user', content: 'Change the main title to red', createdAt: 1 },
                { id: 'a1', role: 'agent', content: 'Verified: Todo app running on http://localhost:3002', createdAt: 2 },
            ]),
            status: 'idle',
        };
        expect(conversationShouldWatchDevPreview(conv)).to.equal(true);
        retireTranscriptPreviewPortHint(conv, 3002);
        expect(conversationShouldWatchDevPreview(conv)).to.equal(false);
        expect(transcriptPreviewProbePorts(conv)).to.deep.equal([]);
    });

    it('revives the port when a newer message names it again, and keeps other conversations untouched', () => {
        const conv = testedOn3002('idle');
        retireTranscriptPreviewPortHint(conv, 3002);
        expect(findTranscriptPreviewPortHint({ ...conv, id: 'conv-other' })).to.equal(3002);
        const later: QaapAgentConversationDTO = {
            ...conv,
            messages: [
                ...conv.messages,
                { id: 'a2', role: 'agent', content: 'Restarted it: http://localhost:3002', createdAt: 3 },
            ],
        };
        expect(findTranscriptPreviewPortHint(later)).to.equal(3002);
        // An older, still-live mention of another port surfaces once the newer one is retired.
        const twoPorts: QaapAgentConversationDTO = {
            ...conversation([
                { id: 'a0', role: 'agent', content: 'Vite ready on http://localhost:5173', createdAt: 1 },
                { id: 'a1', role: 'agent', content: 'Also tried http://localhost:3002', createdAt: 2 },
            ]),
            id: 'conv-two',
        };
        retireTranscriptPreviewPortHint(twoPorts, 3002);
        expect(findTranscriptPreviewPortHint(twoPorts)).to.equal(5173);
    });
});
