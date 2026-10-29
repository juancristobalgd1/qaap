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
import { clearNativeAgentModelCache, listNativeAgentModels } from './qaap-agent-native-models';
import {
    buildTemplateVarsExtracted,
    resolveAgentBindingForTaskExtracted,
} from './qaap-agent-task-runner-streaming2';
import { listModelsForAgentExtracted } from './qaap-agent-task-runner-render2';

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
                'gpt-5.6-sol',
                'gpt-5.6-terra',
                'gpt-5.6-luna',
                'gpt-5.5',
            ]);
        } finally {
            NATIVE_MODEL_PICKER_AGENT_IDS.add('codex');
            clearNativeAgentModelCache();
        }
    });

    it('keeps hosted models visible as locked on Starter when no user session is connected', () => {
        const ctx = {
            normalizeAgentId: () => undefined,
            isAgentConnected: () => false,
            agentConnectionSnapshot: () => ({ connectionState: 'disconnected', probeSettled: true }),
            billingStore: {
                peekEntitlements: () => ({ hostedModels: false }),
            },
        };
        const models = listModelsForAgentExtracted(ctx as unknown as QaapAgentTaskRunnerContext, 'codex', 'starter-user');
        expect(models).to.have.length(4);
        expect(models.every(model => model.available === false)).to.equal(true);
    });

    it('does not lock Codex models when the user has their own Codex session', () => {
        const ctx = {
            normalizeAgentId: () => undefined,
            isAgentConnected: () => true,
            agentConnectionSnapshot: () => ({ connectionState: 'connected', probeSettled: true }),
            billingStore: {
                peekEntitlements: () => ({ hostedModels: false }),
            },
        };
        const models = listModelsForAgentExtracted(ctx as unknown as QaapAgentTaskRunnerContext, 'codex', 'starter-user');
        expect(models).to.have.length(4);
        expect(models.every(model => model.available === true)).to.equal(true);
    });

    describe('OpenCode paid-model access', () => {
        const opencodeCtx = (
            connectionState: 'connected' | 'disconnected' | 'unknown',
            probeSettled: boolean,
        ): QaapAgentTaskRunnerContext => ({
            normalizeAgentId: () => undefined,
            agentConnectionSnapshot: () => ({ connectionState, probeSettled }),
            billingStore: { peekEntitlements: () => undefined },
        } as unknown as QaapAgentTaskRunnerContext);

        it('keeps free OpenCode models usable and locks paid ones without a sign-in', () => {
            const models = listModelsForAgentExtracted(opencodeCtx('disconnected', true), 'opencode', 'starter-user');
            const free = models.filter(model => model.modelId.endsWith('-free') || model.modelId === 'opencode/big-pickle');
            const paid = models.filter(model => !free.includes(model));
            expect(free).to.have.length(10);
            expect(paid).to.have.length(73);
            expect(free.every(model => model.available === undefined && model.unavailableReason === undefined)).to.equal(true);
            expect(paid.every(model => model.available === false && model.unavailableReason === 'not-connected')).to.equal(true);
        });

        it('unlocks paid OpenCode models for a connected owner', () => {
            const models = listModelsForAgentExtracted(opencodeCtx('connected', true), 'opencode', 'pro-user');
            const paid = models.filter(model => !model.modelId.endsWith('-free') && model.modelId !== 'opencode/big-pickle');
            expect(paid).to.have.length(73);
            expect(paid.every(model => model.available === true && model.unavailableReason === undefined)).to.equal(true);
        });

        it('shows paid OpenCode models without a lock while the auth probe is still pending', () => {
            const models = listModelsForAgentExtracted(opencodeCtx('unknown', false), 'opencode', 'pro-user');
            expect(models.some(model => model.modelId === 'opencode/claude-opus-4-7')).to.equal(true);
            expect(models.every(model => model.available !== false && model.unavailableReason === undefined)).to.equal(true);
        });
    });

    describe('Codex access (shared with the picker row)', () => {
        const codexCtx = (
            connectionState: 'connected' | 'disconnected' | 'unknown',
            probeSettled: boolean,
            entitlements: { hostedModels: boolean; creditsRemaining: number } | undefined,
        ): QaapAgentTaskRunnerContext => ({
            normalizeAgentId: () => undefined,
            agentConnectionSnapshot: () => ({ connectionState, probeSettled }),
            billingStore: { peekEntitlements: () => entitlements },
        } as unknown as QaapAgentTaskRunnerContext);

        it('unlocks hosted Codex models for a Pro owner with credits but no sign-in', () => {
            const models = listModelsForAgentExtracted(
                codexCtx('disconnected', true, { hostedModels: true, creditsRemaining: 10 }), 'codex', 'pro-user');
            expect(models.every(model => model.available === true)).to.equal(true);
        });

        it('locks Codex models as not-connected (not plan) for a Pro owner without credits and no sign-in', () => {
            const models = listModelsForAgentExtracted(
                codexCtx('disconnected', true, { hostedModels: true, creditsRemaining: 0 }), 'codex', 'pro-user');
            expect(models).to.have.length(4);
            expect(models.every(model => model.available === false && model.unavailableReason === 'not-connected')).to.equal(true);
        });

        it('shows Codex models without a plan lock while the auth probe is still pending', () => {
            const models = listModelsForAgentExtracted(
                codexCtx('unknown', false, { hostedModels: false, creditsRemaining: 0 }), 'codex', 'starter-user');
            expect(models).to.have.length(4);
            expect(models.every(model => model.available !== false && model.unavailableReason === undefined)).to.equal(true);
        });

        it('locks a settled-unknown Codex probe as not-connected, never as plan', () => {
            const models = listModelsForAgentExtracted(
                codexCtx('unknown', true, { hostedModels: false, creditsRemaining: 0 }), 'codex', 'starter-user');
            expect(models.every(model => model.unavailableReason === 'not-connected')).to.equal(true);
        });
    });
});
