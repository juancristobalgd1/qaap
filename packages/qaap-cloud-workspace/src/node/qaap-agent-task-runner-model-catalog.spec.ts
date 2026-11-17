// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// ****************************************************************************

import { expect } from 'chai';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';
import { NATIVE_MODEL_PICKER_AGENT_IDS } from '@theia/qaap-shared-core/lib/common/qaap-builtin-agents';
import { bindingFromQaiqModelSelection } from '../common/qaap-qaiq-model-binding';
import { formatModelFlagsForAgent } from '../common/qaap-agent-model-flags';
import { applyTemplate } from './qaap-agent-task-runner-utils';
import { clearNativeAgentModelCache, listNativeAgentModels, prepareNativeAgentModels } from './qaap-agent-native-models';
import {
    buildTemplateVarsExtracted,
    resolveAgentBindingForTaskExtracted,
} from './qaap-agent-task-runner-streaming2';
import { listModelsForAgentExtracted } from './qaap-agent-task-runner-render2';
import { sharedQaapAgentModelUnavailableRegistry } from './qaap-agent-model-unavailable-registry';

describe('QAIQ/OpenClaude model routing', () => {
    it('does not inject QAIQ Settings flags into an unpinned OpenClaude task', () => {
        const ctx = {
            resolveQaiqProviderFlags: () => '--provider openai --model qaiq/custom-model',
            normalizeAgentBinding: (binding: unknown) => binding,
        };

        expect(buildTemplateVarsExtracted(ctx as unknown as QaapAgentTaskRunnerContext, 'openclaude')).to.deep.equal({
            qaiq_flags: '',
            model_flags: '',
            trust_flags: '',
        });
        expect(buildTemplateVarsExtracted(ctx as unknown as QaapAgentTaskRunnerContext, 'qaiq')).to.deep.equal({
            qaiq_flags: '--dangerously-skip-permissions --provider openai --model qaiq/custom-model',
            model_flags: '',
            trust_flags: '',
        });
    });

    it('does not resolve a QAIQ Settings binding for an unpinned OpenClaude task', () => {
        const qaiqBinding = { provider: 'openai', vendor: 'openrouter', modelId: 'qaiq/custom-model' };
        const ctx = {
            resolveQaapQaiqBinding: () => qaiqBinding,
            normalizeAgentBinding: (binding: unknown) => binding,
        };

        expect(resolveAgentBindingForTaskExtracted(ctx as unknown as QaapAgentTaskRunnerContext, {
            agentId: 'openclaude',
            command: 'openclaude --print prompt',
        } as any)).to.equal(undefined);
        expect(resolveAgentBindingForTaskExtracted(ctx as unknown as QaapAgentTaskRunnerContext, {
            agentId: 'qaiq',
            command: 'qaiq --print prompt',
        } as any)).to.deep.equal(qaiqBinding);
    });

    it('places Hermes --model before chat so a picker slug overrides config.yaml', () => {
        const ctx = {
            normalizeAgentBinding: (binding: unknown) => binding,
        };
        const agentModel = {
            provider: 'openai' as const,
            vendor: 'unknown',
            modelId: 'xiaomi/mimo-v2.5-pro',
        };
        const vars = buildTemplateVarsExtracted(ctx as unknown as QaapAgentTaskRunnerContext, 'hermes', agentModel);
        expect(vars.model_flags).to.equal('--model xiaomi/mimo-v2.5-pro');
        const flags = formatModelFlagsForAgent('hermes', bindingFromQaiqModelSelection(agentModel));
        const command = applyTemplate(
            'hermes --yolo --ignore-user-config --provider openrouter {model_flags} chat -Q -q {prompt}',
            'hola',
            { model_flags: flags },
        );
        expect(command).to.equal(
            "hermes --yolo --ignore-user-config --provider openrouter --model xiaomi/mimo-v2.5-pro chat -Q -q 'hola'",
        );
    });

    it('keeps the Codex catalog when the browser and cloud capability sets drift', () => {
        clearNativeAgentModelCache();
        NATIVE_MODEL_PICKER_AGENT_IDS.delete('codex');
        try {
            expect(listNativeAgentModels('codex').map(model => model.modelId)).to.deep.equal([
                'gpt-6-luna',
                'gpt-5.6-terra',
                'gpt-5.6-luna',
            ]);
        } finally {
            NATIVE_MODEL_PICKER_AGENT_IDS.add('codex');
            clearNativeAgentModelCache();
        }
    });

    it('keeps Codex models visible as locked when no user session is connected', () => {
        const ctx = {
            normalizeAgentId: () => undefined,
            isAgentConnected: () => false,
            isAgentEnabled: () => true,
            agentConnectionSnapshot: () => ({ connectionState: 'disconnected', probeSettled: true }),
        };
        const models = listModelsForAgentExtracted(ctx as unknown as QaapAgentTaskRunnerContext, 'codex', 'starter-user');
        expect(models).to.have.length(3);
        expect(models.every(model => model.available === false)).to.equal(true);
    });

    it('does not lock Codex models when the user has their own Codex session', () => {
        const ctx = {
            normalizeAgentId: () => undefined,
            isAgentConnected: () => true,
            isAgentEnabled: () => true,
            agentConnectionSnapshot: () => ({ connectionState: 'connected', probeSettled: true }),
        };
        const models = listModelsForAgentExtracted(ctx as unknown as QaapAgentTaskRunnerContext, 'codex', 'starter-user');
        expect(models).to.have.length(3);
        expect(models.every(model => model.available === true)).to.equal(true);
    });

    describe('OpenCode paid-model access', () => {
        const opencodeCtx = (
            connectionState: 'connected' | 'disconnected' | 'unknown',
            probeSettled: boolean,
        ): QaapAgentTaskRunnerContext => ({
            normalizeAgentId: () => undefined,
            isAgentEnabled: () => true,
            agentConnectionSnapshot: () => ({ connectionState, probeSettled }),
            billingStore: { peekEntitlements: () => undefined },
        } as unknown as QaapAgentTaskRunnerContext);

        it('keeps free OpenCode models usable and locks paid ones without a sign-in', () => {
            const models = listModelsForAgentExtracted(opencodeCtx('disconnected', true), 'opencode', 'starter-user');
            const free = models.filter(model => model.modelId.endsWith('-free') || model.modelId === 'opencode/big-pickle');
            const paid = models.filter(model => !free.includes(model));
            expect(free).to.have.length(10);
            expect(paid).to.have.length(73);
            expect(free.every(model => model.available === true && model.tier === 'free' && model.unavailableReason === undefined)).to.equal(true);
            expect(paid.every(model => model.available === false && model.unavailableReason === 'not-connected')).to.equal(true);
        });

        it('unlocks paid OpenCode models for a connected owner', () => {
            const models = listModelsForAgentExtracted(opencodeCtx('connected', true), 'opencode', 'pro-user');
            const paid = models.filter(model => !model.modelId.endsWith('-free') && model.modelId !== 'opencode/big-pickle');
            expect(paid).to.have.length(73);
            expect(paid.every(model => model.available === true && model.unavailableReason === undefined)).to.equal(true);
        });

        // Was: paid models held as checking-sign-in (not selectable) while the probe ran. A pending probe no longer
        // locks (fail-open); only a positive sign-out does (first test above).
        it('keeps paid OpenCode models selectable while the auth probe is still pending or inconclusive', () => {
            for (const settled of [false, true]) {
                const models = listModelsForAgentExtracted(opencodeCtx('unknown', settled), 'opencode', 'pro-user');
                expect(models.some(model => model.modelId === 'opencode/claude-opus-4-7')).to.equal(true);
                const paid = models.filter(model => model.tier === 'pro');
                expect(paid.length).to.be.greaterThan(0);
                expect(paid.every(model => model.available === true && model.unavailableReason === undefined), `settled=${settled}`).to.equal(true);
                expect(models.filter(model => model.tier === 'free').every(model => model.available === true)).to.equal(true);
            }
        });
    });

    describe('Codex access (shared with the picker row)', () => {
        const codexCtx = (
            connectionState: 'connected' | 'disconnected' | 'unknown',
            probeSettled: boolean,
        ): QaapAgentTaskRunnerContext => ({
            normalizeAgentId: () => undefined,
            isAgentEnabled: () => true,
            agentConnectionSnapshot: () => ({ connectionState, probeSettled }),
        } as unknown as QaapAgentTaskRunnerContext);

        it('unlocks Codex models for an owner with their own sign-in', () => {
            const models = listModelsForAgentExtracted(codexCtx('connected', true), 'codex', 'pro-user');
            expect(models.every(model => model.available === true)).to.equal(true);
        });

        it('locks Codex models as not-connected (never as plan) for an owner without a sign-in, on any plan', () => {
            const models = listModelsForAgentExtracted(codexCtx('disconnected', true), 'codex', 'pro-user');
            expect(models).to.have.length(3);
            expect(models.every(model => model.available === false && model.unavailableReason === 'not-connected')).to.equal(true);
        });

        // Was: checking-sign-in while pending and not-connected once settled (both locked). Fail-open now: an
        // unresolved or inconclusive probe keeps the models selectable; never a plan lock either way.
        it('keeps Codex models selectable (never plan) while the auth probe is pending or settled without an answer', () => {
            for (const settled of [false, true]) {
                const models = listModelsForAgentExtracted(codexCtx('unknown', settled), 'codex', 'starter-user');
                expect(models).to.have.length(3);
                expect(models.every(model => model.available === true && model.unavailableReason === undefined), `settled=${settled}`).to.equal(true);
            }
        });
    });

    describe('models the provider rejected recently', () => {
        const owner = 'registry-catalog-owner';
        const connectedCodexCtx = {
            normalizeAgentId: () => undefined,
            isAgentEnabled: () => true,
            agentConnectionSnapshot: () => ({ connectionState: 'connected', probeSettled: true }),
        } as unknown as QaapAgentTaskRunnerContext;

        afterEach(() => {
            // The registry is process-wide; drop this owner's findings so other specs see a clean slate.
            sharedQaapAgentModelUnavailableRegistry.clear();
        });

        it('locks a model recorded as model_unavailable for this owner and agent, and leaves the others open', () => {
            const before = listModelsForAgentExtracted(connectedCodexCtx, 'codex', owner);
            const rejected = before[0].modelId;
            sharedQaapAgentModelUnavailableRegistry.record(owner, 'codex', rejected);
            const after = listModelsForAgentExtracted(connectedCodexCtx, 'codex', owner);
            const marked = after.find(model => model.modelId === rejected);
            expect(marked).to.deep.include({ available: false, unavailableReason: 'unknown' });
            expect(after.filter(model => model.modelId !== rejected).every(model => model.available === true)).to.equal(true);
        });

        it('does not mark the model for another owner', () => {
            const rejected = listModelsForAgentExtracted(connectedCodexCtx, 'codex', owner)[0].modelId;
            sharedQaapAgentModelUnavailableRegistry.record(owner, 'codex', rejected);
            const other = listModelsForAgentExtracted(connectedCodexCtx, 'codex', 'someone-else');
            expect(other.find(model => model.modelId === rejected)?.available).to.not.equal(false);
        });
    });
});

describe('Antigravity model listing follows the resolved CLI', () => {
    const agyLabel = 'Gemini 3.8 Flash (High)';
    const noSpawn = (): undefined => undefined;

    const contextFor = (bin: string | undefined): QaapAgentTaskRunnerContext => ({
        resolveAntigravityBin: () => bin,
        isAgentEnabled: () => true,
        agentConnectionSnapshot: () => ({ connectionState: 'connected', probeSettled: true }),
    }) as unknown as QaapAgentTaskRunnerContext;

    beforeEach(() => {
        clearNativeAgentModelCache();
    });

    afterEach(() => {
        clearNativeAgentModelCache();
    });

    it('lists Gemini CLI model ids when the host resolved gemini', () => {
        const ids = listModelsForAgentExtracted(contextFor('gemini'), 'antigravity').map(model => model.modelId);
        expect(ids).to.include('gemini-3.5-flash');
        expect(ids).to.include('auto');
        expect(ids).to.not.include(agyLabel);
        expect(listModelsForAgentExtracted(contextFor('gemini'), 'antigravity', 'owner').map(model => model.modelId)).to.deep.equal(ids);
    });

    it('lists the agy catalog when the host resolved agy, and keeps it apart from gemini', async () => {
        await prepareNativeAgentModels('antigravity', { antigravityBin: 'agy', spawner: noSpawn });
        expect(listModelsForAgentExtracted(contextFor('agy'), 'antigravity').map(model => model.modelId)).to.include(agyLabel);
        expect(listModelsForAgentExtracted(contextFor('gemini'), 'antigravity').map(model => model.modelId)).to.not.include(agyLabel);
    });

    it('answers the agy catalog when no Antigravity CLI is resolved', async () => {
        await prepareNativeAgentModels('antigravity', { spawner: noSpawn });
        expect(listModelsForAgentExtracted(contextFor(undefined), 'antigravity').map(model => model.modelId)).to.include(agyLabel);
    });
});

describe('one availability rule for every harness (model catalog)', () => {
    const ctxFor = (
        connectionState: 'connected' | 'disconnected' | 'unknown',
        probeSettled: boolean,
        harnessEnabled = true,
    ): QaapAgentTaskRunnerContext => ({
        normalizeAgentId: () => undefined,
        isAgentEnabled: () => harnessEnabled,
        agentConnectionSnapshot: () => ({ connectionState, probeSettled }),
    } as unknown as QaapAgentTaskRunnerContext);

    it('returns no models for a harness the owner turned off, even its Free ones', () => {
        expect(listModelsForAgentExtracted(ctxFor('connected', true, false), 'opencode', 'pro-user')).to.deep.equal([]);
        expect(listModelsForAgentExtracted(ctxFor('disconnected', true, false), 'codex', 'pro-user')).to.deep.equal([]);
    });

    it('locks Pro models with the same rule when there is no owner (local or Electron)', () => {
        const models = listModelsForAgentExtracted(ctxFor('disconnected', true), 'codex', undefined);
        expect(models).to.have.length(3);
        expect(models.every(model => model.tier === 'pro' && model.available === false && model.unavailableReason === 'not-connected')).to.equal(true);
    });

    it('locks Copilot Pro models for a signed-out owner, and keeps every model tiered', () => {
        const models = listModelsForAgentExtracted(ctxFor('disconnected', true), 'copilot', 'pro-user');
        expect(models.every(model => model.tier === 'pro')).to.equal(true);
        expect(models.every(model => model.available === false && model.unavailableReason === 'not-connected')).to.equal(true);
    });

    it('leaves every Copilot model selectable once the owner is signed in', () => {
        const models = listModelsForAgentExtracted(ctxFor('connected', true), 'copilot', 'pro-user');
        expect(models.every(model => model.available === true && model.unavailableReason === undefined)).to.equal(true);
    });
});
