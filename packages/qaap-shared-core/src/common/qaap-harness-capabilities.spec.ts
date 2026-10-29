// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_BUILTIN_AGENT_DEFINITIONS, QAAP_RETIRED_AGENT_DEFINITIONS } from './qaap-builtin-agents';
import {
    mapQaapToolKind,
    QaapHarnessCapabilityRegistry,
    resolveQaapHarnessCapabilities,
} from './qaap-harness-capabilities';

describe('qaap-harness-capabilities', () => {

    const registry = new QaapHarnessCapabilityRegistry();
    /** Every harness Qaap can start today, including the native QAIQ runner and the retired OpenClaude. */
    const builtinIds = [
        'qaiq',
        'openclaude',
        ...QAAP_BUILTIN_AGENT_DEFINITIONS.map(definition => definition.id),
    ];

    it('has an explicit entry for every builtin harness', () => {
        const registered = registry.listAgentIds();
        for (const id of builtinIds) {
            expect(registered, `missing registry entry for ${id}`).to.include(id);
            expect(registry.get(id).agentId).to.equal(id);
        }
    });

    it('has an entry for the retired OpenClaude definition', () => {
        const openclaude = QAAP_RETIRED_AGENT_DEFINITIONS.find(definition => definition.id === 'openclaude');
        expect(openclaude).to.not.equal(undefined);
        expect(registry.get('openclaude').gate).to.equal('native-stdio');
    });

    it('lets QAIQ and OpenClaude ask before changes through the native stdio gate', () => {
        for (const id of ['qaiq', 'openclaude']) {
            const capabilities = registry.get(id);
            expect(capabilities.gate).to.equal('native-stdio');
            expect(capabilities.canAsk).to.equal(true);
            expect(capabilities.askTtlSec).to.be.greaterThan(0);
            expect(capabilities.shellGuard).to.equal('gate');
        }
    });

    it('records what each builtin does under request-approval when it cannot ask', () => {
        for (const id of ['qaiq', 'openclaude', 'claude', 'codex', 'opencode']) {
            expect(registry.get(id).whenAskUnsupported, id).to.equal('refuses');
        }
        expect(registry.get('pi').whenAskUnsupported).to.equal('runs-unchecked');
        for (const definition of QAAP_BUILTIN_AGENT_DEFINITIONS) {
            expect(registry.get(definition.id).whenAskUnsupported, definition.id).to.be.oneOf(['refuses', 'runs-unchecked']);
        }
    });

    it('keeps every other builtin harness unable to ask, with no ask window', () => {
        for (const definition of QAAP_BUILTIN_AGENT_DEFINITIONS) {
            const capabilities = registry.get(definition.id);
            expect(capabilities.canAsk, definition.id).to.equal(false);
            expect(capabilities.askTtlSec, definition.id).to.equal(0);
            expect(capabilities.gate, definition.id).to.equal('none');
        }
    });

    it('gives unknown and custom ids the conservative default', () => {
        for (const id of ['', 'my-custom-agent', 'snow']) {
            const capabilities = registry.get(id);
            expect(capabilities.gate).to.equal('none');
            expect(capabilities.canAsk).to.equal(false);
            expect(capabilities.usage).to.equal('none');
            expect(capabilities.costSource).to.equal('none');
            expect(capabilities.whenAskUnsupported).to.equal('runs-unchecked');
        }
        expect(resolveQaapHarnessCapabilities(undefined).canAsk).to.equal(false);
    });

    it('matches ids case-insensitively and ignores surrounding whitespace', () => {
        expect(registry.get('  QAIQ ').canAsk).to.equal(true);
        expect(registry.get('Codex').agentId).to.equal('codex');
    });

    it('maps common harness tool names to normalized kinds', () => {
        expect(mapQaapToolKind('Bash')).to.equal('shell');
        expect(mapQaapToolKind('apply_patch')).to.equal('edit');
        expect(mapQaapToolKind('write_file')).to.equal('write');
        expect(mapQaapToolKind('Grep')).to.equal('read');
        expect(mapQaapToolKind('WebFetch')).to.equal('web');
        expect(mapQaapToolKind('mcp__github__get_issue')).to.equal('mcp');
        expect(mapQaapToolKind('Task')).to.equal('other');
        expect(registry.get('qaiq').mapToolKind('Bash', {})).to.equal('shell');
    });
});
