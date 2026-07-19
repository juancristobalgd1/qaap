// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    openCurrentComposerPreview,
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
});
