// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    compareSemver,
    isVersionOutdated,
    parseCliVersion,
    pickNextAgentUpdateToShow,
    readAgentCliUpdateDismissMap,
    rememberAgentCliUpdateDismiss,
    shouldShowAgentUpdateNotification,
    type QaapAgentCliUpdateInfo,
} from './qaap-agent-cli-update';

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
});
