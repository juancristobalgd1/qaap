// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_BUILTIN_AGENT_DEFINITIONS, QAAP_RETIRED_AGENT_DEFINITIONS } from '@theia/qaap-shared-core/lib/common/qaap-builtin-agents';
import { QAAP_HARNESS_CAPABILITY_REGISTRY, resolveQaapHarnessCapabilities } from '@theia/qaap-shared-core/lib/common/qaap-harness-capabilities';
import { QAAP_PI_PLAN_MODE_INSTRUCTION } from '../../common/qaap-agent-readonly-workspace';
import { emitsStreamJsonFinalResult } from '../qaap-agent-final-result-watcher';
import { usesCodexToolGateHook } from '../qaap-codex-gate-overlay';
import { usesOpencodeGatePlugin } from '../qaap-tool-gate-opencode-adapter';
import { usesToolGateExtension } from '../qaap-tool-gate-pi-adapter';
import { QAAP_HARNESS_ADAPTER_REGISTRY } from './qaap-harness-adapter-registry';

/** Every harness id Qaap can start or resolve: builtins, the native QAIQ runner and the retired CLIs. */
const ALL_IDS: readonly string[] = [...new Set([
    'qaiq',
    'shell',
    ...QAAP_BUILTIN_AGENT_DEFINITIONS.map(definition => definition.id),
    ...QAAP_RETIRED_AGENT_DEFINITIONS.map(definition => definition.id),
])];

describe('QaapHarnessAdapterRegistry', () => {

    it('has a dedicated native adapter for every builtin, retired and capability-registered harness id', () => {
        for (const id of [...ALL_IDS, ...QAAP_HARNESS_CAPABILITY_REGISTRY.listAgentIds()]) {
            const adapter = QAAP_HARNESS_ADAPTER_REGISTRY.find(id);
            expect(adapter, `no adapter for ${id}`).to.not.equal(undefined);
            expect(adapter!.agentId).to.equal(id);
            expect(adapter!.transport).to.equal('native');
        }
    });

    it('matches ids case-insensitively and gives every other id the generic adapter', () => {
        expect(QAAP_HARNESS_ADAPTER_REGISTRY.get('  Codex ').agentId).to.equal('codex');
        for (const id of ['my-custom-agent', 'qaiq-gemini', '', undefined]) {
            expect(QAAP_HARNESS_ADAPTER_REGISTRY.find(id), String(id)).to.equal(undefined);
            expect(QAAP_HARNESS_ADAPTER_REGISTRY.get(id).agentId, String(id)).to.equal('generic');
        }
    });

    it('exposes the static capabilities of the harness it adapts', () => {
        for (const id of ALL_IDS) {
            const { mapToolKind: adapted, ...adaptedData } = QAAP_HARNESS_ADAPTER_REGISTRY.get(id).capabilities;
            const { mapToolKind: registered, ...registeredData } = resolveQaapHarnessCapabilities(id);
            expect(adaptedData, id).to.deep.equal(registeredData);
            expect(adapted('Bash', {}), id).to.equal(registered('Bash', {}));
        }
    });

    it('declares the same gate wiring as the predicates the runner used to evaluate', () => {
        for (const id of [...ALL_IDS, 'unknown', 'gemini', ' Pi ', undefined]) {
            const wiring = QAAP_HARNESS_ADAPTER_REGISTRY.get(id).gateWiring;
            expect(wiring === 'pi-extension', `${id} pi-extension`).to.equal(usesToolGateExtension(id));
            expect(wiring === 'codex-hook', `${id} codex-hook`).to.equal(usesCodexToolGateHook(id));
            expect(wiring === 'opencode-plugin', `${id} opencode-plugin`).to.equal(usesOpencodeGatePlugin(id));
            expect(wiring === 'stdio-control', `${id} stdio-control`).to.equal(resolveQaapHarnessCapabilities(id).gate === 'native-stdio');
        }
    });

    it('declares the spawn quirks the runner used to derive from agent ids', () => {
        for (const id of [...ALL_IDS, 'unknown', undefined]) {
            const quirks = QAAP_HARNESS_ADAPTER_REGISTRY.get(id).spawnQuirks;
            const normalized = id?.trim().toLowerCase();
            expect(quirks.removesStaleSnapshotLocks, `${id} snapshot locks`).to.equal(normalized === 'opencode');
            expect(quirks.watchesFatalStderr, `${id} fatal stderr`).to.equal(normalized === 'opencode');
            expect(quirks.watchesProviderErrors, `${id} provider errors`).to.equal(normalized === 'pi');
            expect(quirks.watchesSignInWait, `${id} sign-in wait`).to.equal(normalized === 'antigravity');
            expect(quirks.allowsSubagentTools, `${id} subagent tools`).to.equal(normalized === 'claude');
            expect(quirks.emitsStreamJsonFinalResult, `${id} final result`).to.equal(emitsStreamJsonFinalResult(id));
        }
    });

    describe('prompt transport', () => {
        it('lets the first adapter in priority order claim a detected binary, like the old rule list', () => {
            // `bin: grok` wins over the id; `bin: copilot` is claimed after the stdin-omit ids but before codex.
            expect(QAAP_HARNESS_ADAPTER_REGISTRY.resolvePromptTransport('mygrok', { bin: 'grok' })).to.deep.equal({ kind: 'prompt-file', flag: '--prompt-file' });
            expect(QAAP_HARNESS_ADAPTER_REGISTRY.resolvePromptTransport('claude', { bin: 'copilot' })).to.deep.equal({ kind: 'plain-stdin', placeholder: 'omit' });
            expect(QAAP_HARNESS_ADAPTER_REGISTRY.resolvePromptTransport('codex', { bin: 'copilot' })).to.deep.equal({ kind: 'plain-stdin', placeholder: 'omit-flag' });
        });

        it('falls back to the template of a harness without an adapter', () => {
            expect(QAAP_HARNESS_ADAPTER_REGISTRY.resolvePromptTransport('x', { template: 'tool -p {prompt}' })).to.deep.equal({ kind: 'plain-stdin', placeholder: 'dash' });
            expect(QAAP_HARNESS_ADAPTER_REGISTRY.resolvePromptTransport('x', { template: 'tool {prompt}' })).to.deep.equal({ kind: 'plain-stdin', placeholder: 'omit' });
            expect(QAAP_HARNESS_ADAPTER_REGISTRY.resolvePromptTransport('x', { template: 'tool run' })).to.deep.equal({ kind: 'argv' });
        });
    });

    describe('child env hooks', () => {
        const task = (agentId: string | undefined, command: string, autoApprove = true, readOnlyWorkspace = false): {
            agentId: string | undefined; command: string; autoApprove: boolean; readOnlyWorkspace: boolean;
        } => ({ agentId, command, autoApprove, readOnlyWorkspace });

        it('turns the Claude Code telemetry off unless the operator already chose', () => {
            for (const id of ['claude', 'openclaude']) {
                const env: NodeJS.ProcessEnv = {};
                QAAP_HARNESS_ADAPTER_REGISTRY.get(id).applyChildEnv(env, task(id, `${id} -p`));
                expect(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, id).to.equal('1');
                const chosen: NodeJS.ProcessEnv = { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '0' };
                QAAP_HARNESS_ADAPTER_REGISTRY.get(id).applyChildEnv(chosen, task(id, `${id} -p`));
                expect(chosen.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, id).to.equal('0');
            }
            const codex: NodeJS.ProcessEnv = {};
            QAAP_HARNESS_ADAPTER_REGISTRY.get('codex').applyChildEnv(codex, task('codex', 'codex exec'));
            expect(codex).to.deep.equal({});
        });

        it('gates OpenCode explicitly, by the approval protocol the command speaks', () => {
            const ask: NodeJS.ProcessEnv = {};
            QAAP_HARNESS_ADAPTER_REGISTRY.forApprovalProtocol('opencode run', 'opencode').applyPermissionEnv(ask, task('opencode', 'opencode run', false));
            expect(JSON.parse(ask.OPENCODE_PERMISSION!)).to.deep.equal({ edit: 'ask', bash: 'ask', webfetch: 'ask', websearch: 'ask' });
            // A custom id that runs the OpenCode CLI is gated like OpenCode.
            const custom: NodeJS.ProcessEnv = {};
            QAAP_HARNESS_ADAPTER_REGISTRY.forApprovalProtocol('opencode run', 'my-opencode').applyPermissionEnv(custom, task('my-opencode', 'opencode run', false));
            expect(custom.OPENCODE_PERMISSION).to.equal(ask.OPENCODE_PERMISSION);
            // Another harness never gets one.
            const other: NodeJS.ProcessEnv = {};
            QAAP_HARNESS_ADAPTER_REGISTRY.forApprovalProtocol('codex exec', 'codex').applyPermissionEnv(other, task('codex', 'codex exec', false));
            expect(other).to.deep.equal({});
        });
    });

    describe('prompt and template hooks', () => {
        it('adds the plan instruction to a Pi plan turn only', () => {
            expect(QAAP_HARNESS_ADAPTER_REGISTRY.get('pi').preparePrompt('pi', 'fix it', 'plan')).to.equal(`${QAAP_PI_PLAN_MODE_INSTRUCTION}\n\nfix it`);
            expect(QAAP_HARNESS_ADAPTER_REGISTRY.get('pi').preparePrompt('pi', 'fix it', 'agent')).to.equal('fix it');
            expect(QAAP_HARNESS_ADAPTER_REGISTRY.get('claude').preparePrompt('claude', 'fix it', 'plan')).to.equal('fix it');
        });

        it('keeps the template variables of a harness without extras untouched', () => {
            const vars = { model_flags: '', qaiq_flags: '' };
            expect(QAAP_HARNESS_ADAPTER_REGISTRY.get('codex').extendTemplateVars('codex', vars)).to.equal(vars);
            const pi = QAAP_HARNESS_ADAPTER_REGISTRY.get('pi').extendTemplateVars('pi', vars);
            expect(pi.model_flags).to.not.equal('');
            expect(pi).to.have.property('gate_ext');
        });
    });

    describe('stream hooks', () => {
        it('selects a parser for the structured harnesses and none for the plain-text ones', () => {
            for (const id of ['claude', 'codex', 'opencode', 'pi', 'antigravity', 'openclaude', 'qaiq']) {
                expect(QAAP_HARNESS_ADAPTER_REGISTRY.get(id).createStreamAccumulator(id), id).to.not.equal(undefined);
            }
            for (const id of ['cursor', 'copilot', 'grok', 'shell']) {
                expect(QAAP_HARNESS_ADAPTER_REGISTRY.get(id).createStreamAccumulator(id), id).to.equal(undefined);
                expect(QAAP_HARNESS_ADAPTER_REGISTRY.get(id).createAgUiEmitter(id), id).to.equal(undefined);
            }
        });
    });
});
