// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { QaapPlanLimit } from '@theia/qaap-adapters/lib/common/qaap-plan-limit';
import type { QaapAgentTask, QaapCreateAgentTaskRequest } from '../common/qaap-agent-task';
import {
    canStartNewAgentJob,
    hostedModelDenialPlanLimit,
    hostedModelDenialReason,
    isHostedCodexUsage,
    type QaapBillingAccount,
} from '../common/qaap-billing-plans';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';

const BILLING_READ_ATTEMPTS = 3;
const BILLING_READ_RETRY_DELAY_MS = 250;

export type QaapAgentTaskBillingGateContext = Pick<QaapAgentTaskRunnerContext, 'billingStore' | 'resolveAgentModelForRequest'>
    & Partial<Pick<QaapAgentTaskRunnerContext, 'resolveAgentId' | 'isAgentConnectedFresh'>>;

export interface QaapAgentTaskBillingGateOptions {
    /** Base delay between billing-store read attempts (tests pass 0). */
    readonly retryDelayMs?: number;
}

/** Filled in as the gate learns about the turn, so a later crash can still be classified. */
interface QaapAgentTurnBillingProbe {
    /** Set once the turn is known to be (or not be) a hosted Codex turn; `undefined` while still unknown. */
    hostedCodex?: boolean;
}

/** Retries a transient billing-store read before the caller decides how to degrade. */
async function retryBillingRead<T>(read: () => Promise<T>, retryDelayMs: number): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= BILLING_READ_ATTEMPTS; attempt++) {
        try {
            return await read();
        } catch (error) {
            lastError = error;
            if (attempt < BILLING_READ_ATTEMPTS && retryDelayMs > 0) {
                await new Promise<void>(resolve => setTimeout(resolve, retryDelayMs * attempt));
            }
        }
    }
    throw lastError;
}

/**
 * Pre-spawn entitlement gate for one agent turn. Resolves to the log line that rejects the turn, or
 * `undefined` when the turn may run.
 *
 * Only the billing-store read degrades: when it fails, BYOK / keyless turns fail open (a billing
 * outage must not break work the user pays for with their own key), while hosted Codex turns billed
 * to Qaap's credentials fail closed — they fall back to the warm entitlements cache and are rejected
 * when there is none. Every other error (model / agent resolution, connection probe) propagates.
 */
export async function checkAgentTaskBillingGate(
    ctx: QaapAgentTaskBillingGateContext,
    task: QaapAgentTask,
    request: QaapCreateAgentTaskRequest,
    options: QaapAgentTaskBillingGateOptions = {},
): Promise<string | undefined> {
    return checkAgentTaskBillingGateWithProbe(ctx, task, request, options, {});
}

async function checkAgentTaskBillingGateWithProbe(
    ctx: QaapAgentTaskBillingGateContext,
    task: QaapAgentTask,
    request: QaapCreateAgentTaskRequest,
    options: QaapAgentTaskBillingGateOptions,
    probe: QaapAgentTurnBillingProbe,
): Promise<string | undefined> {
    const billingStore = ctx.billingStore;
    const ownerLogin = task.ownerLogin;
    if (!ownerLogin || !billingStore) {
        return undefined;
    }
    let account: QaapBillingAccount | undefined;
    let billingError: unknown;
    try {
        account = await retryBillingRead(
            () => billingStore.getOrCreateAccount(ownerLogin),
            options.retryDelayMs ?? BILLING_READ_RETRY_DELAY_MS,
        );
    } catch (error) {
        billingError = error;
    }
    if (account && !canStartNewAgentJob(account)) {
        return QaapPlanLimit.tagged('runtime_exhausted', 'Agent runtime allowance is used up for this billing period. The current turn was not started. Top up hours or wait for the next cycle.');
    }
    const agentModel = ctx.resolveAgentModelForRequest(request, (request.prompt ?? '').trim(), ownerLogin);
    const modelId = agentModel?.modelId ?? task.agentModel?.modelId ?? task.qaiqModel?.modelId;
    const agentId = ctx.resolveAgentId?.(request.prompt ?? '', request.agent, ownerLogin) ?? request.agent ?? task.agentId;
    const hostedCodex = isHostedCodexUsage(agentId, modelId) && await ctx.isAgentConnectedFresh?.(agentId ?? '', ownerLogin) !== true;
    probe.hostedCodex = hostedCodex;
    if (account) {
        const hostedDenial = hostedCodex ? hostedModelDenialReason(account, modelId) : undefined;
        if (!hostedDenial) {
            return undefined;
        }
        const denialReason = hostedModelDenialPlanLimit(account, modelId);
        return denialReason ? QaapPlanLimit.tagged(denialReason, hostedDenial) : hostedDenial;
    }
    const message = billingError instanceof Error ? billingError.message : String(billingError);
    const cached = billingStore.peekEntitlements?.(ownerLogin);
    // The account is unreadable but a warm cache may still say the runtime allowance is gone.
    if (cached?.canStartAgent === false) {
        console.error(`[qaap-billing] Entitlement read failed for ${ownerLogin}; cached entitlements deny starting a turn. ${message}`);
        return QaapPlanLimit.tagged('runtime_exhausted', 'Agent runtime allowance is used up for this billing period. The current turn was not started. Top up hours or wait for the next cycle.');
    }
    if (!hostedCodex) {
        console.error(`[qaap-billing] Entitlement read failed for ${ownerLogin}; BYOK turn runs (fail-open). ${message}`);
        return undefined;
    }
    if (cached?.hostedModels === true && cached.creditsRemaining > 0) {
        console.error(`[qaap-billing] Entitlement read failed for ${ownerLogin}; hosted Codex turn allowed from cached entitlements. ${message}`);
        return undefined;
    }
    console.error(`[qaap-billing] Entitlement read failed for ${ownerLogin}; hosted Codex turn rejected (fail-closed, ${cached ? 'cache denies' : 'no cache'}). ${message}`);
    return nls.localize(
        'qaap/billing/hostedCodexUnavailable',
        'Billing is temporarily unavailable, so hosted Codex models cannot be started right now. Try again in a moment or use another harness.',
    );
}

/**
 * {@link checkAgentTaskBillingGate} for callers that cannot let an exception escape (the spawn path is
 * fire-and-forget): an unexpected error becomes a rejection line so the task is finished as failed
 * instead of sitting in `running` until the watchdog.
 */
export async function resolveAgentTaskBillingRejection(
    ctx: QaapAgentTaskBillingGateContext,
    task: QaapAgentTask,
    request: QaapCreateAgentTaskRequest,
    options?: QaapAgentTaskBillingGateOptions,
): Promise<string | undefined> {
    const probe: QaapAgentTurnBillingProbe = {};
    try {
        return await checkAgentTaskBillingGateWithProbe(ctx, task, request, options ?? {}, probe);
    } catch (error) {
        // Same policy as the read branch: a BYOK turn is known not to be hosted Codex, so an unexpected
        // error must not block work the user pays for with their own key. Unknown or hosted turns still fail closed.
        if (probe.hostedCodex === false) {
            console.error(`[qaap-billing] Entitlement gate crashed for task ${task.id}; letting the turn run (BYOK, fail-open).`, error);
            return undefined;
        }
        console.error(`[qaap-billing] Entitlement gate crashed for task ${task.id}; failing the turn.`, error);
        return nls.localize('qaap/billing/gateFailed', 'This turn could not be started because the entitlement check failed unexpectedly. Please try again.');
    }
}
