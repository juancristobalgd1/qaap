// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentEffortLevel } from '@theia/qaap-shared-core/lib/common/qaap-agent-effort';
import { QAAP_BUILTIN_AGENT_DEFINITIONS } from '@theia/qaap-shared-core/lib/common/qaap-builtin-agents';
import { formatEffortFlagsForAgent } from '../common/qaap-agent-effort-flags';
import { buildTemplateVarsExtracted, withEffortFlags } from './qaap-agent-task-runner-streaming2';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';
import { applyTemplate } from './qaap-agent-task-runner-utils';

/** Only the members buildTemplateVarsExtracted reads, with a model selection passed through unchanged. */
const context = {
    isProjectFolderTrusted: () => false,
    resolveQaiqProviderFlags: () => '',
    normalizeAgentBinding: (binding: unknown) => binding,
} as unknown as QaapAgentTaskRunnerContext;

/** The argv a harness would get for `prompt`, with the effort flags merged the way buildAgentCommandExtracted does. */
function argvFor(agentId: string, modelId: string | undefined, effort: QaapAgentEffortLevel | undefined): string {
    const definition = QAAP_BUILTIN_AGENT_DEFINITIONS.find(candidate => candidate.id === agentId);
    const agentModel = modelId ? { provider: 'openai' as const, vendor: agentId, modelId } : undefined;
    const vars = withEffortFlags(
        buildTemplateVarsExtracted(context, agentId, agentModel, undefined, undefined, undefined),
        formatEffortFlagsForAgent(agentId, modelId, effort),
    );
    return applyTemplate(definition?.template ?? '', 'hi', vars);
}

describe('qaap agent task runner effort flags', () => {

    it('passes --effort to Claude Code', () => {
        expect(argvFor('claude', undefined, 'max')).to.contain('--effort max');
    });

    it('passes the reasoning effort override to Codex', () => {
        expect(argvFor('codex', 'gpt-5.6-sol', 'high')).to.contain('-c model_reasoning_effort=high');
    });

    it('passes --variant to OpenCode for a paid model', () => {
        expect(argvFor('opencode', 'opencode/some-paid-model', 'max')).to.contain('--variant max');
    });

    it('passes --thinking to Pi, keeping the Pi default model flags', () => {
        const argv = argvFor('pi', undefined, 'off');
        expect(argv).to.contain('--thinking off');
        expect(argv).to.contain('--model');
    });

    it('drops an unsupported level without changing the command', () => {
        expect(argvFor('codex', undefined, 'max')).to.not.contain('model_reasoning_effort');
        expect(argvFor('claude', undefined, undefined)).to.not.contain('--effort');
    });

    it('leaves a harness without effort untouched', () => {
        expect(argvFor('grok', undefined, 'high')).to.not.contain('high');
    });

    it('keeps existing model flags when appending effort', () => {
        expect(withEffortFlags({ model_flags: '--model m' }, '--effort low')).to.deep.equal({ model_flags: '--model m --effort low' });
        expect(withEffortFlags({ model_flags: '--model m' }, '')).to.deep.equal({ model_flags: '--model m' });
    });
});
