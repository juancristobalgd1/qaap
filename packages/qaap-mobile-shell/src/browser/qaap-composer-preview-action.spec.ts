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
});
