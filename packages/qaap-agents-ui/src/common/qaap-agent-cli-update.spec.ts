// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    compareSemver,
    isAgentCliUpdateSnoozed,
    isVersionOutdated,
    parseCliVersion,
    pickNextAgentUpdateToShow,
    QAAP_AGENT_CLI_UPDATE_DISMISS_KEY,
    QAAP_AGENT_CLI_UPDATE_SNOOZE_MS,
    readAgentCliUpdateDismissMap,
    readAgentCliUpdateState,
    rememberAgentCliUpdateDismiss,
    requestAgentCliUpdate,
    shouldShowAgentUpdateNotification,
    snoozeAgentCliUpdates,
    type QaapAgentCliUpdateInfo,
} from './qaap-agent-cli-update';

function createMemoryStorage(initial?: string): Pick<Storage, 'getItem' | 'setItem'> {
    const store = new Map<string, string>();
    if (initial !== undefined) {
        store.set(QAAP_AGENT_CLI_UPDATE_DISMISS_KEY, initial);
    }
    return {
        getItem: (key: string): string | null => store.get(key) ?? null,
        setItem: (key: string, value: string): void => { store.set(key, value); },
    };
}

describe('qaap-agent-cli-update', () => {
    describe('parseCliVersion', () => {
        it('extracts semver from Codex-style output', () => {
            expect(parseCliVersion('codex-cli 0.145.0')).to.equal('0.145.0');
        });

        it('extracts semver from Claude-style output', () => {
            expect(parseCliVersion('1.0.48 (Claude Code)')).to.equal('1.0.48');
        });

        it('extracts prerelease tags', () => {
            expect(parseCliVersion('qaiq 1.2.3-beta.1')).to.equal('1.2.3-beta.1');
        });

        it('returns undefined when no semver is present', () => {
            expect(parseCliVersion('not a version')).to.equal(undefined);
            expect(parseCliVersion(undefined)).to.equal(undefined);
        });
    });

    describe('compareSemver / isVersionOutdated', () => {
        it('orders core versions', () => {
            expect(compareSemver('0.144.5', '0.145.0')).to.be.lessThan(0);
            expect(compareSemver('0.145.0', '0.145.0')).to.equal(0);
            expect(compareSemver('1.0.0', '0.9.9')).to.be.greaterThan(0);
        });

        it('treats release as newer than prerelease of the same core', () => {
            expect(compareSemver('1.0.0', '1.0.0-beta')).to.be.greaterThan(0);
            expect(isVersionOutdated('1.0.0-beta', '1.0.0')).to.equal(true);
        });

        it('does not mark unknown / equal versions as outdated', () => {
            expect(isVersionOutdated(undefined, '1.0.0')).to.equal(false);
            expect(isVersionOutdated('1.0.0', undefined)).to.equal(false);
            expect(isVersionOutdated('1.0.0', '1.0.0')).to.equal(false);
            expect(isVersionOutdated('not-semver', '1.0.0')).to.equal(false);
        });
    });

    describe('shouldShowAgentUpdateNotification / dismiss', () => {
        const info: QaapAgentCliUpdateInfo = {
            id: 'codex',
            label: 'Codex',
            bin: 'codex',
            installedVersion: '0.144.5',
            latestVersion: '0.145.0',
            updateAvailable: true,
            npmPackage: '@openai/codex',
            updateSupported: true,
        };

        it('shows when update is available and not dismissed', () => {
            expect(shouldShowAgentUpdateNotification(info, {})).to.equal(true);
            expect(shouldShowAgentUpdateNotification(info, undefined)).to.equal(true);
        });

        it('hides when the same latest version was dismissed', () => {
            expect(shouldShowAgentUpdateNotification(info, { codex: '0.145.0' })).to.equal(false);
        });

        it('re-shows when a newer latest version appears after dismiss', () => {
            expect(shouldShowAgentUpdateNotification(
                { ...info, latestVersion: '0.146.0' },
                { codex: '0.145.0' },
            )).to.equal(true);
        });

        it('never shows when updateAvailable is false', () => {
            expect(shouldShowAgentUpdateNotification(
                { ...info, updateAvailable: false },
                {},
            )).to.equal(false);
        });

        it('persists dismiss map in storage', () => {
            const store = new Map<string, string>();
            const storage = {
                getItem: (key: string): string | null => store.get(key) ?? null,
                setItem: (key: string, value: string): void => { store.set(key, value); },
            };
            rememberAgentCliUpdateDismiss('codex', '0.145.0', storage);
            expect(readAgentCliUpdateDismissMap(storage)).to.deep.equal({ codex: '0.145.0' });
        });
    });

    describe('snoozeAgentCliUpdates / isAgentCliUpdateSnoozed', () => {
        const now = 1_800_000_000_000;
        const day = 24 * 60 * 60 * 1000;

        it('dismisses every pending update and snoozes for seven days', () => {
            const storage = createMemoryStorage();
            snoozeAgentCliUpdates([
                { id: 'codex', latestVersion: '0.145.0', updateAvailable: true },
                { id: 'claude', latestVersion: '1.0.1', updateAvailable: true },
                { id: 'qaiq', latestVersion: '2.0.0', updateAvailable: false },
            ], now, storage);

            expect(readAgentCliUpdateDismissMap(storage)).to.deep.equal({ codex: '0.145.0', claude: '1.0.1' });
            expect(readAgentCliUpdateState(storage).snoozedUntil).to.equal(now + QAAP_AGENT_CLI_UPDATE_SNOOZE_MS);
            expect(QAAP_AGENT_CLI_UPDATE_SNOOZE_MS).to.equal(7 * day);
            expect(isAgentCliUpdateSnoozed(now + 6 * day, storage)).to.equal(true);
            expect(isAgentCliUpdateSnoozed(now + 7 * day, storage)).to.equal(false);
        });

        it('keeps the snooze when a single dismiss is recorded afterwards', () => {
            const storage = createMemoryStorage();
            snoozeAgentCliUpdates([{ id: 'codex', latestVersion: '0.145.0', updateAvailable: true }], now, storage);
            rememberAgentCliUpdateDismiss('claude', '1.0.1', storage);

            expect(readAgentCliUpdateState(storage)).to.deep.equal({
                dismissed: { codex: '0.145.0', claude: '1.0.1' },
                snoozedUntil: now + QAAP_AGENT_CLI_UPDATE_SNOOZE_MS,
            });
        });

        it('reads the legacy flat dismiss map without a snooze', () => {
            const storage = createMemoryStorage(JSON.stringify({ codex: '0.145.0', bogus: 3 }));

            expect(readAgentCliUpdateState(storage)).to.deep.equal({ dismissed: { codex: '0.145.0' } });
            expect(isAgentCliUpdateSnoozed(now, storage)).to.equal(false);
        });

        it('treats corrupt or ignored stored values as no snooze', () => {
            expect(isAgentCliUpdateSnoozed(now, createMemoryStorage('not json'))).to.equal(false);
            expect(readAgentCliUpdateState(createMemoryStorage('not json'))).to.deep.equal({ dismissed: {} });
            expect(isAgentCliUpdateSnoozed(now, createMemoryStorage(JSON.stringify({ dismissed: {}, snoozedUntil: 'soon' })))).to.equal(false);
        });
    });

    describe('pickNextAgentUpdateToShow', () => {
        it('prioritizes Codex over OpenCode', () => {
            const updates: QaapAgentCliUpdateInfo[] = [
                {
                    id: 'opencode',
                    label: 'OpenCode',
                    bin: 'opencode',
                    installedVersion: '1.0.0',
                    latestVersion: '1.1.0',
                    updateAvailable: true,
                    updateSupported: true,
                },
                {
                    id: 'codex',
                    label: 'Codex',
                    bin: 'codex',
                    installedVersion: '0.144.5',
                    latestVersion: '0.145.0',
                    updateAvailable: true,
                    updateSupported: true,
                },
            ];
            expect(pickNextAgentUpdateToShow(updates, {})?.id).to.equal('codex');
        });

        it('skips dismissed entries and returns the next priority', () => {
            const updates: QaapAgentCliUpdateInfo[] = [
                {
                    id: 'codex',
                    label: 'Codex',
                    bin: 'codex',
                    installedVersion: '0.144.5',
                    latestVersion: '0.145.0',
                    updateAvailable: true,
                    updateSupported: true,
                },
                {
                    id: 'claude',
                    label: 'Claude Code',
                    bin: 'claude',
                    installedVersion: '1.0.0',
                    latestVersion: '1.0.1',
                    updateAvailable: true,
                    updateSupported: true,
                },
            ];
            expect(pickNextAgentUpdateToShow(updates, { codex: '0.145.0' })?.id).to.equal('claude');
            expect(pickNextAgentUpdateToShow(updates, {
                codex: '0.145.0',
                claude: '1.0.1',
            })).to.equal(undefined);
        });
    });

    describe('requestAgentCliUpdate', () => {
        it('returns the backend failure detail so the user can act on it', async () => {
            const result = await requestAgentCliUpdate('codex', async () => ({
                ok: false,
                status: 400,
                json: async () => ({ error: 'EACCES: permission denied' }),
            } as Response));

            expect(result).to.deep.equal({
                ok: false,
                id: 'codex',
                message: 'EACCES: permission denied',
            });
        });
    });
});
