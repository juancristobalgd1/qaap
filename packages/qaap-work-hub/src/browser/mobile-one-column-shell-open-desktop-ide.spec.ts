// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import type { MobileOneColumnShellContributionContext } from './mobile-one-column-shell-contribution-context';
import { openDesktopIdeExtracted } from './mobile-one-column-shell-contribution-timeline';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

describe('openDesktopIdeExtracted', () => {

    useSuiteJSDOM();

    function run(panel: { shown?: string; selected?: string } | undefined): Promise<Array<string | undefined>> {
        const prepared: Array<string | undefined> = [];
        const ctx = {
            ideFallback: { openDesktopIde: (): void => undefined },
            projectsPanel: panel && {
                resolveShellProject: (): MobileProjectEntry | undefined =>
                    panel.shown ? { id: panel.shown } as MobileProjectEntry : undefined,
                getAgentsHubSelectedProjectId: (): string | undefined => panel.selected,
            },
            prepareDesktopIdeWorkspaceFromHub: async (id?: string): Promise<boolean> => {
                prepared.push(id);
                return true;
            },
        } as unknown as MobileOneColumnShellContributionContext;
        return openDesktopIdeExtracted(ctx).then(() => prepared);
    }

    it('roots the IDE on the project the hub shows when none was picked explicitly', async () => {
        expect(await run({ shown: 'github:acme/shadcn-landing-page' }))
            .to.deep.equal(['github:acme/shadcn-landing-page']);
    });

    it('falls back to the explicit selection when the hub resolves no project', async () => {
        expect(await run({ selected: 'b' })).to.deep.equal(['b']);
    });

    it('prepares without a project when there is no projects panel', async () => {
        expect(await run(undefined)).to.deep.equal([undefined]);
    });
});
