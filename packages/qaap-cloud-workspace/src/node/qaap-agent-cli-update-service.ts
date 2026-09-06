// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { spawnSync } from 'child_process';
import * as https from 'https';
import {
    isVersionOutdated,
    parseCliVersion,
    type QaapAgentCliUpdateInfo,
    type QaapAgentCliUpdateResult,
    type QaapAgentCliUpdatesResponse,
} from '@theia/qaap-mobile-shell/lib/common/qaap-agent-cli-update';
import { isQaapProductionRuntime } from './qaap-agent-spawn-identity';
import { isOnPath } from './qaap-agent-task-runner-utils';

/** Operator opt-in for in-place `npm install -g` on hosted/production backends. */
export const QAAP_ALLOW_IN_PLACE_CLI_UPDATE = 'QAAP_ALLOW_IN_PLACE_CLI_UPDATE';

/**
 * Hosted/production: deny mutating global agent CLIs unless the operator opts in.
 * Local/dev: allow (single-user box). Prefer rebuilding immutable images in cloud.
 */
export function isInPlaceCliUpdateAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
    if (!isQaapProductionRuntime(env)) {
        return true;
    }
    const raw = env[QAAP_ALLOW_IN_PLACE_CLI_UPDATE]?.trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/** npm registry GET timeout — boot toast must never block the backend event loop long. */
const NPM_FETCH_TIMEOUT_MS = 4_000;
/** Cache npm `latest` lookups for the process lifetime (and a short TTL for freshness). */
const NPM_CACHE_TTL_MS = 30 * 60_000;
/** Cap in-place `npm install -g` so a hung registry cannot wedge the UI action. */
const NPM_INSTALL_TIMEOUT_MS = 120_000;

interface TrackedAgentCli {
    readonly id: string;
    readonly label: string;
    readonly bins: readonly string[];
    readonly npmPackage?: string;
    /** Optional env override for a minimum / expected version (skips npm when set and not `latest`). */
    readonly expectedVersionEnv?: string;
}

/**
 * CLIs we can version-check for the boot "Update Available" toast.
 * npm-backed agents support in-place update; QAIQ/OpenClaude are git-layered in Docker (updateSupported=false).
 */
const TRACKED_AGENT_CLIS: readonly TrackedAgentCli[] = [
    {
        id: 'codex',
        label: 'Codex',
        bins: ['codex'],
        npmPackage: '@openai/codex',
        expectedVersionEnv: 'CODEX_CLI_VERSION',
    },
    {
        id: 'claude',
        label: 'Claude Code',
        bins: ['claude'],
        npmPackage: '@anthropic-ai/claude-code',
        expectedVersionEnv: 'CLAUDE_CODE_VERSION',
    },
    {
        id: 'opencode',
        label: 'OpenCode',
        bins: ['opencode'],
        npmPackage: 'opencode-ai',
        expectedVersionEnv: 'OPENCODE_CLI_VERSION',
    },
    {
        id: 'copilot',
        label: 'Copilot CLI',
        bins: ['copilot'],
        npmPackage: '@github/copilot',
        expectedVersionEnv: 'COPILOT_CLI_VERSION',
    },
    {
        id: 'antigravity',
        label: 'Antigravity CLI',
        bins: ['antigravity', 'agy', 'ag'],
        npmPackage: '@sanchaymittal/antigravity-cli',
        expectedVersionEnv: 'ANTIGRAVITY_CLI_VERSION',
    },
    {
        id: 'qaiq',
        label: 'QAIQ',
        bins: ['qaiq'],
        // No public npm package — Docker rebuild / QAIQ_REF bump is the real update path.
        expectedVersionEnv: 'QAAP_QAIQ_MIN_VERSION',
    },
    {
        id: 'openclaude',
        label: 'OpenClaude',
        bins: ['openclaude'],
        // The OpenClaude harness is shipped alongside QAIQ; rebuild the image to update it.
        expectedVersionEnv: 'QAAP_QAIQ_MIN_VERSION',
    },
];

interface NpmLatestCacheEntry {
    readonly version: string | undefined;
    readonly at: number;
}

/**
 * Probes installed agent CLIs, compares against npm `latest` (or env pins), and can attempt
 * an in-place `npm install -g` for whitelisted packages.
 *
 * Disable entirely with `QAAP_AGENT_CLI_UPDATE_CHECK=0` (air-gapped / CI).
 */
@injectable()
export class QaapAgentCliUpdateService {

    protected readonly npmLatestCache = new Map<string, NpmLatestCacheEntry>();
    protected listInFlight: Promise<QaapAgentCliUpdatesResponse> | undefined;

    isUpdateCheckEnabled(): boolean {
        const raw = process.env.QAAP_AGENT_CLI_UPDATE_CHECK?.trim().toLowerCase();
        return !(raw === '0' || raw === 'false' || raw === 'off' || raw === 'no');
    }

    isInPlaceCliUpdateAllowed(): boolean {
        return isInPlaceCliUpdateAllowed();
    }

    /** Outdated CLIs only — empty when check disabled or everything is current. */
    async listOutdated(): Promise<QaapAgentCliUpdatesResponse> {
        if (!this.isUpdateCheckEnabled()) {
            return { updates: [] };
        }
        if (!this.listInFlight) {
            this.listInFlight = this.collectOutdated().finally(() => {
                this.listInFlight = undefined;
            });
        }
        return this.listInFlight;
    }

    /**
     * Best-effort in-place update for a whitelisted npm package.
     * QAIQ and unknown agents return a clear non-ok message (no shell injection — id is mapped).
     * Hosted/production denies unless `QAAP_ALLOW_IN_PLACE_CLI_UPDATE` is set.
     */
    async installUpdate(agentId: string): Promise<QaapAgentCliUpdateResult> {
        const id = agentId.trim().toLowerCase();
        if (!this.isUpdateCheckEnabled()) {
            return {
                ok: false,
                id,
                message: 'Agent CLI update checks are disabled (QAAP_AGENT_CLI_UPDATE_CHECK=0).',
            };
        }
        if (!this.isInPlaceCliUpdateAllowed()) {
            return {
                ok: false,
                id,
                message: 'In-place CLI updates are disabled on hosted/production deployments. '
                    + 'Rebuild the Qaap image with updated CLI pins (or set QAAP_ALLOW_IN_PLACE_CLI_UPDATE=1).',
            };
        }
        const tracked = TRACKED_AGENT_CLIS.find(entry => entry.id === id);
        if (!tracked) {
            return { ok: false, id, message: `Unknown agent CLI: ${agentId}` };
        }
        if (!tracked.npmPackage) {
            return {
                ok: false,
                id: tracked.id,
                message: `${tracked.label} is not updated in-place. Rebuild the Qaap image (or bump QAIQ_REF) to pick up a newer CLI.`,
            };
        }
        const install = spawnSync(
            'npm',
            ['install', '-g', `${tracked.npmPackage}@latest`],
            { encoding: 'utf8', timeout: NPM_INSTALL_TIMEOUT_MS, env: process.env },
        );
        if (install.error || (install.status !== null && install.status !== 0)) {
            const detail = (install.stderr || install.stdout || install.error?.message || 'npm install failed').trim();
            return {
                ok: false,
                id: tracked.id,
                message: detail.slice(0, 500) || `Failed to update ${tracked.label}`,
            };
        }
        // Invalidate cached latest so the next list re-probes.
        this.npmLatestCache.delete(tracked.npmPackage);
        const probed = this.probeInstalled(tracked);
        return {
            ok: true,
            id: tracked.id,
            installedVersion: probed.version,
            message: probed.version
                ? `${tracked.label} updated to v${probed.version}`
                : `${tracked.label} update finished`,
        };
    }

    protected async collectOutdated(): Promise<QaapAgentCliUpdatesResponse> {
        const updates: QaapAgentCliUpdateInfo[] = [];
        for (const tracked of TRACKED_AGENT_CLIS) {
            const probed = this.probeInstalled(tracked);
            if (!probed.bin) {
                continue;
            }
            const latestVersion = await this.resolveLatestVersion(tracked);
            if (!latestVersion) {
                continue;
            }
            const installedVersion = probed.version;
            const updateAvailable = isVersionOutdated(installedVersion, latestVersion);
            if (!updateAvailable) {
                continue;
            }
            updates.push({
                id: tracked.id,
                label: tracked.label,
                bin: probed.bin,
                installedVersion,
                latestVersion,
                updateAvailable: true,
                npmPackage: tracked.npmPackage,
                updateSupported: !!tracked.npmPackage && this.isInPlaceCliUpdateAllowed(),
            });
        }
        return { updates };
    }

    protected probeInstalled(tracked: TrackedAgentCli): { bin?: string; version?: string } {
        for (const bin of tracked.bins) {
            if (!isOnPath(bin)) {
                continue;
            }
            try {
                const probe = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 8_000 });
                const raw = `${probe.stdout || ''}\n${probe.stderr || ''}`.trim();
                const version = parseCliVersion(raw);
                return { bin, version };
            } catch {
                return { bin };
            }
        }
        return {};
    }

    protected async resolveLatestVersion(tracked: TrackedAgentCli): Promise<string | undefined> {
        if (tracked.npmPackage) {
            const fromNpm = await this.fetchNpmLatest(tracked.npmPackage);
            if (fromNpm) {
                return fromNpm;
            }
        }
        // Fallback when registry is unreachable (air-gapped) or the agent has no npm package (QAIQ).
        return this.readExpectedVersionFromEnv(tracked.expectedVersionEnv);
    }

    /**
     * Use a concrete env pin (e.g. `CODEX_CLI_VERSION=0.145.0`) as the comparison target.
     * Values of `latest` / empty are ignored so we fall through to the npm registry.
     */
    protected readExpectedVersionFromEnv(envName: string | undefined): string | undefined {
        if (!envName) {
            return undefined;
        }
        const raw = process.env[envName]?.trim();
        if (!raw || raw.toLowerCase() === 'latest') {
            return undefined;
        }
        return parseCliVersion(raw) ?? (/^\d+\.\d+\.\d+/.test(raw) ? raw : undefined);
    }

    protected async fetchNpmLatest(npmPackage: string): Promise<string | undefined> {
        const cached = this.npmLatestCache.get(npmPackage);
        if (cached && Date.now() - cached.at < NPM_CACHE_TTL_MS) {
            return cached.version;
        }
        const version = await this.requestNpmLatest(npmPackage);
        this.npmLatestCache.set(npmPackage, { version, at: Date.now() });
        return version;
    }

    protected requestNpmLatest(npmPackage: string): Promise<string | undefined> {
        const encoded = npmPackage.split('/').map(encodeURIComponent).join('/');
        const url = `https://registry.npmjs.org/${encoded}/latest`;
        return new Promise(resolve => {
            const req = https.get(url, { timeout: NPM_FETCH_TIMEOUT_MS, headers: { Accept: 'application/json' } }, res => {
                if (res.statusCode && res.statusCode >= 400) {
                    res.resume();
                    resolve(undefined);
                    return;
                }
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    try {
                        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { version?: unknown };
                        resolve(typeof body.version === 'string' ? parseCliVersion(body.version) ?? body.version : undefined);
                    } catch {
                        resolve(undefined);
                    }
                });
            });
            req.on('timeout', () => {
                req.destroy();
                resolve(undefined);
            });
            req.on('error', () => resolve(undefined));
        });
    }
}
