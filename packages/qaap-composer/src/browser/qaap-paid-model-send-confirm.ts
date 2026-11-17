// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ConfirmDialog } from '@theia/core/lib/browser';
import { nls } from '@theia/core/lib/common/nls';
import { MobileSnackbar } from '@theia/qaap-mobile-shell/lib/browser/mobile-snackbar';
import {
    agentSupportsModelPicker,
    agentUsesSettingsModelCatalog,
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
    migrateLegacyBackendAgentId,
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

/**
 * Outcome of resolving the model for a send. `ok: false` blocks the send: `sign-in-required` when the chosen model
 * is locked until the harness is signed in (the send never switches models silently), otherwise the user must pick one.
 */
export type QaapSendModelResolution =
    | { readonly ok: true; readonly model: QaapCreateAgentTaskQaiqModel | undefined }
    | { readonly ok: false; readonly reason?: 'sign-in-required' | 'availability-unknown'; readonly modelLabel?: string };

/** The block for a model the catalog lists but the harness session does not unlock. */
function signInRequiredResolution(
    model: QaapCreateAgentTaskQaiqModel,
    option: QaapQaiqModelOption,
): QaapSendModelResolution {
    return { ok: false, reason: 'sign-in-required', modelLabel: option.label?.trim() || model.modelId };
}

/**
 * The catalog that decides whether a chosen model is locked: the caller's, else the session cache, else a bounded
 * fetch (`undefined` when it did not arrive in time). A cold cache (e.g. right after a reload, before the composer's
 * prewarm answered) must never let a locked Pro model through unchecked.
 */
async function availabilityCatalog(
    agentId: string,
    preloadedCatalog: readonly QaapQaiqModelOption[] | undefined,
): Promise<readonly QaapQaiqModelOption[] | undefined> {
    if (preloadedCatalog?.length) {
        return preloadedCatalog;
    }
    return cachedSendCatalog(agentId) ?? await fetchSendCatalog(agentId);
}

/**
 * A chosen model checked against the live catalog: locked → `sign-in-required`; catalog unavailable → a Free model
 * still goes (it never needs the harness session), any other model is held fail-closed as `availability-unknown`.
 * `undefined` means the catalog does not lock it and the caller goes on with its own rules.
 * QAIQ is exempt: its models come from the Settings lists and are gated by the provider key, never by a session.
 */
async function checkChosenModelAvailability(
    agentId: string,
    model: QaapCreateAgentTaskQaiqModel,
    preloadedCatalog: readonly QaapQaiqModelOption[] | undefined,
): Promise<{ readonly blocked?: QaapSendModelResolution; readonly live?: readonly QaapQaiqModelOption[] }> {
    if (agentUsesSettingsModelCatalog(agentId)) {
        return { live: preloadedCatalog?.length ? preloadedCatalog : cachedSendCatalog(agentId) };
    }
    const live = await availabilityCatalog(agentId, preloadedCatalog);
    if (live === undefined) {
        return isFreeAgentModel(model)
            ? {}
            : { blocked: { ok: false, reason: 'availability-unknown', modelLabel: model.modelId } };
    }
    const listed = live.find(option => isSameAgentModel(model, option));
    if (listed?.available === false) {
        return { blocked: signInRequiredResolution(model, listed), live };
    }
    return { live };
}

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
        const { blocked } = await checkChosenModelAvailability(agentId, explicitModel, preloadedCatalog);
        return blocked ?? { ok: true, model: explicitModel };
    }
    const record = readStoredAgentModelSelection(cwd, agentId);
    if (record) {
        // Locked by the session, not gone from the catalog: block with the sign-in reason instead of healing it.
        const { blocked, live } = await checkChosenModelAvailability(agentId, record.model, preloadedCatalog);
        if (blocked) {
            return blocked;
        }
        // An empty catalog (or an unavailable one for a Free pick) cannot tell more: the stored pick is sent.
        if (!live?.length) {
            return { ok: true, model: record.model };
        }
        const listed = live.find(option => isSameAgentModel(record.model, option));
        if (listed) {
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

function sameAgentId(left: string, right: string): boolean {
    const normalize = (id: string): string => {
        const bare = id.trim().replace(/^@/, '').toLowerCase();
        return migrateLegacyBackendAgentId(bare)?.toLowerCase() ?? bare;
    };
    return normalize(left) === normalize(right);
}

/**
 * True when `model` can be sent with `agentId`. A model resolved for another harness (`modelAgentId`) never
 * belongs, nor does one the agent's loaded native catalog does not list. Without a model, or for an agent
 * without a model picker (the model is dropped there), there is nothing to check.
 */
export function sendModelBelongsToAgent(
    agentId: string | undefined,
    model: QaapCreateAgentTaskQaiqModel | undefined,
    modelAgentId?: string,
): boolean {
    if (!model || !agentId || !agentSupportsModelPicker(agentId)) {
        return true;
    }
    if (modelAgentId?.trim() && !sameAgentId(modelAgentId, agentId)) {
        return false;
    }
    // QAIQ reads its models from the Settings lists, which the native catalog does not mirror.
    if (agentUsesSettingsModelCatalog(agentId)) {
        return true;
    }
    const live = cachedSendCatalog(agentId);
    return !live?.length || live.some(option => isSameAgentModel(model, option));
}

/**
 * Tells the user a send was held because the chosen model needs the harness sign-in; the action opens that sign-in.
 */
export function warnSignInRequiredSend(agentLabel: string, modelLabel: string, openSignIn?: () => void): void {
    MobileSnackbar.show(
        nls.localize('qaap/composer/signInToUseModel', 'Sign in to {0} to use {1}.', agentLabel, modelLabel),
        openSignIn
            ? {
                kind: 'warning',
                actionLabel: nls.localize('qaap/agentPicker/signIn', 'Sign in'),
                onAction: () => openSignIn(),
            }
            : { kind: 'warning' },
    );
}

/**
 * Tells the user a send was held because the model's availability could not be checked in time (fail-closed for
 * models that may need the harness sign-in); sending again retries the check.
 */
export function warnSendAvailabilityUnknown(agentLabel: string, modelLabel: string): void {
    MobileSnackbar.show(
        nls.localize('qaap/composer/sendAvailabilityUnknown', "Couldn't check whether {0} can use {1}. Try again.", agentLabel, modelLabel),
        { kind: 'warning' },
    );
}

/**
 * Shows why a send was held: the sign-in, an availability that could not be checked, or a missing model choice.
 * One place, so every composer (web, mobile, desktop) says the same thing.
 */
export function warnBlockedSend(
    resolution: Extract<QaapSendModelResolution, { readonly ok: false }>,
    agentLabel: string,
    actions: { readonly openSignIn?: () => void; readonly openModelPicker?: () => void } = {},
): void {
    if (resolution.reason === 'sign-in-required') {
        warnSignInRequiredSend(agentLabel, resolution.modelLabel ?? agentLabel, actions.openSignIn);
    } else if (resolution.reason === 'availability-unknown') {
        warnSendAvailabilityUnknown(agentLabel, resolution.modelLabel ?? agentLabel);
    } else {
        warnChooseSendModel(agentLabel, actions.openModelPicker);
    }
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
