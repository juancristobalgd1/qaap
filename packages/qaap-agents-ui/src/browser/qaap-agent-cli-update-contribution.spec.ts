// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import type { QaapAgentCliUpdateInfo } from '../common/qaap-agent-cli-update';

describe('QaapAgentCliUpdateContribution update action', () => {
    let disableJSDOM: (() => void) | undefined;
    let contributionModule: typeof import('./qaap-agent-cli-update-contribution');

    before(() => {
        disableJSDOM = enableJSDOM();
        contributionModule = require('./qaap-agent-cli-update-contribution');
    });

    after(() => disableJSDOM?.());

    const codex: QaapAgentCliUpdateInfo = {
        id: 'codex', label: 'Codex', bin: 'codex', latestVersion: '1.1.0', updateAvailable: true, updateSupported: true,
    };

    it('closes the large notice at once and hands the install to the tracker', () => {
        const contribution = Object.create(contributionModule.QaapAgentCliUpdateContribution.prototype) as Record<string, unknown>;
        const disposed: boolean[] = [];
        const started: string[] = [];
        Object.assign(contribution, {
            disposed: false,
            toast: { root: document.createElement('div'), dispose: () => { disposed.push(true); } },
            tracker: {
                start: (request: QaapAgentCliUpdateInfo) => {
                    started.push(request.id);
                    return new Promise(() => undefined);
                },
            },
        });

        (contribution as unknown as { runUpdate(request: QaapAgentCliUpdateInfo): void }).runUpdate(codex);

        expect(disposed).to.deep.equal([true]);
        expect(contribution.toast).to.equal(undefined);
        expect(started).to.deep.equal(['codex']);
    });

    it('does not start an in-place install for a harness that ships with the image', () => {
        const contribution = Object.create(contributionModule.QaapAgentCliUpdateContribution.prototype) as Record<string, unknown>;
        const started: string[] = [];
        const infos: string[] = [];
        Object.assign(contribution, {
            disposed: false,
            toast: { root: document.createElement('div'), dispose: () => undefined },
            tracker: { start: (request: QaapAgentCliUpdateInfo) => { started.push(request.id); return Promise.resolve(); } },
            messages: { info: (message: string) => { infos.push(message); } },
            openSettings: () => undefined,
        });

        (contribution as unknown as { runUpdate(request: QaapAgentCliUpdateInfo): void }).runUpdate({
            ...codex, id: 'qaiq', label: 'QAIQ', updateSupported: false,
        });

        expect(started).to.deep.equal([]);
        expect(infos).to.have.length(1);
        expect(infos[0]).to.contain('cannot be updated in-place');
    });

    it('never shows raw npm output from an older server; only a short sentence is presentable', () => {
        const presentable = contributionModule.presentableAgentCliUpdateFailure;
        expect(presentable('Codex update could not reach the npm registry. Check the connection and try again (ENOTFOUND).'))
            .to.equal('Codex update could not reach the npm registry. Check the connection and try again (ENOTFOUND).');
        expect(presentable('npm ERR! code EACCES')).to.equal(undefined);
        expect(presentable('npm error code ENOENT\nnpm error syscall mkdir')).to.equal(undefined);
        expect(presentable('x'.repeat(300))).to.equal(undefined);
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

        const claude: QaapAgentCliUpdateInfo = {
            id: 'claude', label: 'Claude Code', bin: 'claude', latestVersion: '1.0.1', updateAvailable: true, updateSupported: true,
        };
        const codexLater: QaapAgentCliUpdateInfo = { ...codex, latestVersion: '0.145.0' };

        it('records every pending update, snoozes for a week and does not show another toast this session', async () => {
            const contribution = Object.create(contributionModule.QaapAgentCliUpdateContribution.prototype) as Record<string, unknown>;
            const disposed: boolean[] = [];
            const presented: string[] = [];
            Object.defineProperty(globalThis, 'fetch', {
                value: async () => ({ ok: true, json: async () => ({ updates: [codexLater, claude] }) }) as unknown as Response,
                configurable: true,
                writable: true,
            });
            Object.assign(contribution, {
                disposed: false,
                pendingUpdates: [codexLater, claude],
                toast: { dispose: () => { disposed.push(true); } },
                present: (info: QaapAgentCliUpdateInfo) => { presented.push(info.id); },
            });
            const before = Date.now();

            (contribution as unknown as { dismiss(info: QaapAgentCliUpdateInfo): void }).dismiss(codexLater);
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

        it('surfaces at most one automatic notice per day across reloads even when ignored', async () => {
            const presented: string[] = [];
            Object.defineProperty(globalThis, 'fetch', {
                value: async () => ({ ok: true, json: async () => ({ updates: [codexLater] }) }) as unknown as Response,
                configurable: true,
                writable: true,
            });
            const makeContribution = (): Record<string, unknown> => {
                const instance = Object.create(contributionModule.QaapAgentCliUpdateContribution.prototype) as Record<string, unknown>;
                Object.assign(instance, {
                    disposed: false,
                    pendingUpdates: [],
                    laterChosenThisSession: false,
                    present: (info: QaapAgentCliUpdateInfo) => { presented.push(info.id); },
                });
                return instance;
            };

            const firstBoot = makeContribution();
            await (firstBoot as unknown as { checkAndShow(): Promise<void> }).checkAndShow();
            expect(presented).to.deep.equal(['codex']);

            // User reloads without clicking Later: the second boot within 24h stays quiet.
            const secondBoot = makeContribution();
            await (secondBoot as unknown as { checkAndShow(): Promise<void> }).checkAndShow();
            expect(presented).to.deep.equal(['codex']);

            // Explicitly completing an update still advances to the next pending CLI without being blocked by the 24h boot cap.
            Object.defineProperty(globalThis, 'fetch', {
                value: async () => ({ ok: true, json: async () => ({ updates: [claude] }) }) as unknown as Response,
                configurable: true,
                writable: true,
            });
            await (firstBoot as unknown as { checkAndShow(trigger?: 'boot' | 'afterUpdate'): Promise<void> }).checkAndShow('afterUpdate');
            expect(presented).to.deep.equal(['codex', 'claude']);
        });

        it('suppresses automatic boot update toasts on narrow mobile viewports', async () => {
            const presented: string[] = [];
            const originalMatchMedia = window.matchMedia;
            Object.defineProperty(globalThis, 'fetch', {
                value: async () => ({ ok: true, json: async () => ({ updates: [codexLater] }) }) as unknown as Response,
                configurable: true,
                writable: true,
            });
            window.matchMedia = ((query: string) => ({
                matches: query === '(max-width: 767px)',
                media: query,
            })) as typeof window.matchMedia;
            try {
                const instance = Object.create(contributionModule.QaapAgentCliUpdateContribution.prototype) as Record<string, unknown>;
                Object.assign(instance, {
                    disposed: false,
                    pendingUpdates: [],
                    laterChosenThisSession: false,
                    present: (info: QaapAgentCliUpdateInfo) => { presented.push(info.id); },
                });
                await (instance as unknown as { checkAndShow(trigger?: 'boot' | 'afterUpdate'): Promise<void> }).checkAndShow('boot');
                expect(presented).to.deep.equal([]);
            } finally {
                window.matchMedia = originalMatchMedia;
            }
        });
    });
});
