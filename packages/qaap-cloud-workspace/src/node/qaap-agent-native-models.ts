// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { QaapQaiqModelOption } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import { NATIVE_MODEL_CATALOG_EXCLUDED_AGENT_IDS } from '@theia/qaap-shared-core/lib/common/qaap-builtin-agents';
import { resolveAgentSpawnIdentity } from './qaap-agent-spawn-identity';
import { QaapTenantAgentStorageEnv } from './qaap-tenant-agent-storage-env';
import { resolveTrustedSystemExecutable } from './qaap-trusted-executable';
import {
    agentUsesNativeModelCatalog,
    listStaticNativeAgentModels,
} from '../common/qaap-agent-native-model-catalog';
import { parseCodexDebugModels, parseNativeModelOutput } from '../common/qaap-agent-native-model-parsers';
import { childProcessEnv } from './qaap-child-process-env';

/** One cached catalog. `live` is true when the CLI answered; false for the curated fallback. */
interface NativeModelCacheEntry {
    readonly models: QaapQaiqModelOption[];
    readonly live: boolean;
    /** When a request may start a background refresh (stale-while-revalidate). */
    readonly refreshAt: number;
}

const cache = new Map<string, NativeModelCacheEntry>();
/** A live CLI catalog is served for this long before a background refresh runs. */
export const NATIVE_MODEL_CACHE_TTL_MS = 6 * 60 * 60_000;
/** A curated fallback (CLI missing, signed out, listing failed) is retried after this long. */
export const NATIVE_MODEL_FALLBACK_RETRY_MS = 60_000;

function isNativeModelEntryStale(entry: NativeModelCacheEntry, now: number = Date.now()): boolean {
    return now >= entry.refreshAt;
}
/** In-flight CLI discoveries; the event loop is shared with every other request, so never spawn synchronously. */
const discoveries = new Map<string, Promise<QaapQaiqModelOption[]>>();

/** How one CLI model listing runs: the argv, plus the cwd/env of the tenant that owns the sign-in. */
export interface NativeModelDiscoverySpawn {
    readonly file: string;
    readonly args: readonly string[];
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
}

/** Wraps a model-listing command so it runs where the agent does; undefined when it cannot run there yet. */
export type NativeModelDiscoverySpawner = (bin: string, args: readonly string[]) => NativeModelDiscoverySpawn | undefined;

export interface NativeModelDiscoveryOptions {
    readonly ownerLogin?: string;
    readonly spawner?: NativeModelDiscoverySpawner;
}

/**
 * Agents whose model listing answers from the sign-in in their HOME (`pi --list-models` only shows
 * the providers in `~/.pi/agent/auth.json`). Run in the backend's own HOME they see no sign-in, so
 * they are discovered per owner through the owner's spawner and never from the shared cold path.
 */
const ACCOUNT_SCOPED_DISCOVERY_AGENT_IDS: ReadonlySet<string> = new Set(['pi']);

function nativeModelCacheKey(agentId: string, ownerLogin: string | undefined): string {
    if (!ACCOUNT_SCOPED_DISCOVERY_AGENT_IDS.has(agentId)) {
        return agentId;
    }
    return `${agentId}:${ownerLogin?.trim().toLowerCase() ?? ''}`;
}

export function listNativeAgentModels(agentId: string | undefined, ownerLogin?: string): QaapQaiqModelOption[] {
    const normalized = agentId?.trim().toLowerCase();
    if (!normalized || NATIVE_MODEL_CATALOG_EXCLUDED_AGENT_IDS.has(normalized)) {
        return [];
    }
    // The browser and cloud packages can be rebuilt independently. If their capability
    // sets are temporarily out of sync, keep a known native agent visible instead of
    // returning an empty picker and making the CLI look uninstalled.
    if (!agentUsesNativeModelCatalog(normalized)) {
        return listStaticNativeAgentModels(normalized);
    }
    const key = nativeModelCacheKey(normalized, ownerLogin);
    const entry = cache.get(key);
    if (entry) {
        // Serve what we have at once; a stale entry is refreshed in the background.
        if (isNativeModelEntryStale(entry)) {
            void prepareNativeAgentModels(normalized, { ownerLogin });
        }
        return entry.models;
    }
    // Only the picker endpoint knows how to run an account-scoped CLI in the owner's HOME.
    if (ACCOUNT_SCOPED_DISCOVERY_AGENT_IDS.has(normalized)) {
        return listStaticNativeAgentModels(normalized);
    }
    // Cold cache: answer with the curated catalog now and let the CLI discovery replace it.
    void prepareNativeAgentModels(normalized, { ownerLogin });
    return listStaticNativeAgentModels(normalized);
}

/**
 * Resolve once the agent's native catalog is current (CLI discovery, else the curated list). A fresh
 * cache answers at once; a stale one is replaced by discovery, but a failed or empty discovery never
 * overwrites a live list it could not improve on. Concurrent calls share one CLI run.
 */
export function prepareNativeAgentModels(
    agentId: string | undefined,
    options: NativeModelDiscoveryOptions = {},
): Promise<QaapQaiqModelOption[]> {
    const normalized = agentId?.trim().toLowerCase();
    if (!normalized) {
        return Promise.resolve([]);
    }
    const key = nativeModelCacheKey(normalized, options.ownerLogin);
    const entry = cache.get(key);
    if (entry && !isNativeModelEntryStale(entry)) {
        return Promise.resolve(entry.models);
    }
    if (!agentUsesNativeModelCatalog(normalized) || NATIVE_MODEL_CATALOG_EXCLUDED_AGENT_IDS.has(normalized)) {
        return Promise.resolve(listStaticNativeAgentModels(normalized));
    }
    if (ACCOUNT_SCOPED_DISCOVERY_AGENT_IDS.has(normalized) && !options.spawner) {
        return Promise.resolve(entry?.models ?? listStaticNativeAgentModels(normalized));
    }
    const inFlight = discoveries.get(key);
    if (inFlight) {
        return inFlight;
    }
    const discovery: Promise<QaapQaiqModelOption[]> = discoverNativeAgentModels(normalized, options.spawner)
        .catch((): QaapQaiqModelOption[] => [])
        .then(discovered => {
            if (discoveries.get(key) !== discovery) {
                // invalidated or cleared while running: the result is no longer wanted.
                return discovered.length > 0 ? discovered : (cache.get(key)?.models ?? listStaticNativeAgentModels(normalized));
            }
            discoveries.delete(key);
            if (discovered.length > 0) {
                cache.set(key, { models: discovered, live: true, refreshAt: Date.now() + NATIVE_MODEL_CACHE_TTL_MS });
                return discovered;
            }
            const previous = cache.get(key);
            if (previous?.live) {
                // Never replace a good list with an empty or failed result; retry soon.
                cache.set(key, { ...previous, refreshAt: Date.now() + NATIVE_MODEL_FALLBACK_RETRY_MS });
                return previous.models;
            }
            const models = listStaticNativeAgentModels(normalized);
            cache.set(key, { models, live: false, refreshAt: Date.now() + NATIVE_MODEL_FALLBACK_RETRY_MS });
            return models;
        });
    discoveries.set(key, discovery);
    return discovery;
}

/** Forget every cached and in-flight native catalog. Called when the agent catalog is refreshed. */
export function clearNativeAgentModelCache(): void {
    cache.clear();
    discoveries.clear();
}

/**
 * Forget one agent's catalog, e.g. after it signed in: its CLI can now list the account's models.
 * Without an owner every owner's entry for that agent goes.
 */
export function invalidateNativeAgentModels(agentId: string, ownerLogin?: string): void {
    const normalized = agentId.trim().toLowerCase();
    const keys = ACCOUNT_SCOPED_DISCOVERY_AGENT_IDS.has(normalized) && ownerLogin === undefined
        ? [...new Set([...cache.keys(), ...discoveries.keys()])].filter(key => key.startsWith(`${normalized}:`))
        : [nativeModelCacheKey(normalized, ownerLogin)];
    for (const key of keys) {
        cache.delete(key);
        discoveries.delete(key);
    }
}

/**
 * Environment for the OpenCode listing. OpenCode writes its model cache and state under
 * `XDG_CACHE_HOME`/`XDG_STATE_HOME`; when the backend's home is read-only that write fails with an
 * EROFS diagnostic. Those two directories are therefore pointed at a fresh writable temp dir, while
 * `XDG_DATA_HOME` (where the owner's sign-in lives) is left alone so paid models stay listed.
 */
function openCodeListingEnv(): { readonly env: NodeJS.ProcessEnv; readonly cleanup: () => void } {
    try {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-opencode-models-'));
        return {
            env: { XDG_CACHE_HOME: path.join(root, 'cache'), XDG_STATE_HOME: path.join(root, 'state') },
            cleanup: () => {
                try {
                    fs.rmSync(root, { recursive: true, force: true });
                } catch {
                    // best effort: a leftover temp dir is harmless
                }
            },
        };
    } catch {
        return { env: {}, cleanup: () => undefined };
    }
}

async function discoverNativeAgentModels(agentId: string, spawner?: NativeModelDiscoverySpawner): Promise<QaapQaiqModelOption[]> {
    switch (agentId) {
        case 'opencode': {
            const listing = openCodeListingEnv();
            try {
                return await discoverFromCommand('opencode', ['models'], agentId, spawner, listing.env);
            } finally {
                listing.cleanup();
            }
        }
        case 'pi':
            // `pi --list-models` prints a `provider model context ...` table of every model the
            // CLI can reach with its configured providers.
            return discoverFromCommand('pi', ['--list-models'], agentId, spawner);
        case 'codex': {
            // The CLI's own cache of the account's models (same JSON as `codex debug models`), read as the
            // agent identity; with a spawner the live listing runs in the owner's HOME when the cache is empty.
            const cached = await discoverCodexAccountModels();
            if (cached.length > 0 || !spawner) {
                return cached;
            }
            return discoverFromCommand('codex', ['debug', 'models'], agentId, spawner);
        }
        case 'grok':
            return discoverFromCommand('grok', ['models'], agentId, spawner);
        case 'antigravity':
        case 'gemini':
            // The Antigravity binary is `agy`; the catalog is stored under the agent id.
            return discoverFromCommand('agy', ['models'], agentId, spawner);
        case 'cursor':
            // Cursor Agent exposes the account-scoped catalog through both the modern
            // `agent models` command and the backwards-compatible `cursor-agent` alias.
            {
                const models = await discoverFromCommand('cursor-agent', ['models'], agentId, spawner);
                return models.length > 0
                    ? models
                    : discoverFromCommand('cursor-agent', ['--list-models'], agentId, spawner);
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
 * The account's Codex models from the CLI's `models_cache.json` (or `codex debug models` output): every
 * row the CLI lists, in the CLI's order. A missing, unreadable or unparsable cache yields `[]`.
 */
export function parseCodexModelsCache(text: string | undefined): QaapQaiqModelOption[] {
    return parseCodexDebugModels(text);
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
            env: childProcessEnv(),
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

function discoverFromCommand(
    bin: string,
    args: string[],
    agentId: string,
    spawner?: NativeModelDiscoverySpawner,
    extraEnv?: NodeJS.ProcessEnv,
): Promise<QaapQaiqModelOption[]> {
    return new Promise<QaapQaiqModelOption[]>(resolve => {
        try {
            const spawn = spawner ? spawner(bin, args) : undefined;
            if (spawner && !spawn) {
                resolve([]);
                return;
            }
            // npm-installed CLIs are `.cmd` shims on Windows and cannot be spawned by
            // their extensionless name from Node without a shell. Use the same
            // Windows-safe resolution as the CLI installer so native model discovery
            // does not silently fall back to a partial static catalog.
            const unwrapped = (spawn?.file ?? bin) === bin;
            const windowsShim = unwrapped && process.platform === 'win32';
            const executable = windowsShim ? `${bin}.cmd` : spawn?.file ?? bin;
            execFile(executable, spawn ? [...spawn.args] : args, {
                encoding: 'utf8',
                timeout: 15_000,
                shell: windowsShim,
                ...(spawn?.cwd ? { cwd: spawn.cwd } : {}),
                // Never inherit the backend env by omission; a spawner env is stripped too.
                env: childProcessEnv({ ...(spawn?.env ?? process.env), ...extraEnv }),
            }, (error, stdout) => {
                // stderr is diagnostic output, never a model catalog. A failed run or an
                // unparsable answer is "no answer" (empty), so the caller keeps its catalog.
                if (error) {
                    resolve([]);
                    return;
                }
                const models = parseNativeModelOutput(agentId, String(stdout ?? ''));
                // Picker rows belong to the agent that lists them (Pi keeps provider as vendor).
                resolve(agentId === 'pi' ? models : models.map(model => ({ ...model, vendor: agentId })));
            });
        } catch {
            resolve([]);
        }
    });
}
