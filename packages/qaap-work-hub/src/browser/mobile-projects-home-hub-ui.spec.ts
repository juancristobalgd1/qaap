// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import { MobileProjectsHomeHubUi, type MobileProjectsHomeHubHost } from './mobile-projects-home-hub-ui';

disableImportJSDOM();

describe('MobileProjectsHomeHubUi.resolveHomePinnedProject', () => {

    function project(id: string, name: string, options?: { cwd?: string; fullName?: string; pinned?: boolean }): MobileProjectEntry & { cwd?: string } {
        return {
            id,
            name,
            color: '#8EB5DC',
            branch: 'main',
            status: 'idle',
            task: '',
            progress: 0,
            agents: [],
            lastActive: 'now',
            tokens: '0',
            cost: '$0',
            pinned: options?.pinned ?? false,
            isCurrent: false,
            github: options?.fullName
                ? { owner: options.fullName.split('/')[0], name: options.fullName.split('/')[1], fullName: options.fullName, htmlUrl: '', private: false }
                : undefined,
            cwd: options?.cwd,
        };
    }

    function createUi(projects: MobileProjectEntry[]): { ui: MobileProjectsHomeHubUi; host: MobileProjectsHomeHubHost } {
        const host = {
            projects,
            agentsHubSelectedProjectId: undefined,
            projectsService: {
                // Hosted Work Hub: the workspace is the multi-repo container, so nothing matches.
                resolveCurrentWorkspaceProject: () => undefined,
                getProjectCwd: (entry: MobileProjectEntry & { cwd?: string }) => entry.cwd,
            },
        } as unknown as MobileProjectsHomeHubHost;
        return { ui: new MobileProjectsHomeHubUi(host), host };
    }

    const vyyqCwd = '/workspace/repos/users/alice/alice/vyyq';

    it('keeps the first painted project when the loaded list re-ids and re-sorts it', () => {
        // First paint: cached project sessions (local recency).
        const { ui, host } = createUi([
            project('github:alice/vyyq', 'vyyq', { cwd: vyyqCwd, fullName: 'alice/vyyq' }),
            project('github:alice/OpenDots', 'OpenDots', { fullName: 'alice/OpenDots' }),
        ]);
        expect(ui.resolveHomePinnedProject()?.name).to.equal('vyyq');

        // primeVisiblePanelData(): fresh loadProjects() with other ids and server recency.
        host.projects = [
            project('github:alice/OpenDots', 'OpenDots', { fullName: 'alice/OpenDots' }),
            project(`recent:file://${vyyqCwd}`, 'vyyq', { cwd: vyyqCwd }),
        ];
        expect(ui.resolveHomePinnedProject()?.id).to.equal(`recent:file://${vyyqCwd}`);
    });

    it('still lets an explicit selection or a pinned project take the header', () => {
        const { ui, host } = createUi([
            project('github:alice/vyyq', 'vyyq', { cwd: vyyqCwd }),
            project('github:alice/OpenDots', 'OpenDots'),
        ]);
        expect(ui.resolveHomePinnedProject()?.name).to.equal('vyyq');

        host.projects = [project('github:alice/OpenDots', 'OpenDots', { pinned: true }), project('github:alice/vyyq', 'vyyq', { cwd: vyyqCwd })];
        expect(ui.resolveHomePinnedProject()?.name).to.equal('OpenDots');

        host.projects = [project('github:alice/OpenDots', 'OpenDots'), project('github:alice/vyyq', 'vyyq', { cwd: vyyqCwd }), project('other', 'other')];
        host.agentsHubSelectedProjectId = 'other';
        expect(ui.resolveHomePinnedProject()?.name).to.equal('other');
    });

    it('falls back to the most recent project once the shown one is gone', () => {
        const { ui, host } = createUi([project('github:alice/vyyq', 'vyyq', { cwd: vyyqCwd })]);
        expect(ui.resolveHomePinnedProject()?.name).to.equal('vyyq');

        host.projects = [project('github:alice/OpenDots', 'OpenDots')];
        expect(ui.resolveHomePinnedProject()?.name).to.equal('OpenDots');
    });
});
