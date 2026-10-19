// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';

/**
 * Structured "you hit a plan boundary" signal shared by the backend (clone limit, hosted-model
 * denial, exhausted credits / runtime) and the frontends (clone dialog, transcript failure card).
 *
 * HTTP/job responses carry `code: 'plan_limit'` plus a {@link QaapPlanLimitReason}. Agent turns only
 * persist free text (the CLI log), so the same signal rides in it as a machine-readable tag
 * (`[qaap:plan_limit:<reason>]`) that the failure card strips and turns into a localized message + CTA.
 */
export const QAAP_PLAN_LIMIT_CODE = 'plan_limit';

/** Legacy job error code for the repo cap; still emitted so older clients keep working. */
export const QAAP_PLAN_REPO_LIMIT_CODE = 'plan_repo_limit';

export type QaapPlanLimitReason = 'repo_limit' | 'hosted_model_denied' | 'credits_exhausted' | 'runtime_exhausted';

export type QaapPlanLimitCta = 'upgrade' | 'top_up';

const PLAN_LIMIT_REASONS: readonly QaapPlanLimitReason[] = ['repo_limit', 'hosted_model_denied', 'credits_exhausted', 'runtime_exhausted'];

const PLAN_LIMIT_TAG = /\[qaap:plan_limit:([a-z_]+)\]\s*/;

export class QaapPlanLimit {

    /** True for the job/HTTP error codes that mean "plan boundary" (new and legacy). */
    static isPlanLimitCode(code: string | undefined): boolean {
        return code === QAAP_PLAN_LIMIT_CODE || code === QAAP_PLAN_REPO_LIMIT_CODE;
    }

    /** Tag prepended to an agent log / failure reason so the frontend can recognise the cause. */
    static tag(reason: QaapPlanLimitReason): string {
        return `[qaap:${QAAP_PLAN_LIMIT_CODE}:${reason}]`;
    }

    /** Reason carried by a tagged text, if any (unknown reasons are ignored). */
    static parse(text: string | undefined): QaapPlanLimitReason | undefined {
        const match = text ? PLAN_LIMIT_TAG.exec(text) : null;
        const reason = match?.[1] as QaapPlanLimitReason | undefined;
        return reason && PLAN_LIMIT_REASONS.includes(reason) ? reason : undefined;
    }

    static strip(text: string): string {
        return text.replace(new RegExp(PLAN_LIMIT_TAG.source, 'g'), '').trim();
    }

    static cta(reason: QaapPlanLimitReason): QaapPlanLimitCta {
        return reason === 'credits_exhausted' || reason === 'runtime_exhausted' ? 'top_up' : 'upgrade';
    }

    static ctaLabel(reason: QaapPlanLimitReason): string {
        return QaapPlanLimit.cta(reason) === 'top_up'
            ? nls.localize('qaap/planLimit/ctaTopUp', 'Top up')
            : nls.localize('qaap/planLimit/ctaUpgrade', 'Upgrade plan');
    }

    /** Localized, plan-name-free sentence the UI shows for each boundary. */
    static describe(reason: QaapPlanLimitReason): string {
        switch (reason) {
            case 'repo_limit':
                return nls.localize('qaap/planLimit/repoLimit', 'You have reached the number of active repositories your plan allows. Upgrade your plan or remove a clone to open another.');
            case 'hosted_model_denied':
                return nls.localize('qaap/planLimit/hostedModelDenied', 'Hosted Codex models are not included in your plan. Pick a BYOK model or upgrade your plan.');
            case 'credits_exhausted':
                return nls.localize('qaap/planLimit/creditsExhausted', 'Your hosted Codex credits are used up for this billing period. Top up credits or wait for the next cycle.');
            case 'runtime_exhausted':
                return nls.localize('qaap/planLimit/runtimeExhausted', 'Your agent runtime allowance is used up for this billing period. Top up hours or wait for the next cycle.');
        }
    }

    /** Tagged English text as written by the backend into an agent log. */
    static tagged(reason: QaapPlanLimitReason, text: string): string {
        return `${QaapPlanLimit.tag(reason)} ${text}`;
    }
}
