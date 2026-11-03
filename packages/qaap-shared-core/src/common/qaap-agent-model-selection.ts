// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { isExcludedOpenRouterModelSlug, OPENROUTER_DEFAULT_FREE_MODELS } from '@theia/qaap-ai-openrouter/lib/common/openrouter-models';
import { qaapUserScopedStorageKey } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { NATIVE_MODEL_CATALOG_EXCLUDED_AGENT_IDS, NATIVE_MODEL_PICKER_AGENT_IDS } from './qaap-builtin-agents';
import {
    hashString,
    isTheiaCoderAgent,
    migrateLegacyBackendAgentId,
    QAIQ_AGENT_ID,
    SELECTED_QAIQ_MODEL_STORAGE_KEY,
    SHELL_AGENT_ID,
    type QaapCreateAgentTaskQaiqModel,
    type QaapQaiqModelOption,
} from './qaap-agent-task-client';
import { qaiqModelSupportsToolCalls } from './qaap-agent-tool-support';
import { isOpenCodeFreeModelId, OPENCODE_FREE_MODEL_OPTIONS } from './qaap-opencode-model-catalog';

export type QaapAgentModelSelection = QaapCreateAgentTaskQaiqModel;

const AGENT_MODEL_STORAGE_PREFIX = 'qaap.agentTasks.selectedAgentModel';

/** OpenRouter's free-tier slug suffix. The catalogs carry no price, so the slug is the free marker. */
const FREE_MODEL_SLUG_SUFFIX = ':free';
const OPENCODE_VENDOR = 'opencode';

/** Catalog fields that can mark a model free. Only `modelId` is required; the others sharpen OpenCode detection. */
export interface AgentModelFreeMetadata {
    readonly modelId?: string;
    readonly vendor?: string;
    readonly label?: string;
}

/**
 * True for a free model. Every other model is treated as paid, so the lock fails closed. Free markers:
 * an OpenRouter free-tier slug (`:free`, or the `/free` router), and an OpenCode model whose catalog entry is
 * free (zero cost in `opencode models --verbose`, mirrored in `OPENCODE_FREE_MODEL_OPTIONS`; ids ending `-free`,
 * or a label ending in " Free"). Shared by the composer (Paid badge, send confirmation) and the fallback chain.
 */
export function isFreeAgentModel(model: AgentModelFreeMetadata | undefined): boolean {
    const modelId = model?.modelId?.trim().toLowerCase() ?? '';
    if (modelId.endsWith(FREE_MODEL_SLUG_SUFFIX) || modelId.endsWith('/free')) {
        return true;
    }
    return isOpenCodeFreeModel(model);
}

function isOpenCodeFreeModel(model: AgentModelFreeMetadata | undefined): boolean {
    const modelId = model?.modelId?.trim() ?? '';
    if (!modelId) {
        return false;
    }
    // Both conditions must hold: a `Free` label on another provider's model (e.g. `anthropic/x`) is not a free marker.
    const vendor = model?.vendor?.trim().toLowerCase();
    if (vendor !== OPENCODE_VENDOR || !modelId.toLowerCase().startsWith(`${OPENCODE_VENDOR}/`)) {
        return false;
    }
    // Primary signal: the zero-cost OpenCode catalog (generated from `opencode models --verbose`).
    const lowerId = modelId.toLowerCase();
    if (isOpenCodeFreeModelId(lowerId) || OPENCODE_FREE_MODEL_OPTIONS.some(option => option.modelId.toLowerCase() === lowerId)) {
        return true;
    }
    // Last resort: the catalog label ends in " Free" (e.g. "Beam Free").
    return / free$/i.test(model?.label?.trim() ?? '');
}

/** Stored pick plus whether the user chose it (a default seeded by the picker is not a user choice). */
interface StoredAgentModelRecord {
    readonly model: QaapAgentModelSelection;
    readonly userChosen: boolean;
}

/** QAIQ uses the OpenRouter/NVIDIA/etc. lists from Settings → AI Features. */
// Keep these literals here: qaap-agent-task-client re-exports this module, so reading its
// constants during CommonJS module initialization would otherwise produce undefined entries.
export const SETTINGS_MODEL_CATALOG_AGENT_IDS = new Set(['qaiq']);

export function agentUsesSettingsModelCatalog(agentId: string | undefined): boolean {
    const normalized = migrateLegacyBackendAgentId(agentId)?.toLowerCase();
    return !!normalized && SETTINGS_MODEL_CATALOG_AGENT_IDS.has(normalized);
}

/** VPS agents with their own model catalog (CLI or curated), not the Settings BYOK lists. */
export function agentUsesNativeModelCatalog(agentId: string | undefined): boolean {
    const normalized = migrateLegacyBackendAgentId(agentId)?.toLowerCase();
    if (!normalized || normalized === SHELL_AGENT_ID || isTheiaCoderAgent(normalized)) {
        return false;
    }
    if (NATIVE_MODEL_CATALOG_EXCLUDED_AGENT_IDS.has(normalized)) {
        return false;
    }
    return !agentUsesSettingsModelCatalog(normalized) && NATIVE_MODEL_PICKER_AGENT_IDS.has(normalized);
}

/** Agent exposes a model submenu (Settings catalog for QAIQ, native catalog for other VPS agents). */
export function agentSupportsModelPicker(agentId: string | undefined): boolean {
    const normalized = migrateLegacyBackendAgentId(agentId)?.toLowerCase();
    if (!normalized || normalized === SHELL_AGENT_ID || isTheiaCoderAgent(normalized)) {
        return false;
    }
    return agentUsesSettingsModelCatalog(normalized) || agentUsesNativeModelCatalog(normalized);
}

export function scopedAgentModelStorageKey(cwd: string, agentId: string, userLogin?: string): string {
    const agent = migrateLegacyBackendAgentId(agentId) ?? agentId;
    return qaapUserScopedStorageKey(
        `${AGENT_MODEL_STORAGE_PREFIX}.${hashString(cwd)}.${agent}`,
        userLogin ?? resolveAgentModelStorageLogin(),
    );
}

let agentModelStorageLogin: string | undefined;

/** Bind the signed-in login so model picks never cross tenants on a shared origin. */
export function setAgentModelStorageUserLogin(login: string | undefined): void {
    agentModelStorageLogin = login?.trim() || undefined;
}

function resolveAgentModelStorageLogin(): string | undefined {
    if (agentModelStorageLogin) {
        return agentModelStorageLogin;
    }
    if (typeof window === 'undefined' || !window.localStorage) {
        return undefined;
    }
    try {
        for (let i = 0; i < window.localStorage.length; i++) {
            const key = window.localStorage.key(i);
            if (!key?.includes('qaap.auth.user')) {
                continue;
            }
            const raw = window.localStorage.getItem(key);
            if (!raw) {
                continue;
            }
            const parsed = JSON.parse(raw) as { login?: unknown };
            if (typeof parsed?.login === 'string' && parsed.login.trim()) {
                return parsed.login;
            }
        }
    } catch {
        return undefined;
    }
    return undefined;
}

function parseStoredModel(raw: string | null | undefined): StoredAgentModelRecord | undefined {
    if (!raw) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(raw) as Partial<QaapAgentModelSelection> & { userChosen?: unknown };
        if (!parsed || typeof parsed.provider !== 'string' || typeof parsed.modelId !== 'string') {
            return undefined;
        }
        const model: QaapAgentModelSelection = {
            provider: parsed.provider as QaapAgentModelSelection['provider'],
            vendor: typeof parsed.vendor === 'string' ? parsed.vendor : 'unknown',
            modelId: parsed.modelId,
        };
        return isStoredAgentModelUsable(model) ? { model, userChosen: parsed.userChosen === true } : undefined;
    } catch {
        return undefined;
    }
}

/** Drop models removed from the catalog (e.g. offline OpenRouter :free slugs). */
export function isStoredAgentModelUsable(model: QaapAgentModelSelection | undefined): boolean {
    if (!model?.modelId?.trim()) {
        return false;
    }
    // Confirmed tool-less families cannot drive Agent mode — clear stale localStorage picks.
    if (qaiqModelSupportsToolCalls(model.modelId) === false) {
        return false;
    }
    // Hermes (and other native catalogs) store the org as vendor (`nvidia`, `poolside`),
    // not `openrouter` — still drop slugs OpenRouter no longer serves.
    if (isExcludedOpenRouterModelSlug(model.modelId)) {
        return false;
    }
    return true;
}

export function readStoredAgentModel(cwd: string | undefined, agentId: string | undefined): QaapAgentModelSelection | undefined {
    return readStoredAgentModelRecord(cwd, agentId)?.model;
}

function readStoredAgentModelRecord(cwd: string | undefined, agentId: string | undefined): StoredAgentModelRecord | undefined {
    if (!cwd || !agentId || !agentSupportsModelPicker(agentId)) {
        return undefined;
    }
    try {
        const agent = migrateLegacyBackendAgentId(agentId) ?? agentId;
        const scopedKey = scopedAgentModelStorageKey(cwd, agent);
        const scopedRaw = window.localStorage.getItem(scopedKey);
        const scoped = parseStoredModel(scopedRaw);
        if (scoped) {
            return scoped;
        }
        if (scopedRaw) {
            window.localStorage.removeItem(scopedKey);
        }
        if (agent === QAIQ_AGENT_ID) {
            return readLegacyQaiqModel(cwd);
        }
        return undefined;
    } catch {
        return undefined;
    }
}

function readLegacyQaiqModel(cwd: string): StoredAgentModelRecord | undefined {
    const login = resolveAgentModelStorageLogin();
    const scopedKey = qaapUserScopedStorageKey(`${SELECTED_QAIQ_MODEL_STORAGE_KEY}.${hashString(cwd)}`, login);
    const scopedRaw = window.localStorage.getItem(scopedKey);
    const globalRaw = login
        ? undefined
        : window.localStorage.getItem(SELECTED_QAIQ_MODEL_STORAGE_KEY);
    const raw = scopedRaw ?? globalRaw ?? undefined;
    const model = parseStoredModel(raw);
    if (!model && raw) {
        if (scopedRaw) {
            window.localStorage.removeItem(scopedKey);
        }
        if (globalRaw) {
            window.localStorage.removeItem(SELECTED_QAIQ_MODEL_STORAGE_KEY);
        }
    }
    return model;
}

/** Persists a model the user picked for this project (an explicit choice, never a seeded default). */
export function writeStoredAgentModel(
    cwd: string | undefined,
    agentId: string,
    model: QaapAgentModelSelection | QaapQaiqModelOption,
): void {
    persistStoredAgentModel(cwd, agentId, model, true);
}

function persistStoredAgentModel(
    cwd: string | undefined,
    agentId: string,
    model: QaapAgentModelSelection | QaapQaiqModelOption,
    userChosen: boolean,
): void {
    if (!cwd || !agentSupportsModelPicker(agentId)) {
        return;
    }
    const agent = migrateLegacyBackendAgentId(agentId) ?? agentId;
    const payload: QaapAgentModelSelection & { userChosen?: true } = {
        provider: model.provider,
        vendor: model.vendor,
        modelId: model.modelId,
        ...(userChosen ? { userChosen: true as const } : {}),
    };
    try {
        const serialized = JSON.stringify(payload);
        window.localStorage.setItem(scopedAgentModelStorageKey(cwd, agent), serialized);
        if (agent === QAIQ_AGENT_ID) {
            const login = resolveAgentModelStorageLogin();
            window.localStorage.setItem(
                qaapUserScopedStorageKey(`${SELECTED_QAIQ_MODEL_STORAGE_KEY}.${hashString(cwd)}`, login),
                serialized,
            );
            if (!login) {
                window.localStorage.setItem(SELECTED_QAIQ_MODEL_STORAGE_KEY, serialized);
            }
        }
    } catch {
        /* localStorage unavailable */
    }
}

export function isSameAgentModel(
    stored: QaapAgentModelSelection | undefined,
    model: QaapQaiqModelOption,
): boolean {
    return !!stored
        && stored.provider === model.provider
        && stored.vendor === model.vendor
        && stored.modelId === model.modelId;
}

/** Prefer an in-memory / conversation selection; fall back to project-scoped localStorage. */
export function resolveAgentModelForSubmit(
    agentId: string | undefined,
    cwd: string | undefined,
    explicitModel?: QaapAgentModelSelection | undefined,
): QaapAgentModelSelection | undefined {
    if (!agentId || !agentSupportsModelPicker(agentId)) {
        return undefined;
    }
    if (explicitModel && isStoredAgentModelUsable(explicitModel)) {
        return explicitModel;
    }
    return readStoredAgentModel(cwd, agentId);
}

export function resolveStoredAgentModelForSubmit(
    agentId: string | undefined,
    cwd: string | undefined,
): QaapAgentModelSelection | undefined {
    return resolveAgentModelForSubmit(agentId, cwd);
}

/**
 * Composer default: the QAIQ/Pi default free model first, then any other free model. Never a paid model:
 * a catalog without a usable free entry yields `undefined`, so the caller moves on to another harness or
 * leaves the choice to the user. Entries the account cannot run (`available === false`, e.g.
 * `unavailableReason: 'plan'`) are skipped as well.
 */
export function pickDefaultAgentModel(
    models: readonly QaapQaiqModelOption[],
): QaapQaiqModelOption | undefined {
    const usableFree = models.filter(model => model.available !== false && isFreeAgentModel(model) && isStoredAgentModelUsable({
        provider: model.provider,
        vendor: model.vendor,
        modelId: model.modelId,
    }));
    return usableFree.find(model => model.modelId === OPENROUTER_DEFAULT_FREE_MODELS[0])
        ?? usableFree[0];
}

/**
 * Read-only-for-the-user seam for render paths (picker views, row labels). Keeps any valid stored selection
 * exactly as it is, even when the catalog no longer lists it, and seeds the free default only when nothing is
 * stored. Navigating the picker therefore never swaps a choice; explicit picks go through
 * `writeStoredAgentModel`, and the catalog healing stays in `ensureStoredAgentModel`.
 */
export function seedDisplayedAgentModel(
    cwd: string | undefined,
    agentId: string | undefined,
    models: readonly QaapQaiqModelOption[],
): QaapAgentModelSelection | undefined {
    if (!cwd || !agentId || !agentSupportsModelPicker(agentId)) {
        return undefined;
    }
    const existing = readStoredAgentModelRecord(cwd, agentId);
    if (existing) {
        return existing.model;
    }
    const picked = pickDefaultAgentModel(models);
    if (!picked) {
        return undefined;
    }
    persistStoredAgentModel(cwd, agentId, picked, false);
    return {
        provider: picked.provider,
        vendor: picked.vendor,
        modelId: picked.modelId,
    };
}

/**
 * Persist a usable model when a model-capable agent has none selected, or when
 * the live native catalog no longer contains the stored selection.
 * Returns the existing, replaced, or newly written selection (undefined if
 * catalog empty).
 */
export function ensureStoredAgentModel(
    cwd: string | undefined,
    agentId: string | undefined,
    models: readonly QaapQaiqModelOption[],
): QaapAgentModelSelection | undefined {
    if (!cwd || !agentId || !agentSupportsModelPicker(agentId)) {
        return undefined;
    }
    const existing = readStoredAgentModelRecord(cwd, agentId);
    const picked = pickDefaultAgentModel(models);
    if (existing && (models.length === 0 || models.some(model => isSameAgentModel(existing.model, model)))) {
        // A paid default the user never chose (seeded before free-first defaults) yields to a free model.
        const yieldsToFree = !existing.userChosen && !isFreeAgentModel(existing.model) && isFreeAgentModel(picked);
        if (!yieldsToFree) {
            return existing.model;
        }
    }
    if (!picked) {
        return undefined;
    }
    persistStoredAgentModel(cwd, agentId, picked, false);
    return {
        provider: picked.provider,
        vendor: picked.vendor,
        modelId: picked.modelId,
    };
}
