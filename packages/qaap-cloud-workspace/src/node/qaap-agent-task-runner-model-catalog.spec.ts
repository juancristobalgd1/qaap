// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// ****************************************************************************

import { expect } from 'chai';
import {
    buildTemplateVarsExtracted,
    resolveAgentBindingForTaskExtracted,
} from './qaap-agent-task-runner-streaming2';

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
});
