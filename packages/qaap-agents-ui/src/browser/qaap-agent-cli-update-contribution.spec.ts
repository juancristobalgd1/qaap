// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import type { QaapAgentCliUpdateInfo, QaapAgentCliUpdateResult } from '../common/qaap-agent-cli-update';

describe('QaapAgentCliUpdateContribution update action', () => {
    let disableJSDOM: (() => void) | undefined;
    let contributionModule: typeof import('./qaap-agent-cli-update-contribution');

    before(() => {
        disableJSDOM = enableJSDOM();
        contributionModule = require('./qaap-agent-cli-update-contribution');
    });

    after(() => disableJSDOM?.());

    it('shows the backend reason and resets the toast so the user can retry', async () => {
        const contribution = Object.create(contributionModule.QaapAgentCliUpdateContribution.prototype) as Record<string, unknown>;
        const updating: boolean[] = [];
        const failures: string[] = [];
        let requestedId: string | undefined;
        const result: QaapAgentCliUpdateResult = { ok: false, id: 'codex', message: 'EACCES: permission denied' };
        Object.assign(contribution, {
            disposed: false,
            toast: {
                root: document.createElement('div'),
                setUpdating: (value: boolean) => { updating.push(value); },
                dispose: () => undefined,
            },
            requestUpdate: async (request: QaapAgentCliUpdateInfo) => {
                requestedId = request.id;
                return result;
            },
            showUpdateFailure: (_request: QaapAgentCliUpdateInfo, message: string) => { failures.push(message); },
        });
        const info: QaapAgentCliUpdateInfo = {
            id: 'codex',
            label: 'Codex',
            bin: 'codex',
            latestVersion: '1.1.0',
            updateAvailable: true,
            updateSupported: true,
        };

        await (contribution as unknown as { runUpdate(request: QaapAgentCliUpdateInfo): Promise<void> }).runUpdate(info);

        expect(requestedId).to.equal('codex');
        expect(failures).to.have.length(1);
        expect(failures[0]).to.contain('EACCES: permission denied');
        expect(updating).to.deep.equal([true, false]);
    });

    it('never shows raw npm output from an older server; the retry offers a short message instead', async () => {
        const contribution = Object.create(contributionModule.QaapAgentCliUpdateContribution.prototype) as Record<string, unknown>;
        const failures: string[] = [];
        const raw = 'Codex update failed: npm error code ENOENT\nnpm error syscall mkdir\nnpm error path /tmp/qaap-home/.npm';
        Object.assign(contribution, {
            disposed: false,
            toast: { root: document.createElement('div'), setUpdating: () => undefined, dispose: () => undefined },
            requestUpdate: async () => ({ ok: false, id: 'codex', message: raw }),
            showUpdateFailure: (_request: QaapAgentCliUpdateInfo, message: string) => { failures.push(message); },
        });
        const info: QaapAgentCliUpdateInfo = {
            id: 'codex', label: 'Codex', bin: 'codex', latestVersion: '1.1.0', updateAvailable: true, updateSupported: true,
        };

        await (contribution as unknown as { runUpdate(request: QaapAgentCliUpdateInfo): Promise<void> }).runUpdate(info);

        expect(failures).to.deep.equal(['Could not update Codex. Try again in a moment.']);
        expect(contributionModule.presentableAgentCliUpdateFailure('Codex update could not reach the npm registry. Check the connection and try again (ENOTFOUND).'))
            .to.equal('Codex update could not reach the npm registry. Check the connection and try again (ENOTFOUND).');
        expect(contributionModule.presentableAgentCliUpdateFailure('npm ERR! code EACCES')).to.equal(undefined);
        expect(contributionModule.presentableAgentCliUpdateFailure('x'.repeat(300))).to.equal(undefined);
    });

    it('shows the full failure in a wrapping notification and re-runs the update when Retry is chosen', async () => {
        const contribution = Object.create(contributionModule.QaapAgentCliUpdateContribution.prototype) as Record<string, unknown>;
        const shown: Array<{ message: string; actions: string[] }> = [];
        const reruns: string[] = [];
        const fullMessage = 'Codex update could not start npm on this server: permission denied (EACCES). Try again; if it keeps failing, contact support.';
        Object.assign(contribution, {
            disposed: false,
            messages: {
                error: (message: string, ...actions: string[]) => {
                    shown.push({ message, actions });
                    return Promise.resolve(actions[0]);
                },
            },
            runUpdate: async (request: QaapAgentCliUpdateInfo) => { reruns.push(request.id); },
        });
        const info: QaapAgentCliUpdateInfo = {
            id: 'codex', label: 'Codex', bin: 'codex', latestVersion: '1.1.0', updateAvailable: true, updateSupported: true,
        };

        (contribution as unknown as { showUpdateFailure(request: QaapAgentCliUpdateInfo, message: string): void })
            .showUpdateFailure(info, fullMessage);
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(shown).to.deep.equal([{ message: fullMessage, actions: ['Retry'] }]);
        expect(reruns).to.deep.equal(['codex']);
    });

    describe('Later (dismiss)', () => {
        const globals = globalThis as unknown as Record<string, unknown>;
        let savedStorage: PropertyDescriptor | undefined;
        let savedFetch: PropertyDescriptor | undefined;
        let stored: Map<string, string>;

        beforeEach(() => {
            savedStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
            savedFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
            stored = new Map<string, string>();
            const storage = {
                getItem: (key: string): string | null => stored.get(key) ?? null,
                setItem: (key: string, value: string): void => { stored.set(key, value); },
            };
            Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
        });

        afterEach(() => {
            restoreGlobal('localStorage', savedStorage);
            restoreGlobal('fetch', savedFetch);
        });

        function restoreGlobal(name: string, descriptor: PropertyDescriptor | undefined): void {
            if (descriptor) {
                Object.defineProperty(globalThis, name, descriptor);
            } else {
                delete globals[name];
            }
        }

        const codex: QaapAgentCliUpdateInfo = {
            id: 'codex', label: 'Codex', bin: 'codex', latestVersion: '0.145.0', updateAvailable: true, updateSupported: true,
        };
        const claude: QaapAgentCliUpdateInfo = {
            id: 'claude', label: 'Claude Code', bin: 'claude', latestVersion: '1.0.1', updateAvailable: true, updateSupported: true,
        };

        it('records every pending update, snoozes for a week and does not show another toast this session', async () => {
            const contribution = Object.create(contributionModule.QaapAgentCliUpdateContribution.prototype) as Record<string, unknown>;
            const disposed: boolean[] = [];
            const presented: string[] = [];
            Object.defineProperty(globalThis, 'fetch', {
                value: async () => ({ ok: true, json: async () => ({ updates: [codex, claude] }) }) as unknown as Response,
                configurable: true,
                writable: true,
            });
            Object.assign(contribution, {
                disposed: false,
                pendingUpdates: [codex, claude],
                toast: { dispose: () => { disposed.push(true); } },
                present: (info: QaapAgentCliUpdateInfo) => { presented.push(info.id); },
            });
            const before = Date.now();

            (contribution as unknown as { dismiss(info: QaapAgentCliUpdateInfo): void }).dismiss(codex);
            await (contribution as unknown as { checkAndShow(): Promise<void> }).checkAndShow();

            expect(disposed).to.deep.equal([true]);
            expect(contribution.toast).to.equal(undefined);
            const stateRaw = JSON.parse(stored.get('qaap.agentCliUpdate.dismissed') ?? '{}') as {
                dismissed: Record<string, string>;
                snoozedUntil: number;
            };
            expect(stateRaw.dismissed).to.deep.equal({ codex: '0.145.0', claude: '1.0.1' });
            expect(stateRaw.snoozedUntil).to.be.within(before + 7 * 24 * 60 * 60 * 1000, Date.now() + 7 * 24 * 60 * 60 * 1000);
            expect(contribution.laterChosenThisSession).to.equal(true);
            expect(presented).to.deep.equal([]);
        });
    });
});
