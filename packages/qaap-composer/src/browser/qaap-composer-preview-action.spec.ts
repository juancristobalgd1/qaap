// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversationDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import {
    composerConversationInvolvesPreview,
    openCurrentComposerPreview,
    resolveComposerFallbackPreviewUrls,
    resolveComposerPreviewCandidate,
    resolveVerifiedComposerPreviewUrl,
    type ComposerPreviewRuntime,
} from './qaap-composer-preview-action';

describe('qaap-composer-preview-action', () => {
    const ready: ComposerPreviewRuntime = {
        projectId: 'project-a',
        projectCwd: '/workspace/project-a',
        bootstrapRoot: '/workspace/project-a',
        dependenciesInstalled: true,
        phase: 'running',
        previewUrl: 'http://localhost:3000/qaap-dev/5173/',
    };

    it('is hidden when dependencies are not installed', () => {
        expect(resolveComposerPreviewCandidate({ ...ready, dependenciesInstalled: false })).to.equal(undefined);
    });

    it('is hidden when the dev server is not running', () => {
        expect(resolveComposerPreviewCandidate({ ...ready, phase: 'ready-to-run' })).to.equal(undefined);
    });

    it('is visible when dependencies are installed and this project server is running', () => {
        expect(resolveComposerPreviewCandidate(ready)).to.equal(ready.previewUrl);
        expect(resolveVerifiedComposerPreviewUrl(ready, ready.previewUrl)).to.equal(ready.previewUrl);
        expect(resolveComposerPreviewCandidate({
            ...ready,
            projectCwd: '/workspace/project-b',
        })).to.equal(undefined);
    });

    it('opens the probed URL for the still-current project', async () => {
        let current = ready;
        const opened: string[] = [];
        const didOpen = await openCurrentComposerPreview(
            'project-a',
            () => current,
            async () => ({ ready: true, previewUrl: 'http://localhost:3000/qaap-dev/5173/current/' }),
            async url => {
                opened.push(url);
                return true;
            },
        );
        expect(didOpen).to.equal(true);
        expect(opened).to.deep.equal(['http://localhost:3000/qaap-dev/5173/current/']);

        current = { ...ready, projectId: 'project-b', projectCwd: '/workspace/project-b', bootstrapRoot: '/workspace/project-b' };
        expect(await openCurrentComposerPreview(
            'project-a',
            () => current,
            async () => ({ ready: true, previewUrl: 'http://localhost:3000/qaap-dev/5174/' }),
            async url => {
                opened.push(url);
                return true;
            },
        )).to.equal(false);
        expect(opened).to.have.length(1);
    });

    const IDENTITY_URL = 'http://localhost:3000/qaap-preview/u-alice-w-file-wor-p-file-wor-x-11111111-abcdefgh/';
    const identityReady: ComposerPreviewRuntime = { ...ready, previewUrl: IDENTITY_URL };

    it('accepts identity preview URLs as candidates (no port required)', () => {
        // Regression: identity URLs have no port; "no port ⇒ no candidate" silently disabled the
        // Open-preview pill for every identity-proxied app on the VPS.
        expect(resolveComposerPreviewCandidate(identityReady, 'http://localhost:3000')).to.equal(IDENTITY_URL);
        expect(resolveVerifiedComposerPreviewUrl(identityReady, IDENTITY_URL, 'http://localhost:3000')).to.equal(IDENTITY_URL);
    });

    it('never verifies one identity against another', () => {
        const other = 'http://localhost:3000/qaap-preview/u-alice-w-file-wor-p-file-wor-x-22222222-zzzzzzzz/';
        expect(resolveVerifiedComposerPreviewUrl(identityReady, other, 'http://localhost:3000')).to.equal(undefined);
    });

    it('opens an identity preview through the identity probe', async () => {
        const probed: string[] = [];
        const opened: string[] = [];
        const didOpen = await openCurrentComposerPreview(
            'project-a',
            () => identityReady,
            async target => {
                probed.push(target.previewId ?? `port:${target.port}`);
                return { ready: true, previewUrl: IDENTITY_URL };
            },
            async url => {
                opened.push(url);
                return true;
            },
            'http://localhost:3000',
        );
        expect(didOpen).to.equal(true);
        expect(probed).to.deep.equal(['u-alice-w-file-wor-p-file-wor-x-11111111-abcdefgh']);
        expect(opened).to.deep.equal([IDENTITY_URL]);
    });

    it('opens a port candidate whose probe answers with the canonical identity URL', async () => {
        const opened: string[] = [];
        const didOpen = await openCurrentComposerPreview(
            'project-a',
            () => ready,
            async () => ({ ready: true, previewUrl: IDENTITY_URL }),
            async url => {
                opened.push(url);
                return true;
            },
            'http://localhost:3000',
        );
        expect(didOpen).to.equal(true);
        expect(opened).to.deep.equal([IDENTITY_URL]);
    });

    describe('previews the Run flow did not start (agent shell dev servers)', () => {
        const ORIGIN = 'https://qaap.example.test';
        const idle: ComposerPreviewRuntime = {
            projectId: 'project-a',
            projectCwd: '/workspace/project-a',
            dependenciesInstalled: false,
            phase: 'idle',
        };

        function conversation(messages: Array<{ role: 'user' | 'agent'; content: string }>): QaapAgentConversationDTO {
            return { id: 'c1', status: 'idle', messages } as unknown as QaapAgentConversationDTO;
        }

        const started = conversation([
            { role: 'user', content: 'start the project' },
            { role: 'agent', content: 'Done: the dev server is running at http://localhost:5173/' },
        ]);

        it('falls back to the first previewable URL when the bootstrap is not running', () => {
            expect(resolveComposerPreviewCandidate({ ...idle, fallbackPreviewUrls: ['not a preview', `${ORIGIN}/qaap-dev/5173/`] }, ORIGIN))
                .to.equal(`${ORIGIN}/qaap-dev/5173/`);
            expect(resolveComposerPreviewCandidate({ ...idle, fallbackPreviewUrls: [] }, ORIGIN)).to.equal(undefined);
        });

        it('still prefers the running Run-flow URL over any fallback', () => {
            expect(resolveComposerPreviewCandidate({ ...ready, fallbackPreviewUrls: [`${ORIGIN}/qaap-dev/3000/`] }))
                .to.equal(ready.previewUrl);
        });

        it('derives the fallback from what the conversation announced', () => {
            expect(resolveComposerFallbackPreviewUrls(started, undefined, ORIGIN)).to.deep.equal([`${ORIGIN}/qaap-dev/5173/`]);
            // The URL the transcript already adopted for the project comes first.
            expect(resolveComposerFallbackPreviewUrls(started, `${ORIGIN}/qaap-preview/u-alice-x-1/`, ORIGIN))
                .to.deep.equal([`${ORIGIN}/qaap-preview/u-alice-x-1/`, `${ORIGIN}/qaap-dev/5173/`]);
        });

        it('never resurrects a stale project URL in a conversation unrelated to running the app', () => {
            const unrelated = conversation([{ role: 'user', content: 'rename the helper' }, { role: 'agent', content: 'Renamed.' }]);
            expect(composerConversationInvolvesPreview(unrelated, ORIGIN)).to.equal(false);
            expect(resolveComposerFallbackPreviewUrls(unrelated, `${ORIGIN}/qaap-dev/5173/`, ORIGIN)).to.deep.equal([]);
            expect(resolveComposerFallbackPreviewUrls(undefined, `${ORIGIN}/qaap-dev/5173/`, ORIGIN)).to.deep.equal([]);
            expect(composerConversationInvolvesPreview(started, ORIGIN)).to.equal(true);
        });

        it('accepts the identity URL a port probe answers with as verification of that port', () => {
            const runtime: ComposerPreviewRuntime = { ...idle, fallbackPreviewUrls: [`${ORIGIN}/qaap-dev/5173/`] };
            const identity = `${ORIGIN}/qaap-preview/u-alice-x-1/`;
            expect(resolveVerifiedComposerPreviewUrl(runtime, identity, ORIGIN)).to.equal(undefined);
            expect(resolveVerifiedComposerPreviewUrl(runtime, identity, ORIGIN, `${ORIGIN}/qaap-dev/5173/`)).to.equal(identity);
            // A verification made for another candidate does not carry over.
            expect(resolveVerifiedComposerPreviewUrl(runtime, identity, ORIGIN, `${ORIGIN}/qaap-dev/3000/`)).to.equal(undefined);
        });
    });
});
