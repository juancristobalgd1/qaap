// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// ****************************************************************************

import { expect } from 'chai';
import { NATIVE_MODEL_PICKER_AGENT_IDS } from '@theia/qaap-mobile-shell/lib/common/qaap-builtin-agents';
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

        expect(buildTemplateVarsExtracted(ctx, 'openclaude')).to.deep.equal({
            qaiq_flags: '',
            model_flags: '',
        });
        expect(buildTemplateVarsExtracted(ctx, 'qaiq')).to.deep.equal({
            qaiq_flags: '--dangerously-skip-permissions --provider openai --model qaiq/custom-model',
            model_flags: '',
        });
    });

    it('does not resolve a QAIQ Settings binding for an unpinned OpenClaude task', () => {
        const qaiqBinding = { provider: 'openai', vendor: 'openrouter', modelId: 'qaiq/custom-model' };
        const ctx = {
            resolveQaapQaiqBinding: () => qaiqBinding,
            normalizeAgentBinding: (binding: unknown) => binding,
        };

        expect(resolveAgentBindingForTaskExtracted(ctx, {
            agentId: 'openclaude',
            command: 'openclaude --print prompt',
        } as any)).to.equal(undefined);
        expect(resolveAgentBindingForTaskExtracted(ctx, {
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
        const vars = buildTemplateVarsExtracted(ctx, 'hermes', agentModel);
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
            billingStore: {
                peekEntitlements: () => ({ hostedModels: false }),
            },
        };
        const models = listModelsForAgentExtracted(ctx, 'codex', 'starter-user');
        expect(models).to.have.length(4);
        expect(models.every(model => model.available === false)).to.equal(true);
    });

    it('does not lock Codex models when the user has their own Codex session', () => {
        const ctx = {
            normalizeAgentId: () => undefined,
            isAgentConnected: () => true,
            billingStore: {
                peekEntitlements: () => ({ hostedModels: false }),
            },
        };
        const models = listModelsForAgentExtracted(ctx, 'codex', 'starter-user');
        expect(models).to.have.length(4);
        expect(models.every(model => model.available === true)).to.equal(true);
    });
});
