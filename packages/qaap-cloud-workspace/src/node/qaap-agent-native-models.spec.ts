// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { listStaticNativeAgentModels } from '../common/qaap-agent-native-model-catalog';
import { clearNativeAgentModelCache, listNativeAgentModels, parseCodexModelsCache, prepareNativeAgentModels } from './qaap-agent-native-models';

describe('qaap-agent-native-models', () => {
    let sandbox: string;
    let originalPath: string | undefined;

    beforeEach(() => {
        clearNativeAgentModelCache();
        sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-native-models-'));
        originalPath = process.env.PATH;
    });

    afterEach(() => {
        process.env.PATH = originalPath;
        clearNativeAgentModelCache();
        fs.rmSync(sandbox, { recursive: true, force: true });
    });

    it('answers a cold catalog without waiting for a slow CLI, then caches the discovered list', async function (): Promise<void> {
        if (process.platform === 'win32') {
            this.skip();
        }
        // A CLI that takes far longer than any request may block the event loop.
        fs.writeFileSync(path.join(sandbox, 'cursor-agent'), '#!/bin/sh\nsleep 1\necho auto\necho cursor-private-model\n', { mode: 0o755 });
        process.env.PATH = `${sandbox}${path.delimiter}${originalPath ?? ''}`;

        const startedAt = Date.now();
        const cold = listNativeAgentModels('cursor');
        expect(Date.now() - startedAt).to.be.lessThan(500);
        expect(cold).to.deep.equal(listStaticNativeAgentModels('cursor'));

        const discovered = await prepareNativeAgentModels('cursor');
        expect(discovered.map(model => model.modelId)).to.deep.equal(['auto', 'cursor-private-model']);
        expect(listNativeAgentModels('cursor').map(model => model.modelId)).to.deep.equal(['auto', 'cursor-private-model']);
    });

    it('falls back to the curated catalog when the CLI is missing', async () => {
        process.env.PATH = sandbox;
        expect(await prepareNativeAgentModels('cursor')).to.deep.equal(listStaticNativeAgentModels('cursor'));
    });

    describe('Codex account catalog (models_cache.json)', () => {
        const freeAccountCache = JSON.stringify({
            fetched_at: '2026-10-26T00:00:00Z',
            etag: 'W/"abc"',
            client_version: '0.144.5',
            models: [
                { slug: 'gpt-reserve', display_name: 'Reserve', visibility: 'list' },
                { slug: 'gpt-5.6-terra', display_name: 'GPT-5.6 Terra', visibility: 'list' },
                { slug: 'gpt-5.6-luna', display_name: 'GPT-5.6 Luna', visibility: 'list' },
                { slug: 'codex-auto-review', display_name: 'Auto review', visibility: 'hide' },
            ],
        });

        it('keeps only the curated Codex entries the account lists, in curated order', () => {
            const models = parseCodexModelsCache(freeAccountCache);
            expect(models.map(model => model.modelId)).to.deep.equal(['gpt-5.6-terra', 'gpt-5.6-luna']);
            expect(models).to.deep.equal(listStaticNativeAgentModels('codex').filter(model => model.modelId !== 'gpt-5.6-sol' && model.modelId !== 'gpt-5.5'));
        });

        it('returns no entries when the account lists none of the curated models', () => {
            expect(parseCodexModelsCache(JSON.stringify({ models: [{ slug: 'gpt-reserve' }] }))).to.deep.equal([]);
        });

        it('returns no entries for a garbage, empty or differently shaped cache', () => {
            expect(parseCodexModelsCache('<html>not json</html>')).to.deep.equal([]);
            expect(parseCodexModelsCache('')).to.deep.equal([]);
            expect(parseCodexModelsCache(undefined)).to.deep.equal([]);
            expect(parseCodexModelsCache('null')).to.deep.equal([]);
            expect(parseCodexModelsCache(JSON.stringify({ models: 'gpt-5.6-sol' }))).to.deep.equal([]);
        });

        it('reads the cache from the Codex home and falls back to the full curated list when the cache is missing', async () => {
            const codexHome = path.join(sandbox, 'codex-home');
            fs.mkdirSync(codexHome);
            const originalCodexHome = process.env.CODEX_HOME;
            process.env.CODEX_HOME = codexHome;
            try {
                // Cache missing: discovery yields nothing, the picker keeps the full curated list.
                expect(await prepareNativeAgentModels('codex')).to.deep.equal(listStaticNativeAgentModels('codex'));
                clearNativeAgentModelCache();
                fs.writeFileSync(path.join(codexHome, 'models_cache.json'), freeAccountCache);
                const discovered = await prepareNativeAgentModels('codex');
                expect(discovered.map(model => model.modelId)).to.deep.equal(['gpt-5.6-terra', 'gpt-5.6-luna']);
                expect(listNativeAgentModels('codex').map(model => model.modelId)).to.deep.equal(['gpt-5.6-terra', 'gpt-5.6-luna']);
            } finally {
                if (originalCodexHome === undefined) {
                    delete process.env.CODEX_HOME;
                } else {
                    process.env.CODEX_HOME = originalCodexHome;
                }
            }
        });
    });
});
