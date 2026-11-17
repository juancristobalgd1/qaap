// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import type { JSONObject } from '@theia/core/shared/@lumino/coreutils';

/** Keep in sync with `@theia/ai-mcp` `MCP_SERVERS_PREF`. */
const MCP_SERVERS_PREF = 'ai-features.mcp.mcpServers';
const GITHUB_SERVER_NAME = 'github';
const LEGACY_GITHUB_PACKAGE = /^@modelcontextprotocol\/server-github(@[\w.-]+)?$/;
const LEGACY_LOCAL_KEYS = new Set(['command', 'args', 'env', 'autostart']);
const LEGACY_REMOTE_KEYS = new Set(['serverUrl', 'autostart']);
const LEGACY_REMOTE_URL = 'https://api.githubcopilot.com/mcp';

/**
 * Removes the token-less GitHub MCP entries that older builds wrote to `ai-features.mcp.mcpServers.github`:
 *
 * - the marketplace default `npx -y @modelcontextprotocol/server-github` (autostart, no credential), which
 *   launched a GitHub server without a token on every start;
 * - the remote `https://api.githubcopilot.com/mcp/` entry without `serverAuthToken` that the GitHub chat agent
 *   persisted, which cannot authenticate.
 *
 * It is not a one-time migration. The per-user AI settings mirror (`~/.qaap/users/<login>/settings.json`) is
 * hydrated back into the User scope on every start (`QaapUserAiSettingsSync`), so a single removal raced the
 * hydration and the entry came back while the one-time flag stopped any retry. The check now runs once the
 * preferences are ready and again on every change of the setting, and it is idempotent: it writes only while a
 * legacy entry is present in the User scope, and that removal is then pushed to the mirror as usual.
 *
 * A customised entry (a token, a non-empty `env` value, other args, headers, OAuth or any extra field) is never
 * touched. Only the User scope is rewritten; entries in workspace settings are left alone (the MCP contribution
 * still refuses to start a legacy entry, see `QaapMcpFrontendApplicationContribution`).
 */
@injectable()
export class QaapGithubMcpDefaultMigration implements FrontendApplicationContribution {

    @inject(PreferenceService)
    protected readonly preferenceService: PreferenceService;

    protected running: Promise<void> | undefined;
    protected rerunRequested = false;

    /** Whether `value` is one of the token-less GitHub entries written by older builds. */
    static isLegacyGithubEntry(value: unknown): boolean {
        if (typeof value !== 'object' || !value || Array.isArray(value)) {
            return false;
        }
        const entry = value as Record<string, unknown>;
        if (entry.autostart !== undefined && typeof entry.autostart !== 'boolean') {
            return false;
        }
        if ('serverUrl' in entry) {
            return Object.keys(entry).every(key => LEGACY_REMOTE_KEYS.has(key))
                && typeof entry.serverUrl === 'string'
                && entry.serverUrl.trim().replace(/\/+$/, '').toLowerCase() === LEGACY_REMOTE_URL;
        }
        if (!Object.keys(entry).every(key => LEGACY_LOCAL_KEYS.has(key))) {
            return false;
        }
        return QaapGithubMcpDefaultMigration.isNpxCommand(entry.command)
            && QaapGithubMcpDefaultMigration.isLegacyArgs(entry.args)
            && QaapGithubMcpDefaultMigration.isEmptyEnv(entry.env);
    }

    protected static isNpxCommand(command: unknown): boolean {
        if (typeof command !== 'string') {
            return false;
        }
        const base = command.trim().split(/[\\/]/).pop() ?? '';
        return /^npx(\.cmd|\.exe)?$/i.test(base);
    }

    /** Exactly one package argument, the GitHub server (optionally pinned), plus at most `-y` / `--yes`. */
    protected static isLegacyArgs(args: unknown): boolean {
        if (!Array.isArray(args) || !args.every(arg => typeof arg === 'string')) {
            return false;
        }
        const rest = (args as string[]).map(arg => arg.trim()).filter(arg => arg !== '-y' && arg !== '--yes');
        return rest.length === 1 && LEGACY_GITHUB_PACKAGE.test(rest[0]);
    }

    /** No `env`, `{}`, or only empty-string values (no credential, no customisation). */
    protected static isEmptyEnv(env: unknown): boolean {
        if (env === undefined) {
            return true;
        }
        if (typeof env !== 'object' || !env || Array.isArray(env)) {
            return false;
        }
        return Object.values(env).every(value => value === '');
    }

    onStart(): void {
        // Not awaited: startup must not wait for the preference service.
        this.preferenceService.ready.then(() => {
            this.preferenceService.onPreferenceChanged(event => {
                if (event.preferenceName === MCP_SERVERS_PREF) {
                    this.schedule();
                }
            });
            this.schedule();
        });
    }

    /** Serialises runs; a change during a run triggers exactly one more run afterwards. */
    protected schedule(): Promise<void> {
        if (this.running) {
            this.rerunRequested = true;
            return this.running;
        }
        this.running = (async () => {
            try {
                do {
                    this.rerunRequested = false;
                    await this.migrate();
                } while (this.rerunRequested);
            } catch (error) {
                console.warn('[qaap] Removing the legacy GitHub MCP entry failed; it is retried on the next change or start.', error);
            } finally {
                this.running = undefined;
            }
        })();
        return this.running;
    }

    /** Removes the legacy entry from the User scope only; never copies other scopes into it. */
    protected async migrate(): Promise<void> {
        await this.preferenceService.ready;
        const userServers = this.preferenceService.inspect<JSONObject>(MCP_SERVERS_PREF)?.globalValue;
        if (!userServers || typeof userServers !== 'object' || Array.isArray(userServers)
            || !Object.prototype.hasOwnProperty.call(userServers, GITHUB_SERVER_NAME)
            || !QaapGithubMcpDefaultMigration.isLegacyGithubEntry(userServers[GITHUB_SERVER_NAME])) {
            return;
        }
        const next = { ...userServers };
        delete next[GITHUB_SERVER_NAME];
        await this.preferenceService.set(MCP_SERVERS_PREF, next, PreferenceScope.User);
    }
}
