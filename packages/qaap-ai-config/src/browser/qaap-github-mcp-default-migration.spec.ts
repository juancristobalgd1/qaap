// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { QaapGithubMcpDefaultMigration } from './qaap-github-mcp-default-migration';

const PREF = 'ai-features.mcp.mcpServers';
const LEGACY_GITHUB = { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], autostart: true };
const SLACK = { command: 'npx', args: ['-y', 'slack'], autostart: true };

/** User-scope value plus a separate workspace value; `get` would merge them, `inspect` keeps them apart. */
class FakePreferenceService {
    readonly ready = Promise.resolve();
    readonly sets: Array<{ name: string; value: Record<string, unknown>; scope: PreferenceScope | undefined }> = [];
    readonly listeners: Array<(event: { preferenceName: string }) => void> = [];
    failSet = false;
    workspaceValue: Record<string, unknown> | undefined;

    constructor(public userValue: Record<string, unknown> | undefined) { }

    inspect<T>(name: string): { globalValue: T | undefined; workspaceValue: T | undefined } | undefined {
        return name === PREF ? { globalValue: this.userValue as T | undefined, workspaceValue: this.workspaceValue as T | undefined } : undefined;
    }

    async set(name: string, value: Record<string, unknown>, scope?: PreferenceScope): Promise<void> {
        if (this.failSet) {
            throw new Error('preference write failed');
        }
        this.sets.push({ name, value, scope });
        this.userValue = value;
    }

    onPreferenceChanged(listener: (event: { preferenceName: string }) => void): void {
        this.listeners.push(listener);
    }

    /** Simulates the AI settings sync hydrating the per-user mirror back into the User scope. */
    hydrate(value: Record<string, unknown>): void {
        this.userValue = value;
        this.listeners.forEach(listener => listener({ preferenceName: PREF }));
    }
}

const flush = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) {
        await Promise.resolve();
    }
};

describe('QaapGithubMcpDefaultMigration', () => {

    class TestMigration extends QaapGithubMcpDefaultMigration {
        tenant = false;
        readonly mirrorWrites: Array<Record<string, unknown>> = [];
        protected override isTenant(): boolean {
            return this.tenant;
        }
        protected override async writeMirror(servers: Record<string, unknown>): Promise<void> {
            this.mirrorWrites.push(servers);
        }
    }

    const create = (userValue: Record<string, unknown> | undefined): { migration: TestMigration; prefs: FakePreferenceService } => {
        const prefs = new FakePreferenceService(userValue);
        const migration = new TestMigration();
        Object.assign(migration, { preferenceService: prefs as unknown as PreferenceService });
        return { migration, prefs };
    };
    const isLegacy = (value: unknown): boolean => QaapGithubMcpDefaultMigration.isLegacyGithubEntry(value);

    describe('isLegacyGithubEntry', () => {
        it('accepts the catalog entry in any key order', () => {
            expect(isLegacy({ autostart: true, args: ['-y', '@modelcontextprotocol/server-github'], command: 'npx' })).to.equal(true);
        });

        it('tolerates an empty env, a missing -y, --yes, a pinned version, autostart false or absent and an npx path', () => {
            expect(isLegacy({ ...LEGACY_GITHUB, env: {} })).to.equal(true);
            expect(isLegacy({ ...LEGACY_GITHUB, env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' } })).to.equal(true);
            expect(isLegacy({ ...LEGACY_GITHUB, args: ['@modelcontextprotocol/server-github'] })).to.equal(true);
            expect(isLegacy({ ...LEGACY_GITHUB, args: ['--yes', '@modelcontextprotocol/server-github'] })).to.equal(true);
            expect(isLegacy({ ...LEGACY_GITHUB, args: ['-y', '@modelcontextprotocol/server-github@2025.4.8'] })).to.equal(true);
            expect(isLegacy({ ...LEGACY_GITHUB, autostart: false })).to.equal(true);
            expect(isLegacy({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] })).to.equal(true);
            expect(isLegacy({ ...LEGACY_GITHUB, command: '/opt/homebrew/bin/npx' })).to.equal(true);
            expect(isLegacy({ ...LEGACY_GITHUB, command: 'npx.cmd' })).to.equal(true);
        });

        it('accepts the token-less remote entry the GitHub chat agent persisted', () => {
            expect(isLegacy({ serverUrl: 'https://api.githubcopilot.com/mcp/' })).to.equal(true);
            expect(isLegacy({ serverUrl: 'https://api.githubcopilot.com/mcp', autostart: true })).to.equal(true);
        });

        it('keeps an entry with a credential or a non-empty env value', () => {
            expect(isLegacy({ ...LEGACY_GITHUB, env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'x' } })).to.equal(false);
            expect(isLegacy({ ...LEGACY_GITHUB, env: { CUSTOM_FLAG: 'user-value' } })).to.equal(false);
            expect(isLegacy({ serverUrl: 'https://api.githubcopilot.com/mcp/', serverAuthToken: 'x' })).to.equal(false);
            expect(isLegacy({ serverUrl: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'x' } })).to.equal(false);
            expect(isLegacy({ serverUrl: 'https://api.githubcopilot.com/mcp/', oauth: {} })).to.equal(false);
        });

        it('keeps other commands, other servers, extra args and extra fields', () => {
            expect(isLegacy({ ...LEGACY_GITHUB, command: 'node' })).to.equal(false);
            expect(isLegacy({ ...LEGACY_GITHUB, args: ['-y', '@other/server'] })).to.equal(false);
            expect(isLegacy({ ...LEGACY_GITHUB, args: ['-y', '@modelcontextprotocol/server-github', '--toolsets', 'repos'] })).to.equal(false);
            expect(isLegacy({ ...LEGACY_GITHUB, deferLoading: true })).to.equal(false);
            expect(isLegacy({ serverUrl: 'https://example.com/mcp/' })).to.equal(false);
            expect(isLegacy({ serverUrl: 'https://api.githubcopilot.com/mcp/readonly' })).to.equal(false);
        });

        it('rejects non-object values', () => {
            expect(isLegacy(undefined)).to.equal(false);
            expect(isLegacy(['npx'])).to.equal(false);
            expect(isLegacy('npx')).to.equal(false);
        });
    });

    it('removes the legacy entry from the User scope and keeps the other servers', async () => {
        const { migration, prefs } = create({ github: { ...LEGACY_GITHUB }, slack: SLACK });
        await migration['schedule']();
        expect(prefs.sets).to.have.length(1);
        expect(prefs.sets[0].scope).to.equal(PreferenceScope.User);
        expect(prefs.userValue).to.deep.equal({ slack: SLACK });
    });

    it('writes the cleaned servers to the per-user mirror for a local user, not for a tenant', async () => {
        const local = create({ github: { ...LEGACY_GITHUB }, slack: SLACK });
        await local.migration['schedule']();
        expect(local.migration.mirrorWrites).to.deep.equal([{ slack: SLACK }]);
        const tenant = create({ github: { ...LEGACY_GITHUB }, slack: SLACK });
        tenant.migration.tenant = true;
        await tenant.migration['schedule']();
        expect(tenant.migration.mirrorWrites).to.deep.equal([]);
        expect(tenant.prefs.userValue).to.deep.equal({ slack: SLACK });
    });

    it('does not write the mirror when nothing was removed', async () => {
        const { migration } = create({ slack: SLACK });
        await migration['schedule']();
        expect(migration.mirrorWrites).to.deep.equal([]);
    });

    it('never copies workspace entries into the User scope', async () => {
        const { migration, prefs } = create({ github: { ...LEGACY_GITHUB } });
        prefs.workspaceValue = { project: SLACK };
        await migration['schedule']();
        expect(prefs.userValue).to.deep.equal({});
    });

    it('does not touch a customised github entry', async () => {
        const customised = { ...LEGACY_GITHUB, env: { CUSTOM_FLAG: 'user-value' } };
        const { migration, prefs } = create({ github: customised });
        await migration['schedule']();
        expect(prefs.sets).to.have.length(0);
    });

    it('does nothing without a github entry or without User-scope servers', async () => {
        const a = create({ slack: SLACK });
        await a.migration['schedule']();
        expect(a.prefs.sets).to.have.length(0);
        const b = create(undefined);
        await b.migration['schedule']();
        expect(b.prefs.sets).to.have.length(0);
    });

    it('removes the entry again when the settings mirror hydrates it back after the first removal', async () => {
        const { migration, prefs } = create({ github: { ...LEGACY_GITHUB }, slack: SLACK });
        migration.onStart();
        await flush();
        expect(prefs.userValue).to.deep.equal({ slack: SLACK });
        prefs.hydrate({ github: { ...LEGACY_GITHUB }, slack: SLACK });
        await flush();
        expect(prefs.userValue).to.deep.equal({ slack: SLACK });
        expect(prefs.sets).to.have.length(2);
    });

    it('does not loop: its own write does not trigger another write', async () => {
        const { migration, prefs } = create({ github: { ...LEGACY_GITHUB } });
        migration.onStart();
        await flush();
        prefs.listeners.forEach(listener => listener({ preferenceName: PREF }));
        await flush();
        expect(prefs.sets).to.have.length(1);
    });

    it('swallows a failed write and retries on the next change', async () => {
        const { migration, prefs } = create({ github: { ...LEGACY_GITHUB } });
        prefs.failSet = true;
        const originalWarn = console.warn;
        console.warn = (): void => undefined;
        try {
            await migration['schedule']();
        } finally {
            console.warn = originalWarn;
        }
        expect(prefs.userValue).to.deep.equal({ github: LEGACY_GITHUB });
        prefs.failSet = false;
        await migration['schedule']();
        expect(prefs.userValue).to.deep.equal({});
    });
});
