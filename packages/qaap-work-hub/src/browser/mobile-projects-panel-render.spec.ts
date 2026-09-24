// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import type { MobileProjectsPanelContext } from './mobile-projects-panel-context';
import {
    QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE,
    QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND,
} from './qaap-workbench-account-menu';

disableImportJSDOM();

type OpenDesktopIde = typeof import('./mobile-projects-panel-render').openDesktopIdeFromAgentsHubExtracted;

interface OpenIdeHarness {
    readonly ctx: MobileProjectsPanelContext;
    readonly executed: Array<{ readonly id: string; readonly args: unknown[] }>;
    readonly hidden: () => number;
}

function harness(registered: readonly string[]): OpenIdeHarness {
    const executed: Array<{ id: string; args: unknown[] }> = [];
    let hideCount = 0;
    const ctx = {
        commands: {
            getCommand: (id: string) => registered.includes(id) ? { id } : undefined,
            isEnabled: (id: string) => registered.includes(id),
            executeCommand: async (id: string, ...args: unknown[]) => {
                executed.push({ id, args });
                return undefined;
            },
        },
        hide: () => {
            hideCount++;
        },
    } as unknown as MobileProjectsPanelContext;
    return { ctx, executed, hidden: () => hideCount };
}

describe('openDesktopIdeFromAgentsHubExtracted', () => {

    let disableJSDOM: (() => void) | undefined;
    let openDesktopIde: OpenDesktopIde;

    before(function (): void {
        // Loading the render module's import graph cold can exceed mocha's 2s default.
        this.timeout(30_000);
        // The render module pulls in Lumino, which touches `document` at load time.
        disableJSDOM = enableJSDOM();
        openDesktopIde = (require('./mobile-projects-panel-render') as typeof import('./mobile-projects-panel-render'))
            .openDesktopIdeFromAgentsHubExtracted;
    });

    after(() => {
        disableJSDOM?.();
    });

    it('switches the IDE header view to the editor when that command is available', async () => {
        const { ctx, executed, hidden } = harness([QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE, QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND]);
        await openDesktopIde(ctx);
        expect(executed).to.deep.equal([{ id: QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE, args: ['editor'] }]);
        expect(hidden()).to.equal(1);
    });

    it('falls back to the open-desktop-IDE command', async () => {
        const { ctx, executed, hidden } = harness([QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND]);
        await openDesktopIde(ctx);
        expect(executed).to.deep.equal([{ id: QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND, args: [] }]);
        expect(hidden()).to.equal(1);
    });
});
