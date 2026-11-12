// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import {
    parseAgyModelLines,
    parseClaudeBundleModelIds,
    parseClaudeControlResponseModels,
    parseCodexDebugModels,
    parseGrokModelLines,
    parseNativeModelOutput,
} from './qaap-agent-native-model-parsers';

/** Listings captured from the installed CLIs (2026-11) for the parsers below. */
const FIXTURES = path.join(__dirname, '..', '..', 'test-resources', 'agent-models');

function fixture(name: string): string {
    return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

describe('qaap-agent-native-model-parsers', () => {

    describe('codex debug models', () => {
        it('keeps only the rows the CLI lists, in the CLI order, with display names', () => {
            const models = parseCodexDebugModels(fixture('codex-debug-models.json'));
            expect(models).to.deep.equal([
                { provider: 'openai', vendor: 'codex', modelId: 'gpt-6-luna', label: 'GPT-6-Luna' },
                { provider: 'openai', vendor: 'codex', modelId: 'gpt-5.6-terra', label: 'GPT-5.6-Terra' },
                { provider: 'openai', vendor: 'codex', modelId: 'gpt-5.6-luna', label: 'GPT-5.6-Luna' },
            ]);
        });

        it('skips banners before the JSON, unsupported rows and malformed slugs', () => {
            const text = 'WARN something\n' + JSON.stringify({
                models: [
                    { slug: 'gpt-x', display_name: 'X', visibility: 'list', supported_in_api: false },
                    { slug: 'bad slug!', display_name: 'Bad', visibility: 'list' },
                    { slug: 'gpt-ok', visibility: 'list' },
                    'not an object',
                ],
            });
            expect(parseCodexDebugModels(text).map(model => [model.modelId, model.label])).to.deep.equal([['gpt-ok', 'gpt-ok']]);
        });

        it('returns nothing for diagnostics, empty output or a differently shaped document', () => {
            expect(parseCodexDebugModels('error: not logged in')).to.deep.equal([]);
            expect(parseCodexDebugModels('')).to.deep.equal([]);
            expect(parseCodexDebugModels('{"models":"nope"}')).to.deep.equal([]);
            expect(parseCodexDebugModels('{broken')).to.deep.equal([]);
        });
    });

    describe('grok models', () => {
        it('parses the default row first and ignores the sign-in banner', () => {
            const lines = fixture('grok-models.txt').split(/\r?\n/);
            expect(parseGrokModelLines(lines)).to.deep.equal([
                { provider: 'openai', vendor: 'grok', modelId: 'grok-4.7', label: 'Grok 4.7' },
            ]);
        });

        it('keeps a non-default row after the default one and drops duplicates', () => {
            const models = parseGrokModelLines(['  * grok-4.7 (default)', '    grok-4.6', '    grok-4.6', 'Default model: grok-4.7']);
            expect(models.map(model => model.modelId)).to.deep.equal(['grok-4.7', 'grok-4.6']);
        });
    });

    describe('agy models', () => {
        it('takes the label as the model id, because Antigravity resolves labels verbatim', () => {
            const models = parseAgyModelLines(fixture('agy-models.txt').split(/\r?\n/));
            expect(models.map(model => model.modelId)).to.deep.equal([
                'Gemini 3.8 Flash (High)',
                'Gemini 3.8 Flash (Medium)',
                'Gemini 3.8 Flash (Low)',
                'Claude Sonnet 4.6 (Thinking)',
                'Claude Opus 4.6 (Thinking)',
                'GPT-OSS 120B (Medium)',
            ]);
            expect(models.map(model => model.provider)).to.deep.equal(['gemini', 'gemini', 'gemini', 'anthropic', 'anthropic', 'openai']);
        });

        it('ignores rows without a tab and progress text', () => {
            expect(parseAgyModelLines(['Fetching available models...', 'no-tab-here', 'id-only\t', '\tLabel'])).to.deep.equal([]);
        });
    });

    describe('opencode models', () => {
        it('keeps provider-qualified ids and drops any diagnostic text', () => {
            const stdout = fixture('opencode-models.txt') + '\nError: EROFS: read-only file system, mkdir\n    at Object.mkdir\n';
            const models = parseNativeModelOutput('opencode', stdout);
            expect(models.length).to.be.greaterThan(40);
            expect(models.every(model => /^opencode\/[a-z0-9][a-z0-9._-]*$/i.test(model.modelId))).to.equal(true);
            expect(models.map(model => model.modelId)).to.include('opencode/claude-opus-5-5');
        });
    });

    describe('claude initialize answer', () => {
        const answer = (models: unknown, subtype: unknown = 'success'): unknown => ({
            type: 'control_response',
            response: { subtype, request_id: 'qaap-model-list', response: { models } },
        });

        it('keeps the CLI aliases and labels in the CLI order, and the fixture ids as usable model ids', () => {
            const message: unknown = JSON.parse(fixture('claude-initialize-response.json'));
            const models = parseClaudeControlResponseModels(message);
            expect(models).to.have.length(14);
            expect(models[0]).to.deep.equal({ provider: 'anthropic', vendor: 'claude', modelId: 'default', label: 'Default (recommended)' });
            expect(models.map(model => model.modelId)).to.include.members(['opus', 'sonnet', 'fable', 'haiku', 'claude-fable-5-1']);
            expect(models.find(model => model.modelId === 'fable')?.label).to.equal('Fable 5.2');
        });

        it('drops malformed, unsafe and duplicate entries and keeps the first of each value', () => {
            const models = parseClaudeControlResponseModels(answer([
                { value: 'opus', displayName: 'Opus 5.5' },
                { value: 'opus', displayName: 'Opus again' },
                { value: 'bad value; rm -rf', displayName: 'Injected' },
                { value: '--dangerous', displayName: 'Flag-shaped' },
                { value: 'sonnet' },
                { displayName: 'No value' },
                { value: 42, displayName: 'Numeric' },
                { value: 'haiku', displayName: '' },
                { value: 'fable', displayName: 'x'.repeat(121) },
                'not an object',
                null,
            ]));
            expect(models.map(model => model.modelId)).to.deep.equal(['opus']);
            expect(models[0].label).to.equal('Opus 5.5');
        });

        it('returns nothing for an error answer, another message type or a differently shaped answer', () => {
            expect(parseClaudeControlResponseModels(answer([{ value: 'opus', displayName: 'Opus' }], 'error'))).to.deep.equal([]);
            expect(parseClaudeControlResponseModels({ ...(answer([]) as object), type: 'system' })).to.deep.equal([]);
            expect(parseClaudeControlResponseModels(answer('opus'))).to.deep.equal([]);
            expect(parseClaudeControlResponseModels(answer(undefined))).to.deep.equal([]);
            expect(parseClaudeControlResponseModels(null)).to.deep.equal([]);
            expect(parseClaudeControlResponseModels('control_response')).to.deep.equal([]);
        });
    });

    describe('claude bundle model ids', () => {
        it('keeps the newest non-dated id of each family and drops dated and suffixed ids', () => {
            const models = parseClaudeBundleModelIds(fixture('claude-bundle-model-ids.txt').split(/\r?\n/));
            expect(models.map(model => model.modelId)).to.deep.equal([
                'claude-fable-5-2',
                'claude-opus-5-5',
                'claude-sonnet-5-5',
                'claude-haiku-5-5',
            ]);
            expect(models.map(model => model.label)).to.deep.equal(['Fable 5.2', 'Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5']);
            expect(models.every(model => model.provider === 'anthropic' && model.vendor === 'claude')).to.equal(true);
        });

        it('returns nothing when the bundle lists only dated, suffixed or unrelated ids', () => {
            expect(parseClaudeBundleModelIds(['claude-haiku-4-5-20251001', 'claude-fable-5-mythos-5', 'noise'])).to.deep.equal([]);
        });
    });

    describe('dispatcher', () => {
        it('routes each agent to its parser and returns nothing for agents without a listing', () => {
            expect(parseNativeModelOutput('codex', fixture('codex-debug-models.json'))).to.have.length(3);
            expect(parseNativeModelOutput('grok', fixture('grok-models.txt'))).to.have.length(1);
            expect(parseNativeModelOutput('gemini', fixture('agy-models.txt'))).to.have.length(6);
            expect(parseNativeModelOutput('claude', 'claude-opus-5-5')).to.deep.equal([]);
            expect(parseNativeModelOutput('cursor', 'auto\nsonnet-4-thinking')).to.have.length(2);
        });
    });
});
