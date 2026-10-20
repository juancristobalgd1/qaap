// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentTask, QaapCreateAgentTaskRequest } from '../common/qaap-agent-task';
import type { QaapBillingAccount, QaapBillingEntitlements } from '../common/qaap-billing-plans';
import type { QaapBillingStore } from './qaap-billing-store';
import { checkAgentTaskBillingGate, resolveAgentTaskBillingRejection, type QaapAgentTaskBillingGateContext } from './qaap-agent-task-billing-gate';

const HOSTED_MODEL = 'gpt-5.6-sol';
const BYOK_MODEL = 'gpt-4o-mini';

function account(planId: QaapBillingAccount['planId'], credits: number): QaapBillingAccount {
    return {
        login: 'alice',
        planId,
        includedRuntimeMinutesRemaining: 600,
        purchasedRuntimeMinutes: 0,
        includedCreditsRemaining: credits,
        purchasedCredits: 0,
        periodStart: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
    };
}

interface GateFixture {
    readonly read?: () => Promise<QaapBillingAccount>;
    readonly cached?: Partial<QaapBillingEntitlements>;
    readonly agentId: string;
    readonly modelId: string;
    readonly resolveModel?: () => never;
}

function context(fixture: GateFixture): QaapAgentTaskBillingGateContext {
    const store = {
        getOrCreateAccount: fixture.read ?? (() => Promise.reject(new Error('SQLITE_BUSY: database is locked'))),
        peekEntitlements: () => fixture.cached as QaapBillingEntitlements | undefined,
    } as unknown as QaapBillingStore;
    return {
        billingStore: store,
        resolveAgentModelForRequest: fixture.resolveModel ?? (() => ({ modelId: fixture.modelId }) as ReturnType<QaapAgentTaskBillingGateContext['resolveAgentModelForRequest']>),
        resolveAgentId: () => fixture.agentId,
        isAgentConnectedFresh: () => Promise.resolve(false),
    };
}

const task = { id: 't1', ownerLogin: 'alice', agentId: 'codex' } as QaapAgentTask;
const request = { prompt: 'hello', agent: 'codex' } as QaapCreateAgentTaskRequest;

async function gate(fixture: GateFixture): Promise<string | undefined> {
    return checkAgentTaskBillingGate(context(fixture), task, request, { retryDelayMs: 0 });
}

describe('checkAgentTaskBillingGate', () => {
    let savedError: typeof console.error;
    beforeEach(() => {
        savedError = console.error;
        console.error = () => undefined;
    });
    afterEach(() => {
        console.error = savedError;
    });

    it('fails open for a BYOK turn when the billing store is down', async () => {
        expect(await gate({ agentId: 'claude', modelId: BYOK_MODEL })).to.equal(undefined);
    });

    it('fails closed for hosted Codex when the billing store is down and nothing is cached', async () => {
        const rejection = await gate({ agentId: 'codex', modelId: HOSTED_MODEL });
        expect(rejection).to.be.a('string').and.to.contain('Billing is temporarily unavailable');
    });

    it('runs hosted Codex from cached entitlements that allow it', async () => {
        expect(await gate({ agentId: 'codex', modelId: HOSTED_MODEL, cached: { hostedModels: true, creditsRemaining: 10 } })).to.equal(undefined);
    });

    it('rejects hosted Codex when the cached entitlements deny it', async () => {
        const rejection = await gate({ agentId: 'codex', modelId: HOSTED_MODEL, cached: { hostedModels: false, creditsRemaining: 0 } });
        expect(rejection).to.contain('Billing is temporarily unavailable');
    });

    it('does not swallow a model-resolution error behind the billing fallback', async () => {
        let caught: unknown;
        try {
            await gate({ agentId: 'codex', modelId: HOSTED_MODEL, resolveModel: () => { throw new Error('model resolution exploded'); } });
        } catch (error) {
            caught = error;
        }
        expect((caught as Error | undefined)?.message).to.equal('model resolution exploded');
    });

    it('still applies the plan boundary when the billing read succeeds', async () => {
        const starter = await gate({ agentId: 'codex', modelId: HOSTED_MODEL, read: () => Promise.resolve(account('starter', 0)) });
        expect(starter).to.contain('hosted_model_denied');
        expect(await gate({ agentId: 'codex', modelId: HOSTED_MODEL, read: () => Promise.resolve(account('pro', 50)) })).to.equal(undefined);
    });

    it('recovers when a transient billing read succeeds on retry', async () => {
        let attempts = 0;
        const read = (): Promise<QaapBillingAccount> => ++attempts < 2 ? Promise.reject(new Error('busy')) : Promise.resolve(account('pro', 50));
        expect(await gate({ agentId: 'codex', modelId: HOSTED_MODEL, read })).to.equal(undefined);
        expect(attempts).to.equal(2);
    });

    it('applies a cached "cannot start" verdict when the account is unreadable', async () => {
        const rejection = await gate({ agentId: 'claude', modelId: BYOK_MODEL, cached: { canStartAgent: false } });
        expect(rejection).to.contain('runtime_exhausted');
    });

    it('lets a BYOK turn run when the cache says it can start', async () => {
        expect(await gate({ agentId: 'claude', modelId: BYOK_MODEL, cached: { canStartAgent: true } })).to.equal(undefined);
    });

    it('turns an unexpected gate error into a rejection line instead of throwing', async () => {
        const fixture: GateFixture = { agentId: 'codex', modelId: HOSTED_MODEL, resolveModel: () => { throw new Error('boom'); } };
        const rejection = await resolveAgentTaskBillingRejection(context(fixture), task, request, { retryDelayMs: 0 });
        expect(rejection).to.be.a('string').and.to.contain('entitlement check failed unexpectedly');
    });
});
