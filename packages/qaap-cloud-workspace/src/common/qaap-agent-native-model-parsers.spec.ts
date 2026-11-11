// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import {
    parseAgyModelLines,
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
