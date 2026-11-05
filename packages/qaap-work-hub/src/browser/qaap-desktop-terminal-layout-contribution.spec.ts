// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { TerminalCommands } from '@theia/terminal/lib/browser/terminal-frontend-contribution';
import { clearPreferDesktopIde, markPreferDesktopIde, QAAP_PREFER_DESKTOP_IDE_EVENT } from '@theia/qaap-shared-core/lib/common/qaap-mobile-work-surface-preference';
import { QaapDesktopTerminalLayoutContribution } from './qaap-desktop-terminal-layout-contribution';
import { useSuiteAnimationFrameStub, useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

describe('QaapDesktopTerminalLayoutContribution', () => {

    useSuiteJSDOM();
    useSuiteAnimationFrameStub();

    let executed: string[];
    let contribution: QaapDesktopTerminalLayoutContribution;

    /** Desktop viewport with an empty bottom panel: the default terminal is the only thing a setup would open. */
    beforeEach(() => {
        window.sessionStorage.clear();
        clearPreferDesktopIde();
        window.matchMedia = (query: string): MediaQueryList => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
        } as MediaQueryList);
        executed = [];
        contribution = new QaapDesktopTerminalLayoutContribution();
        Object.assign(contribution, {
            shell: {
                pendingUpdates: Promise.resolve(),
                bottomPanel: { isEmpty: true, hasClass: () => false, toggleMaximized: () => undefined },
                isExpanded: () => true,
                expandPanel: () => undefined,
                getWidgets: () => [],
                getAreaFor: () => 'main',
                activateWidget: () => undefined,
                onDidAddWidget: () => undefined,
            },
            stateService: { reachedState: () => Promise.resolve() },
            preferenceService: { ready: Promise.resolve(), get: () => 'classic' },
            commands: {
                getCommand: () => ({ id: TerminalCommands.NEW.id }),
                isEnabled: () => true,
                executeCommand: async (commandId: string) => { executed.push(commandId); },
            },
        });
        contribution.onStart();
    });

    afterEach(() => {
        contribution.onStop();
        clearPreferDesktopIde();
    });

    /** Let the scheduled setup run its awaits and animation frames. */
    async function settle(): Promise<void> {
        for (let i = 0; i < 10; i++) {
            await new Promise(resolve => setTimeout(resolve, 5));
        }
    }

    it('opens no terminal without an IDE preference, even when the setup runs', async () => {
        await (contribution as unknown as { runEnsureDesktopTerminal(): Promise<void> }).runEnsureDesktopTerminal();
        await settle();
        expect(executed).to.deep.equal([]);
    });

    it('does not open a terminal from a side-panel resize without an IDE preference', async () => {
        await contribution.ensureDesktopTerminalNormal();
        await settle();
        expect(executed).to.deep.equal([]);
    });

    it('runs the terminal setup once when the user first opens the IDE', async () => {
        window.dispatchEvent(new window.CustomEvent(QAAP_PREFER_DESKTOP_IDE_EVENT));
        await settle();
        expect(executed).to.deep.equal([]);

        markPreferDesktopIde();
        window.dispatchEvent(new window.CustomEvent(QAAP_PREFER_DESKTOP_IDE_EVENT));
        await settle();
        expect(executed).to.deep.equal([TerminalCommands.NEW.id]);

        window.dispatchEvent(new window.CustomEvent(QAAP_PREFER_DESKTOP_IDE_EVENT));
        await settle();
        expect(executed).to.have.length(1);
    });
});
