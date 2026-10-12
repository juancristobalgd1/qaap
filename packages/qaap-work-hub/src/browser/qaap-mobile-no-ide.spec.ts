// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import {
    clearPreferDesktopIde,
    peekPreferDesktopIde,
    markPreferDesktopIde,
} from '@theia/qaap-shared-core/lib/browser/mobile-projects-open';
import {
    createTranscriptFilesViewServices,
    openTranscriptWorkspaceChange,
    openTranscriptWorkspaceChanges,
    openTranscriptWorkspaceFile,
} from '@theia/qaap-transcript/lib/browser/qaap-transcript-file-open';
import { MobileShellIdeFallbackController } from './mobile-shell-ide-fallback';
import { MobileProjectsExecutionSurfaceTabsUi } from './mobile-projects-execution-surface-tabs-ui';
import { executionSurfaceTabSpecsExtracted } from './mobile-projects-execution-surface-tabs-ui-streaming';
import { openDesktopIdeFromAgentsHubExtracted } from './mobile-projects-panel-render';
import { MobileProjectsReadmeContribution } from './mobile-projects-readme-contribution';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

/**
 * Product rule: in mobile mode (`matchesMobileOneColumnLayout()`) the Theia IDE never opens and the
 * Work Hub offers no path into it. Mobile is stubbed on through `window.matchMedia`.
 */
describe('mobile mode never opens the IDE', () => {

    useSuiteJSDOM();

    const calls: string[] = [];
    let originalMatchMedia: typeof window.matchMedia | undefined;
    const storage = new Map<string, string>();

    const record = (name: string) => (): Promise<undefined> => {
        calls.push(name);
        return Promise.resolve(undefined);
    };

    beforeEach(() => {
        calls.length = 0;
        storage.clear();
        const sessionStorage = {
            getItem: (key: string) => storage.get(key) ?? undefined,
            setItem: (key: string, value: string) => { storage.set(key, value); },
            removeItem: (key: string) => { storage.delete(key); },
            clear: () => { storage.clear(); },
            key: () => undefined,
            length: 0,
        };
        Object.defineProperty(window, 'sessionStorage', { value: sessionStorage, configurable: true });
        (global as unknown as { sessionStorage: Storage }).sessionStorage = sessionStorage as unknown as Storage;
        clearPreferDesktopIde();
        originalMatchMedia = window.matchMedia;
        window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia;
    });

    afterEach(() => {
        window.matchMedia = originalMatchMedia as typeof window.matchMedia;
        clearPreferDesktopIde();
    });

    it('markPreferDesktopIde does not record an IDE preference', () => {
        markPreferDesktopIde();
        expect(peekPreferDesktopIde()).to.equal(false);
    });

    it('transcript file, change and changes openers never touch the editor, SCM or shell', async () => {
        const editorManager = { open: record('EditorManager.open') };
        const workspaceService = { tryGetRoots: () => [] };
        const scmService = { findRepository: () => { calls.push('scmService.findRepository'); return undefined; } };
        const shell = {
            activateWidget: record('shell.activateWidget'),
            addWidget: record('shell.addWidget'),
            expandPanel: () => { calls.push('shell.expandPanel'); },
        };
        const widgetManager = { getOrCreateWidget: record('widgetManager.getOrCreateWidget') };
        await openTranscriptWorkspaceFile('/work/a.ts', workspaceService as never, editorManager as never);
        await openTranscriptWorkspaceChange('/work/a.ts', workspaceService as never, editorManager as never, scmService as never);
        await openTranscriptWorkspaceChanges(shell as never, widgetManager as never);
        expect(calls).to.deep.equal([]);
    });

    it('transcript Files view services expose no IDE actions', () => {
        const commands = { executeCommand: record('commands.executeCommand') };
        const editorManager = { open: record('EditorManager.open') };
        const services = createTranscriptFilesViewServices(
            { tryGetRoots: () => [] } as never,
            {} as never,
            editorManager as never,
            commands as never,
        );
        expect(services.createNewFile).to.equal(undefined);
        expect(services.createNewFolder).to.equal(undefined);
        expect(services.openInEditor).to.equal(undefined);
        expect(calls).to.deep.equal([]);
    });

    it('Work Hub execution surface offers no Terminal tab', () => {
        const ids = executionSurfaceTabSpecsExtracted({} as never).map(spec => spec.id);
        expect(ids).to.not.include('terminal');
        const ui = new MobileProjectsExecutionSurfaceTabsUi({
            executionSurfaceTabByProjectId: new Map([['p', 'terminal']]),
        } as never);
        expect(ui.executionSurfaceTabForProject({ id: 'p' } as never)).to.equal('preview');
    });

    it('Open IDE from the Agents hub runs no command', async () => {
        const ctx = {
            commands: {
                getCommand: () => { calls.push('commands.getCommand'); return {}; },
                isEnabled: () => true,
                executeCommand: record('commands.executeCommand'),
            },
            hide: () => { calls.push('hide'); },
        };
        await openDesktopIdeFromAgentsHubExtracted(ctx as never);
        expect(calls).to.deep.equal([]);
    });

    it('IDE fallback openDesktopIde and README activation stay inert', async () => {
        const hostCalls: string[] = [];
        const host = new Proxy({}, {
            get: (_target, prop) => (...args: unknown[]): unknown => {
                hostCalls.push(String(prop));
                return undefined;
            },
        });
        const fallback = new MobileShellIdeFallbackController({ host, sessionState: {} } as never);
        fallback.openDesktopIde();
        expect(hostCalls).to.deep.equal([]);
        expect(peekPreferDesktopIde()).to.equal(false);

        const readme = new MobileProjectsReadmeContribution() as unknown as { tryOpenReadme(): Promise<boolean> };
        expect(await readme.tryOpenReadme()).to.equal(false);
    });
});
