// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { listStaticNativeAgentModels } from '../common/qaap-agent-native-model-catalog';
import {
    clearNativeAgentModelCache,
    discoverCodexAccountModels,
    listNativeAgentModels,
    parseCodexModelsCache,
    prepareNativeAgentModels,
    resolveCodexAgentHome,
} from './qaap-agent-native-models';

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

        it('resolves the Codex home: CODEX_HOME, then the tenant agent storage home, then the agent HOME', () => {
            expect(resolveCodexAgentHome({ CODEX_HOME: '/custom/codex' })).to.equal('/custom/codex');
            expect(resolveCodexAgentHome({})).to.equal('/home/theia/.qaap/.qaap-agent-storage/home/.codex');
            expect(resolveCodexAgentHome({ QAAP_TENANT_AGENT_STORAGE_ROOT: '/data/agent-storage' }))
                .to.equal('/data/agent-storage/home/.codex');
            // Storage disabled: the agent HOME is used, `/home/qaap-agent` unless QAAP_AGENT_HOME says otherwise.
            expect(resolveCodexAgentHome({ QAAP_TENANT_AGENT_STORAGE_ROOT: 'off' })).to.equal(path.join('/home/qaap-agent', '.codex'));
            expect(resolveCodexAgentHome({ QAAP_TENANT_AGENT_STORAGE_ROOT: 'off', QAAP_AGENT_HOME: '/srv/agent' }))
                .to.equal(path.join('/srv/agent', '.codex'));
        });

        it('reads the cache as the configured agent uid/gid when the backend is root', async () => {
            const seen: { file: string; identity: unknown }[] = [];
            const reader = async (file: string, identity: unknown): Promise<string> => {
                seen.push({ file, identity });
                return freeAccountCache;
            };
            const env = { QAAP_TENANT_AGENT_STORAGE_ROOT: '/data/agent-storage', QAAP_AGENT_UID: '1001', QAAP_AGENT_GID: '1001' };
            const models = await discoverCodexAccountModels(env, true, reader);
            expect(models.map(model => model.modelId)).to.deep.equal(['gpt-5.6-terra', 'gpt-5.6-luna']);
            expect(seen).to.deep.equal([{
                file: path.join('/data/agent-storage/home/.codex', 'models_cache.json'),
                identity: { uid: 1001, gid: 1001 },
            }]);
        });

        it('reads the cache as the backend when it is not root, or no agent identity is configured', async () => {
            const identities: unknown[] = [];
            const reader = async (_file: string, identity: unknown): Promise<string> => {
                identities.push(identity);
                return freeAccountCache;
            };
            await discoverCodexAccountModels({ QAAP_AGENT_UID: '1001' }, false, reader);
            await discoverCodexAccountModels({}, true, reader);
            // uid 0 is never used as the agent identity.
            await discoverCodexAccountModels({ QAAP_AGENT_UID: '0' }, true, reader);
            expect(identities).to.deep.equal([undefined, undefined, undefined]);
        });

        it('falls back to the curated list when the cache cannot be read', async () => {
            const failing = async (): Promise<string> => {
                throw new Error('EACCES: permission denied');
            };
            expect(await discoverCodexAccountModels({}, true, failing)).to.deep.equal([]);
        });
    });
});
