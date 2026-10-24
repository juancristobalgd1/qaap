// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { OpenAiModelDescription } from '@theia/ai-openai/lib/common';
import { MODELS_PREF } from '../common/openrouter-preferences';
import { OpenRouterFrontendApplicationContribution } from './openrouter-frontend-application-contribution';

type Call = { kind: 'createOrUpdate'; ids: string[] } | { kind: 'remove'; ids: string[] };

/** Records the backend calls; `delayMs` lets a call stay in flight while later calls are issued. */
class RecordingManager {
    readonly calls: Call[] = [];
    active = 0;
    maxActive = 0;
    failNext = false;
    delayMs = 0;

    async createOrUpdateLanguageModels(...models: OpenAiModelDescription[]): Promise<void> {
        await this.track(() => this.calls.push({ kind: 'createOrUpdate', ids: models.map(model => model.id) }));
    }

    removeLanguageModels(...ids: string[]): void {
        this.calls.push({ kind: 'remove', ids });
    }

    protected async track(record: () => void): Promise<void> {
        this.active++;
        this.maxActive = Math.max(this.maxActive, this.active);
        try {
            await new Promise(resolve => setTimeout(resolve, this.delayMs));
            if (this.failNext) {
                this.failNext = false;
                throw new Error('backend unavailable');
            }
            record();
        } finally {
            this.active--;
        }
    }
}

class TestOpenRouterContribution extends OpenRouterFrontendApplicationContribution {
    updateAll(): void {
        this.updateAllModels();
    }

    changeModels(newModels: string[]): void {
        this.handleModelChanges(this.normalizeModelIds(newModels));
    }

    normalize(ids: string[]): string[] {
        return this.normalizeModelIds(ids);
    }
}

const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 60));

describe('OpenRouterFrontendApplicationContribution', () => {

    function createContribution(models: string[], manager: RecordingManager): { contribution: TestOpenRouterContribution; errors: unknown[][] } {
        const errors: unknown[][] = [];
        const contribution = new TestOpenRouterContribution();
        Object.assign(contribution, {
            preferenceService: {
                get: (name: string, defaultValue: unknown) => name === MODELS_PREF ? models : defaultValue
            },
            aiCorePreferences: { get: () => 3 },
            manager,
            logger: { error: (...args: unknown[]) => { errors.push(args); } }
        });
        return { contribution, errors };
    }

    it('registers a model once when a preference lists it with and without the openrouter prefix', () => {
        const manager = new RecordingManager();
        const { contribution } = createContribution([], manager);

        expect(contribution.normalize(['openrouter/a/b:free', 'a/b:free', 'c:free'])).to.deep.equal(['a/b:free', 'c:free']);
    });

    it('issues one backend call per update, never overlapping the previous one', async () => {
        const manager = new RecordingManager();
        manager.delayMs = 5;
        const { contribution } = createContribution(['x:free', 'y:free'], manager);
        Object.assign(contribution, { prevModels: ['x:free', 'y:free'] });

        // Startup, an API key change and a preference change arrive back to back.
        contribution.updateAll();
        contribution.updateAll();
        contribution.changeModels(['x:free', 'y:free', 'z:free']);
        await flush();

        expect(manager.maxActive).to.equal(1);
        expect(manager.calls.map(call => call.kind)).to.deep.equal(['createOrUpdate', 'createOrUpdate', 'createOrUpdate']);
        expect(manager.calls[2]).to.deep.equal({ kind: 'createOrUpdate', ids: ['openrouter/z:free'] });
    });

    it('keeps the queue running after a failed backend call and logs it', async () => {
        const manager = new RecordingManager();
        manager.failNext = true;
        const { contribution, errors } = createContribution(['x:free'], manager);

        contribution.updateAll();
        contribution.updateAll();
        await flush();

        expect(errors).to.have.length(1);
        expect(manager.calls).to.deep.equal([{ kind: 'createOrUpdate', ids: ['openrouter/x:free'] }]);
    });
});
