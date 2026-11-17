// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';

/** Keep in sync with `@theia/ai-mcp` `MCP_SERVERS_PREF`. */
const MCP_SERVERS_PREF = 'ai-features.mcp.mcpServers';
const GITHUB_SERVER_NAME = 'github';
/** One-time flag; a missing or unreadable storage only means the (idempotent) check runs again. */
const MIGRATION_FLAG_KEY = 'qaap.migration.githubMcpDefaultRemoved.v1';

/**
 * The entry the marketplace catalog used to install for GitHub (`npx -y @modelcontextprotocol/server-github`,
 * autostart, no token). The catalog no longer ships it, so existing installs keep it only by its exact shape.
 */
export const QAAP_LEGACY_GITHUB_MCP_DEFAULT: Readonly<{ command: string; args: readonly string[]; autostart: boolean }> = {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    autostart: true,
};

/**
 * One-time migration that removes the legacy GitHub marketplace default from `ai-features.mcp.mcpServers`.
 *
 * Only an entry that matches the legacy default EXACTLY is removed: same keys (no `env`, no token, no
 * extra fields), same `command`, same `args` and same `autostart`. A customised entry is never touched.
 */
@injectable()
export class QaapGithubMcpDefaultMigration implements FrontendApplicationContribution {

    @inject(PreferenceService)
    protected readonly preferenceService: PreferenceService;

    /**
     * Whether `value` is exactly the legacy catalog default: a plain object whose keys are exactly the
     * legacy keys, with the same `command`, `args` and `autostart`.
     */
    static isExactLegacyDefault(value: unknown): boolean {
        if (typeof value !== 'object' || !value || Array.isArray(value)) {
            return false;
        }
        const actual = value as Record<string, unknown>;
        const expectedKeys = Object.keys(QAAP_LEGACY_GITHUB_MCP_DEFAULT).sort();
        const actualKeys = Object.keys(actual).sort();
        if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
            return false;
        }
        const actualArgs = actual.args;
        return actual.command === QAAP_LEGACY_GITHUB_MCP_DEFAULT.command
            && actual.autostart === QAAP_LEGACY_GITHUB_MCP_DEFAULT.autostart
            && Array.isArray(actualArgs)
            && actualArgs.length === QAAP_LEGACY_GITHUB_MCP_DEFAULT.args.length
            && actualArgs.every((arg, index) => arg === QAAP_LEGACY_GITHUB_MCP_DEFAULT.args[index]);
    }

    onStart(): void {
        // Not awaited: startup must not wait for the preference service.
        this.migrate().catch(error => console.warn('[qaap] GitHub MCP default migration failed; it will run again on the next start.', error));
    }

    /** Runs the migration once per browser profile; the flag is written only after the check succeeded. */
    protected async migrate(): Promise<void> {
        if (this.readMigrationFlag()) {
            return;
        }
        await this.preferenceService.ready;
        const current = this.preferenceService.get<Record<string, unknown>>(MCP_SERVERS_PREF, {});
        if (Object.prototype.hasOwnProperty.call(current, GITHUB_SERVER_NAME)
            && QaapGithubMcpDefaultMigration.isExactLegacyDefault(current[GITHUB_SERVER_NAME])) {
            const next = { ...current };
            delete next[GITHUB_SERVER_NAME];
            await this.preferenceService.set(MCP_SERVERS_PREF, next, PreferenceScope.User);
        }
        this.writeMigrationFlag();
    }

    protected readMigrationFlag(): boolean {
        try {
            return globalThis.localStorage?.getItem(MIGRATION_FLAG_KEY) === '1';
        } catch {
            return false;
        }
    }

    protected writeMigrationFlag(): void {
        try {
            globalThis.localStorage?.setItem(MIGRATION_FLAG_KEY, '1');
        } catch {
            // Storage is blocked (private window or cleared site data): the check simply runs again.
        }
    }
}
