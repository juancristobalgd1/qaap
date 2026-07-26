// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapQaiqModelOption } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-task-client';
import { listStaticNativeAgentModels } from './qaap-agent-native-model-catalog';
import {
    DEFAULT_QAAP_NATIVE_MODEL_ROUTING_TABLE,
    parseQaapNativeModelRoutingTable,
    resolveNativeAgentModelForTaskKind,
} from './qaap-agent-native-model-routing';

const CLAUDE_CATALOG = listStaticNativeAgentModels('claude');

describe('DEFAULT_QAAP_NATIVE_MODEL_ROUTING_TABLE', () => {

    // The safety contract in one assertion: every id we ship must be offered by that agent's own
    // catalog. A typo or a model retired from the catalog would otherwise reach the CLI as
    // `--model <unknown>` and kill the turn.
    it('only pins model ids the agent actually lists', () => {
        for (const [agentId, entry] of Object.entries(DEFAULT_QAAP_NATIVE_MODEL_ROUTING_TABLE)) {
            const catalog = listStaticNativeAgentModels(agentId).map(option => option.modelId);
            for (const [kind, modelId] of Object.entries(entry)) {
                expect(catalog, `${agentId}/${kind}`).to.include(modelId);
            }
        }
    });

    it('never reviews with the model that writes', () => {
        for (const [agentId, entry] of Object.entries(DEFAULT_QAAP_NATIVE_MODEL_ROUTING_TABLE)) {
            if (entry.review && entry.implementation) {
                expect(entry.review, agentId).to.not.equal(entry.implementation);
            }
        }
    });

    it('leaves codex on its default model — its tier ordering is not verifiable', () => {
        // gpt-5.6-{sol,terra,luna} all exist, but nothing tells us which is the cheap one, and a
        // pin is only safe when BOTH the id and its place in the ladder are known.
        expect(DEFAULT_QAAP_NATIVE_MODEL_ROUTING_TABLE.codex).to.equal(undefined);
    });
});

describe('resolveNativeAgentModelForTaskKind', () => {

    it('routes a cheap/mechanical turn to the fast model', () => {
        const model = resolveNativeAgentModelForTaskKind('claude', 'exploration', CLAUDE_CATALOG);
        expect(model?.modelId).to.equal('claude-haiku-4-5');
    });

    it('routes a writer turn and a judge turn to different frontier models', () => {
        const writer = resolveNativeAgentModelForTaskKind('claude', 'implementation', CLAUDE_CATALOG);
        const judge = resolveNativeAgentModelForTaskKind('claude', 'review', CLAUDE_CATALOG);
        expect(writer?.modelId).to.equal('claude-fable-5');
        expect(judge?.modelId).to.equal('claude-opus-4-8');
        expect(judge?.modelId).to.not.equal(writer?.modelId);
    });

    it('emits no model for an unpinned kind, leaving the CLI default', () => {
        expect(resolveNativeAgentModelForTaskKind('claude', 'general', CLAUDE_CATALOG)).to.equal(undefined);
    });

    it('takes provider and vendor from the catalog entry, never from the table', () => {
        const model = resolveNativeAgentModelForTaskKind('claude', 'exploration', CLAUDE_CATALOG);
        expect(model).to.deep.equal({ provider: 'anthropic', vendor: 'claude', modelId: 'claude-haiku-4-5' });
    });

    it('drops a pin the agent does not list rather than passing it through', () => {
        // A stale table (model retired from the CLI) must degrade to the default, not break the run.
        const table = { claude: { exploration: 'claude-haiku-retired' } };
        expect(resolveNativeAgentModelForTaskKind('claude', 'exploration', CLAUDE_CATALOG, table)).to.equal(undefined);
    });

    it('drops a pin when the catalog is empty (CLI absent or listing failed)', () => {
        expect(resolveNativeAgentModelForTaskKind('claude', 'exploration', [])).to.equal(undefined);
    });

    it('matches catalog ids case-insensitively', () => {
        const table = { claude: { exploration: 'CLAUDE-Haiku-4-5' } };
        const model = resolveNativeAgentModelForTaskKind('claude', 'exploration', CLAUDE_CATALOG, table);
        // The emitted id is the catalog's spelling, not the operator's.
        expect(model?.modelId).to.equal('claude-haiku-4-5');
    });

    it('never routes QAIQ, whose catalog is the Settings alias set', () => {
        const catalog: QaapQaiqModelOption[] = [{ provider: 'openai', vendor: 'qaiq', modelId: 'x', label: 'x' }];
        const table = { qaiq: { exploration: 'x' } };
        expect(resolveNativeAgentModelForTaskKind('qaiq', 'exploration', catalog, table)).to.equal(undefined);
    });

    it('never routes the raw shell agent', () => {
        const catalog: QaapQaiqModelOption[] = [{ provider: 'openai', vendor: 'shell', modelId: 'x', label: 'x' }];
        expect(resolveNativeAgentModelForTaskKind('shell', 'exploration', catalog, { shell: { exploration: 'x' } })).to.equal(undefined);
    });

    it('ignores a missing or blank agent id', () => {
        expect(resolveNativeAgentModelForTaskKind(undefined, 'exploration', CLAUDE_CATALOG)).to.equal(undefined);
        expect(resolveNativeAgentModelForTaskKind('  ', 'exploration', CLAUDE_CATALOG)).to.equal(undefined);
    });
});

describe('parseQaapNativeModelRoutingTable', () => {

    it('falls back to the defaults when unset or malformed', () => {
        for (const raw of [undefined, '', '   ', 'not json', '[]', 'null', '"claude"']) {
            expect(parseQaapNativeModelRoutingTable(raw), String(raw)).to.equal(DEFAULT_QAAP_NATIVE_MODEL_ROUTING_TABLE);
        }
    });

    it('replaces only the agents it names', () => {
        const table = parseQaapNativeModelRoutingTable('{"codex":{"exploration":"gpt-5.5"}}');
        expect(table.codex).to.deep.equal({ exploration: 'gpt-5.5' });
        expect(table.claude).to.deep.equal(DEFAULT_QAAP_NATIVE_MODEL_ROUTING_TABLE.claude);
    });

    it('replaces a named agent wholesale so an operator can shrink it', () => {
        const table = parseQaapNativeModelRoutingTable('{"claude":{"exploration":"claude-sonnet-5"}}');
        expect(table.claude).to.deep.equal({ exploration: 'claude-sonnet-5' });
    });

    it('treats an empty object as the per-agent off switch', () => {
        const table = parseQaapNativeModelRoutingTable('{"claude":{}}');
        expect(table.claude).to.deep.equal({});
        expect(resolveNativeAgentModelForTaskKind('claude', 'exploration', CLAUDE_CATALOG, table)).to.equal(undefined);
    });

    it('normalizes agent ids and trims model ids', () => {
        const table = parseQaapNativeModelRoutingTable('{" CLAUDE ":{"exploration":"  claude-sonnet-5  "}}');
        expect(table.claude).to.deep.equal({ exploration: 'claude-sonnet-5' });
    });

    it('drops unknown task kinds and non-string model ids instead of guessing', () => {
        const table = parseQaapNativeModelRoutingTable(
            '{"claude":{"judge":"claude-sonnet-5","exploration":42,"implementation":null,"review":"claude-sonnet-5"}}',
        );
        expect(table.claude).to.deep.equal({ review: 'claude-sonnet-5' });
    });

    it('keeps the defaults when no agent entry survives sanitizing', () => {
        expect(parseQaapNativeModelRoutingTable('{"claude":[]}')).to.equal(DEFAULT_QAAP_NATIVE_MODEL_ROUTING_TABLE);
    });
});
