// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { QaapGithubMcpDefaultMigration } from './qaap-github-mcp-default-migration';

const LEGACY_GITHUB = { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], autostart: true };

class FakePreferenceService {
    readonly ready = Promise.resolve();
    readonly sets: Array<{ name: string; value: Record<string, unknown>; scope: PreferenceScope | undefined }> = [];
    failSet = false;

    constructor(public values: Record<string, unknown>) { }

    get<T>(name: string, defaultValue?: T): T {
        return (this.values[name] ?? defaultValue) as T;
    }

    async set(name: string, value: Record<string, unknown>, scope?: PreferenceScope): Promise<void> {
        if (this.failSet) {
            throw new Error('preference write failed');
        }
        this.sets.push({ name, value, scope });
        this.values[name] = value;
    }
}

/** Keeps the one-time flag in memory instead of localStorage, which the node test environment lacks. */
class TestGithubMcpDefaultMigration extends QaapGithubMcpDefaultMigration {
    flag = false;
    protected override readMigrationFlag(): boolean {
        return this.flag;
    }
    protected override writeMigrationFlag(): void {
        this.flag = true;
    }
}

describe('QaapGithubMcpDefaultMigration', () => {

    const createMigration = (prefs: Record<string, unknown>): { migration: TestGithubMcpDefaultMigration; prefs: FakePreferenceService } => {
        const fake = new FakePreferenceService(prefs);
        const migration = new TestGithubMcpDefaultMigration();
        Object.assign(migration, { preferenceService: fake as unknown as PreferenceService });
        return { migration, prefs: fake };
    };

    describe('isExactLegacyDefault', () => {
        it('accepts the catalog entry regardless of key order', () => {
            expect(QaapGithubMcpDefaultMigration.isExactLegacyDefault({ autostart: true, args: ['-y', '@modelcontextprotocol/server-github'], command: 'npx' })).to.equal(true);
        });

        it('rejects an entry with extra keys such as env or a token', () => {
            expect(QaapGithubMcpDefaultMigration.isExactLegacyDefault({ ...LEGACY_GITHUB, env: { A: 'b' } })).to.equal(false);
            expect(QaapGithubMcpDefaultMigration.isExactLegacyDefault({ ...LEGACY_GITHUB, extraField: 'x' })).to.equal(false);
        });

        it('rejects a different command, args or autostart', () => {
            expect(QaapGithubMcpDefaultMigration.isExactLegacyDefault({ ...LEGACY_GITHUB, command: 'node' })).to.equal(false);
            expect(QaapGithubMcpDefaultMigration.isExactLegacyDefault({ ...LEGACY_GITHUB, args: ['-y', '@other/server'] })).to.equal(false);
            expect(QaapGithubMcpDefaultMigration.isExactLegacyDefault({ ...LEGACY_GITHUB, autostart: false })).to.equal(false);
        });

        it('rejects non-object values', () => {
            expect(QaapGithubMcpDefaultMigration.isExactLegacyDefault(undefined)).to.equal(false);
            expect(QaapGithubMcpDefaultMigration.isExactLegacyDefault(['npx'])).to.equal(false);
            expect(QaapGithubMcpDefaultMigration.isExactLegacyDefault('npx')).to.equal(false);
        });
    });

    it('removes an entry that matches the legacy default exactly and keeps the other servers', async () => {
        const { migration, prefs } = createMigration({
            'ai-features.mcp.mcpServers': { github: { ...LEGACY_GITHUB }, slack: { command: 'npx', args: ['-y', 'slack'], autostart: true } }
        });
        await migration['migrate']();
        expect(prefs.sets).to.have.length(1);
        expect(prefs.sets[0].scope).to.equal(PreferenceScope.User);
        expect(prefs.values['ai-features.mcp.mcpServers']).to.deep.equal({
            slack: { command: 'npx', args: ['-y', 'slack'], autostart: true }
        });
        expect(migration.flag).to.equal(true);
    });

    it('does not touch a customised github entry', async () => {
        const customised = { ...LEGACY_GITHUB, env: { CUSTOM_FLAG: 'user-value' } };
        const { migration, prefs } = createMigration({ 'ai-features.mcp.mcpServers': { github: customised } });
        await migration['migrate']();
        expect(prefs.sets).to.have.length(0);
        expect(prefs.values['ai-features.mcp.mcpServers']).to.deep.equal({ github: customised });
        expect(migration.flag).to.equal(true);
    });

    it('does not touch a github entry that only changed its args', async () => {
        const changed = { ...LEGACY_GITHUB, args: ['-y', '@modelcontextprotocol/server-github@1.0.0'] };
        const { migration, prefs } = createMigration({ 'ai-features.mcp.mcpServers': { github: changed } });
        await migration['migrate']();
        expect(prefs.sets).to.have.length(0);
        expect(prefs.values['ai-features.mcp.mcpServers']).to.deep.equal({ github: changed });
    });

    it('does nothing when no github entry exists', async () => {
        const servers = { slack: { command: 'npx', args: ['-y', 'slack'], autostart: true } };
        const { migration, prefs } = createMigration({ 'ai-features.mcp.mcpServers': servers });
        await migration['migrate']();
        expect(prefs.sets).to.have.length(0);
        expect(migration.flag).to.equal(true);
    });

    it('runs only once: a set flag skips the check entirely', async () => {
        const { migration, prefs } = createMigration({ 'ai-features.mcp.mcpServers': { github: { ...LEGACY_GITHUB } } });
        migration.flag = true;
        await migration['migrate']();
        expect(prefs.sets).to.have.length(0);
        expect(prefs.values['ai-features.mcp.mcpServers']).to.deep.equal({ github: LEGACY_GITHUB });
    });

    it('leaves the flag unset when the write fails, so the next start retries', async () => {
        const { migration, prefs } = createMigration({ 'ai-features.mcp.mcpServers': { github: { ...LEGACY_GITHUB } } });
        prefs.failSet = true;
        let thrown: unknown;
        try {
            await migration['migrate']();
        } catch (error) {
            thrown = error;
        }
        expect(thrown).to.be.instanceOf(Error);
        expect(migration.flag).to.equal(false);
    });
});
