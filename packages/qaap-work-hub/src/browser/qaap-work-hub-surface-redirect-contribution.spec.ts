// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
const disableImportJSDOM = enableJSDOM();
import { expect } from 'chai';
import type { CommandHandler } from '@theia/core/lib/common/command';
import { clearPreferDesktopIde, markPreferDesktopIde } from '@theia/qaap-shared-core/lib/common/qaap-mobile-work-surface-preference';
import { QAAP_WORK_HUB_OPEN_SETTINGS_COMMAND } from '../common/qaap-work-hub-command-palette';
import { QaapWorkHubSurfaceRedirectContribution } from './qaap-work-hub-surface-redirect-contribution';
disableImportJSDOM();

interface RecordedCall {
    readonly commandId: string;
    readonly args: unknown[];
}

/** Records executeCommand calls and keeps the handlers the contribution registers. */
class FakeCommandRegistry {
    readonly handlers = new Map<string, CommandHandler>();
    readonly executed: RecordedCall[] = [];

    registerHandler(commandId: string, handler: CommandHandler): { dispose(): void } {
        this.handlers.set(commandId, handler);
        return { dispose: (): void => { this.handlers.delete(commandId); } };
    }

    async executeCommand(commandId: string, ...args: unknown[]): Promise<void> {
        this.executed.push({ commandId, args });
    }
}

/** Records notifications; a notification with actions resolves to `answer` (the user's pick). */
class FakeMessages {
    readonly infos: Array<{ message: string; actions: string[] }> = [];
    readonly warnings: string[] = [];
    readonly errors: string[] = [];

    constructor(readonly answer: string | undefined = undefined) { }

    info(message: string, ...actions: string[]): Promise<string | undefined> {
        this.infos.push({ message, actions });
        return Promise.resolve(this.answer);
    }

    warn(message: string): void {
        this.warnings.push(message);
    }

    error(message: string): void {
        this.errors.push(message);
    }
}

/** Stands in for the tenant update service (no network, no reload). */
class FakeTenantUpdate {
    readonly updateCalls: number[] = [];

    constructor(
        readonly readResult: { updatePending: boolean; runningTasks: number } | 'throw',
        readonly outcome = 'applied',
    ) { }

    async readBackendUpdate(): Promise<{ updatePending: boolean; runningTasks: number } | undefined> {
        if (this.readResult === 'throw') {
            throw new Error('offline');
        }
        return this.readResult;
    }

    async updateNow(runningTasks: number): Promise<string> {
        this.updateCalls.push(runningTasks);
        return this.outcome;
    }
}

function createContribution(
    registry: FakeCommandRegistry,
    tenantUpdate: FakeTenantUpdate,
    messages: FakeMessages = new FakeMessages(),
): QaapWorkHubSurfaceRedirectContribution {
    const contribution = new QaapWorkHubSurfaceRedirectContribution();
    const mutable = contribution as unknown as { commands: unknown; tenantUpdate: unknown; messageService: unknown };
    mutable.commands = registry;
    mutable.tenantUpdate = tenantUpdate;
    mutable.messageService = messages;
    contribution.onStart();
    return contribution;
}

function handlerOf(registry: FakeCommandRegistry, commandId: string): CommandHandler {
    const handler = registry.handlers.get(commandId);
    if (!handler) {
        throw new Error(`no handler for ${commandId}`);
    }
    return handler;
}

/** Lets the pending notification answer settle. */
async function settle(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 0));
}

describe('QaapWorkHubSurfaceRedirectContribution', () => {

    afterEach(() => {
        clearPreferDesktopIde();
    });

    describe('settings redirects', () => {
        it('opens the Work Hub section for Settings, Keyboard Shortcuts and Color Theme', async () => {
            const registry = new FakeCommandRegistry();
            createContribution(registry, new FakeTenantUpdate({ updatePending: false, runningTasks: 0 }));

            await handlerOf(registry, 'preferences:open').execute?.();
            await handlerOf(registry, 'keymaps:open').execute?.();
            await handlerOf(registry, 'workbench.action.selectTheme').execute?.();

            expect(registry.executed).to.deep.equal([
                { commandId: QAAP_WORK_HUB_OPEN_SETTINGS_COMMAND, args: ['section:general'] },
                { commandId: QAAP_WORK_HUB_OPEN_SETTINGS_COMMAND, args: ['section:keybindings'] },
                { commandId: QAAP_WORK_HUB_OPEN_SETTINGS_COMMAND, args: ['section:appearance'] },
            ]);
        });

        it('forwards a caller query such as the AI features deep link', async () => {
            const registry = new FakeCommandRegistry();
            createContribution(registry, new FakeTenantUpdate({ updatePending: false, runningTasks: 0 }));

            await handlerOf(registry, 'preferences:open').execute?.('ai-features');

            expect(registry.executed).to.deep.equal([
                { commandId: QAAP_WORK_HUB_OPEN_SETTINGS_COMMAND, args: ['ai-features'] },
            ]);
        });

        it('is enabled only while the Work Hub is the active surface', () => {
            const registry = new FakeCommandRegistry();
            createContribution(registry, new FakeTenantUpdate({ updatePending: false, runningTasks: 0 }));
            const handler = handlerOf(registry, 'keymaps:open');

            expect(handler.isEnabled?.()).to.equal(true);
            markPreferDesktopIde();
            expect(handler.isEnabled?.()).to.equal(false);
            expect(handler.isVisible?.()).to.equal(false);
        });

        it('does not claim File Icon Theme', () => {
            const registry = new FakeCommandRegistry();
            createContribution(registry, new FakeTenantUpdate({ updatePending: false, runningTasks: 0 }));

            expect(registry.handlers.has('workbench.action.selectIconTheme')).to.equal(false);
        });
    });

    describe('Check for Updates', () => {
        const checkForUpdatesId = 'electron-sample:check-for-updates';

        it('shows "Update available" with "Update now" and applies nothing by itself', async () => {
            const registry = new FakeCommandRegistry();
            const tenantUpdate = new FakeTenantUpdate({ updatePending: true, runningTasks: 2 });
            const messages = new FakeMessages();
            createContribution(registry, tenantUpdate, messages);

            await handlerOf(registry, checkForUpdatesId).execute?.();
            await settle();

            expect(messages.infos).to.deep.equal([{ message: 'Update available', actions: ['Update now'] }]);
            expect(tenantUpdate.updateCalls).to.deep.equal([]);
        });

        it('runs the update flow with the running task count when the user picks "Update now"', async () => {
            const registry = new FakeCommandRegistry();
            const tenantUpdate = new FakeTenantUpdate({ updatePending: true, runningTasks: 2 });
            const messages = new FakeMessages('Update now');
            createContribution(registry, tenantUpdate, messages);

            await handlerOf(registry, checkForUpdatesId).execute?.();
            await settle();

            expect(tenantUpdate.updateCalls).to.deep.equal([2]);
            expect(messages.errors).to.deep.equal([]);
        });

        it('applies nothing when the notification is dismissed', async () => {
            const registry = new FakeCommandRegistry();
            const tenantUpdate = new FakeTenantUpdate({ updatePending: true, runningTasks: 0 });
            createContribution(registry, tenantUpdate, new FakeMessages(undefined));

            await handlerOf(registry, checkForUpdatesId).execute?.();
            await settle();

            expect(tenantUpdate.updateCalls).to.deep.equal([]);
        });

        it('reports "Qaap is up to date" when no update is pending and applies nothing', async () => {
            const registry = new FakeCommandRegistry();
            const tenantUpdate = new FakeTenantUpdate({ updatePending: false, runningTasks: 0 });
            const messages = new FakeMessages();
            createContribution(registry, tenantUpdate, messages);

            await handlerOf(registry, checkForUpdatesId).execute?.();
            await settle();

            expect(messages.infos).to.deep.equal([{ message: 'Qaap is up to date.', actions: [] }]);
            expect(tenantUpdate.updateCalls).to.deep.equal([]);
        });

        it('warns and applies nothing when the status cannot be read', async () => {
            const registry = new FakeCommandRegistry();
            const tenantUpdate = new FakeTenantUpdate('throw');
            const messages = new FakeMessages();
            createContribution(registry, tenantUpdate, messages);

            await handlerOf(registry, checkForUpdatesId).execute?.();

            expect(messages.warnings).to.have.length(1);
            expect(messages.infos).to.deep.equal([]);
            expect(tenantUpdate.updateCalls).to.deep.equal([]);
        });

        it('is enabled only while the Work Hub is the active surface', () => {
            const registry = new FakeCommandRegistry();
            createContribution(registry, new FakeTenantUpdate({ updatePending: false, runningTasks: 0 }));
            const handler = handlerOf(registry, checkForUpdatesId);

            expect(handler.isEnabled?.()).to.equal(true);
            markPreferDesktopIde();
            expect(handler.isEnabled?.()).to.equal(false);
        });
    });

    it('removes its handlers on stop', () => {
        const registry = new FakeCommandRegistry();
        const contribution = createContribution(registry, new FakeTenantUpdate({ updatePending: false, runningTasks: 0 }));

        contribution.onStop();

        expect(registry.handlers.size).to.equal(0);
    });
});
