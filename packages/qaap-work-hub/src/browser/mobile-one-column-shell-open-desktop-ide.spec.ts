// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import { clearPreferDesktopIde, markPreferDesktopIde } from '@theia/qaap-shared-core/lib/browser/mobile-projects-open';
import type { MobileOneColumnShellContributionContext } from './mobile-one-column-shell-contribution-context';
import { openDesktopIdeExtracted, prepareDesktopIdeWorkspaceFromHubExtracted } from './mobile-one-column-shell-contribution-timeline';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

const REPOS = '/workspace/repos/users/alice/acme';

function githubProject(name: string, extra: Partial<MobileProjectEntry> = {}): MobileProjectEntry {
    return {
        id: `github:acme/${name}`,
        name,
        uri: new URI(`file://${REPOS}/${name}`),
        github: { owner: 'acme', name, fullName: `acme/${name}`, htmlUrl: `https://github.com/acme/${name}`, private: false },
        ...extra,
    } as MobileProjectEntry;
}

/** What a fresh `loadProjects()` lists for a repository that is also a recent workspace. */
function recentProject(name: string, extra: Partial<MobileProjectEntry> = {}): MobileProjectEntry {
    const uri = new URI(`file://${REPOS}/${name}`);
    return { id: `recent:${uri.toString()}`, name, uri, ...extra } as MobileProjectEntry;
}

interface Harness {
    readonly ctx: MobileOneColumnShellContributionContext;
    readonly opened: string[];
    readonly events: string[];
    closed: number;
    resolveProjects(projects: MobileProjectEntry[]): void;
}

interface HarnessOptions {
    /** The project the Work Hub header shows when the IDE tab is clicked. */
    readonly shown?: MobileProjectEntry;
    readonly currentCwd?: string;
}

function harness(options: HarnessOptions = {}): Harness {
    let resolveProjects: (projects: MobileProjectEntry[]) => void = () => undefined;
    // Mirrors a cold tenant: `/github/project-sessions` answers only after the click.
    const pendingProjects = new Promise<MobileProjectEntry[]>(resolve => { resolveProjects = resolve; });
    const cwdOf = (project: MobileProjectEntry): string | undefined => project.uri?.path.toString();
    const result: Harness = {
        opened: [],
        events: [],
        closed: 0,
        resolveProjects: projects => {
            result.events.push('project-sessions');
            resolveProjects(projects);
        },
        ctx: undefined as unknown as MobileOneColumnShellContributionContext,
    };
    const ctx = {
        ideFallback: {
            // Like MobileShellIdeFallback.openDesktopIde: the IDE surface becomes the preference.
            openDesktopIde: (): void => {
                markPreferDesktopIde();
                result.events.push('ide');
            },
        },
        projectsPanel: {
            hubHeaderUi: { resolveHeaderProject: (): MobileProjectEntry | undefined => options.shown },
            resolveShellProject: (): MobileProjectEntry | undefined => options.shown,
            getAgentsHubSelectedProjectId: (): string | undefined => undefined,
        },
        projectsService: {
            loadProjects: (): Promise<MobileProjectEntry[]> => pendingProjects,
            getProjectCwd: cwdOf,
            getCurrentWorkspaceCwd: (): string | undefined => options.currentCwd,
            prepareProjectCwd: async (project: MobileProjectEntry): Promise<string | undefined> => cwdOf(project),
            openInCurrentWindowAsync: async (project: MobileProjectEntry): Promise<boolean> => {
                const cwd = cwdOf(project) ?? project.id;
                result.events.push(`open ${cwd}`);
                result.opened.push(cwd);
                return true;
            },
        },
        workspaceService: { close: async (): Promise<void> => { result.closed++; } },
        prepareDesktopIdeWorkspaceFromHub: (selected?: string | MobileProjectEntry): Promise<boolean> =>
            prepareDesktopIdeWorkspaceFromHubExtracted(ctx, selected),
    } as unknown as MobileOneColumnShellContributionContext;
    return Object.assign(result, { ctx });
}

describe('openDesktopIdeExtracted', () => {

    useSuiteJSDOM();

    afterEach(() => {
        clearPreferDesktopIde();
        document.body.replaceChildren();
    });

    it('opens the project the hub shows on a cold hosted start (cached github id, recent id in the fresh list)', async () => {
        // Production 2026-10-05: no workspace root (hosted container), the hub painted from cached
        // project sessions, and the fresh list names the same repo `recent:file:///…`.
        const h = harness({ shown: githubProject('shadcn-landing-page') });
        const done = openDesktopIdeExtracted(h.ctx);
        h.resolveProjects([recentProject('vitesse-lite'), recentProject('shadcn-landing-page')]);
        await done;
        expect(h.opened).to.deep.equal([`${REPOS}/shadcn-landing-page`]);
        expect(h.closed).to.equal(0);
    });

    it('does not wait for project-sessions when the hub already shows the project', async () => {
        const h = harness({ shown: githubProject('shadcn-landing-page') });
        await openDesktopIdeExtracted(h.ctx);
        h.resolveProjects([]);
        expect(h.events).to.deep.equal(['ide', `open ${REPOS}/shadcn-landing-page`, 'project-sessions']);
    });

    it('waits for project-sessions when the hub shows no project yet and opens what it would show', async () => {
        const h = harness();
        const done = openDesktopIdeExtracted(h.ctx);
        await Promise.resolve();
        expect(h.opened).to.deep.equal([]);
        h.resolveProjects([recentProject('vitesse-lite'), recentProject('shadcn-landing-page', { pinned: true })]);
        await done;
        expect(h.opened).to.deep.equal([`${REPOS}/shadcn-landing-page`]);
    });

    it('opens the most recent project when project-sessions arrives with several unpinned projects', async () => {
        const h = harness();
        const done = openDesktopIdeExtracted(h.ctx);
        h.resolveProjects([recentProject('shadcn-landing-page'), recentProject('vitesse-lite')]);
        await done;
        expect(h.opened).to.deep.equal([`${REPOS}/shadcn-landing-page`]);
    });

    it('does not reroot the IDE when the user went back to Agents before project-sessions arrived', async () => {
        const h = harness();
        const done = openDesktopIdeExtracted(h.ctx);
        clearPreferDesktopIde();
        h.resolveProjects([recentProject('shadcn-landing-page')]);
        await done;
        expect(h.opened).to.deep.equal([]);
    });

    it('keeps the workspace when the shown project is already open (trailing slash)', async () => {
        const h = harness({ shown: githubProject('shadcn-landing-page'), currentCwd: `${REPOS}/shadcn-landing-page/` });
        await openDesktopIdeExtracted(h.ctx);
        expect(h.opened).to.deep.equal([]);
        expect(h.closed).to.equal(0);
    });

    it('does nothing on the mobile one-column layout', async () => {
        const matchMedia = window.matchMedia;
        window.matchMedia = ((query: string) => ({ matches: true, media: query })) as unknown as typeof window.matchMedia;
        try {
            const h = harness({ shown: githubProject('shadcn-landing-page') });
            await openDesktopIdeExtracted(h.ctx);
            h.resolveProjects([recentProject('shadcn-landing-page')]);
            expect(h.events).to.deep.equal(['project-sessions']);
        } finally {
            window.matchMedia = matchMedia;
        }
    });
});
