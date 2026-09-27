// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { listStaticNativeAgentModels } from './qaap-agent-native-model-catalog';
import {
    QAAP_CODEX_HOSTED_MODEL_IDS,
    QAAP_RUNTIME_EUR_PER_HOUR,
    QAAP_RUNTIME_PACKS,
    applyMonthlyReset,
    canStartNewAgentJob,
    creditsForTokenUsage,
    creditsRemaining,
    entitlementsFor,
    filterModelsForHostedPlan,
    hostedModelDenialReason,
    hoursToMinutes,
    isHostedCodexUsage,
    isQaapCodexHostedModel,
    parseQaapBillingPlanId,
    runtimeMinutesForDurationMs,
    runtimeUsageRatio,
    shouldWarnRuntime,
    spendCredits,
    spendCreditsUpTo,
    spendRuntimeMinutes,
    wouldExceedActiveRepoLimit,
    type QaapBillingAccount,
} from './qaap-billing-plans';

function account(overrides: Partial<QaapBillingAccount> = {}): QaapBillingAccount {
    return {
        login: 'alice',
        planId: 'pro',
        includedRuntimeMinutesRemaining: hoursToMinutes(160),
        purchasedRuntimeMinutes: 0,
        includedCreditsRemaining: 2500,
        purchasedCredits: 0,
        periodStart: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
        ...overrides,
    };
}

describe('qaap-billing-plans', () => {
    it('hosted model ids match the Codex native catalog', () => {
        const catalog = listStaticNativeAgentModels('codex').map(model => model.modelId);
        expect([...QAAP_CODEX_HOSTED_MODEL_IDS]).to.have.members(catalog);
        expect(catalog).to.have.members([...QAAP_CODEX_HOSTED_MODEL_IDS]);
    });

    it('does not host non-Codex harness models', () => {
        expect(isQaapCodexHostedModel('claude-fable-5')).to.equal(false);
        expect(isQaapCodexHostedModel('gpt-4o-mini')).to.equal(false);
        expect(isQaapCodexHostedModel('moonshotai/kimi-k3')).to.equal(false);
        expect(isQaapCodexHostedModel('gpt-5.6-sol')).to.equal(true);
    });

    it('parses plan ids with starter fallback', () => {
        expect(parseQaapBillingPlanId('PRO')).to.equal('pro');
        expect(parseQaapBillingPlanId('nope')).to.equal('starter');
        expect(parseQaapBillingPlanId(undefined)).to.equal('starter');
    });

    it('Starter is fair-use BYOK; Pro/Team meter 160h/500h plus Codex credits', () => {
        const starter = entitlementsFor(account({
            planId: 'starter',
            includedCreditsRemaining: 0,
            includedRuntimeMinutesRemaining: 0,
        }));
        expect(starter.hostedModels).to.equal(false);
        expect(starter.runtimeFairUse).to.equal(true);
        expect(starter.canStartAgent).to.equal(true);
        expect(starter.runtimeHoursRemaining).to.equal(-1);
        expect(starter.runtimeWarning).to.equal(false);
        const pro = entitlementsFor(account());
        expect(pro.hostedModels).to.equal(true);
        expect(pro.includedRuntimeHoursPerMonth).to.equal(160);
        expect(pro.includedCreditsPerMonth).to.equal(2500);
        expect(entitlementsFor(account({ planId: 'team' })).includedCreditsPerMonth).to.equal(10000);
        expect(entitlementsFor(account({ planId: 'team' })).includedRuntimeHoursPerMonth).to.equal(500);
    });

    it('warns at 80% included runtime and blocks new jobs at 0 (not fair-use)', () => {
        const included = hoursToMinutes(160);
        const atWarning = account({ includedRuntimeMinutesRemaining: Math.floor(included * 0.2) });
        expect(shouldWarnRuntime(atWarning)).to.equal(true);
        expect(canStartNewAgentJob(atWarning)).to.equal(true);
        expect(runtimeUsageRatio(atWarning)).to.be.at.least(0.8);
        const empty = account({ includedRuntimeMinutesRemaining: 0, purchasedRuntimeMinutes: 0 });
        expect(canStartNewAgentJob(empty)).to.equal(false);
        expect(canStartNewAgentJob(account({ planId: 'starter', includedRuntimeMinutesRemaining: 0 }))).to.equal(true);
    });

    it('top-up packs stay at €0.25 / agent-hour', () => {
        expect(QAAP_RUNTIME_EUR_PER_HOUR).to.equal(0.25);
        expect(QAAP_RUNTIME_PACKS.map(pack => pack.qcu)).to.deep.equal([80, 200, 400]);
        expect(QAAP_RUNTIME_PACKS[0].monthlyPriceEur / QAAP_RUNTIME_PACKS[0].qcu).to.equal(0.25);
    });

    it('prices a typical Sol turn (~100k in + 8k out) around 95 credits', () => {
        expect(creditsForTokenUsage('gpt-5.6-sol', 100_000, 8_000)).to.equal(97);
        expect(creditsForTokenUsage('gpt-5.6-terra', 100_000, 8_000)).to.equal(39);
        expect(creditsForTokenUsage('gpt-5.6-luna', 100_000, 8_000)).to.equal(4);
        expect(creditsForTokenUsage('unknown', 100_000, 8_000)).to.equal(undefined);
        expect(creditsForTokenUsage('gpt-5.6-sol', 0, 0)).to.equal(0);
    });

    it('rounds agent wall-clock up to whole minutes', () => {
        expect(runtimeMinutesForDurationMs(0)).to.equal(0);
        expect(runtimeMinutesForDurationMs(1)).to.equal(1);
        expect(runtimeMinutesForDurationMs(60_000)).to.equal(1);
        expect(runtimeMinutesForDurationMs(60_001)).to.equal(2);
    });

    it('spends included credits before purchased', () => {
        const next = spendCredits(account({ includedCreditsRemaining: 10, purchasedCredits: 5 }), 12);
        expect(next?.includedCreditsRemaining).to.equal(0);
        expect(next?.purchasedCredits).to.equal(3);
        expect(spendCredits(account({ includedCreditsRemaining: 1, purchasedCredits: 1 }), 5)).to.equal(undefined);
        expect(creditsRemaining(account({ includedCreditsRemaining: 10, purchasedCredits: 5 }))).to.equal(15);
    });

    it('partial-debits runtime so an in-flight turn can finish', () => {
        const next = spendRuntimeMinutes(account({
            includedRuntimeMinutesRemaining: 10,
            purchasedRuntimeMinutes: 5,
        }), 12);
        expect(next.includedRuntimeMinutesRemaining).to.equal(0);
        expect(next.purchasedRuntimeMinutes).to.equal(3);
        const drained = spendRuntimeMinutes(account({
            includedRuntimeMinutesRemaining: 1,
            purchasedRuntimeMinutes: 1,
        }), 5);
        expect(drained.includedRuntimeMinutesRemaining).to.equal(0);
        expect(drained.purchasedRuntimeMinutes).to.equal(0);
        const fairUse = spendRuntimeMinutes(account({
            planId: 'starter',
            includedRuntimeMinutesRemaining: 0,
        }), 30);
        expect(fairUse.includedRuntimeMinutesRemaining).to.equal(0);
    });

    it('resets included meters on a new UTC month and keeps purchased', () => {
        const next = applyMonthlyReset(
            account({
                includedCreditsRemaining: 3,
                purchasedCredits: 40,
                includedRuntimeMinutesRemaining: 5,
                purchasedRuntimeMinutes: 120,
                periodStart: '2026-07-01T00:00:00.000Z',
            }),
            new Date('2026-08-20T09:00:00.000Z'),
        );
        expect(next.includedCreditsRemaining).to.equal(2500);
        expect(next.purchasedCredits).to.equal(40);
        expect(next.includedRuntimeMinutesRemaining).to.equal(hoursToMinutes(160));
        expect(next.purchasedRuntimeMinutes).to.equal(120);
        expect(next.periodStart).to.equal('2026-08-01T00:00:00.000Z');
    });

    it('denies Codex hosted models on Starter and when credits are empty', () => {
        expect(hostedModelDenialReason(account({ planId: 'starter' }), 'gpt-5.6-sol'))
            .to.match(/Pro or Team/);
        expect(hostedModelDenialReason(account({ includedCreditsRemaining: 0, purchasedCredits: 0 }), 'gpt-5.6-sol'))
            .to.match(/exhausted/);
        expect(hostedModelDenialReason(account(), 'gpt-5.6-sol')).to.equal(undefined);
        expect(hostedModelDenialReason(account({ planId: 'starter' }), 'gpt-4o-mini')).to.equal(undefined);
        expect(isHostedCodexUsage('codex', 'gpt-5.6-sol')).to.equal(true);
        expect(isHostedCodexUsage('qaiq', 'gpt-5.6-sol')).to.equal(false);
        expect(isHostedCodexUsage('copilot', 'gpt-5.6-sol')).to.equal(false);
    });

    it('filters hosted Codex models out of Starter pickers', () => {
        const models = [
            { modelId: 'gpt-5.6-sol' },
            { modelId: 'gpt-4o-mini' },
        ];
        expect(filterModelsForHostedPlan('codex', models, false).map(m => m.modelId))
            .to.deep.equal(['gpt-4o-mini']);
        expect(filterModelsForHostedPlan('codex', models, true)).to.have.length(2);
        expect(filterModelsForHostedPlan('claude', models, false)).to.have.length(2);
    });

    it('enforces active-repo caps for Starter/Pro', () => {
        expect(wouldExceedActiveRepoLimit(3, 3, false)).to.equal(true);
        expect(wouldExceedActiveRepoLimit(3, 2, false)).to.equal(false);
        expect(wouldExceedActiveRepoLimit(3, 3, true)).to.equal(false);
        expect(wouldExceedActiveRepoLimit(-1, 99, false)).to.equal(false);
    });

    it('partial-debits hosted credits so an in-flight Codex turn can finish', () => {
        const spent = spendCreditsUpTo(account({ includedCreditsRemaining: 10, purchasedCredits: 5 }), 12);
        expect(spent.charged).to.equal(12);
        expect(spent.account.includedCreditsRemaining).to.equal(0);
        expect(spent.account.purchasedCredits).to.equal(3);
        const drained = spendCreditsUpTo(account({ includedCreditsRemaining: 1, purchasedCredits: 1 }), 50);
        expect(drained.charged).to.equal(2);
        expect(drained.account.includedCreditsRemaining).to.equal(0);
        expect(drained.account.purchasedCredits).to.equal(0);
    });
});
