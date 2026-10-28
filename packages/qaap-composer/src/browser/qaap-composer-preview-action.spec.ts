// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversationDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { formatMissingBootstrapProjectHint } from '@theia/qaap-shared-core/lib/common/qaap-project-bootstrap-scaffold-plan';
import {
    COMPOSER_PREVIEW_PROBE_BACKOFF_MAX_MS,
    composerConversationInvolvesPreview,
    composerPreviewProbeBackoffMs,
    isComposerPreviewStartupActive,
    openCurrentComposerPreview,
    resolveComposerPreviewChipVisibility,
    resolveComposerFallbackPreviewUrls,
    resolveComposerPreviewCandidate,
    resolveComposerPreviewTarget,
    resolveVerifiedComposerPreviewUrl,
    type ComposerPreviewRuntime,
} from './qaap-composer-preview-action';

describe('qaap-composer-preview-action', () => {

    it('backs off failed preview probes exponentially from 2 s to a 30 s cap', () => {
        expect([1, 2, 3, 4, 5, 6, 12].map(composerPreviewProbeBackoffMs))
            .to.deep.equal([2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
        expect(composerPreviewProbeBackoffMs(50)).to.equal(COMPOSER_PREVIEW_PROBE_BACKOFF_MAX_MS);
    });

    it('keeps periodic preview probing only while a preview is starting or running', () => {
        expect(isComposerPreviewStartupActive({ phase: 'idle' })).to.equal(false);
        expect(isComposerPreviewStartupActive({ phase: 'ready-to-run' })).to.equal(false);
        expect(isComposerPreviewStartupActive({ phase: 'starting' })).to.equal(true);
        expect(isComposerPreviewStartupActive({ phase: 'running' })).to.equal(true);
        expect(isComposerPreviewStartupActive({ phase: 'idle' }, { previewRequestActive: true })).to.equal(true);
        expect(isComposerPreviewStartupActive({ phase: 'idle' }, { agentWorking: true })).to.equal(true);
    });
    it('shows only the starting chip while a preview boots, even if a stale URL verified', () => {
        expect(resolveComposerPreviewChipVisibility({ previewStarting: true, previewVerified: true }))
            .to.deep.equal({ showStarting: true, showViewPreview: false });
        expect(resolveComposerPreviewChipVisibility({ previewStarting: true, previewVerified: false }))
            .to.deep.equal({ showStarting: true, showViewPreview: false });
    });

    it('hides View Preview during a turn when the verification predates the turn', () => {
        expect(resolveComposerPreviewChipVisibility({
            previewStarting: false, previewVerified: true, agentWorking: true, agentWorkingSince: 2_000, verifiedAt: 1_000,
        })).to.deep.equal({ showStarting: false, showViewPreview: false });
    });

    it('offers View Preview during a turn once the verification postdates the turn start', () => {
        expect(resolveComposerPreviewChipVisibility({
            previewStarting: false, previewVerified: true, agentWorking: true, agentWorkingSince: 2_000, verifiedAt: 3_000,
        })).to.deep.equal({ showStarting: false, showViewPreview: true });
    });

    it('offers View Preview when idle and verified, regardless of timestamps', () => {
        expect(resolveComposerPreviewChipVisibility({
            previewStarting: false, previewVerified: true, agentWorking: false, agentWorkingSince: undefined, verifiedAt: 1_000,
        })).to.deep.equal({ showStarting: false, showViewPreview: true });
    });

    it('after a cancelled or failed turn, needs a verification taken once it ended', () => {
        expect(resolveComposerPreviewChipVisibility({
            previewStarting: false, previewVerified: true, requireVerifiedAfter: 2_000, verifiedAt: 1_000,
        })).to.deep.equal({ showStarting: false, showViewPreview: false });
        expect(resolveComposerPreviewChipVisibility({
            previewStarting: false, previewVerified: true, requireVerifiedAfter: 2_000, verifiedAt: 2_500,
        })).to.deep.equal({ showStarting: false, showViewPreview: true });
    });

    it('offers View Preview only once the probe verified the server answers', () => {
        expect(resolveComposerPreviewChipVisibility({ previewStarting: false, previewVerified: true }))
            .to.deep.equal({ showStarting: false, showViewPreview: true });
        expect(resolveComposerPreviewChipVisibility({ previewStarting: false, previewVerified: false }))
            .to.deep.equal({ showStarting: false, showViewPreview: false });
    });

    const ready: ComposerPreviewRuntime = {
        projectId: 'project-a',
        projectCwd: '/workspace/project-a',
        bootstrapRoot: '/workspace/project-a',
        dependenciesInstalled: true,
        phase: 'running',
        previewUrl: 'http://localhost:3000/qaap-dev/5173/',
    };

    it('enables the Open preview pill for an isolated-origin preview, targeting its host label', () => {
        const label = '0123456789abcdef0123456789abcdef';
        const isolated = `https://${label}.previews.qaap.example/`;
        const origin = 'https://app.qaap.example';
        expect(resolveComposerPreviewTarget(`${isolated}settings`, origin)).to.deep.equal({ previewId: label });
        const runtime = { ...ready, previewUrl: isolated };
        expect(resolveComposerPreviewCandidate(runtime, origin)).to.equal(isolated);
        expect(resolveVerifiedComposerPreviewUrl(runtime, `${isolated}settings`, origin)).to.equal(`${isolated}settings`);
        expect(resolveComposerPreviewTarget(`https://${label}.example/`, origin)).to.equal(undefined);
    });

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

    describe('the section live claim before the saved target', () => {
        const LIVE_URL = 'http://localhost:3000/qaap-preview/u-alice-w-file-wor-p-file-wor-x-33333333-qqqqqqqq/';
        const LIVE_ID = 'u-alice-w-file-wor-p-file-wor-x-33333333-qqqqqqqq';
        const SAVED_ID = 'u-alice-w-file-wor-p-file-wor-x-11111111-abcdefgh';

        it('opens the live claim when the saved target is dead, without probing the saved one', async () => {
            const probed: string[] = [];
            const opened: string[] = [];
            const didOpen = await openCurrentComposerPreview(
                'project-a',
                () => identityReady,
                async target => {
                    probed.push(target.previewId ?? `port:${target.port}`);
                    return target.previewId === LIVE_ID
                        ? { ready: true, previewUrl: LIVE_URL }
                        : { ready: false, previewUrl: IDENTITY_URL };
                },
                async url => {
                    opened.push(url);
                    return true;
                },
                'http://localhost:3000',
                async () => ({ previewUrl: LIVE_URL }),
            );
            expect(didOpen).to.equal(true);
            expect(probed).to.deep.equal([LIVE_ID]);
            expect(opened).to.deep.equal([LIVE_URL]);
            expect(probed).to.not.include(SAVED_ID);
        });

        it('keeps the saved-target flow when there is no live claim', async () => {
            const probed: string[] = [];
            const opened: string[] = [];
            const didOpen = await openCurrentComposerPreview(
                'project-a',
                () => identityReady,
                async target => {
                    probed.push(target.previewId ?? `port:${target.port}`);
                    return { ready: false, previewUrl: IDENTITY_URL };
                },
                async url => {
                    opened.push(url);
                    return true;
                },
                'http://localhost:3000',
                async () => undefined,
            );
            expect(didOpen).to.equal(false);
            expect(probed).to.deep.equal([SAVED_ID]);
            expect(opened).to.deep.equal([]);
        });

        it('a live claim that is not ready yet falls through to the saved-target flow', async () => {
            const probed: string[] = [];
            const opened: string[] = [];
            const didOpen = await openCurrentComposerPreview(
                'project-a',
                () => identityReady,
                async target => {
                    probed.push(target.previewId ?? `port:${target.port}`);
                    return target.previewId === SAVED_ID
                        ? { ready: true, previewUrl: IDENTITY_URL }
                        : { ready: false, previewUrl: LIVE_URL };
                },
                async url => {
                    opened.push(url);
                    return true;
                },
                'http://localhost:3000',
                async () => ({ previewUrl: LIVE_URL }),
            );
            expect(didOpen).to.equal(true);
            expect(probed).to.deep.equal([LIVE_ID, SAVED_ID]);
            expect(opened).to.deep.equal([IDENTITY_URL]);
        });

        it('a failed live lookup is treated as no live claim', async () => {
            const probed: string[] = [];
            const didOpen = await openCurrentComposerPreview(
                'project-a',
                () => identityReady,
                async target => {
                    probed.push(target.previewId ?? `port:${target.port}`);
                    return { ready: false, previewUrl: IDENTITY_URL };
                },
                async () => true,
                'http://localhost:3000',
                async () => {
                    throw new Error('network down');
                },
            );
            expect(didOpen).to.equal(false);
            expect(probed).to.deep.equal([SAVED_ID]);
        });
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

        it('offers no stale fallback once this project\'s own Run failed', () => {
            const fallbackPreviewUrls = [`${ORIGIN}/qaap-dev/5173/`];
            const failed: ComposerPreviewRuntime = { ...idle, bootstrapRoot: '/workspace/project-a', fallbackPreviewUrls };
            expect(resolveComposerPreviewCandidate({ ...failed, phase: 'run-failed' }, ORIGIN)).to.equal(undefined);
            expect(resolveComposerPreviewCandidate({ ...failed, phase: 'install-failed' }, ORIGIN)).to.equal(undefined);
            // Another project's failed Run does not hide this project's agent-started server.
            expect(resolveComposerPreviewCandidate({ ...failed, phase: 'run-failed', bootstrapRoot: '/workspace/other' }, ORIGIN))
                .to.equal(fallbackPreviewUrls[0]);
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

    it('explains a project without a runnable target in full, never the truncated discovery toast', () => {
        const message = formatMissingBootstrapProjectHint([]) ?? '';
        expect(message).to.match(/no app Qaap can start yet/);
        expect(message).to.match(/\.qaap\/preview\.json/);
        expect(message).to.not.match(/discovery/i);
    });
});
