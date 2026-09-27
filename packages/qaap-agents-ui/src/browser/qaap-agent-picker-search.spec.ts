// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

import { expect } from 'chai';
import { activateAgentPickerEntry, buildAgentPickerSearchResults, createAgentPickerInlineModelButton, modelMatchesAgentPickerQuery, type QaapAgentPickerSearchEntry } from './qaap-agent-picker-search';
import { createAgentSheetOptionButton } from './qaap-agent-ui';
import type { QaapQaiqModelOption } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';

const entries: readonly QaapAgentPickerSearchEntry[] = [
    {
        id: 'qaiq',
        label: 'QAIQ',
        models: [{
            provider: 'anthropic',
            vendor: 'Anthropic',
            modelId: 'claude-sonnet-4',
            label: 'Claude Sónnet 4',
        }],
    },
    {
        id: 'codex',
        label: 'Codex',
        models: [{
            provider: 'openai',
            vendor: 'OpenAI',
            modelId: 'gpt-5.4',
            label: 'GPT 5.4',
        }],
    },
];

describe('qaap-agent-picker-search', () => {
    it('filters models with the same normalized matching', () => {
        expect(entries[0].models.filter(model => modelMatchesAgentPickerQuery(model, 'sónnet'))).to.have.length(1);
    });

    it('groups matching models by agent', () => {
        const results = buildAgentPickerSearchResults(entries, 'gpt');
        expect(results.directAgents).to.be.empty;
        expect(results.modelGroups).to.have.length(1);
        expect(results.modelGroups[0].agent.id).to.equal('codex');
        expect(results.modelGroups[0].models.map(model => model.modelId)).to.deep.equal(['gpt-5.4']);
    });

    it('keeps direct agent matches above grouped model matches', () => {
        const withMatchingModel: readonly QaapAgentPickerSearchEntry[] = [
            ...entries,
            {
                id: 'opencode',
                label: 'OpenCode',
                models: [{
                    provider: 'openai',
                    vendor: 'OpenAI',
                    modelId: 'codex-mini',
                    label: 'Codex Mini',
                }],
            },
        ];
        const results = buildAgentPickerSearchResults(withMatchingModel, 'codex');
        expect(results.directAgents.map(agent => agent.id)).to.deep.equal(['codex']);
        expect(results.modelGroups.map(group => group.agent.id)).to.deep.equal(['opencode']);
    });

    it('deduplicates repeated agents and models', () => {
        const results = buildAgentPickerSearchResults([
            {
                ...entries[1],
                models: [...entries[1].models, entries[1].models[0]],
            },
            entries[1],
        ], 'gpt');
        expect(results.modelGroups).to.have.length(1);
        expect(results.modelGroups[0].models).to.have.length(1);
    });

    it('deduplicates the unfiltered direct agent list', () => {
        const results = buildAgentPickerSearchResults([entries[1], entries[1]], '');
        expect(results.directAgents.map(agent => agent.id)).to.deep.equal(['codex']);
        expect(results.directAgents[0].models).to.have.length(1);
    });

    it('returns an empty grouped result for an unmatched query', () => {
        const results = buildAgentPickerSearchResults(entries, 'definitely-missing');
        expect(results.directAgents).to.be.empty;
        expect(results.modelGroups).to.be.empty;
    });

    it('opens a cached single-model catalog instead of selecting directly', async () => {
        let showedModels = false;
        let selectedDirectly = false;
        const result = await activateAgentPickerEntry({
            agentId: 'codex',
            supportsModels: true,
            cachedModels: entries[1].models,
            loadModels: async () => [],
            onLoading: () => undefined,
            onModelsResolved: () => undefined,
            onShowModels: () => showedModels = true,
            onSelectDirect: () => selectedDirectly = true,
        });
        expect(result).to.equal('models');
        expect(showedModels).to.equal(true);
        expect(selectedDirectly).to.equal(false);
    });

    it('refreshes an empty cached catalog before deciding navigation', async () => {
        let resolvedModels: readonly QaapQaiqModelOption[] = [];
        let showedModels = false;
        const result = await activateAgentPickerEntry({
            agentId: 'qaiq',
            supportsModels: true,
            cachedModels: [],
            loadModels: async () => entries[0].models,
            onLoading: () => undefined,
            onModelsResolved: models => resolvedModels = models,
            onShowModels: () => showedModels = true,
            onSelectDirect: () => undefined,
        });
        expect(result).to.equal('models');
        expect(resolvedModels).to.deep.equal(entries[0].models);
        expect(showedModels).to.equal(true);
    });

    it('opens the model submenu even when the refreshed catalog is empty', async () => {
        let selectedDirectly = false;
        let showedModels = false;
        const result = await activateAgentPickerEntry({
            agentId: 'copilot',
            supportsModels: true,
            cachedModels: [],
            loadModels: async () => [],
            onLoading: () => undefined,
            onModelsResolved: () => undefined,
            onShowModels: () => showedModels = true,
            onSelectDirect: () => selectedDirectly = true,
        });
        expect(result).to.equal('models');
        expect(showedModels).to.equal(true);
        expect(selectedDirectly).to.equal(false);
    });

    it('selects an agent directly when it does not support models', async () => {
        let selectedDirectly = false;
        const result = await activateAgentPickerEntry({
            agentId: 'shell',
            supportsModels: false,
            cachedModels: [],
            loadModels: async () => [],
            onLoading: () => undefined,
            onModelsResolved: () => undefined,
            onShowModels: () => undefined,
            onSelectDirect: () => selectedDirectly = true,
        });
        expect(result).to.equal('direct');
        expect(selectedDirectly).to.equal(true);
    });

    describe('DOM behavior', () => {
        let disableJSDOM: (() => void) | undefined;

        before(() => {
            disableJSDOM = enableJSDOM();
        });

        afterEach(() => {
            document.body.replaceChildren();
        });

        after(() => {
            disableJSDOM?.();
            disableJSDOM = undefined;
        });

        it('renders a real provider subavatar and selects agent plus model', () => {
            let selectedAgent: string | undefined;
            let selectedModel: string | undefined;
            const button = createAgentPickerInlineModelButton({
                agentId: entries[0].id,
                model: entries[0].models[0],
                onSelect: (agentId, model) => {
                    selectedAgent = agentId;
                    selectedModel = model.modelId;
                },
            });

            expect(button.querySelector('.theia-qaap-agent-sheet-model-subavatar .theia-qaap-llm-provider-icon'))
                .to.not.equal(null);
            expect(button.querySelector('.theia-qaap-agent-sheet-inline-model-provider')?.textContent)
                .to.equal('Anthropic');
            button.click();
            expect(selectedAgent).to.equal('qaiq');
            expect(selectedModel).to.equal('claude-sonnet-4');
        });

        it('activates selected and unselected agent rows alike', () => {
            const activated: string[] = [];
            const selected = createAgentSheetOptionButton({
                agentId: 'qaiq',
                label: 'QAIQ',
                selected: true,
                submenuChevron: 'forward',
                onSelect: () => activated.push('selected'),
            });
            const unselected = createAgentSheetOptionButton({
                agentId: 'codex',
                label: 'Codex',
                selected: false,
                submenuChevron: 'forward',
                onSelect: () => activated.push('unselected'),
            });

            selected.click();
            unselected.click();
            expect(activated).to.deep.equal(['selected', 'unselected']);
        });
    });
});

