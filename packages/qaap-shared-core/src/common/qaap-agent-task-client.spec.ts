// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { buildCreateAgentTaskBody, extractBackendAgentMention, hashString, isOpencodeAgent, isQaiqAgent, usesStructuredAgentTranscript, isStickyComposerAgentSelected, isTheiaCoderMention, stripNonCoderAgentMention, normalizeBackendAgentId, migrateLegacyBackendAgentId, mergeAgentTaskAgentOptions, mergeComposerAgentPickerOptions, listQaapComposerPickerAgents, migrateQaapProductAgentId, reconcileSelectedAgent, reconcileStickyComposerAgent, resolveAgentOptionId, resolveBackendAgentForTurn, resolveExplicitAgentForSubmit, resolveQaapAgentMentionToken, normalizeOpenCodeModelOptions, SHELL_AGENT_ID, THEIA_CODER_AGENT_ID } from './qaap-agent-task-client';
import { rememberQaapHostedRuntime } from './qaap-hosted-agent-auth-policy';
import {
    AGENT_MODELS_CACHE_TTL_MS,
    AGENT_TASK_LIST_ALL_TTL_MS,
    fetchAgentModelsForAgent,
    fetchAgentTaskListAll,
    invalidateAgentModelsCache,
    invalidateAgentTaskListAllCache,
} from './qaap-agent-task-client';
import { QAAP_HARNESS_DEFINITIONS } from './qaap-builtin-agents';
import { QAAP_DEFAULT_DISABLED_HARNESS_IDS } from './qaap-harness-preferences';

describe('qaap-agent-task-client', () => {
    afterEach(() => {
        rememberQaapHostedRuntime(false);
    });

    it('resolveQaapAgentMentionToken lowercases tokens', () => {
        expect(resolveQaapAgentMentionToken('QAIQ')).to.equal('qaiq');
    });

    it('normalizeBackendAgentId recognizes the registered coding agents', () => {
        expect(normalizeBackendAgentId('opencode')).to.equal('opencode');
        expect(normalizeBackendAgentId('pi')).to.equal('pi');
        expect(normalizeBackendAgentId('codex')).to.equal('codex');
        expect(normalizeBackendAgentId('claude')).to.equal('claude');
    });

    it('normalizeBackendAgentId no longer recognizes retired agents', () => {
        for (const id of ['qaiq', 'hermes', 'openclaw', 'cursor', 'cursor-agent', 'antigravity', 'gemini', 'copilot', 'qwen', 'kimi', 'openclaude', 'grok']) {
            expect(normalizeBackendAgentId(id), id).to.equal(undefined);
        }
    });

    it('extractBackendAgentMention prefers the last recognized @agent', () => {
        expect(extractBackendAgentMention('@codex hola @qaiq adiós')).to.equal('codex');
        expect(extractBackendAgentMention('@qaiq solo')).to.equal(undefined);
        expect(extractBackendAgentMention('@opencode revisa la app')).to.equal('opencode');
        expect(extractBackendAgentMention('@pi fix tests')).to.equal('pi');
    });

    it('normalizes OpenCode diagnostics to friendly fallback model names', () => {
        const models = normalizeOpenCodeModelOptions([
            { provider: 'openai', vendor: 'opencode', modelId: 'EROFS: read-only file system', label: 'EROFS: read-only file system' },
        ]);
        expect(models.map(model => model.label)).to.include('Big Pickle');
        expect(models.some(model => model.label.includes('EROFS'))).to.be.false;
    });

    it('keeps paid OpenCode models visible and locked when the backend returns nothing', () => {
        const models = normalizeOpenCodeModelOptions([]);
        const paid = models.filter(model => model.available === false);
        expect(paid).to.have.length(73);
        expect(paid.every(model => model.unavailableReason === 'not-connected')).to.be.true;
        expect(models.filter(model => model.available === undefined)).to.have.length(10);
    });

    it('canonicalizes known OpenCode model labels from a valid backend response', () => {
        const models = normalizeOpenCodeModelOptions([
            { provider: 'openai', vendor: 'opencode', modelId: 'opencode/big-pickle', label: 'opencode/big-pickle' },
        ]);
        expect(models).to.deep.equal([
            { provider: 'openai', vendor: 'opencode', modelId: 'opencode/big-pickle', label: 'Big Pickle' },
        ]);
    });

    it('migrateLegacyBackendAgentId preserves the OpenClaude agent id', () => {
        expect(migrateLegacyBackendAgentId('openclaude')).to.equal('openclaude');
        expect(migrateLegacyBackendAgentId('codex')).to.equal('codex');
    });

    it('migrateQaapProductAgentId drops retired Coder defaults so the default harness applies', () => {
        expect(migrateQaapProductAgentId('Coder')).to.equal(undefined);
        expect(migrateQaapProductAgentId('codex')).to.equal('codex');
        expect(migrateQaapProductAgentId('opencode')).to.equal('opencode');
    });

    it('mergeAgentTaskAgentOptions unions HTTP and WebSocket agent snapshots', () => {
        const merged = mergeAgentTaskAgentOptions(
            [{ id: 'codex', label: 'Codex', available: true }],
            [{ id: 'qaiq', label: 'QAIQ', available: true }],
        );
        expect(merged.map(agent => agent.id)).to.deep.equal(['codex', 'qaiq']);
    });

    it('mergeComposerAgentPickerOptions orders harnesses by label and never lists retired qaiq', () => {
        const agents = [
            { id: 'codex', label: 'Codex', available: true },
            { id: 'qaiq', label: 'QAIQ', available: true },
            { id: 'claude', label: 'Claude Code', available: true },
        ];
        const ids = mergeComposerAgentPickerOptions(agents).map(agent => agent.id);
        expect(ids).to.deep.equal(['claude', 'codex']);
    });

    it('mergeComposerAgentPickerOptions only lists agents the server detected as installed', () => {
        const agents = [
            { id: 'qaiq', label: 'QAIQ', available: true },
            { id: 'claude', label: 'Claude Code', available: false },
        ];
        const ids = mergeComposerAgentPickerOptions(agents).map(agent => agent.id);
        expect(ids).to.deep.equal([]);
    });

    it('listQaapComposerPickerAgents keeps enabled undetected harnesses for connection actions', () => {
        const agents = listQaapComposerPickerAgents([
            { id: 'qaiq', label: 'QAIQ', available: true },
            { id: 'codex', label: 'Codex', available: false },
        ]);
        const codex = agents.find(agent => agent.id === 'codex');
        expect(codex?.available).to.equal(false);
        expect(agents.find(agent => agent.id === 'qaiq')).to.equal(undefined);
    });

    it('listQaapComposerPickerAgents lists exactly claude, codex, opencode and pi by default', () => {
        const detected = ['qaiq', 'claude'].map(id => ({ id, label: id, available: true }));
        const agents = listQaapComposerPickerAgents(detected, [...QAAP_DEFAULT_DISABLED_HARNESS_IDS]);
        expect(agents.map(agent => agent.id).sort()).to.deep.equal(['claude', 'codex', 'opencode', 'pi']);
        expect(agents.map(agent => agent.id).sort()).to.deep.equal(QAAP_HARNESS_DEFINITIONS.map(harness => harness.id).sort());
        for (const id of ['codex', 'opencode', 'pi']) {
            expect(agents.find(agent => agent.id === id)?.available, id).to.equal(false);
        }
    });

    it('reconcileSelectedAgent falls back to the first available harness when the stored agent is retired', () => {
        const agents = ['qaiq', 'codex'].map(id => ({ id, label: id, available: true }));
        expect(reconcileSelectedAgent('kimi', agents, undefined, undefined)).to.equal('codex');
        expect(reconcileSelectedAgent('cursor', agents, 'hermes', undefined)).to.equal('codex');
        expect(reconcileSelectedAgent('qaiq', agents, 'qaiq', undefined)).to.equal('codex');
    });

    it('listQaapComposerPickerAgents honors harnesses disabled in AI Configuration', () => {
        const agents = listQaapComposerPickerAgents([
            { id: 'codex', label: 'Codex', available: true },
            { id: 'qaiq', label: 'QAIQ', available: true },
            { id: 'claude', label: 'Claude Code', available: true },
        ], ['codex', 'qaiq']);
        expect(agents.some(agent => agent.id === 'codex')).to.equal(false);
        expect(agents.some(agent => agent.id === 'qaiq')).to.equal(false);
        expect(agents.some(agent => agent.id === 'claude')).to.equal(true);
    });

    it('reconcileSelectedAgent uses the server default, else the first available harness', () => {
        const agents = [
            { id: 'opencode', label: 'OpenCode', available: true },
            { id: 'codex', label: 'Codex', available: true },
        ];
        expect(reconcileSelectedAgent(undefined, agents, 'opencode', undefined)).to.equal('opencode');
        expect(reconcileSelectedAgent(undefined, agents, undefined, undefined)).to.equal('codex');
        const unavailableFirst = [
            { id: 'claude', label: 'Claude Code', available: false },
            { id: 'pi', label: 'Pi', available: true },
        ];
        expect(reconcileSelectedAgent(undefined, unavailableFirst, undefined, undefined)).to.equal('pi');
    });

    it('reconcileSelectedAgent keeps a stored OpenCode pick when it is available', () => {
        const storage = new Map<string, string>();
        (global as unknown as { window: Window }).window = {
            localStorage: {
                getItem: (key: string) => storage.get(key) ?? null,
                setItem: (key: string, value: string) => { storage.set(key, value); },
                removeItem: (key: string) => { storage.delete(key); },
                clear: () => { storage.clear(); },
                key: () => null,
                length: 0,
            },
        } as unknown as Window;
        storage.set(`qaap.agentTasks.selectedAgent.${hashString('/repo')}`, 'opencode');
        const agents = [
            { id: 'qaiq', label: 'QAIQ', available: true },
            { id: 'opencode', label: 'OpenCode', available: true },
        ];
        expect(reconcileSelectedAgent(undefined, agents, 'codex', '/repo')).to.equal('opencode');
        expect(storage.get(`qaap.agentTasks.selectedAgent.${hashString('/repo')}`)).to.equal('opencode');
    });

    it('resolveExplicitAgentForSubmit prefers @mention over pinned chat agent', () => {
        expect(resolveExplicitAgentForSubmit('hola @codex', { pinnedChatAgentId: 'qaiq' })).to.equal('codex');
        expect(resolveExplicitAgentForSubmit('arregla tests', { pinnedChatAgentId: 'qaiq' })).to.equal('qaiq');
    });

    it('reconcileStickyComposerAgent defaults to the server default but honors an explicit VPS pick', () => {
        const agents = [
            { id: 'qaiq', label: 'QAIQ', available: true },
            { id: 'opencode', label: 'OpenCode', available: true },
            { id: 'codex', label: 'Codex', available: true },
        ];
        expect(reconcileStickyComposerAgent(THEIA_CODER_AGENT_ID, agents, 'codex', undefined, true))
            .to.equal('codex');
        expect(reconcileStickyComposerAgent('opencode', agents, 'codex', undefined, true))
            .to.equal('opencode');
        expect(reconcileStickyComposerAgent(undefined, agents, 'codex', undefined, false))
            .to.equal('codex');
    });

    it('isStickyComposerAgentSelected matches Coder case-insensitively', () => {
        expect(isStickyComposerAgentSelected(THEIA_CODER_AGENT_ID, 'coder', undefined)).to.equal(true);
        expect(isStickyComposerAgentSelected('qaiq', 'codex', undefined)).to.equal(false);
    });

    it('buildCreateAgentTaskBody uses command for shell agent and prompt for others', () => {
        expect(buildCreateAgentTaskBody('ls -la', SHELL_AGENT_ID, '/home'))
            .to.deep.equal({ command: 'ls -la', cwd: '/home' });
        expect(buildCreateAgentTaskBody('fix tests', 'codex', '/home'))
            .to.deep.equal({ prompt: 'fix tests', agent: 'codex', cwd: '/home' });
    });

    it('isQaiqAgent recognizes the QAIQ-family protocol agents', () => {
        expect(isQaiqAgent('qaiq')).to.be.true;
        expect(isQaiqAgent('openclaude')).to.be.true;
        expect(isQaiqAgent('QAIQ')).to.be.true;
        expect(isQaiqAgent('codex')).to.be.false;
        expect(isQaiqAgent(undefined)).to.be.false;
    });

    it('isOpencodeAgent only matches opencode; other agents stay on raw stdout', () => {
        expect(isOpencodeAgent('opencode')).to.be.true;
        expect(isOpencodeAgent('OpenCode')).to.be.true;
        expect(isOpencodeAgent('codex')).to.be.false;
        expect(isOpencodeAgent('claude')).to.be.false;
        expect(isOpencodeAgent('grok')).to.be.false;
        expect(usesStructuredAgentTranscript('opencode')).to.be.true;
        expect(usesStructuredAgentTranscript('qaiq')).to.be.true;
        expect(usesStructuredAgentTranscript('codex')).to.be.true;
        expect(usesStructuredAgentTranscript('claude')).to.be.true;
        expect(usesStructuredAgentTranscript('antigravity')).to.be.true;
        expect(usesStructuredAgentTranscript('grok')).to.be.false;
    });

    it('isTheiaCoderMention detects @coder prefix in message text', () => {
        expect(isTheiaCoderMention('@Coder fix this')).to.be.true;
        expect(isTheiaCoderMention('@coder')).to.be.true;
        expect(isTheiaCoderMention('please fix this @coder')).to.be.false;
        expect(isTheiaCoderMention('@qaiq do something')).to.be.false;
    });

    it('stripNonCoderAgentMention removes VPS mentions for chat-only Coder', () => {
        expect(stripNonCoderAgentMention('@codex fix tests')).to.equal('fix tests');
        expect(stripNonCoderAgentMention('@Coder keep me')).to.equal('@Coder keep me');
        expect(stripNonCoderAgentMention('plain prompt')).to.equal('plain prompt');
    });

    it('hashString produces stable non-negative base-36 output', () => {
        const a = hashString('hello');
        const b = hashString('hello');
        expect(a).to.equal(b);
        expect(a).to.match(/^[0-9a-z]+$/);
        expect(hashString('hello')).not.to.equal(hashString('world'));
    });

    it('resolveAgentOptionId matches by exact id and built-in alias', () => {
        const agents = [
            { id: 'qaiq', label: 'QAIQ', available: true },
            { id: 'my-custom', label: 'Custom', available: true },
        ];
        expect(resolveAgentOptionId('QAIQ', agents)).to.equal('qaiq');
        expect(resolveAgentOptionId('my-custom', agents)).to.equal('my-custom');
        expect(resolveAgentOptionId('codex', agents)).to.equal('codex');
        expect(resolveAgentOptionId(undefined, agents)).to.be.undefined;
    });

    it('resolveBackendAgentForTurn: @mention beats explicit, explicit beats stored', () => {
        const agents = [
            { id: 'qaiq', label: 'QAIQ', available: true },
            { id: 'codex', label: 'Codex', available: true },
        ];
        expect(resolveBackendAgentForTurn('@codex fix it', agents, { explicitAgentId: 'qaiq' }))
            .to.equal('codex');
        expect(resolveBackendAgentForTurn('fix it', agents, { explicitAgentId: 'codex' }))
            .to.equal('codex');
        expect(resolveBackendAgentForTurn('fix it', agents, { storedAgentId: 'qaiq' }))
            .to.equal('codex');
        expect(resolveBackendAgentForTurn('@qaiq fix it', agents, {})).to.equal('codex');
        expect(resolveBackendAgentForTurn('fix it', agents, { conversationAgentId: 'qaiq' })).to.equal('codex');
    });
});

describe('qaap-agent-task-client request caches', () => {
    let now: number;
    let realNow: () => number;
    let realFetch: typeof fetch;
    let requestUrls: string[];
    let respond: (call: number) => Response;

    beforeEach(() => {
        now = 1_000_000;
        realNow = Date.now;
        Date.now = () => now;
        realFetch = globalThis.fetch;
        requestUrls = [];
        respond = () => new Response(JSON.stringify({
            agents: [{ id: 'pi', label: 'Pi', available: true }],
            models: [{ provider: 'provider', vendor: 'vendor', modelId: 'model' }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            requestUrls.push(String(input));
            return respond(requestUrls.length - 1);
        }) as typeof fetch;
        invalidateAgentTaskListAllCache();
        invalidateAgentModelsCache();
    });

    afterEach(() => {
        Date.now = realNow;
        globalThis.fetch = realFetch;
        invalidateAgentTaskListAllCache();
        invalidateAgentModelsCache();
    });

    it('shares one agent task list request between concurrent calls', async () => {
        await Promise.all([1, 2, 3, 4, 5].map(() => fetchAgentTaskListAll()));
        expect(requestUrls).to.have.length(1);
    });

    it('serves the agent task list from cache within the TTL and refetches after it', async () => {
        await fetchAgentTaskListAll();
        now += AGENT_TASK_LIST_ALL_TTL_MS - 1;
        await fetchAgentTaskListAll();
        expect(requestUrls).to.have.length(1);

        now += 1;
        await fetchAgentTaskListAll();
        expect(requestUrls).to.have.length(2);
    });

    it('bypasses the cache on forceRefresh and asks the backend to refresh', async () => {
        await fetchAgentTaskListAll();
        await fetchAgentTaskListAll({ forceRefresh: true });
        expect(requestUrls).to.have.length(2);
        expect(requestUrls[1]).to.contain('/all?refresh=1');
    });

    it('does not cache a failed agent task list request', async () => {
        respond = call => call === 0
            ? new Response('', { status: 500, statusText: 'backend down' })
            : new Response(JSON.stringify({ agents: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        let failure: unknown;
        try {
            await fetchAgentTaskListAll();
        } catch (error) {
            failure = error;
        }
        expect(failure).to.be.instanceOf(Error);
        await fetchAgentTaskListAll();
        expect(requestUrls).to.have.length(2);
    });

    it('drops the cached agent task list on invalidation', async () => {
        await fetchAgentTaskListAll();
        invalidateAgentTaskListAllCache();
        await fetchAgentTaskListAll();
        expect(requestUrls).to.have.length(2);
    });

    it('shares one model catalog request per agent between concurrent calls', async () => {
        await Promise.all([fetchAgentModelsForAgent('cursor'), fetchAgentModelsForAgent('cursor'), fetchAgentModelsForAgent('cursor')]);
        expect(requestUrls).to.have.length(1);
        await fetchAgentModelsForAgent('gemini');
        expect(requestUrls).to.have.length(2);
    });

    it('reuses an agent model catalog within the TTL and refetches it after the TTL', async () => {
        await fetchAgentModelsForAgent('cursor');
        now += AGENT_MODELS_CACHE_TTL_MS - 1;
        await fetchAgentModelsForAgent('cursor');
        expect(requestUrls).to.have.length(1);

        now += 1;
        await fetchAgentModelsForAgent('cursor');
        expect(requestUrls).to.have.length(2);
    });

    it('does not cache a failed agent model request', async () => {
        respond = call => call === 0
            ? new Response('', { status: 404, statusText: 'not found' })
            : new Response(JSON.stringify({ models: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        let failure: unknown;
        try {
            await fetchAgentModelsForAgent('cursor');
        } catch (error) {
            failure = error;
        }
        expect(failure).to.be.instanceOf(Error);
        await fetchAgentModelsForAgent('cursor');
        expect(requestUrls).to.have.length(2);
    });

    it('never caches an empty agent task list, so the next call asks the backend again', async () => {
        respond = () => new Response(JSON.stringify({ agents: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        const first = await fetchAgentTaskListAll();
        const second = await fetchAgentTaskListAll();
        expect(first.agents).to.deep.equal([]);
        expect(second.agents).to.deep.equal([]);
        expect(requestUrls).to.have.length(2);
    });

    it('never caches an empty agent model catalog, so the next call asks again', async () => {
        respond = () => new Response(JSON.stringify({ models: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        await fetchAgentModelsForAgent('cursor');
        await fetchAgentModelsForAgent('cursor');
        expect(requestUrls).to.have.length(2);
    });

    it('drops only the invalidated agent model catalog', async () => {
        await fetchAgentModelsForAgent('cursor');
        await fetchAgentModelsForAgent('gemini');
        invalidateAgentModelsCache('cursor');
        await fetchAgentModelsForAgent('gemini');
        expect(requestUrls).to.have.length(2);
        await fetchAgentModelsForAgent('cursor');
        expect(requestUrls).to.have.length(3);
    });
});
