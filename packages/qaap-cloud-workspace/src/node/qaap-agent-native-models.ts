// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { QaapQaiqModelOption } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import { NATIVE_MODEL_CATALOG_EXCLUDED_AGENT_IDS } from '@theia/qaap-shared-core/lib/common/qaap-builtin-agents';
import { resolveAgentSpawnIdentity } from './qaap-agent-spawn-identity';
import { QaapTenantAgentStorageEnv } from './qaap-tenant-agent-storage-env';
import { resolveTrustedSystemExecutable } from './qaap-trusted-executable';
import {
    agentUsesNativeModelCatalog,
    listStaticNativeAgentModels,
    parseNativeModelLines,
} from '../common/qaap-agent-native-model-catalog';

const cache = new Map<string, QaapQaiqModelOption[]>();
/**
 * When a cached catalog is only the curated fallback because the CLI discovery found nothing (CLI
 * signed out, not on PATH yet): such entries expire so a later sign-in shows the real catalog.
 */
const fallbackCachedAt = new Map<string, number>();
export const NATIVE_MODEL_FALLBACK_RETRY_MS = 60_000;

function cachedNativeModels(agentId: string): QaapQaiqModelOption[] | undefined {
    const at = fallbackCachedAt.get(agentId);
    if (at !== undefined && Date.now() - at >= NATIVE_MODEL_FALLBACK_RETRY_MS) {
        cache.delete(agentId);
        fallbackCachedAt.delete(agentId);
        return undefined;
    }
    return cache.get(agentId);
}
/** In-flight CLI discoveries; the event loop is shared with every other request, so never spawn synchronously. */
const discoveries = new Map<string, Promise<QaapQaiqModelOption[]>>();

export function listNativeAgentModels(agentId: string | undefined): QaapQaiqModelOption[] {
    const normalized = agentId?.trim().toLowerCase();
    if (!normalized || NATIVE_MODEL_CATALOG_EXCLUDED_AGENT_IDS.has(normalized)) {
        return [];
    }
    const cached = cachedNativeModels(normalized);
    if (cached) {
        return cached;
    }
    // The browser and cloud packages can be rebuilt independently. If their capability
    // sets are temporarily out of sync, keep a known native agent visible instead of
    // returning an empty picker and making the CLI look uninstalled.
    if (!agentUsesNativeModelCatalog(normalized)) {
        const models = listStaticNativeAgentModels(normalized);
        cache.set(normalized, models);
        return models;
    }
    // OpenCode's `models` command may emit a multiline filesystem diagnostic when its
    // user-data directory is read-only. Keep the picker deterministic and user-facing:
    // the curated catalog contains the provider-qualified IDs and friendly names that
    // OpenCode supports in the Work Hub, while the command output is still parsed for
    // other native catalogs below.
    if (normalized === 'opencode') {
        const models = listStaticNativeAgentModels(normalized);
        cache.set(normalized, models);
        return models;
    }
    // Cold cache: answer with the curated catalog now and let the CLI discovery replace it.
    void prepareNativeAgentModels(normalized);
    return listStaticNativeAgentModels(normalized);
}

/**
 * Resolve once the agent's native catalog is cached (CLI discovery, else the curated list). Callers
 * that can wait a little, like the picker endpoint, race this against a budget.
 */
export function prepareNativeAgentModels(agentId: string | undefined): Promise<QaapQaiqModelOption[]> {
    const normalized = agentId?.trim().toLowerCase();
    if (!normalized) {
        return Promise.resolve([]);
    }
    const cached = cachedNativeModels(normalized);
    if (cached) {
        return Promise.resolve(cached);
    }
    if (!agentUsesNativeModelCatalog(normalized) || normalized === 'opencode'
        || NATIVE_MODEL_CATALOG_EXCLUDED_AGENT_IDS.has(normalized)) {
        return Promise.resolve(listNativeAgentModels(normalized));
    }
    const inFlight = discoveries.get(normalized);
    if (inFlight) {
        return inFlight;
    }
    const discovery = discoverNativeAgentModels(normalized)
        .catch((): QaapQaiqModelOption[] => [])
        .then(discovered => {
            const models = discovered.length > 0 ? discovered : listStaticNativeAgentModels(normalized);
            if (discoveries.get(normalized) === discovery) {
                discoveries.delete(normalized);
                cache.set(normalized, models);
                if (discovered.length > 0) {
                    fallbackCachedAt.delete(normalized);
                } else {
                    fallbackCachedAt.set(normalized, Date.now());
                }
            }
            return models;
        });
    discoveries.set(normalized, discovery);
    return discovery;
}

export function clearNativeAgentModelCache(): void {
    cache.clear();
    discoveries.clear();
    fallbackCachedAt.clear();
}

/** Forget one agent's catalog, e.g. after it signed in: its CLI can now list the account's models. */
export function invalidateNativeAgentModels(agentId: string): void {
    const normalized = agentId.trim().toLowerCase();
    cache.delete(normalized);
    discoveries.delete(normalized);
    fallbackCachedAt.delete(normalized);
}

async function discoverNativeAgentModels(agentId: string): Promise<QaapQaiqModelOption[]> {
    switch (agentId) {
        case 'opencode':
            return discoverFromCommand('opencode', ['models'], agentId);
        case 'pi':
            // `pi --list-models` prints a `provider model context ...` table of every model the
            // CLI can reach with its configured providers.
            return discoverFromCommand('pi', ['--list-models'], agentId);
        case 'codex':
            return discoverCodexAccountModels();
        case 'cursor':
            // Cursor Agent exposes the account-scoped catalog through both the modern
            // `agent models` command and the backwards-compatible `cursor-agent` alias.
            {
                const models = await discoverFromCommand('cursor-agent', ['models'], agentId);
                return models.length > 0
                    ? models
                    : discoverFromCommand('cursor-agent', ['--list-models'], agentId);
            }
        default:
            return [];
    }
}

/** File the Codex CLI keeps in its home: the model slugs the signed-in account may run (server-side list). */
export const CODEX_MODELS_CACHE_FILE = 'models_cache.json';

/** Uid/gid the agent CLI runs as; the backend reads the cache as this identity when it is root. */
export interface CodexCacheIdentity {
    readonly uid: number;
    readonly gid?: number;
}

/**
 * Codex home the agent CLI reads. Codex honours `CODEX_HOME`; otherwise it is `.codex` under the tenant
 * agent storage home (`<storage root>/home`, the HOME the agent's sign-in lives in) when that storage is
 * enabled; otherwise under the agent HOME (`QAAP_AGENT_HOME`, default `/home/qaap-agent`).
 */
export function resolveCodexAgentHome(env: NodeJS.ProcessEnv = process.env): string {
    const explicit = env.CODEX_HOME?.trim();
    if (explicit) {
        return explicit;
    }
    const storageRoot = QaapTenantAgentStorageEnv.resolveRoot(env, QaapTenantAgentStorageEnv.defaultTenantBackendRoot(env));
    if (storageRoot) {
        return path.posix.join(QaapTenantAgentStorageEnv.homeDir(storageRoot), '.codex');
    }
    return path.join(env.QAAP_AGENT_HOME?.trim() || '/home/qaap-agent', '.codex');
}

/**
 * The curated Codex entries whose ids the account's `models_cache.json` lists, in curated order and with
 * curated labels. A missing, unreadable or unparsable cache, or one with no curated overlap, yields `[]`;
 * the caller then keeps the full curated list.
 */
export function parseCodexModelsCache(text: string | undefined): QaapQaiqModelOption[] {
    const slugs = readCodexCacheSlugs(text);
    if (slugs.size === 0) {
        return [];
    }
    return listStaticNativeAgentModels('codex').filter(model => slugs.has(model.modelId));
}

function readCodexCacheSlugs(text: string | undefined): Set<string> {
    const slugs = new Set<string>();
    if (!text?.trim()) {
        return slugs;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return slugs;
    }
    const models = typeof parsed === 'object' && parsed !== null ? (parsed as { models?: unknown }).models : undefined;
    if (!Array.isArray(models)) {
        return slugs;
    }
    for (const entry of models as unknown[]) {
        const slug = typeof entry === 'object' && entry !== null ? (entry as { slug?: unknown }).slug : undefined;
        if (typeof slug === 'string' && slug.trim()) {
            slugs.add(slug.trim());
        }
    }
    return slugs;
}

/** Reads one file; with an identity, as that uid/gid (the backend is root, the cache is owned by the agent). */
export type CodexCacheFileReader = (file: string, identity: CodexCacheIdentity | undefined) => Promise<string>;

/**
 * Default reader. A root backend cannot read the agent-owned cache directly (its capabilities drop
 * DAC_OVERRIDE), so with an agent identity the file is read by `cat` running as that identity.
 */
export function readCodexCacheFile(file: string, identity: CodexCacheIdentity | undefined): Promise<string> {
    if (!identity) {
        return fs.promises.readFile(file, 'utf8');
    }
    const cat = resolveTrustedSystemExecutable('cat');
    if (!cat) {
        return Promise.reject(new Error('cat is not available to read the Codex models cache'));
    }
    return new Promise<string>((resolve, reject) => {
        execFile(cat, [file], {
            encoding: 'utf8',
            uid: identity.uid,
            gid: identity.gid,
            timeout: 5000,
            maxBuffer: 2 * 1024 * 1024,
        }, (error, stdout) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(String(stdout ?? ''));
        });
    });
}

/**
 * Reads the account's Codex model list from the Codex home the agent uses. The identity is the configured
 * agent uid/gid when the backend is root (uid 0 is never used for the agent). Any failure yields `[]`.
 */
export async function discoverCodexAccountModels(
    env: NodeJS.ProcessEnv = process.env,
    isRoot: boolean = typeof process.getuid === 'function' && process.getuid() === 0,
    reader: CodexCacheFileReader = readCodexCacheFile,
): Promise<QaapQaiqModelOption[]> {
    const file = path.join(resolveCodexAgentHome(env), CODEX_MODELS_CACHE_FILE);
    const identity = resolveAgentSpawnIdentity(env, isRoot);
    const agentIdentity: CodexCacheIdentity | undefined = identity.uid !== undefined && identity.uid > 0
        ? { uid: identity.uid, gid: identity.gid }
        : undefined;
    try {
        return parseCodexModelsCache(await reader(file, agentIdentity));
    } catch {
        return [];
    }
}

function discoverFromCommand(bin: string, args: string[], agentId: string): Promise<QaapQaiqModelOption[]> {
    return new Promise<QaapQaiqModelOption[]>(resolve => {
        try {
            // npm-installed CLIs are `.cmd` shims on Windows and cannot be spawned by
            // their extensionless name from Node without a shell. Use the same
            // Windows-safe resolution as the CLI installer so native model discovery
            // does not silently fall back to a partial static catalog.
            const executable = process.platform === 'win32' ? `${bin}.cmd` : bin;
            execFile(executable, args, {
                encoding: 'utf8',
                timeout: 15_000,
                shell: process.platform === 'win32',
            }, (error, stdout) => {
                // stderr is diagnostic output, never a model catalog. OpenCode can emit a
                // multiline EROFS/permission error there; treating those lines as models made
                // the picker display paths, syscalls, and Bun details as selectable models.
                if (error) {
                    resolve([]);
                    return;
                }
                const lines = String(stdout ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
                resolve(parseNativeModelLines(agentId, lines));
            });
        } catch {
            resolve([]);
        }
    });
}
