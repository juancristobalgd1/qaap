// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { type QaapCreateAgentTaskQaiqModel, QAIQ_AGENT_ID, SHELL_AGENT_ID } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import { resolveQaapHarnessSessionDetection } from '@theia/qaap-shared-core/lib/common/qaap-harness-auth-profile';
import { QaapHarnessModelAvailability, type QaapModelUnavailableReason } from '@theia/qaap-shared-core/lib/common/qaap-harness-model-availability';
import { resolveAgentAccess } from './qaap-agent-access';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';

/**
 * Thrown by the sign-in guard before the agent process spawns. The runner marks the task
 * `preflightFailure: 'sign_in_required'` so model fallback never re-spawns it.
 */
export class QaapAgentSignInRequiredError extends Error {
    constructor(message: string, readonly reason: QaapModelUnavailableReason) {
        super(message);
        this.name = 'QaapAgentSignInRequiredError';
    }
}

/**
 * Pre-spawn guard for the unified availability rule (`QaapHarnessModelAvailability.availability`, the same function
 * the picker and the send block use): a Pro model is refused when its harness session is signed out (probe answer
 * or a rejected session) or settled `unknown` (no confirmable answer for a detectable harness). Undetectable-session
 * harnesses (`sessionDetection: 'undetectable'`) and unsettled probes (`checking`) let the run through so the CLI
 * itself can succeed or report an auth refusal. Sign-in itself is a terminal flow, never a model turn, so it is
 * not guarded. Only real harnesses are checked. QAIQ is gated by its provider key (assertQaiqConfigured) and the
 * shell runs locally. A turn without a resolved model counts as Pro (fail-closed).
 * @throws {@link QaapAgentSignInRequiredError} when the model is not selectable for this owner.
 */
export function assertAgentModelAccessExtracted(
    ctx: QaapAgentTaskRunnerContext,
    agentId: string,
    ownerLogin?: string,
    agentModel?: QaapCreateAgentTaskQaiqModel,
): void {
    const normalized = agentId.trim().toLowerCase();
    const candidate = ctx.detectedAgents.get(normalized);
    if (!candidate || normalized === QAIQ_AGENT_ID || normalized === SHELL_AGENT_ID) {
        return;
    }
    const snapshot = ctx.agentConnectionSnapshot(normalized, ownerLogin);
    const accessState = resolveAgentAccess({
        agentId: normalized,
        connectionState: snapshot.connectionState,
        probeSettled: snapshot.probeSettled,
    });
    const session = QaapHarnessModelAvailability.session({
        connectionState: snapshot.connectionState,
        accessState,
        probeSettled: snapshot.probeSettled,
        sessionDetection: resolveQaapHarnessSessionDetection(normalized),
    });
    const tier = QaapHarnessModelAvailability.tier(normalized, {
        modelId: agentModel?.modelId ?? '',
        vendor: agentModel?.vendor,
    });
    const availability = QaapHarnessModelAvailability.availability({
        harnessEnabled: ctx.isAgentEnabled(normalized, ownerLogin),
        session,
        tier,
    });
    if (availability.selectable || availability.reason === undefined) {
        return;
    }
    const harnessLabel = candidate.label || normalized;
    const modelLabel = agentModel?.modelId?.trim() || harnessLabel;
    throw new QaapAgentSignInRequiredError(
        signInRefusalMessage(availability.reason, harnessLabel, modelLabel),
        availability.reason,
    );
}

/** Operator-facing refusal copy; the transcript shows it as the failed turn's reason. */
function signInRefusalMessage(reason: QaapModelUnavailableReason, harnessLabel: string, modelLabel: string): string {
    switch (reason) {
        case 'harness-disabled':
            return nls.localize('qaap/agentTasks/harnessDisabled', '{0} is turned off in Settings → Harness.', harnessLabel);
        case 'checking-sign-in':
            return nls.localize('qaap/agentTasks/signInChecking', "Couldn't confirm your sign-in to {0}; try again.", harnessLabel);
        default:
            return nls.localize('qaap/agentTasks/signInRequired', 'Sign in to {0} to use {1}.', harnessLabel, modelLabel);
    }
}
