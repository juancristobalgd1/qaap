// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { isFreeAgentModel } from './qaap-agent-model-selection';
import { OPENCODE_AGENT_ID, type QaapAgentConnectionState } from './qaap-agent-task-client';

/**
 * Sign-in state of one harness as the product rule sees it.
 * - `signed-in`: the harness session is confirmed; Pro models are selectable.
 * - `signed-out`: the harness positively reported no session (or a turn proved the session was rejected);
 *   Pro models are visible but locked.
 * - `checking`: the auth probe is still running. Pro models stay selectable: the run's own pre-spawn guard
 *   waits for the probe, and a lock that depends on a probe settling can hang forever.
 * - `unknown`: the probe settled without a clear answer (timeout, unreadable output) or the harness has no
 *   way to report its session. Fail-open: Pro models stay selectable and the run surfaces the harness's own
 *   sign-in prompt (auth failure → rejected session → `signed-out` with the Sign in action).
 */
export type QaapHarnessSession = 'signed-in' | 'signed-out' | 'checking' | 'unknown';

/** `free` models work without the harness session; `pro` models need it. Unproven Free means `pro`. */
export type QaapModelTier = 'free' | 'pro';

/**
 * Why a model is not selectable. Absent when the model is selectable or hidden by harness settings.
 * `checking-sign-in` is no longer produced by {@link QaapHarnessModelAvailability.availability} (an unsettled
 * session does not lock); it is kept so older payloads and the legacy `checking` mapping still type-check.
 */
export type QaapModelUnavailableReason = 'harness-disabled' | 'sign-in-required' | 'checking-sign-in';

/** Visibility and selectability of one model under the unified harness and model availability rule. */
export interface QaapModelAvailability {
    readonly visible: boolean;
    readonly selectable: boolean;
    readonly reason?: QaapModelUnavailableReason;
}

/** Input of {@link QaapHarnessModelAvailability.session}. Mirrors the backend descriptor fields. */
export interface QaapHarnessSessionInput {
    readonly connectionState?: QaapAgentConnectionState;
    /** Backend access state (`resolveAgentAccess`). When present it takes precedence over `connectionState`. */
    readonly accessState?: 'session' | 'none' | 'unknown';
    /** True once the backend probe for this harness has finished. Splits an unknown answer into `checking` and `unknown`. */
    readonly probeSettled?: boolean;
}

/** Input of {@link QaapHarnessModelAvailability.tier}: the catalog fields that can mark a model free. */
export interface QaapHarnessModelTierInput {
    readonly modelId: string;
    readonly label?: string;
    readonly vendor?: string;
}

/** Input of {@link QaapHarnessModelAvailability.availability}. */
export interface QaapHarnessModelAvailabilityInput {
    readonly harnessEnabled: boolean;
    readonly session: QaapHarnessSession;
    readonly tier: QaapModelTier;
}

/**
 * The single availability rule shared by every harness and every surface (web, mobile, Electron).
 *
 * | Harness state            | Free models              | Pro models                                  |
 * | ------------------------ | ------------------------ | ------------------------------------------- |
 * | signed out               | visible, selectable      | visible, not selectable (sign-in required)  |
 * | signed in                | visible, selectable      | visible, selectable                         |
 * | checking / unknown       | visible, selectable      | visible, selectable (fail-open)             |
 * | disabled in Settings     | hidden                   | hidden                                      |
 *
 * Pure functions only: no DI, no I/O. Backend and frontend call the same functions so the rule cannot drift.
 */
export namespace QaapHarnessModelAvailability {

    /**
     * Resolves the sign-in state of a harness.
     * `accessState`, when present, decides `session` / `none`; its `unknown` and an `unknown` connection state
     * are `checking` while the probe runs and `unknown` once it settled. `connected` and `not-required` are
     * signed in, `disconnected` is signed out. Only a positive answer is ever `signed-out`. A missing
     * connection state is `checking`.
     * @param input the harness connection and access signals.
     * @returns the harness session state.
     */
    export function session(input: QaapHarnessSessionInput): QaapHarnessSession {
        if (input.accessState !== undefined) {
            switch (input.accessState) {
                case 'session':
                    return 'signed-in';
                case 'none':
                    return 'signed-out';
                default:
                    return input.probeSettled === true ? 'unknown' : 'checking';
            }
        }
        switch (input.connectionState) {
            case 'connected':
            case 'not-required':
                return 'signed-in';
            case 'disconnected':
                return 'signed-out';
            case 'unknown':
                return input.probeSettled === true ? 'unknown' : 'checking';
            default:
                return 'checking';
        }
    }

    /**
     * Classifies a model as Free or Pro.
     * Only OpenCode models can be Free, and only when {@link isFreeAgentModel} proves it. Every other model,
     * including OpenRouter `:free` models used through Pi, is Pro.
     * @param agentId the harness id (normalized to lower case before comparison).
     * @param model the model catalog fields.
     * @returns `free` or `pro`.
     */
    export function tier(agentId: string, model: QaapHarnessModelTierInput): QaapModelTier {
        const normalizedAgentId = agentId?.trim().toLowerCase() ?? '';
        if (normalizedAgentId !== OPENCODE_AGENT_ID) {
            return 'pro';
        }
        // Fail-closed: an OpenCode-routed model is free only under the `opencode/` prefix. Any other provider
        // (e.g. `openrouter/x:free`) needs that provider's key, so it stays pro even if its slug looks free.
        const modelId = model.modelId?.trim().toLowerCase() ?? '';
        if (!modelId.startsWith(`${OPENCODE_AGENT_ID}/`)) {
            return 'pro';
        }
        return isFreeAgentModel({ modelId: model.modelId, label: model.label, vendor: model.vendor }) ? 'free' : 'pro';
    }

    /**
     * Visibility and selectability of one model.
     * @param input the harness enabled flag, the harness session and the model tier.
     * @returns the availability with a reason whenever the model is not selectable.
     */
    export function availability(input: QaapHarnessModelAvailabilityInput): QaapModelAvailability {
        if (!input.harnessEnabled) {
            return { visible: false, selectable: false, reason: 'harness-disabled' };
        }
        if (input.tier === 'free') {
            return { visible: true, selectable: true };
        }
        // Only a positive sign-out locks: `checking` and `unknown` fail open (see QaapHarnessSession).
        return input.session === 'signed-out'
            ? { visible: true, selectable: false, reason: 'sign-in-required' }
            : { visible: true, selectable: true };
    }

    /**
     * Maps a unified reason onto the legacy `QaapQaiqModelOption.unavailableReason` values.
     * @param reason the unified unavailable reason, if any.
     * `checking` is used instead of `unknown` because `unknown` already means "the provider rejected the model".
     * @returns `not-connected`, `checking`, or `undefined` when there is no reason to report.
     */
    export function toLegacyUnavailableReason(reason: QaapModelUnavailableReason | undefined): 'not-connected' | 'checking' | undefined {
        switch (reason) {
            case 'sign-in-required':
                return 'not-connected';
            case 'checking-sign-in':
                return 'checking';
            default:
                return undefined;
        }
    }
}
