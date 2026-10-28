// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { QAAP_AI_FEATURES_SETTINGS_QUERY } from '@theia/qaap-shared-core/lib/common/qaap-agent-auth-login';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import type { MobileProjectsPanelContext } from './mobile-projects-panel-context';
import { openAgentSignInTerminalExtracted } from './mobile-projects-panel-timeline';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

/** What the user sees in the Connect dialog. */
interface RenderedConnectDialog {
    readonly title: string;
    readonly message: string;
    readonly actions: HTMLButtonElement[];
    readonly dismissLabel: string;
    readonly spinnerVisible: boolean;
}

function connectDialogs(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('.theia-mobile-agent-login-dialog'));
}

function readConnectDialog(): RenderedConnectDialog {
    const dialogs = connectDialogs();
    expect(dialogs, 'exactly one Connect dialog is open').to.have.length(1);
    const dialog = dialogs[0];
    const status = dialog.querySelector<HTMLElement>('.theia-mobile-agent-login-dialog-status');
    return {
        title: dialog.querySelector('h2')?.textContent ?? '',
        message: Array.from(dialog.querySelectorAll('.theia-mobile-agent-login-dialog-message'))
            .map(element => element.textContent ?? '')
            .join('\n'),
        actions: Array.from(dialog.querySelectorAll<HTMLButtonElement>('.theia-mobile-agent-login-dialog-actions button')),
        dismissLabel: dialog.querySelector('.theia-mobile-agent-login-dialog-cancel')?.textContent ?? '',
        spinnerVisible: !!status && !status.hidden && !!status.querySelector('.codicon-loading'),
    };
}

function closeConnectDialogs(): void {
    for (const dialog of connectDialogs()) {
        dialog.querySelector<HTMLButtonElement>('.theia-mobile-agent-login-dialog-close')?.click();
    }
}

/** A Connect click with no open project, transcript or workspace services. */
function createWorkspacelessContext(openedSettings: string[] = []): MobileProjectsPanelContext {
    return {
        transcriptController: { state: {} },
        openPreferencesSheet: (query: string): Promise<void> => {
            openedSettings.push(query);
            return Promise.resolve();
        },
    } as unknown as MobileProjectsPanelContext;
}

describe('Work Hub harness connection actions', () => {

    useSuiteJSDOM();

    let originalFetch: typeof globalThis.fetch | undefined;
    const harnessStatusRequests: string[] = [];

    beforeEach(() => {
        originalFetch = globalThis.fetch;
        harnessStatusRequests.length = 0;
        // Harness status is advisory: an unavailable endpoint must not change what the dialog offers.
        globalThis.fetch = ((input: string | URL | Request): Promise<Response> => {
            harnessStatusRequests.push(String(input));
            return Promise.resolve({ ok: false } as Response);
        }) as typeof globalThis.fetch;
    });

    afterEach(() => {
        closeConnectDialogs();
        globalThis.fetch = originalFetch!;
    });

    // Product rule: QAIQ is the only harness that signs in with an API key.
    for (const agentId of ['qaiq']) {
        it(`opens the dialog with "Add API key in Settings" for ${agentId} immediately, without a workspace`, async () => {
            const openedSettings: string[] = [];

            openAgentSignInTerminalExtracted(createWorkspacelessContext(openedSettings), agentId);

            // Rendered synchronously by the click: no spinner phase before the action shows up.
            const shown = readConnectDialog();
            expect(shown.title).to.match(/^Connect /);
            expect(shown.spinnerVisible).to.equal(false);
            expect(shown.message).to.match(/API key/i);
            expect(shown.message).to.match(/Settings/);
            expect(shown.actions.map(button => button.textContent)).to.deep.equal(['Add API key in Settings']);
            expect(shown.dismissLabel).to.equal('Close');

            // Once the advisory status lookup settles the action is unchanged.
            await new Promise(resolve => setTimeout(resolve, 0));
            const settled = readConnectDialog();
            expect(settled.spinnerVisible).to.equal(false);
            expect(settled.actions.map(button => button.textContent)).to.deep.equal(['Add API key in Settings']);

            settled.actions[0].click();
            expect(openedSettings).to.deep.equal([QAAP_AI_FEATURES_SETTINGS_QUERY]);
            expect(connectDialogs(), 'the Settings link replaces the dialog').to.have.length(0);
        });
    }

    for (const agentId of ['codex', 'claude']) {
        it(`never offers an API key for ${agentId}: Connect is a sign-in, not a Settings link`, async () => {
            const openedSettings: string[] = [];

            openAgentSignInTerminalExtracted(createWorkspacelessContext(openedSettings), agentId);

            const shown = readConnectDialog();
            expect(shown.title).to.match(/^Connect /);
            expect(shown.message).not.to.match(/API key/i);
            expect(shown.actions.map(button => button.textContent)).not.to.include('Add API key in Settings');

            await new Promise(resolve => setTimeout(resolve, 0));
            const settled = readConnectDialog();
            expect(settled.message).not.to.match(/API key/i);
            expect(settled.actions.map(button => button.textContent)).not.to.include('Add API key in Settings');
            expect(openedSettings, 'Settings is never opened for a sign-in harness').to.deep.equal([]);
        });
    }

    it('signs Pi in inside the dialog: without a project it says what is missing instead of sending the user to a terminal', async () => {
        openAgentSignInTerminalExtracted(createWorkspacelessContext(), 'pi');

        const shown = readConnectDialog();
        expect(shown.title).to.equal('Connect Pi');
        expect(shown.spinnerVisible, 'the hidden `/login` route checks the harness first').to.equal(true);

        await new Promise(resolve => setTimeout(resolve, 0));
        const settled = readConnectDialog();
        expect(settled.spinnerVisible).to.equal(false);
        expect(document.querySelector('.theia-mobile-agent-login-dialog-status')?.textContent)
            .to.equal('Open a project first: Pi signs in from a terminal in that workspace.');
        expect(settled.actions.map(button => button.textContent), 'no terminal without a workspace').to.not.include('Open terminal');
    });

    it('keeps Open terminal as the Pi fallback when the in-dialog sign-in cannot run, and runs `pi` there', async () => {
        const launches: Array<{ projectId: string; agentId: string; options: unknown }> = [];
        const ctx = {
            transcriptController: { state: {} },
            transcriptSurfacesUi: {
                launchAgentTuiInTranscriptTerminal: (project: { id: string }, _summary: unknown, agentId: string, options: unknown): Promise<void> => {
                    launches.push({ projectId: project.id, agentId, options });
                    return Promise.resolve();
                },
            },
            projectsService: { getProjectCwd: () => '/workspace/demo' },
            preparedCwdByProjectId: new Map<string, string>(),
        } as unknown as MobileProjectsPanelContext;

        openAgentSignInTerminalExtracted(ctx, 'pi', { id: 'demo', name: 'demo' } as unknown as MobileProjectEntry);
        expect(readConnectDialog().spinnerVisible).to.equal(true);

        // This context has no terminal services, so the hidden sign-in terminal cannot start.
        for (let index = 0; index < 5 && readConnectDialog().spinnerVisible; index++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        const failed = readConnectDialog();
        expect(failed.spinnerVisible).to.equal(false);
        expect(failed.actions.map(button => button.textContent)).to.deep.equal(['Retry', 'Open terminal']);

        failed.actions[1].click();
        expect(launches).to.deep.equal([{ projectId: 'demo', agentId: 'pi', options: { command: 'pi' } }]);
        expect(connectDialogs(), 'the dialog closes once the terminal opens').to.have.length(0);
    });

    it('opens the OpenCode dialog at once and, without a project, says what is missing instead of spinning', async () => {
        // OpenCode has a verified headless login (`opencode auth login -p openai …`), so it takes the
        // CLI route rather than tenant-terminal instructions.
        openAgentSignInTerminalExtracted(createWorkspacelessContext(), 'opencode');

        const shown = readConnectDialog();
        expect(shown.title).to.equal('Connect OpenCode');
        expect(shown.spinnerVisible, 'the CLI route checks the harness first').to.equal(true);

        await new Promise(resolve => setTimeout(resolve, 0));
        const settled = readConnectDialog();
        expect(settled.spinnerVisible).to.equal(false);
        expect(document.querySelector('.theia-mobile-agent-login-dialog-status')?.textContent)
            .to.equal('Open a project first: OpenCode signs in from a terminal in that workspace.');
        expect(settled.dismissLabel).to.equal('Close');
    });

    it('explains the next step for a custom harness without a registered flow', () => {
        openAgentSignInTerminalExtracted(createWorkspacelessContext(), 'custom-harness');

        const shown = readConnectDialog();
        expect(shown.title).to.include('custom-harness');
        expect(shown.spinnerVisible).to.equal(false);
        expect(shown.message).to.include('custom-harness');
        expect(shown.message).to.include('tenant workspace');
        expect(shown.message).to.include('refresh the agent list');
        expect(shown.actions).to.have.length(0);
        expect(shown.dismissLabel).to.equal('Close');
        expect(harnessStatusRequests).to.deep.equal([]);
    });

    it('closes the dialog from its Close button', () => {
        openAgentSignInTerminalExtracted(createWorkspacelessContext(), 'custom-harness');
        expect(connectDialogs()).to.have.length(1);

        document.querySelector<HTMLButtonElement>('.theia-mobile-agent-login-dialog-cancel')?.click();

        expect(connectDialogs()).to.have.length(0);
    });
});
