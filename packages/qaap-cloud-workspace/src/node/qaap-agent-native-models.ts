// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { execFileKillingGroup } from './qaap-exec-file-group';
import { type ChildProcess, execFile, spawn as spawnChild } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { QaapQaiqModelOption } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import { normalizeAntigravityCliBin, type QaapAntigravityCliBin } from '@theia/qaap-shared-core/lib/common/qaap-antigravity-cli';
import { NATIVE_MODEL_CATALOG_EXCLUDED_AGENT_IDS } from '@theia/qaap-shared-core/lib/common/qaap-builtin-agents';
import { resolveQaapHarnessBaseId } from '@theia/qaap-shared-core/lib/common/qaap-harness-launch-settings';
import { isQaapDesktopRuntime } from '@theia/qaap-adapters/lib/common/qaap-desktop-runtime';
import { resolveAgentSpawnIdentity } from './qaap-agent-spawn-identity';
import { QaapTenantAgentStorageEnv } from './qaap-tenant-agent-storage-env';
import { resolveTrustedSystemExecutable } from './qaap-trusted-executable';
import {
    agentUsesNativeModelCatalog,
    listStaticNativeAgentModels,
} from '../common/qaap-agent-native-model-catalog';
import {
    parseClaudeBundleModelIds,
    parseClaudeControlResponseModels,
    parseCodexDebugModels,
    parseNativeModelOutput,
} from '../common/qaap-agent-native-model-parsers';
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
/** File, in the backend's `~/.qaap` directory, that keeps the last live catalogs across restarts. */
const NATIVE_MODEL_CATALOG_FILE_NAME = 'native-model-catalogs.json';
/** Most catalogs kept on disk; the entry with the oldest `savedAt` is dropped first. */
const NATIVE_MODEL_CATALOG_STORE_MAX_ENTRIES = 64;
/** A catalog saved longer ago than this is not restored after a restart. */
const NATIVE_MODEL_CATALOG_STORE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

/** One live catalog as kept on disk, by cache key. */
interface PersistedNativeModelCatalog {
    readonly models: QaapQaiqModelOption[];
    readonly savedAt: number;
}

/** Test override of the directory holding the catalog file; `undefined` uses `~/.qaap`. */
let nativeModelCatalogStoreDir: string | undefined;
/** Persisted catalogs by cache key, read from disk once, lazily. */
let persistedNativeModelCatalogs: Map<string, PersistedNativeModelCatalog> | undefined;

/**
 * Points the persisted catalog store at another directory and forgets what was loaded from the previous one.
 * Tests only: production always uses `~/.qaap`, which survives backend restarts.
 */
export function setNativeModelCatalogStoreDirForTests(dir: string | undefined): void {
    nativeModelCatalogStoreDir = dir;
    persistedNativeModelCatalogs = undefined;
}

/**
 * Drops the in-memory catalogs and the loaded copy of the store, as a backend restart does; the file is kept.
 * Tests only.
 */
export function forgetNativeModelMemoryForTests(): void {
    cache.clear();
    discoveries.clear();
    persistedNativeModelCatalogs = undefined;
}

/** Path of the persisted catalog file. */
function nativeModelCatalogFilePath(): string {
    return path.join(nativeModelCatalogStoreDir ?? path.join(os.homedir(), '.qaap'), NATIVE_MODEL_CATALOG_FILE_NAME);
}

/** A persisted model row must at least carry its id; anything else is dropped as corrupt. */
function isPersistedNativeModelOption(value: unknown): value is QaapQaiqModelOption {
    return typeof value === 'object' && value !== null && typeof (value as { modelId?: unknown }).modelId === 'string';
}

/** One stored catalog, or undefined when its shape is not a catalog with at least one model. */
function parsePersistedNativeModelCatalog(value: unknown): PersistedNativeModelCatalog | undefined {
    if (typeof value !== 'object' || value === null) {
        return undefined;
    }
    const { models, savedAt } = value as { models?: unknown; savedAt?: unknown };
    if (!Array.isArray(models) || typeof savedAt !== 'number' || !Number.isFinite(savedAt)) {
        return undefined;
    }
    const valid = models.filter(isPersistedNativeModelOption);
    return valid.length > 0 ? { models: valid, savedAt } : undefined;
}

/**
 * The persisted catalogs, read from disk on first use. A missing, unreadable or corrupt file yields an empty store.
 */
function loadPersistedNativeModelCatalogs(): Map<string, PersistedNativeModelCatalog> {
    if (persistedNativeModelCatalogs) {
        return persistedNativeModelCatalogs;
    }
    const loaded = new Map<string, PersistedNativeModelCatalog>();
    try {
        const parsed: unknown = JSON.parse(fs.readFileSync(nativeModelCatalogFilePath(), 'utf8'));
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            for (const [key, value] of Object.entries(parsed)) {
                const catalog = parsePersistedNativeModelCatalog(value);
                if (catalog) {
                    loaded.set(key, catalog);
                }
            }
        }
    } catch {
        // missing or corrupt: start with an empty store, the CLI listing refills it
    }
    persistedNativeModelCatalogs = loaded;
    return loaded;
}

/**
 * Writes the whole store atomically (temp file, then rename) with mode 0600. Best effort: a failed write only
 * means one more CLI listing after the next restart.
 */
function writePersistedNativeModelCatalogs(store: Map<string, PersistedNativeModelCatalog>): void {
    const file = nativeModelCatalogFilePath();
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
        const body: Record<string, PersistedNativeModelCatalog> = {};
        for (const [key, catalog] of store) {
            body[key] = catalog;
        }
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        fs.writeFileSync(temp, JSON.stringify(body), { mode: 0o600 });
        fs.renameSync(temp, file);
    } catch {
        try {
            fs.rmSync(temp, { force: true });
        } catch {
            // best effort: a leftover temp file is harmless
        }
    }
}

/**
 * Saves one live CLI catalog and keeps the store within its size cap by dropping the oldest entries.
 * Called once per successful discovery, never for the curated fallback.
 */
function persistNativeModelCatalog(key: string, models: QaapQaiqModelOption[]): void {
    const store = loadPersistedNativeModelCatalogs();
    store.set(key, { models, savedAt: Date.now() });
    while (store.size > NATIVE_MODEL_CATALOG_STORE_MAX_ENTRIES) {
        let oldestKey: string | undefined;
        let oldestSavedAt = Number.POSITIVE_INFINITY;
        for (const [candidate, catalog] of store) {
            if (catalog.savedAt < oldestSavedAt) {
                oldestSavedAt = catalog.savedAt;
                oldestKey = candidate;
            }
        }
        if (oldestKey === undefined) {
            break;
        }
        store.delete(oldestKey);
    }
    writePersistedNativeModelCatalogs(store);
}

/**
 * Removes the persisted catalogs whose keys match, so a sign-out or a fresh request cannot bring back an old list.
 */
function forgetPersistedNativeModelCatalogs(matches: (key: string) => boolean): void {
    const store = loadPersistedNativeModelCatalogs();
    let changed = false;
    for (const key of [...store.keys()]) {
        if (matches(key)) {
            store.delete(key);
            changed = true;
        }
    }
    if (changed) {
        writePersistedNativeModelCatalogs(store);
    }
}

/**
 * The persisted live catalog for a key as a cache entry that is already due for refresh: it is served at once
 * and replaced by the background discovery. Undefined when none is stored or it is older than the maximum age.
 */
function restorePersistedNativeModelCatalog(key: string): NativeModelCacheEntry | undefined {
    const catalog = loadPersistedNativeModelCatalogs().get(key);
    if (!catalog || Date.now() - catalog.savedAt > NATIVE_MODEL_CATALOG_STORE_MAX_AGE_MS) {
        return undefined;
    }
    return { models: catalog.models, live: true, refreshAt: 0 };
}

/** The cache entry for a key; on a miss, the persisted live catalog is loaded into the cache. */
function cachedNativeModelEntry(key: string): NativeModelCacheEntry | undefined {
    const cached = cache.get(key);
    if (cached) {
        return cached;
    }
    const restored = restorePersistedNativeModelCatalog(key);
    if (restored) {
        cache.set(key, restored);
    }
    return restored;
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
    /** The Antigravity CLI the host resolved; selects the gemini or agy catalog for `antigravity`. */
    readonly antigravityBin?: QaapAntigravityCliBin;
}

/**
 * Agents whose model listing answers from the sign-in in their HOME (`pi --list-models` only shows
 * the providers in `~/.pi/agent/auth.json`). Run in the backend's own HOME they see no sign-in, so
 * they are discovered per owner through the owner's spawner and never from the shared cold path.
 */
const ACCOUNT_SCOPED_DISCOVERY_AGENT_IDS: ReadonlySet<string> = new Set(['pi']);

/** The Antigravity harness: its catalog depends on the resolved CLI (see {@link antigravityCatalogBin}). */
const ANTIGRAVITY_AGENT_ID = 'antigravity';

/**
 * The catalog an Antigravity host lists: `gemini` (Gemini CLI model ids) or `agy` (live `agy models`). An
 * unresolved bin keeps the historical `agy` catalog.
 */
export function antigravityCatalogBin(antigravityBin: QaapAntigravityCliBin | undefined): 'agy' | 'gemini' {
    return antigravityBin === 'gemini' ? 'gemini' : 'agy';
}

/**
 * The Antigravity CLI the host resolved, for the agent it is asked about. Only `antigravity` has a bin-scoped
 * catalog; every other agent gets `undefined`.
 */
export function antigravityBinFor(
    ctx: { resolveAntigravityBin(): string | undefined },
    agentId: string | undefined,
): QaapAntigravityCliBin | undefined {
    return agentId?.trim().toLowerCase() === ANTIGRAVITY_AGENT_ID ? normalizeAntigravityCliBin(ctx.resolveAntigravityBin()) : undefined;
}

/** Gemini CLI has no model-list command, so its catalog is the curated list and never needs discovery. */
function usesCuratedAntigravityCatalog(agentId: string, antigravityBin: QaapAntigravityCliBin | undefined): boolean {
    return agentId === ANTIGRAVITY_AGENT_ID && antigravityCatalogBin(antigravityBin) === 'gemini';
}

/**
 * Cache key of one harness catalog. `harnessKey` is the harness id as the picker names it: the base id
 * (`codex`) or a harness instance (`codex#2`). An instance has its own key, so its catalog (discovered with
 * its own binary and folder, see the runner's spawner) never answers for the base, or the other way round.
 */
function nativeModelCacheKey(harnessKey: string, ownerLogin: string | undefined, antigravityBin?: QaapAntigravityCliBin): string {
    const agentId = resolveQaapHarnessBaseId(harnessKey);
    if (agentId === ANTIGRAVITY_AGENT_ID) {
        return `${harnessKey}:${antigravityCatalogBin(antigravityBin)}`;
    }
    if (!ACCOUNT_SCOPED_DISCOVERY_AGENT_IDS.has(agentId)) {
        return harnessKey;
    }
    return `${harnessKey}:${ownerLogin?.trim().toLowerCase() ?? ''}`;
}

/**
 * The picker list for a native agent. `antigravityBin` is the Antigravity CLI the host resolved; it picks
 * the gemini or agy catalog and keeps their caches apart. Other agents ignore it.
 */
export function listNativeAgentModels(
    agentId: string | undefined,
    ownerLogin?: string,
    antigravityBin?: QaapAntigravityCliBin,
): QaapQaiqModelOption[] {
    const harnessKey = agentId?.trim().toLowerCase();
    if (!harnessKey || NATIVE_MODEL_CATALOG_EXCLUDED_AGENT_IDS.has(resolveQaapHarnessBaseId(harnessKey))) {
        return [];
    }
    const normalized = resolveQaapHarnessBaseId(harnessKey);
    // The browser and cloud packages can be rebuilt independently. If their capability
    // sets are temporarily out of sync, keep a known native agent visible instead of
    // returning an empty picker and making the CLI look uninstalled.
    if (!agentUsesNativeModelCatalog(normalized)) {
        return listStaticNativeAgentModels(normalized, antigravityBin);
    }
    if (usesCuratedAntigravityCatalog(normalized, antigravityBin)) {
        return listStaticNativeAgentModels(normalized, antigravityBin);
    }
    const key = nativeModelCacheKey(harnessKey, ownerLogin, antigravityBin);
    const entry = cachedNativeModelEntry(key);
    if (entry) {
        // Serve what we have at once; a stale entry is refreshed in the background.
        if (isNativeModelEntryStale(entry)) {
            void prepareNativeAgentModels(harnessKey, { ownerLogin, antigravityBin });
        }
        return entry.models;
    }
    // Only the picker endpoint knows how to run an account-scoped CLI in the owner's HOME.
    if (ACCOUNT_SCOPED_DISCOVERY_AGENT_IDS.has(normalized)) {
        return listStaticNativeAgentModels(normalized, antigravityBin);
    }
    // Cold cache: answer with the curated catalog now and let the CLI discovery replace it.
    void prepareNativeAgentModels(harnessKey, { ownerLogin, antigravityBin });
    return listStaticNativeAgentModels(normalized, antigravityBin);
}

/**
 * Whether the cache holds a live CLI catalog (not the curated fallback) for this harness, for the same owner and
 * Antigravity bin as {@link listNativeAgentModels}. False means the picker would only get the curated list, so
 * the endpoint waits longer for a cold discovery instead of answering with it.
 */
export function hasLiveNativeAgentModels(
    agentId: string | undefined,
    ownerLogin?: string,
    antigravityBin?: QaapAntigravityCliBin,
): boolean {
    const harnessKey = agentId?.trim().toLowerCase();
    if (!harnessKey) {
        return false;
    }
    return cachedNativeModelEntry(nativeModelCacheKey(harnessKey, ownerLogin, antigravityBin))?.live === true;
}

/**
 * Whether the cache holds any catalog for this harness (live or the curated fallback after a failed listing).
 * The endpoint waits the long budget only on a cold cache: a harness whose listing keeps failing must not make
 * every picker load wait for it again.
 */
export function hasNativeAgentModelsEntry(
    agentId: string | undefined,
    ownerLogin?: string,
    antigravityBin?: QaapAntigravityCliBin,
): boolean {
    const harnessKey = agentId?.trim().toLowerCase();
    return !!harnessKey && cachedNativeModelEntry(nativeModelCacheKey(harnessKey, ownerLogin, antigravityBin)) !== undefined;
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
    const harnessKey = agentId?.trim().toLowerCase();
    if (!harnessKey) {
        return Promise.resolve([]);
    }
    const normalized = resolveQaapHarnessBaseId(harnessKey);
    const bin = options.antigravityBin;
    if (!agentUsesNativeModelCatalog(normalized) || NATIVE_MODEL_CATALOG_EXCLUDED_AGENT_IDS.has(normalized)
        || usesCuratedAntigravityCatalog(normalized, bin)) {
        return Promise.resolve(listStaticNativeAgentModels(normalized, bin));
    }
    const key = nativeModelCacheKey(harnessKey, options.ownerLogin, bin);
    const entry = cachedNativeModelEntry(key);
    if (entry && !isNativeModelEntryStale(entry)) {
        return Promise.resolve(entry.models);
    }
    if (harnessKey !== normalized && !options.spawner) {
        // An instance's catalog is discovered only through its own binary and folder (the runner's instance
        // spawner). Without one, the base binary must not answer for it: serve what it has, else the curated list.
        return Promise.resolve(entry?.models ?? listStaticNativeAgentModels(normalized, bin));
    }
    if (ACCOUNT_SCOPED_DISCOVERY_AGENT_IDS.has(normalized) && !options.spawner) {
        return Promise.resolve(entry?.models ?? listStaticNativeAgentModels(normalized, bin));
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
                return discovered.length > 0 ? discovered : (cache.get(key)?.models ?? listStaticNativeAgentModels(normalized, bin));
            }
            discoveries.delete(key);
            if (discovered.length > 0) {
                cache.set(key, { models: discovered, live: true, refreshAt: Date.now() + NATIVE_MODEL_CACHE_TTL_MS });
                persistNativeModelCatalog(key, discovered);
                return discovered;
            }
            const previous = cache.get(key);
            if (previous?.live) {
                // Never replace a good list with an empty or failed result; retry soon.
                cache.set(key, { ...previous, refreshAt: Date.now() + NATIVE_MODEL_FALLBACK_RETRY_MS });
                return previous.models;
            }
            const models = listStaticNativeAgentModels(normalized, bin);
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
    forgetPersistedNativeModelCatalogs(() => true);
}

/**
 * Forget one agent's catalog, e.g. after it signed in: its CLI can now list the account's models.
 * Without an owner every owner's entry for that agent goes.
 */
export function invalidateNativeAgentModels(agentId: string, ownerLogin?: string, antigravityBin?: QaapAntigravityCliBin): void {
    // A harness instance (`codex#2`) has its own catalog key: only its entries go, never the base's.
    const harnessKey = agentId.trim().toLowerCase();
    const normalized = resolveQaapHarnessBaseId(harnessKey);
    // Without an owner (or, for Antigravity, without a resolved bin) every catalog of that harness goes.
    const wildcard = (ACCOUNT_SCOPED_DISCOVERY_AGENT_IDS.has(normalized) && ownerLogin === undefined)
        || (normalized === ANTIGRAVITY_AGENT_ID && antigravityBin === undefined);
    const keys = wildcard
        ? [...new Set([...cache.keys(), ...discoveries.keys()])].filter(key => key.startsWith(`${harnessKey}:`))
        : [nativeModelCacheKey(harnessKey, ownerLogin, antigravityBin)];
    for (const key of keys) {
        cache.delete(key);
        discoveries.delete(key);
    }
    // The persisted copy of the same keys goes too, so a sign-out cannot resurrect the old list after a restart.
    const persistedKeys = new Set(keys);
    forgetPersistedNativeModelCatalogs(key => persistedKeys.has(key)
        || (wildcard && key.startsWith(`${harnessKey}:`)));
}

/**
 * Environment for the OpenCode listing. OpenCode writes its model cache and state under
 * `XDG_CACHE_HOME`/`XDG_STATE_HOME`; when the backend's home is read-only that write fails with an
 * EROFS diagnostic. Those two directories are therefore pointed at a fresh writable temp dir, while
 * `XDG_DATA_HOME` (where the owner's sign-in lives) is left alone so paid models stay listed.
 */
function openCodeListingEnv(agentHome?: string): { readonly env: NodeJS.ProcessEnv; readonly cleanup: () => void } {
    if (agentHome) {
        // A dropped process: keep the listing's cache and state in its own (writable) HOME.
        return {
            env: {
                XDG_CACHE_HOME: path.posix.join(agentHome, '.cache', 'qaap-opencode-listing'),
                XDG_STATE_HOME: path.posix.join(agentHome, '.local', 'state', 'qaap-opencode-listing'),
            },
            cleanup: () => undefined,
        };
    }
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
            // Run as the agent uid (tenant backend), OpenCode cannot write a temp dir the backend created (0700,
            // root): EACCES on `cache/opencode/bin` and an empty catalog. Its own HOME is writable.
            const agentHome = spawner?.('opencode', ['models'])?.env?.HOME?.trim();
            const listing = openCodeListingEnv(agentHome);
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
        case 'claude':
            // Claude Code answers an `initialize` control request with the model list its own picker shows;
            // the CLI bundle is only the fallback for a CLI that does not answer.
            return discoverClaudeCliModels(spawner);
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

/** The Claude Code binary: its `initialize` answer and its bundle are the two sources of the picker list. */
const CLAUDE_BIN = 'claude';
/** Request id of the one `initialize` control request the Claude discovery sends; only its answer is read. */
const CLAUDE_INITIALIZE_REQUEST_ID = 'qaap-model-list';
/** Bounded wait for the CLI's answer; past it the curated list answers and the next refresh retries. */
export const CLAUDE_MODEL_LIST_TIMEOUT_MS = 15_000;
/** Stream-json mode without a prompt: the CLI reads control requests only, so no model turn starts. */
const CLAUDE_STREAM_ARGS: readonly string[] = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];
/** Bundle scan pattern; the parser keeps only the newest non-dated id of each family. */
const CLAUDE_BUNDLE_MODEL_ID_PATTERN = 'claude-(opus|sonnet|haiku|fable)-[0-9]+(-[0-9]+)*';
/** Largest unfinished stdout line the probe buffers before giving up (a real answer is about 2 KB). */
const CLAUDE_PROBE_MAX_PENDING_CHARS = 4 * 1024 * 1024;

/**
 * The Claude picker list: the live `initialize` answer of the CLI, else the model ids in its bundle. Both
 * are bounded by `timeoutMs`; an empty result leaves the caller's catalog in place.
 */
export async function discoverClaudeCliModels(
    spawner?: NativeModelDiscoverySpawner,
    timeoutMs: number = CLAUDE_MODEL_LIST_TIMEOUT_MS,
): Promise<QaapQaiqModelOption[]> {
    const live = await askClaudeCliForModels(spawner, timeoutMs);
    return live.length > 0 ? live : listClaudeBundleModels(spawner, timeoutMs);
}

/** Reads one `initialize` control response; `undefined` for any line that is not this request's answer. */
function parseClaudeInitializeLine(line: string): QaapQaiqModelOption[] | undefined {
    let message: { readonly type?: unknown; readonly response?: { readonly request_id?: unknown } } | null;
    try {
        message = JSON.parse(line) as typeof message;
    } catch {
        return undefined;
    }
    if (message?.response?.request_id !== CLAUDE_INITIALIZE_REQUEST_ID) {
        return undefined;
    }
    return parseClaudeControlResponseModels(message);
}

/** How long a probe child may ignore SIGTERM before it is SIGKILLed. */
const PROBE_CHILD_KILL_ESCALATION_MS = 2_000;

/**
 * Ends a one-shot probe child: closes its stdin, sends SIGTERM and, if it is still alive after
 * {@link PROBE_CHILD_KILL_ESCALATION_MS}, SIGKILL. A CLI that ignores SIGTERM must not outlive the probe.
 */
function signalProbeGroup(child: ChildProcess, signal: NodeJS.Signals): void {
    if (process.platform !== 'win32' && child.pid) {
        try {
            process.kill(-child.pid, signal);
            return;
        } catch {
            // Not a group leader, or already gone: signal the child itself.
        }
    }
    try {
        child.kill(signal);
    } catch {
        // Already gone.
    }
}

function stopProbeChild(child: ChildProcess): void {
    child.stdin?.end();
    // The probe leads its own process group (POSIX): signal the group, so the CLI behind a wrapper
    // (npm shim, `setpriv`) stops too instead of outliving it.
    signalProbeGroup(child, 'SIGTERM');
    if (child.exitCode !== null || child.signalCode !== null) {
        return;
    }
    const escalation = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
            signalProbeGroup(child, 'SIGKILL');
        }
    }, PROBE_CHILD_KILL_ESCALATION_MS);
    // The escalation timer must never keep the backend alive on its own.
    escalation.unref();
    const clearEscalation = (): void => {
        clearTimeout(escalation);
    };
    child.once('exit', clearEscalation);
    child.once('close', clearEscalation);
}

/**
 * Sends one `initialize` control request over stream-json and reads the CLI's answer. stdin stays open
 * until the answer arrives, then the CLI is stopped; no user message is sent, so no model turn starts.
 */
function askClaudeCliForModels(spawner: NativeModelDiscoverySpawner | undefined, timeoutMs: number): Promise<QaapQaiqModelOption[]> {
    const command = spawner ? spawner(CLAUDE_BIN, CLAUDE_STREAM_ARGS) : { file: CLAUDE_BIN, args: CLAUDE_STREAM_ARGS };
    if (!command) {
        return Promise.resolve([]);
    }
    return new Promise<QaapQaiqModelOption[]>(resolve => {
        // npm-installed CLIs are `.cmd` shims on Windows; the same resolution as the one-shot listings.
        const windowsShim = process.platform === 'win32' && command.file === CLAUDE_BIN;
        let child: ChildProcess;
        try {
            child = spawnChild(windowsShim ? `${CLAUDE_BIN}.cmd` : command.file, [...command.args], {
                cwd: command.cwd,
                env: childProcessEnv({ ...(command.env ?? process.env) }),
                stdio: ['pipe', 'pipe', 'ignore'],
                shell: windowsShim,
                windowsHide: true,
                detached: process.platform !== 'win32',
            });
        } catch {
            resolve([]);
            return;
        }
        let settled = false;
        let pending = '';
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = (models: QaapQaiqModelOption[]): void => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            stopProbeChild(child);
            resolve(models);
        };
        timer = setTimeout(() => finish([]), timeoutMs);
        child.on('error', () => finish([]));
        child.on('close', () => finish([]));
        child.stdin?.on('error', () => finish([]));
        child.stdout?.setEncoding('utf8');
        child.stdout?.on('data', (chunk: string) => {
            pending += chunk;
            let newline = pending.indexOf('\n');
            while (newline >= 0 && !settled) {
                const line = pending.slice(0, newline).trim();
                pending = pending.slice(newline + 1);
                newline = pending.indexOf('\n');
                const models = line.startsWith('{') ? parseClaudeInitializeLine(line) : undefined;
                if (models) {
                    finish(models);
                }
            }
            if (!settled && pending.length > CLAUDE_PROBE_MAX_PENDING_CHARS) {
                finish([]);
            }
        });
        child.stdin?.write(`${JSON.stringify({ type: 'control_request', request_id: CLAUDE_INITIALIZE_REQUEST_ID, request: { subtype: 'initialize' } })}\n`);
    });
}

/** The first executable named `bin` on the backend PATH, resolved through symlinks; `undefined` when absent. */
function findExecutableOnPath(bin: string): string | undefined {
    for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
        if (!dir) {
            continue;
        }
        const candidate = path.join(dir, bin);
        try {
            fs.accessSync(candidate, fs.constants.X_OK);
            return fs.realpathSync(candidate);
        } catch {
            // not in this directory; keep searching the PATH
        }
    }
    return undefined;
}

/**
 * Fallback when the CLI does not answer `initialize`: scans its bundle with `grep -aoE` (run through the
 * same spawner, so a tenant reads the binary as the agent) and keeps the newest id of each family.
 */
function listClaudeBundleModels(spawner: NativeModelDiscoverySpawner | undefined, timeoutMs: number): Promise<QaapQaiqModelOption[]> {
    const binary = findExecutableOnPath(CLAUDE_BIN);
    if (!binary) {
        return Promise.resolve([]);
    }
    const args = ['-aoE', CLAUDE_BUNDLE_MODEL_ID_PATTERN, binary];
    const command = spawner ? spawner('grep', args) : { file: 'grep', args };
    if (!command) {
        return Promise.resolve([]);
    }
    return new Promise<QaapQaiqModelOption[]>(resolve => {
        execFileKillingGroup(command.file, [...command.args], {
            timeoutMs,
            maxBuffer: 16 * 1024 * 1024,
            ...(command.cwd ? { cwd: command.cwd } : {}),
            env: childProcessEnv({ ...(command.env ?? process.env) }),
        }, (error, stdout) => {
            if (error) {
                resolve([]);
                return;
            }
            resolve(parseClaudeBundleModelIds(String(stdout ?? '').split(/\r?\n/)));
        });
    });
}

/** File the Codex CLI keeps in its home: the model slugs the signed-in account may run (server-side list). */
export const CODEX_MODELS_CACHE_FILE = 'models_cache.json';

/** Uid/gid the agent CLI runs as; the backend reads the cache as this identity when it is root. */
export interface CodexCacheIdentity {
    readonly uid: number;
    readonly gid?: number;
}

/**
 * Codex home the agent CLI reads. Codex honours `CODEX_HOME`; on the desktop app (`QAAP_DESKTOP=1`, no
 * tenant containers) it is the user's own `~/.codex`, the home `codex login` wrote and the auth probe
 * read; otherwise it is `.codex` under the tenant agent storage home (`<storage root>/home`, the HOME the
 * agent's sign-in lives in) when that storage is enabled; otherwise under the agent HOME
 * (`QAAP_AGENT_HOME`, default `/home/qaap-agent`).
 *
 * The desktop branch matters: the tool-gate overlay copies `auth.json` from here into the per-task
 * `CODEX_HOME`. Pointing at the container path (`/home/theia/.qaap/…`) on a Mac copied nothing, so a
 * signed-in Codex ran without credentials and every turn failed with "401 Unauthorized: Missing bearer".
 */
export function resolveCodexAgentHome(env: NodeJS.ProcessEnv = process.env): string {
    const explicit = env.CODEX_HOME?.trim();
    if (explicit) {
        return explicit;
    }
    if (isQaapDesktopRuntime(env) || isQaapDesktopRuntime(process.env)) {
        return path.join(env.HOME?.trim() || os.homedir(), '.codex');
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

const loggedNativeListingFailures = new Set<string>();

/**
 * One server-log line per agent and reason when a CLI model listing gives nothing: the picker then falls back
 * to the curated catalog, and without this a provider the user just connected silently never appeared.
 */
function noteNativeListingFailure(agentId: string, reason: string): void {
    const key = `${agentId}:${reason}`;
    if (loggedNativeListingFailures.has(key)) {
        return;
    }
    loggedNativeListingFailures.add(key);
    console.warn(`[qaap-native-models] ${agentId} model listing gave no models (${reason.slice(0, 240)})`);
}

function firstLine(text: string | undefined): string {
    return (text ?? '').split('\n').map(line => line.trim()).find(line => line.length > 0) ?? '';
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
            // The deadline kills the listing's whole process tree (`agy models` outlived its wrapper).
            execFileKillingGroup(executable, spawn ? [...spawn.args] : args, {
                timeoutMs: 15_000,
                shell: windowsShim,
                ...(spawn?.cwd ? { cwd: spawn.cwd } : {}),
                // Never inherit the backend env by omission; a spawner env is stripped too.
                env: childProcessEnv({ ...(spawn?.env ?? process.env), ...extraEnv }),
            }, (error, stdout, stderr) => {
                // stderr is diagnostic output, never a model catalog. A failed run or an
                // unparsable answer is "no answer" (empty), so the caller keeps its catalog.
                if (error) {
                    noteNativeListingFailure(agentId, `${error.killed ? 'deadline' : error.signal ?? `exit ${String(error.code)}`}: ${firstLine(stderr)}`);
                    resolve([]);
                    return;
                }
                const models = parseNativeModelOutput(agentId, String(stdout ?? ''));
                if (models.length === 0) {
                    noteNativeListingFailure(agentId, `no models parsed: ${firstLine(stdout) || firstLine(stderr)}`);
                }
                // Picker rows belong to the agent that lists them (Pi keeps provider as vendor).
                resolve(agentId === 'pi' ? models : models.map(model => ({ ...model, vendor: agentId })));
            });
        } catch {
            resolve([]);
        }
    });
}
