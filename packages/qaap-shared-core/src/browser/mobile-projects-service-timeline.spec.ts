// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import URI from '@theia/core/lib/common/uri';
import type { MobileProjectEntry } from './mobile-projects-types';

type Timeline = typeof import('./mobile-projects-service-timeline');

// "Open IDE" from the Work Hub keeps the current page (no workspace reload) when this matches.
describe('projectMatchesCurrentWorkspaceExtracted', () => {
    let disableJSDOM: (() => void) | undefined;
    let timeline: Timeline;

    before(() => {
        disableJSDOM = enableJSDOM();
        timeline = require('./mobile-projects-service-timeline');
    });

    after(() => disableJSDOM?.());

    function matches(workspacePath: string | undefined, project: Partial<MobileProjectEntry>): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ctx: any = {
            workspaceService: { workspace: workspacePath ? { resource: new URI(`file://${workspacePath}`) } : undefined },
        };
        ctx.currentGithubRepositoryFullName = () => timeline.currentGithubRepositoryFullNameExtracted(ctx);
        ctx.getProjectWorkspaceMatchKey = (entry: MobileProjectEntry) => timeline.getProjectWorkspaceMatchKeyExtracted(ctx, entry);
        ctx.getCurrentWorkspaceMatchKey = () => timeline.getCurrentWorkspaceMatchKeyExtracted(ctx);
        return timeline.projectMatchesCurrentWorkspaceExtracted(ctx, project as MobileProjectEntry);
    }

    function github(fullName: string): Partial<MobileProjectEntry> {
        const [owner, name] = fullName.split('/');
        return { id: `github:${fullName}`, github: { owner, name, fullName } as MobileProjectEntry['github'] };
    }

    it('matches the GitHub repository open at its clone root, regardless of case', () => {
        expect(matches('/workspace/repos/Acme/Landing', github('acme/landing'))).to.equal(true);
    });

    it('matches the GitHub repository when a folder inside its clone is open', () => {
        expect(matches('/workspace/repos/acme/landing/apps/web', github('acme/landing'))).to.equal(true);
    });

    it('matches per-user clones (repos/users/{login}/{owner}/{repo})', () => {
        expect(matches('/workspace/repos/users/alice/acme/landing', github('acme/landing'))).to.equal(true);
    });

    it('does not match a repository with the same name under another owner (fork)', () => {
        expect(matches('/workspace/repos/alice/landing', github('acme/landing'))).to.equal(false);
    });

    it('does not match an agent worktree of the repository (worktrees live under {tmpdir}/qaap-worktrees)', () => {
        expect(matches('/tmp/qaap-worktrees/alice/deadbeef', github('acme/landing'))).to.equal(false);
    });

    it('does not match the multi-repo container or an owner folder', () => {
        expect(matches('/workspace/repos', github('acme/landing'))).to.equal(false);
        expect(matches('/workspace/repos/acme', github('acme/landing'))).to.equal(false);
    });

    it('does not match when no workspace is open', () => {
        expect(matches(undefined, github('acme/landing'))).to.equal(false);
    });

    it('matches a local (non-GitHub) project only by its exact workspace uri', () => {
        const local = { id: 'recent:x', uri: new URI('file:///home/u/code/app') };
        expect(matches('/home/u/code/app', local)).to.equal(true);
        expect(matches('/home/u/code/app/packages/a', local)).to.equal(false);
        expect(matches('/home/u/code/other', local)).to.equal(false);
    });

    it('trusts a project the service already flagged as current', () => {
        expect(matches('/home/u/code/other', { ...github('acme/landing'), isCurrent: true })).to.equal(true);
    });
});
