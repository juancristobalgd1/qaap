// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapQaiqModelOption } from '../common/qaap-agent-task-client';
import { appendLlmProviderIcon } from '../common/qaap-llm-provider-branding';
import { formatQaiqModelProviderLabel } from '../common/qaap-qaiq-byok-provider-registry';

export interface QaapAgentPickerSearchEntry {
    readonly id: string;
    readonly label: string;
    readonly models: readonly QaapQaiqModelOption[];
}

export interface QaapAgentPickerModelGroup {
    readonly agent: QaapAgentPickerSearchEntry;
    readonly models: readonly QaapQaiqModelOption[];
}

export interface QaapAgentPickerSearchResults {
    readonly directAgents: readonly QaapAgentPickerSearchEntry[];
    readonly modelGroups: readonly QaapAgentPickerModelGroup[];
}

export function normalizeAgentPickerSearchText(value: string): string {
    return value
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLocaleLowerCase()
        .trim();
}

export function modelMatchesAgentPickerQuery(model: QaapQaiqModelOption, query: string): boolean {
    const normalizedQuery = normalizeAgentPickerSearchText(query);
    if (!normalizedQuery) {
        return true;
    }
    return [model.label, model.modelId, model.provider, model.vendor]
        .some(value => normalizeAgentPickerSearchText(value).includes(normalizedQuery));
}

export function agentMatchesAgentPickerQuery(entry: QaapAgentPickerSearchEntry, query: string): boolean {
    const normalizedQuery = normalizeAgentPickerSearchText(query);
    if (!normalizedQuery) {
        return true;
    }
    return normalizeAgentPickerSearchText(entry.label).includes(normalizedQuery)
        || normalizeAgentPickerSearchText(entry.id).includes(normalizedQuery)
        || entry.models.some(model => modelMatchesAgentPickerQuery(model, normalizedQuery));
}

function agentNameMatchesQuery(entry: QaapAgentPickerSearchEntry, query: string): boolean {
    return normalizeAgentPickerSearchText(entry.label).includes(query)
        || normalizeAgentPickerSearchText(entry.id).includes(query);
}

function modelDeduplicationKey(model: QaapQaiqModelOption): string {
    return [
        normalizeAgentPickerSearchText(model.provider),
        normalizeAgentPickerSearchText(model.vendor),
        normalizeAgentPickerSearchText(model.modelId),
    ].join('\0');
}

export function buildAgentPickerSearchResults(
    entries: readonly QaapAgentPickerSearchEntry[],
    query: string,
): QaapAgentPickerSearchResults {
    const normalizedQuery = normalizeAgentPickerSearchText(query);
    const uniqueAgents = new Map<string, QaapAgentPickerSearchEntry>();
    for (const entry of entries) {
        const agentKey = normalizeAgentPickerSearchText(entry.id);
        const previous = uniqueAgents.get(agentKey);
        const models = new Map(
            previous?.models.map(model => [modelDeduplicationKey(model), model]) ?? [],
        );
        for (const model of entry.models) {
            models.set(modelDeduplicationKey(model), model);
        }
        uniqueAgents.set(agentKey, {
            ...entry,
            ...previous,
            models: [...models.values()],
        });
    }
    if (!normalizedQuery) {
        return { directAgents: [...uniqueAgents.values()], modelGroups: [] };
    }

    const directAgents: QaapAgentPickerSearchEntry[] = [];
    const modelGroups: QaapAgentPickerModelGroup[] = [];
    for (const agent of uniqueAgents.values()) {
        if (agentNameMatchesQuery(agent, normalizedQuery)) {
            directAgents.push(agent);
        }
        const models = new Map<string, QaapQaiqModelOption>();
        for (const model of agent.models) {
            if (modelMatchesAgentPickerQuery(model, normalizedQuery)) {
                models.set(modelDeduplicationKey(model), model);
            }
        }
        if (models.size > 0) {
            modelGroups.push({ agent, models: [...models.values()] });
        }
    }
    return { directAgents, modelGroups };
}

export function createAgentPickerInlineModelButton(options: {
    readonly agentId: string;
    readonly model: QaapQaiqModelOption;
    readonly selected?: boolean;
    readonly onSelect: (agentId: string, model: QaapQaiqModelOption) => void;
}): HTMLButtonElement {
    const { agentId, model } = options;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'theia-mobile-sticky-composer-sheet-option theia-qaap-agent-sheet-inline-model';
    if (options.selected) {
        button.classList.add('theia-mod-selected');
    }

    const content = document.createElement('span');
    content.className = 'theia-mobile-sticky-composer-sheet-option-content';
    const subavatar = document.createElement('span');
    subavatar.className = 'theia-qaap-agent-sheet-model-subavatar';
    appendLlmProviderIcon(subavatar, model.vendor, model.modelId, 'sm');

    const text = document.createElement('span');
    text.className = 'theia-qaap-agent-sheet-inline-model-text';
    const label = document.createElement('span');
    label.className = 'theia-qaap-agent-sheet-inline-model-label';
    label.textContent = model.label || model.modelId;
    text.append(label);
    if (model.label && model.label !== model.modelId) {
        const id = document.createElement('span');
        id.className = 'theia-qaap-agent-sheet-inline-model-id';
        id.textContent = model.modelId;
        text.append(id);
    }
    const provider = document.createElement('span');
    provider.className = 'theia-qaap-agent-sheet-inline-model-provider';
    provider.textContent = formatQaiqModelProviderLabel(model.vendor || model.provider);
    content.append(subavatar, text, provider);
    button.append(content);
    button.addEventListener('click', () => options.onSelect(agentId, model));
    return button;
}

export async function activateAgentPickerEntry(options: {
    readonly agentId: string;
    readonly supportsModels: boolean;
    readonly cachedModels: readonly QaapQaiqModelOption[] | undefined;
    readonly loadModels: () => Promise<readonly QaapQaiqModelOption[]>;
    readonly onLoading: () => void;
    readonly onModelsResolved: (models: readonly QaapQaiqModelOption[]) => void;
    readonly onShowModels: () => void;
    readonly onSelectDirect: () => void;
}): Promise<'models' | 'direct'> {
    if (!options.supportsModels) {
        options.onSelectDirect();
        return 'direct';
    }
    let models = options.cachedModels;
    if (!models || models.length === 0) {
        options.onLoading();
        models = await options.loadModels();
        options.onModelsResolved(models);
    }
    // Model-capable agents always drill into the model submenu; an empty catalog is
    // shown there instead of treating the tap as a final agent selection (which closes the sheet).
    options.onShowModels();
    return 'models';
}

export function handleAgentPickerSearchKeydown(
    event: KeyboardEvent,
    input: HTMLInputElement,
    onQueryCleared: () => void,
    onClose: () => void,
    onlyResult?: HTMLElement,
): boolean {
    if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (input.value) {
            input.value = '';
            onQueryCleared();
        } else {
            onClose();
        }
        return true;
    }
    if (event.key === 'Enter' && onlyResult) {
        event.preventDefault();
        onlyResult.click();
        return true;
    }
    return false;
}

