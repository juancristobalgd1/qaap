// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { listStaticNativeAgentModels, parseNativeModelLines } from '../common/qaap-agent-native-model-catalog';
import {
    clearNativeAgentModelCache,
    discoverClaudeCliModels,
    discoverCodexAccountModels,
    invalidateNativeAgentModels,
    listNativeAgentModels,
    NATIVE_MODEL_CACHE_TTL_MS,
    type NativeModelDiscoverySpawner,
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

    it('rediscovers once the CLI signs in instead of keeping the signed-out fallback', async function (): Promise<void> {
        if (process.platform === 'win32') {
            this.skip();
        }
        // Signed out (here: not installed yet): the curated fallback answers.
        process.env.PATH = sandbox;
        expect(await prepareNativeAgentModels('cursor')).to.deep.equal(listStaticNativeAgentModels('cursor'));

        // The sign-in invalidates the agent's catalog, so the next request asks the CLI again.
        fs.writeFileSync(path.join(sandbox, 'cursor-agent'), '#!/bin/sh\necho auto\necho cursor-private-model\n', { mode: 0o755 });
        invalidateNativeAgentModels('cursor');
        const discovered = await prepareNativeAgentModels('cursor');
        expect(discovered.map(model => model.modelId)).to.deep.equal(['auto', 'cursor-private-model']);
    });

    describe('Codex account catalog (models_cache.json)', () => {
        const freeAccountCache = JSON.stringify({
            fetched_at: '2026-10-26T00:00:00Z',
            etag: 'W/"abc"',
            client_version: '0.144.5',
            models: [
                { slug: 'gpt-reserve', display_name: 'Reserve', visibility: 'hide' },
                { slug: 'gpt-6-luna', display_name: 'GPT-6-Luna', visibility: 'list' },
                { slug: 'gpt-5.6-terra', display_name: 'GPT-5.6 Terra', visibility: 'list' },
                { slug: 'gpt-5.6-luna', display_name: 'GPT-5.6 Luna', visibility: 'list' },
                { slug: 'codex-auto-review', display_name: 'Auto review', visibility: 'hide' },
            ],
        });

        it('keeps every visible Codex entry in the CLI order, including ids the static list does not know', () => {
            const models = parseCodexModelsCache(freeAccountCache);
            expect(models.map(model => model.modelId)).to.deep.equal(['gpt-6-luna', 'gpt-5.6-terra', 'gpt-5.6-luna']);
            expect(models[0]).to.deep.equal({ provider: 'openai', vendor: 'codex', modelId: 'gpt-6-luna', label: 'GPT-6-Luna' });
        });

        it('returns no entries when the account lists no visible model', () => {
            expect(parseCodexModelsCache(JSON.stringify({ models: [{ slug: 'gpt-reserve', visibility: 'hide' }] }))).to.deep.equal([]);
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
                expect(discovered.map(model => model.modelId)).to.deep.equal(['gpt-6-luna', 'gpt-5.6-terra', 'gpt-5.6-luna']);
                expect(listNativeAgentModels('codex').map(model => model.modelId)).to.deep.equal(['gpt-6-luna', 'gpt-5.6-terra', 'gpt-5.6-luna']);
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
            expect(models.map(model => model.modelId)).to.deep.equal(['gpt-6-luna', 'gpt-5.6-terra', 'gpt-5.6-luna']);
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
    it('parses the `pi --list-models` table into provider/model ids grouped by provider', () => {
        const table = [
            'provider    model                              context  max-out  thinking  images',
            'openrouter  ~anthropic/claude-sonnet-latest    1M       128K     yes       yes   ',
            '',
            'openrouter  aion-labs/aion-2.0                 131.1K   32.8K    yes       no    ',
            'anthropic   claude-opus-4-8                    1M       128K     yes       yes',
            'openrouter  ~anthropic/claude-sonnet-latest    1M       128K     yes       yes',
            'not a model row',
        ];
        const models = parseNativeModelLines('pi', table);
        expect(models.map(model => model.modelId)).to.deep.equal([
            'openrouter/~anthropic/claude-sonnet-latest',
            'openrouter/aion-labs/aion-2.0',
            'anthropic/claude-opus-4-8',
        ]);
        expect(models.map(model => model.label)).to.deep.equal([
            'anthropic/claude-sonnet-latest',
            'aion-labs/aion-2.0',
            'claude-opus-4-8',
        ]);
        expect(models.map(model => model.vendor)).to.deep.equal(['openrouter', 'openrouter', 'anthropic']);
    });

    describe('Pi account-scoped catalog', () => {
        const piTable = (provider: string, model: string): string =>
            `#!/bin/sh\necho "provider  model  context  max-out  thinking  images"\necho "${provider}  ${model}  200K  64K  yes  yes"\n`;

        it('never lists Pi from the backend HOME: without the owner spawner the curated catalog answers uncached', async function (): Promise<void> {
            if (process.platform === 'win32') {
                this.skip();
            }
            fs.writeFileSync(path.join(sandbox, 'pi'), piTable('anthropic', 'backend-home-model'), { mode: 0o755 });
            process.env.PATH = `${sandbox}${path.delimiter}${originalPath ?? ''}`;

            expect(listNativeAgentModels('pi', 'alice')).to.deep.equal(listStaticNativeAgentModels('pi'));
            expect(await prepareNativeAgentModels('pi', { ownerLogin: 'alice' })).to.deep.equal(listStaticNativeAgentModels('pi'));
        });

        it('lists Pi models where the owner signed in and keeps one catalog per owner', async function (): Promise<void> {
            if (process.platform === 'win32') {
                this.skip();
            }
            const aliceBin = path.join(sandbox, 'alice-pi');
            const bobBin = path.join(sandbox, 'bob-pi');
            fs.writeFileSync(aliceBin, piTable('anthropic', 'claude-opus-4-8'), { mode: 0o755 });
            fs.writeFileSync(bobBin, piTable('openai-codex', 'gpt-5.6-sol'), { mode: 0o755 });
            const spawned: Array<{ bin: string; args: readonly string[] }> = [];
            const spawnerFor = (file: string) => (bin: string, args: readonly string[]) => {
                spawned.push({ bin, args });
                return { file, args, cwd: sandbox };
            };

            const alice = await prepareNativeAgentModels('pi', { ownerLogin: 'alice', spawner: spawnerFor(aliceBin) });
            const bob = await prepareNativeAgentModels('pi', { ownerLogin: 'bob', spawner: spawnerFor(bobBin) });

            expect(alice.map(model => model.modelId)).to.deep.equal(['anthropic/claude-opus-4-8']);
            expect(bob.map(model => model.modelId)).to.deep.equal(['openai-codex/gpt-5.6-sol']);
            expect(listNativeAgentModels('pi', 'Alice').map(model => model.modelId)).to.deep.equal(['anthropic/claude-opus-4-8']);
            expect(spawned).to.deep.equal([{ bin: 'pi', args: ['--list-models'] }, { bin: 'pi', args: ['--list-models'] }]);
        });

        it('falls back to the curated catalog when the owner tenant cannot run the listing yet', async () => {
            const models = await prepareNativeAgentModels('pi', { ownerLogin: 'alice', spawner: () => undefined });
            expect(models).to.deep.equal(listStaticNativeAgentModels('pi'));
        });

        it('rediscovers every owner after invalidation without an owner, and one owner with it', async function (): Promise<void> {
            if (process.platform === 'win32') {
                this.skip();
            }
            const bin = path.join(sandbox, 'pi-owner');
            fs.writeFileSync(bin, piTable('anthropic', 'first-model'), { mode: 0o755 });
            const spawner = () => ({ file: bin, args: [] as string[] });
            await prepareNativeAgentModels('pi', { ownerLogin: 'alice', spawner });
            await prepareNativeAgentModels('pi', { ownerLogin: 'bob', spawner });

            fs.writeFileSync(bin, piTable('anthropic', 'second-model'), { mode: 0o755 });
            invalidateNativeAgentModels('pi', 'alice');
            expect((await prepareNativeAgentModels('pi', { ownerLogin: 'alice', spawner }))[0].modelId).to.equal('anthropic/second-model');
            expect(listNativeAgentModels('pi', 'bob')[0].modelId).to.equal('anthropic/first-model');

            invalidateNativeAgentModels('pi');
            expect(listNativeAgentModels('pi', 'bob')).to.deep.equal(listStaticNativeAgentModels('pi'));
        });
    });

    it('serves a stale live catalog at once and refreshes it once the TTL has passed', async function (): Promise<void> {
        if (process.platform === 'win32') {
            this.skip();
        }
        const realNow = Date.now;
        let now = realNow();
        Date.now = () => now;
        try {
            const bin = path.join(sandbox, 'cursor-agent');
            fs.writeFileSync(bin, '#!/bin/sh\necho auto\n', { mode: 0o755 });
            process.env.PATH = `${sandbox}${path.delimiter}${originalPath ?? ''}`;
            expect((await prepareNativeAgentModels('cursor')).map(model => model.modelId)).to.deep.equal(['auto']);

            fs.writeFileSync(bin, '#!/bin/sh\necho fresh-model\n', { mode: 0o755 });
            now += NATIVE_MODEL_CACHE_TTL_MS - 1;
            expect((await prepareNativeAgentModels('cursor')).map(model => model.modelId)).to.deep.equal(['auto']);

            // Stale: the request is answered from the cache immediately; the refresh runs behind it.
            now += 1;
            expect(listNativeAgentModels('cursor').map(model => model.modelId)).to.deep.equal(['auto']);
            await new Promise(resolve => setTimeout(resolve, 300));
            expect(listNativeAgentModels('cursor').map(model => model.modelId)).to.deep.equal(['fresh-model']);
        } finally {
            Date.now = realNow;
        }
    });

    it('never replaces a live catalog with a failed or empty refresh', async function (): Promise<void> {
        if (process.platform === 'win32') {
            this.skip();
        }
        const realNow = Date.now;
        let now = realNow();
        Date.now = () => now;
        try {
            const bin = path.join(sandbox, 'cursor-agent');
            fs.writeFileSync(bin, '#!/bin/sh\necho auto\necho cursor-private-model\n', { mode: 0o755 });
            process.env.PATH = `${sandbox}${path.delimiter}${originalPath ?? ''}`;
            expect((await prepareNativeAgentModels('cursor')).map(model => model.modelId)).to.deep.equal(['auto', 'cursor-private-model']);

            // The CLI now fails (signed out, crashed): the live list is kept, and retried after the fallback delay.
            fs.writeFileSync(bin, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
            now += NATIVE_MODEL_CACHE_TTL_MS;
            expect((await prepareNativeAgentModels('cursor')).map(model => model.modelId)).to.deep.equal(['auto', 'cursor-private-model']);
            expect(listNativeAgentModels('cursor').map(model => model.modelId)).to.deep.equal(['auto', 'cursor-private-model']);
        } finally {
            Date.now = realNow;
        }
    });

    it('shares one CLI discovery between concurrent requests for the same agent', async function (): Promise<void> {
        if (process.platform === 'win32') {
            this.skip();
        }
        fs.writeFileSync(path.join(sandbox, 'cursor-agent'), '#!/bin/sh\necho auto\n', { mode: 0o755 });
        process.env.PATH = `${sandbox}${path.delimiter}${originalPath ?? ''}`;
        const first = prepareNativeAgentModels('cursor');
        const second = prepareNativeAgentModels('cursor');
        expect(second).to.equal(first);
        expect((await first).map(model => model.modelId)).to.deep.equal(['auto']);
    });

    it('keeps a non-empty static Pi fallback with provider-qualified ids', () => {
        const models = listStaticNativeAgentModels('pi');
        expect(models.length).to.be.greaterThan(0);
        expect(models.every(model => model.modelId.startsWith('openrouter/') && model.vendor === 'openrouter')).to.equal(true);
    });

    describe('Antigravity catalog per resolved CLI', () => {
        const agyLabels = [
            'Gemini 3.8 Flash (High)', 'Gemini 3.8 Flash (Medium)', 'Gemini 3.8 Flash (Low)',
            'Claude Sonnet 4.6 (Thinking)', 'Claude Opus 4.6 (Thinking)', 'GPT-OSS 120B (Medium)',
        ];
        /** A spawner that refuses to run anything: discovery then answers "no list" without touching a CLI. */
        const noSpawn = (): undefined => undefined;

        it('lists the Gemini CLI model ids, never the agy labels, when gemini is resolved', () => {
            const ids = listNativeAgentModels('antigravity', undefined, 'gemini').map(model => model.modelId);
            expect(ids).to.deep.equal(['auto', 'gemini-3.1-pro-preview', 'gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-pro']);
            expect(ids.some(id => agyLabels.includes(id))).to.equal(false);
        });

        it('keeps the live agy list for an agy bin and keeps its cache apart from gemini', async () => {
            // agy's list is the discovered one; a refused run keeps the curated agy labels.
            expect((await prepareNativeAgentModels('antigravity', { antigravityBin: 'agy', spawner: noSpawn })).map(model => model.modelId))
                .to.deep.equal(agyLabels);
            expect(listNativeAgentModels('antigravity', undefined, 'agy').map(model => model.modelId)).to.deep.equal(agyLabels);
            // The gemini list is unaffected by the cached agy entry.
            expect(listNativeAgentModels('antigravity', undefined, 'gemini').map(model => model.modelId)).to.include('gemini-3.5-flash');
            expect(await prepareNativeAgentModels('antigravity', { antigravityBin: 'gemini', spawner: noSpawn }))
                .to.deep.equal(listStaticNativeAgentModels('antigravity', 'gemini'));
        });

        it('invalidates every Antigravity catalog when no bin is given, and only the named one otherwise', async () => {
            await prepareNativeAgentModels('antigravity', { antigravityBin: 'agy', spawner: noSpawn });
            await prepareNativeAgentModels('antigravity', { antigravityBin: 'agy', spawner: noSpawn });
            invalidateNativeAgentModels('antigravity', undefined, 'agy');
            // The agy entry is gone: a fresh discovery (refused here) answers the curated fallback again.
            expect((await prepareNativeAgentModels('antigravity', { antigravityBin: 'agy', spawner: noSpawn })).map(model => model.modelId))
                .to.deep.equal(agyLabels);
            invalidateNativeAgentModels('antigravity');
            expect(listNativeAgentModels('antigravity', undefined, 'gemini').map(model => model.modelId)).to.include('auto');
        });
    });

    describe('Claude catalog (initialize answer, bundle fallback)', () => {
        const fixture = path.join(__dirname, '..', '..', 'test-resources', 'agent-models', 'claude-initialize-response.json');
        const claudeSpawner = (file: string): NativeModelDiscoverySpawner => (bin, args) => ({
            file: bin === 'claude' ? file : bin,
            args: [...args],
        });
        let claudeBin: string;

        beforeEach(function (): void {
            if (process.platform === 'win32') {
                this.skip();
            }
            claudeBin = path.join(sandbox, 'claude');
            process.env.PATH = `${sandbox}${path.delimiter}${originalPath ?? ''}`;
        });

        it('lists the live models from the initialize answer, sending one control request and no user message', async function (): Promise<void> {
            const requestFile = path.join(sandbox, 'request.json');
            fs.writeFileSync(claudeBin, `#!/bin/sh\nread -r request\nprintf '%s' "$request" > '${requestFile}'\ncat '${fixture}'\nexec sleep 30\n`, { mode: 0o755 });

            const discovered = await prepareNativeAgentModels('claude', { spawner: claudeSpawner(claudeBin) });

            expect(discovered).to.have.length(14);
            expect(discovered[0]).to.deep.equal({ provider: 'anthropic', vendor: 'claude', modelId: 'default', label: 'Default (recommended)' });
            expect(listNativeAgentModels('claude').map(model => model.modelId)).to.include('fable');
            const request = JSON.parse(fs.readFileSync(requestFile, 'utf8')) as { type: string; request: { subtype: string } };
            expect(request.type).to.equal('control_request');
            expect(request.request.subtype).to.equal('initialize');
        });

        it('answers with nothing when the CLI stays silent past the timeout', async () => {
            fs.writeFileSync(claudeBin, '#!/bin/sh\nread -r request\nexec sleep 30\n', { mode: 0o755 });
            const startedAt = Date.now();
            expect(await discoverClaudeCliModels(claudeSpawner(claudeBin), 300)).to.deep.equal([]);
            expect(Date.now() - startedAt).to.be.lessThan(5000);
        });

        it('falls back to the newest non-dated ids of the CLI bundle when initialize is not answered', async () => {
            const bundleText = 'claude-fable-5-2 claude-opus-5-5 claude-opus-5-5-20251101 claude-sonnet-5-5 claude-haiku-4-5-20251001';
            fs.writeFileSync(claudeBin, `#!/bin/sh\n# ${bundleText}\nexit 0\n`, { mode: 0o755 });
            const models = await prepareNativeAgentModels('claude', { spawner: claudeSpawner(claudeBin) });
            expect(models.map(model => model.modelId)).to.deep.equal(['claude-fable-5-2', 'claude-opus-5-5', 'claude-sonnet-5-5']);
            expect(models.map(model => model.label)).to.deep.equal(['Fable 5.2', 'Opus 5.5', 'Sonnet 5.5']);
        });

        it('keeps the curated Claude catalog when the CLI answers with an error and its bundle lists no model', async () => {
            const errorAnswer = JSON.stringify({ type: 'control_response', response: { subtype: 'error', request_id: 'qaap-model-list', error: 'unsupported' } });
            fs.writeFileSync(claudeBin, `#!/bin/sh\nread -r request\necho '${errorAnswer}'\nexit 0\n`, { mode: 0o755 });
            expect(await prepareNativeAgentModels('claude', { spawner: claudeSpawner(claudeBin) })).to.deep.equal(listStaticNativeAgentModels('claude'));
        });
    });
});
