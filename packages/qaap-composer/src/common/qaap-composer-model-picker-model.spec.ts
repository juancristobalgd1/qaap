// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapComposerModelPickerModel, type QaapPickerModel, type QaapPickerState } from './qaap-composer-model-picker-model';

const models: QaapPickerModel[] = [
    { agentId: 'claude', modelId: 'opus-4-6', label: 'Opus 4.6', available: true },
    { agentId: 'claude', modelId: 'sonnet-4-6', label: 'Sonnet 4.6', available: true },
    { agentId: 'codex', modelId: 'gpt-5', label: 'GPT-5', available: false, unavailableReason: 'Sign in first' },
];

function state(overrides: Partial<QaapPickerState> = {}): QaapPickerState {
    return {
        harnesses: [{ id: 'claude', label: 'Claude' }, { id: 'codex', label: 'Codex' }],
        models,
        favorites: [],
        railSelection: 'claude',
        query: '',
        currentAgentId: 'claude',
        ...overrides,
    };
}

describe('qaap-composer-model-picker-model', () => {
    it('keys a favorite by harness and model', () => {
        expect(QaapComposerModelPickerModel.favoriteKey('claude', 'opus-4-6')).to.equal('claude::opus-4-6');
    });

    it('lists the models of the selected harness', () => {
        expect(QaapComposerModelPickerModel.visibleModels(state()).map(model => model.modelId))
            .to.deep.equal(['opus-4-6', 'sonnet-4-6']);
    });

    it('lists only favorites on the star rail', () => {
        const favorites = [QaapComposerModelPickerModel.favoriteKey('codex', 'gpt-5')];
        expect(QaapComposerModelPickerModel.visibleModels(state({ railSelection: 'favorites', favorites }))
            .map(model => model.modelId)).to.deep.equal(['gpt-5']);
    });

    it('filters by label or model id, case-insensitively', () => {
        expect(QaapComposerModelPickerModel.visibleModels(state({ query: 'SONNET' })).map(model => model.modelId))
            .to.deep.equal(['sonnet-4-6']);
        expect(QaapComposerModelPickerModel.visibleModels(state({ query: 'opus-4' })).map(model => model.modelId))
            .to.deep.equal(['opus-4-6']);
    });

    it('toggles a favorite on and off', () => {
        const added = QaapComposerModelPickerModel.toggleFavorite([], 'claude::opus-4-6');
        expect(added).to.deep.equal(['claude::opus-4-6']);
        expect(QaapComposerModelPickerModel.toggleFavorite(added, 'claude::opus-4-6')).to.deep.equal([]);
    });

    it('persists favorites and survives a blocked or malformed storage', () => {
        const values = new Map<string, string>();
        const storage = {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => { values.set(key, value); },
        } as unknown as Storage;
        QaapComposerModelPickerModel.writeFavorites(storage, ['claude::opus-4-6']);
        expect(QaapComposerModelPickerModel.readFavorites(storage)).to.deep.equal(['claude::opus-4-6']);

        values.set(QaapComposerModelPickerModel.FAVORITES_STORAGE_KEY, '{not json');
        expect(QaapComposerModelPickerModel.readFavorites(storage)).to.deep.equal([]);

        const blocked = {
            getItem: () => { throw new Error('blocked'); },
            setItem: () => { throw new Error('blocked'); },
        } as unknown as Storage;
        expect(QaapComposerModelPickerModel.readFavorites(blocked)).to.deep.equal([]);
        expect(() => QaapComposerModelPickerModel.writeFavorites(blocked, ['x'])).to.not.throw();
        expect(QaapComposerModelPickerModel.readFavorites(undefined)).to.deep.equal([]);
    });
});
