// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ConfirmDialog } from '@theia/core/lib/browser';
import { nls } from '@theia/core/lib/common/nls';
import { MobileSnackbar } from '@theia/qaap-mobile-shell/lib/browser/mobile-snackbar';
import {
    agentSupportsModelPicker,
    ensureStoredAgentModel,
    isFreeAgentModel,
    isStoredAgentModelUsable,
    pickDefaultAgentModel,
    readStoredAgentModelSelection,
    seedStoredAgentModelDefault,
    staticFreeSendDefault,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-model-selection';
import {
    fetchAgentModelsForAgent,
    hashString,
    isSameAgentModel,
    type QaapCreateAgentTaskQaiqModel,
    type QaapQaiqModelOption,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';

const PAID_SEND_CONFIRMED_STORAGE_PREFIX = 'qaap.paidModelSendConfirmed';

function paidSendStorageKey(cwd: string): string {
    return `${PAID_SEND_CONFIRMED_STORAGE_PREFIX}.${hashString(cwd)}`;
}

/** True when the owner already confirmed paid sends for this project in this browser session. */
export function hasConfirmedPaidSendForProject(cwd: string | undefined): boolean {
    if (!cwd) {
        return false;
    }
    try {
        return window.sessionStorage.getItem(paidSendStorageKey(cwd)) === 'true';
    } catch {
        // sessionStorage can be blocked: then the user is asked again, which is the safe direction.
        return false;
    }
}

function rememberPaidSendForProject(cwd: string | undefined): void {
    if (!cwd) {
        return;
    }
    try {
        window.sessionStorage.setItem(paidSendStorageKey(cwd), 'true');
    } catch {
        /* sessionStorage unavailable: the next send asks again */
    }
}

/** Upper bound for the catalog lookup on the send path; past it the send is blocked, never sent without a model. */
export const SEND_CATALOG_TIMEOUT_MS = 2000;
const SEND_CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;

interface SendCatalogCacheEntry {
    readonly models: readonly QaapQaiqModelOption[];
    readonly at: number;
}
const sendCatalogCache = new Map<string, SendCatalogCacheEntry>();

/** Session cache of the last catalog seen per agent, so a send does not re-fetch the catalog every time. */
function cachedSendCatalog(agentId: string): readonly QaapQaiqModelOption[] | undefined {
    const entry = sendCatalogCache.get(agentId.trim().toLowerCase());
    if (!entry || Date.now() - entry.at > SEND_CATALOG_CACHE_TTL_MS) {
        return undefined;
    }
    return entry.models;
}

/**
 * Fetches the agent catalog with a short bound. Resolves `undefined` when the catalog is unavailable (slow or
 * failed) and the loaded list otherwise (possibly empty). The late result still warms the cache.
 */
async function fetchSendCatalog(agentId: string): Promise<readonly QaapQaiqModelOption[] | undefined> {
    const key = agentId.trim().toLowerCase();
    const request = fetchAgentModelsForAgent(agentId).then(models => {
        sendCatalogCache.set(key, { models, at: Date.now() });
        return models;
    }, () => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<undefined>(resolve => {
        timer = setTimeout(() => resolve(undefined), SEND_CATALOG_TIMEOUT_MS);
    });
    try {
        return await Promise.race([request, timeout]);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Warms the send catalog for an agent (composer mount, agent change) so the first send usually finds it cached.
 * Fire-and-forget; resolves once the warm-up attempt settles.
 */
export function prewarmSendCatalog(agentId: string | undefined): Promise<void> {
    if (!agentId || !agentSupportsModelPicker(agentId) || cachedSendCatalog(agentId)) {
        return Promise.resolve();
    }
    return fetchSendCatalog(agentId).then(() => undefined);
}

/** Outcome of resolving the model for a send. `ok: false` means the send must be blocked until the user picks one. */
export type QaapSendModelResolution =
    | { readonly ok: true; readonly model: QaapCreateAgentTaskQaiqModel | undefined }
    | { readonly ok: false };

/**
 * The model a send will carry, resolved the way the composer resolves it and validated against the live catalog:
 * - the explicit pick;
 * - else the stored selection: a user's pick is dropped (blocked) when the live catalog no longer lists it, while an
 *   auto-seeded default is replaced by the live free default;
 * - else the free default seeded from the catalog. When the catalog is unavailable (slow or failed) the static free
 *   default of the harness is used and stored as an auto default; a catalog that loaded but has no free model blocks.
 * A picker agent with no resolvable model is blocked (`ok: false`), so a send never goes out on the CLI default.
 * `preloadedCatalog` is a catalog the caller already holds; otherwise the session cache, then a bounded fetch, is used.
 */
export async function resolveSendAgentModel(
    agentId: string | undefined,
    cwd: string | undefined,
    explicitModel?: QaapCreateAgentTaskQaiqModel,
    preloadedCatalog?: readonly QaapQaiqModelOption[],
): Promise<QaapSendModelResolution> {
    if (!agentId || !agentSupportsModelPicker(agentId)) {
        return { ok: true, model: undefined };
    }
    if (explicitModel && isStoredAgentModelUsable(explicitModel)) {
        return { ok: true, model: explicitModel };
    }
    const record = readStoredAgentModelSelection(cwd, agentId);
    if (record) {
        const live = preloadedCatalog?.length ? preloadedCatalog : cachedSendCatalog(agentId);
        // Without a live catalog the stored pick cannot be checked; it is sent as before.
        if (!live?.length || live.some(model => isSameAgentModel(record.model, model))) {
            return { ok: true, model: record.model };
        }
        if (record.userChosen) {
            return { ok: false };
        }
        const healed = ensureStoredAgentModel(cwd, agentId, live);
        return healed ? { ok: true, model: healed } : { ok: false };
    }
    const live = preloadedCatalog?.length ? preloadedCatalog : cachedSendCatalog(agentId) ?? await fetchSendCatalog(agentId);
    if (live === undefined) {
        // Catalog unavailable (timeout or error): the harness's static free default, never a paid one.
        const fallback = staticFreeSendDefault(agentId);
        if (!fallback || !isStoredAgentModelUsable(fallback)) {
            return { ok: false };
        }
        if (cwd) {
            seedStoredAgentModelDefault(cwd, agentId, fallback);
        }
        return { ok: true, model: fallback };
    }
    if (!cwd) {
        const picked = pickDefaultAgentModel(live);
        return picked ? { ok: true, model: { provider: picked.provider, vendor: picked.vendor, modelId: picked.modelId } } : { ok: false };
    }
    const picked = ensureStoredAgentModel(cwd, agentId, live);
    return picked ? { ok: true, model: picked } : { ok: false };
}

/** Tells the user a send was held because no model is chosen; the optional opener moves them to the model picker. */
export function warnChooseSendModel(agentLabel: string, openModelPicker?: () => void): void {
    MobileSnackbar.show(
        nls.localize('qaap/composer/chooseModelForAgent', 'Choose a model for {0}', agentLabel),
        { kind: 'warning' },
    );
    openModelPicker?.();
}

/**
 * Before the first send to a paid model in a project during this browser session, asks the user to
 * confirm (paid sends spend provider credits). Free models and already-confirmed projects pass through.
 * Resolves true when the send may proceed.
 */
export async function confirmPaidModelSend(
    cwd: string | undefined,
    model: QaapCreateAgentTaskQaiqModel | undefined,
): Promise<boolean> {
    if (!model || isFreeAgentModel(model) || hasConfirmedPaidSendForProject(cwd)) {
        return true;
    }
    const accepted = await new ConfirmDialog({
        title: nls.localize('qaap/composer/paidModelSendTitle', 'Send with a paid model?'),
        msg: nls.localize(
            'qaap/composer/paidModelSendMessage',
            'This model is paid and uses your provider credits. Send anyway?',
        ),
        ok: nls.localize('qaap/composer/paidModelSendConfirm', 'Send'),
        cancel: nls.localize('qaap/composer/paidModelSendCancel', 'Cancel'),
    }).open();
    if (accepted === true) {
        rememberPaidSendForProject(cwd);
        return true;
    }
    return false;
}
