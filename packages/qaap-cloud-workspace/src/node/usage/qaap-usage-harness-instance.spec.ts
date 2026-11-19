// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as os from 'os';
import * as path from 'path';
import { QaapUsageScanner } from './qaap-usage-scanner';
import { QaapUsageScannerRegistry } from './qaap-usage-scanner-registry';
import { QaapUsageScanTarget } from './qaap-usage-scan-target';

const HOME = path.join(os.tmpdir(), 'qaap-usage-home');

describe('qaap-usage harness instance logs', () => {

    describe('QaapUsageScanTarget.harnessHome', () => {
        it('reads the instance configuration folder for Codex sessions', () => {
            const target = QaapUsageScanTarget.harnessHome({
                instanceId: 'codex#2',
                env: {},
                backendHome: HOME,
                overrides: { CODEX_HOME: '/Users/me/.codex-work' },
            });
            expect(target.roots.codexSessions).to.equal(path.join('/Users/me/.codex-work', 'sessions'));
        });

        it('reads the instance configuration folder for Claude Code projects', () => {
            const target = QaapUsageScanTarget.harnessHome({
                instanceId: 'claude#2',
                env: {},
                backendHome: HOME,
                overrides: { CLAUDE_CONFIG_DIR: '/Users/me/.claude-work' },
            });
            expect(target.roots.claudeProjects).to.equal(path.join('/Users/me/.claude-work', 'projects'));
        });

        it('leaves the other harness folders on the backend home', () => {
            const target = QaapUsageScanTarget.harnessHome({
                instanceId: 'codex#2',
                env: {},
                backendHome: HOME,
                overrides: { CODEX_HOME: '/Users/me/.codex-work' },
            });
            expect(target.roots.claudeProjects).to.equal(path.join(HOME, '.claude', 'projects'));
        });

        it('keys each instance apart, and apart from the base home', () => {
            const base = QaapUsageScanTarget.ownHome({}, HOME);
            const one = QaapUsageScanTarget.harnessHome({ instanceId: 'codex#2', env: {}, backendHome: HOME, overrides: { CODEX_HOME: '/a' } });
            const two = QaapUsageScanTarget.harnessHome({ instanceId: 'codex#3', env: {}, backendHome: HOME, overrides: { CODEX_HOME: '/a' } });
            expect(one.key).to.not.equal(base.key);
            expect(one.key).to.not.equal(two.key);
        });
    });

    describe('QaapUsageScannerRegistry.forHarnessInstance', () => {
        class TestRegistry extends QaapUsageScannerRegistry {
            created = 0;
            constructor() {
                super();
                // Test double for the owner resolver: the backend's own home, as on desktop.
                (this as unknown as { targets: unknown }).targets = { resolve: () => QaapUsageScanTarget.ownHome({}, HOME) };
            }
            protected override createScanner(): QaapUsageScanner {
                this.created++;
                return new QaapUsageScanner();
            }
        }

        it('caches one scanner per instance and keeps instances apart', () => {
            const registry = new TestRegistry();
            const one = registry.forHarnessInstance('me', 'codex#2', { CODEX_HOME: '/a' });
            const again = registry.forHarnessInstance('me', 'codex#2', { CODEX_HOME: '/a' });
            const other = registry.forHarnessInstance('me', 'codex#3', { CODEX_HOME: '/b' });
            expect(again.scanner).to.equal(one.scanner);
            expect(other.scanner).to.not.equal(one.scanner);
            expect(registry.created).to.equal(2);
        });

        it('serves the owner scanner unchanged when the instance has no folder override', () => {
            const registry = new TestRegistry();
            const base = registry.forOwner('me');
            const instance = registry.forHarnessInstance('me', 'codex#2', {});
            expect(instance.scanner).to.equal(base.scanner);
            expect(instance.target.roots.codexSessions).to.equal(base.target.roots.codexSessions);
        });

        it('keeps the base harness scanner apart from an instance scanner', () => {
            const registry = new TestRegistry();
            const base = registry.forOwner('me');
            const instance = registry.forHarnessInstance('me', 'codex#2', { CODEX_HOME: '/a' });
            expect(instance.scanner).to.not.equal(base.scanner);
            expect(base.target.roots.codexSessions).to.equal(path.join(HOME, '.codex', 'sessions'));
        });
    });
});
