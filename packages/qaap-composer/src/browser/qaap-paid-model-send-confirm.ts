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
    readStoredAgentModel,
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

/** Outcome of resolving the model for a send. `ok: false` means the send must be blocked until the user picks one. */
export type QaapSendModelResolution =
    | { readonly ok: true; readonly model: QaapCreateAgentTaskQaiqModel | undefined }
    | { readonly ok: false };

/** Session cache of the last catalog seen per agent, so a send does not re-fetch the catalog every time. */
function cachedSendCatalog(agentId: string): readonly QaapQaiqModelOption[] | undefined {
    const entry = sendCatalogCache.get(agentId.trim().toLowerCase());
    if (!entry || Date.now() - entry.at > SEND_CATALOG_CACHE_TTL_MS) {
        return undefined;
    }
    return entry.models;
}

/** Fetches the agent catalog with a short bound; undefined when it is slow or unavailable. The late result still warms the cache. */
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
 * The model a send will carry, resolved the way the composer resolves it, and validated against the live catalog:
 * the explicit pick, else the stored selection (dropped when the live catalog no longer lists it), else the free
 * default seeded from the catalog. A picker agent with no resolvable model is blocked (`ok: false`), so a send never
 * goes out on the CLI's own default. The paid-send gate checks the returned model, so a seeded default is confirmed too.
 * `preloadedCatalog` is the catalog the composer already holds; without it the session cache or a bounded fetch is used.
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
    const stored = readStoredAgentModel(cwd, agentId);
    if (stored) {
        const live = preloadedCatalog?.length ? preloadedCatalog : cachedSendCatalog(agentId);
        // Without a live catalog the stored pick cannot be checked; it is sent as before.
        if (!live?.length || live.some(model => isSameAgentModel(stored, model))) {
            return { ok: true, model: stored };
        }
        return { ok: false };
    }
    if (!cwd) {
        return { ok: false };
    }
    const live = preloadedCatalog?.length ? preloadedCatalog : cachedSendCatalog(agentId) ?? await fetchSendCatalog(agentId);
    const picked = ensureStoredAgentModel(cwd, agentId, live ?? []);
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
