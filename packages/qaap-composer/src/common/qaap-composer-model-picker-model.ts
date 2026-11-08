// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export interface QaapPickerHarness {
    readonly id: string;
    readonly label: string;
    readonly iconClass?: string;
}

export interface QaapPickerModel {
    readonly agentId: string;
    readonly modelId: string;
    readonly label: string;
    readonly available: boolean;
    readonly unavailableReason?: string;
    readonly paid?: boolean;
}

export interface QaapPickerState {
    readonly harnesses: readonly QaapPickerHarness[];
    readonly models: readonly QaapPickerModel[];
    readonly favorites: readonly string[];
    /** `favorites` for the star rail, otherwise a harness id. */
    readonly railSelection: 'favorites' | string;
    readonly query: string;
    readonly currentAgentId: string;
    readonly currentModelId?: string;
}

export namespace QaapComposerModelPickerModel {
    export const FAVORITES_STORAGE_KEY = 'qaap.composer.favoriteModels';

    /** Stable key of one harness and model pair, as stored in the favorites. */
    export function favoriteKey(agentId: string, modelId: string): string {
        return `${agentId}::${modelId}`;
    }

    /**
     * Models the list shows: the favorites when the star rail is selected, otherwise the models of
     * the selected harness; then narrowed by the query (case-insensitive, label or model id).
     */
    export function visibleModels(state: QaapPickerState): QaapPickerModel[] {
        const favorites = new Set(state.favorites);
        const query = state.query.trim().toLowerCase();
        return state.models.filter(model => {
            if (state.railSelection === 'favorites') {
                if (!favorites.has(favoriteKey(model.agentId, model.modelId))) {
                    return false;
                }
            } else if (model.agentId !== state.railSelection) {
                return false;
            }
            if (!query) {
                return true;
            }
            return model.label.toLowerCase().includes(query) || model.modelId.toLowerCase().includes(query);
        });
    }

    /** Adds the key when absent, removes it when present. Keeps the first-seen order. */
    export function toggleFavorite(favorites: readonly string[], key: string): string[] {
        return favorites.includes(key)
            ? favorites.filter(entry => entry !== key)
            : [...favorites, key];
    }

    /** Reads the favorites; a blocked or malformed storage yields none. */
    export function readFavorites(storage: Storage | undefined): string[] {
        try {
            const raw = storage?.getItem(FAVORITES_STORAGE_KEY);
            if (!raw) {
                return [];
            }
            const parsed: unknown = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
        } catch {
            return [];
        }
    }

    /** Writes the favorites; a blocked storage is ignored (session-only). */
    export function writeFavorites(storage: Storage | undefined, favorites: readonly string[]): void {
        try {
            storage?.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
        } catch {
            /* session-only */
        }
    }
}
