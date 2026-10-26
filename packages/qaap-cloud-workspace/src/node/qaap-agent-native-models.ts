// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { QaapQaiqModelOption } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import { NATIVE_MODEL_CATALOG_EXCLUDED_AGENT_IDS } from '@theia/qaap-shared-core/lib/common/qaap-builtin-agents';
import {
    agentUsesNativeModelCatalog,
    listStaticNativeAgentModels,
    parseNativeModelLines,
} from '../common/qaap-agent-native-model-catalog';

const cache = new Map<string, QaapQaiqModelOption[]>();
/** In-flight CLI discoveries; the event loop is shared with every other request, so never spawn synchronously. */
const discoveries = new Map<string, Promise<QaapQaiqModelOption[]>>();

export function listNativeAgentModels(agentId: string | undefined): QaapQaiqModelOption[] {
    const normalized = agentId?.trim().toLowerCase();
    if (!normalized || NATIVE_MODEL_CATALOG_EXCLUDED_AGENT_IDS.has(normalized)) {
        return [];
    }
    const cached = cache.get(normalized);
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
    const cached = cache.get(normalized);
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
            }
            return models;
        });
    discoveries.set(normalized, discovery);
    return discovery;
}

export function clearNativeAgentModelCache(): void {
    cache.clear();
    discoveries.clear();
}

async function discoverNativeAgentModels(agentId: string): Promise<QaapQaiqModelOption[]> {
    switch (agentId) {
        case 'opencode':
            return discoverFromCommand('opencode', ['models'], agentId);
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

/**
 * Codex home the agent CLI reads. Codex honours `CODEX_HOME`; otherwise it is `.codex` under the agent
 * HOME, which is the shared agent home when no tenant is in scope (the picker has no working directory).
 */
export function resolveCodexAgentHome(env: NodeJS.ProcessEnv = process.env): string {
    const explicit = env.CODEX_HOME?.trim();
    if (explicit) {
        return explicit;
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

/**
 * Reads the account's Codex model list. Plain file read: the cache is written by the Codex CLI into the agent
 * home, and the picker runs in the backend process (the same process the other native discoveries use).
 */
async function discoverCodexAccountModels(codexHome: string = resolveCodexAgentHome()): Promise<QaapQaiqModelOption[]> {
    try {
        return parseCodexModelsCache(await fs.promises.readFile(path.join(codexHome, CODEX_MODELS_CACHE_FILE), 'utf8'));
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
