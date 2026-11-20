// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { hashString } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import { writeStoredAgentModel } from '@theia/qaap-shared-core/lib/common/qaap-agent-model-selection';
import { readStoredAgentModelSelection } from '@theia/qaap-shared-core/lib/common/qaap-agent-model-selection';
import {
    confirmPaidModelSend,
    hasConfirmedPaidSendForProject,
    prewarmSendCatalog,
    resolveSendAgentModel,
    sendModelBelongsToAgent,
    warnBlockedSend,
    warnChooseSendModel,
} from './qaap-paid-model-send-confirm';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

/**
 * The paid-send gate lets free models and already-confirmed projects through without asking; the
 * confirmation itself is remembered per project in sessionStorage.
 */
describe('paid model send confirmation', () => {

    useSuiteJSDOM();

    const cwd = '/repo/paid-send';
    const freeModel = { provider: 'openai' as const, vendor: 'openrouter', modelId: 'google/gemma-4-31b-it:free' };
    const paidModel = { provider: 'openai' as const, vendor: 'openrouter', modelId: 'openai/gpt-5' };

    const beamFree = { provider: 'openai' as const, vendor: 'opencode', modelId: 'opencode/beam-free', label: 'Beam Free' };
    const openCodePaid = { provider: 'openai' as const, vendor: 'opencode', modelId: 'opencode/minimax-m3', label: 'MiniMax-M3' };

    beforeEach(() => {
        window.sessionStorage.clear();
        window.localStorage.clear();
    });

    it('lets free models and a missing model through without a dialog', async () => {
        expect(await confirmPaidModelSend(cwd, freeModel)).to.be.true;
        expect(await confirmPaidModelSend(cwd, undefined)).to.be.true;
        // OpenCode "Beam Free" is free by its catalog metadata, not by a `:free` suffix.
        expect(await confirmPaidModelSend(cwd, beamFree)).to.be.true;
    });

    it('a send carries the explicit pick first, then the stored selection', async () => {
        const storedCwd = '/repo/send-stored';
        const explicit = await resolveSendAgentModel('opencode', storedCwd, openCodePaid, [openCodePaid]);
        expect(explicit).to.deep.equal({ ok: true, model: openCodePaid });
        writeStoredAgentModel(storedCwd, 'opencode', beamFree);
        const stored = await resolveSendAgentModel('opencode', storedCwd, undefined, [beamFree]);
        expect(stored.ok && stored.model?.modelId).to.equal('opencode/beam-free');
    });

    it('fails closed when a picker agent has only paid models: no send without a chosen model', async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () => ({
            ok: true,
            json: async () => ({ models: [{ provider: 'openai', vendor: 'grok', modelId: 'grok-paid', label: 'Grok Paid' }] }),
        })) as unknown as typeof fetch;
        try {
            expect(await resolveSendAgentModel('grok', '/repo/paid-only-send')).to.deep.equal({ ok: false });
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it('fails closed when the catalog lookup exceeds the send timeout', async function (): Promise<void> {
        this.timeout(5000);
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (() => new Promise(() => undefined)) as unknown as typeof fetch;
        try {
            const started = Date.now();
            expect(await resolveSendAgentModel('hermes', '/repo/hung-catalog')).to.deep.equal({ ok: false });
            expect(Date.now() - started).to.be.lessThan(4000);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it('blocks a stored pick that the live catalog no longer lists', async () => {
        const staleCwd = '/repo/stale-pick';
        writeStoredAgentModel(staleCwd, 'opencode', beamFree);
        expect(await resolveSendAgentModel('opencode', staleCwd, undefined, [openCodePaid])).to.deep.equal({ ok: false });
    });

    it('blocks a stored pick the catalog lists as locked until sign-in, and keeps the stored model', async () => {
        const lockedCwd = '/repo/locked-stored';
        const lockedPro = { provider: 'openai' as const, vendor: 'codex', modelId: 'gpt-5.5', label: 'GPT-5.5' };
        writeStoredAgentModel(lockedCwd, 'codex', lockedPro);
        const catalog = [{ ...lockedPro, available: false, unavailableReason: 'not-connected' as const, tier: 'pro' as const }];
        expect(await resolveSendAgentModel('codex', lockedCwd, undefined, catalog)).to.deep.equal({
            ok: false,
            reason: 'sign-in-required',
            modelLabel: 'GPT-5.5',
        });
        expect(readStoredAgentModelSelection(lockedCwd, 'codex')?.model.modelId).to.equal('gpt-5.5');
    });

    it('blocks an explicit pick that the cached catalog lists as locked, without switching models', async () => {
        const lockedCwd = '/repo/locked-explicit';
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () => ({
            ok: true,
            json: async () => ({ models: [{ provider: 'openai', vendor: 'codex', modelId: 'codex/locked-pro', label: 'Codex Pro', available: false, unavailableReason: 'not-connected' }] }),
        })) as unknown as typeof fetch;
        try {
            await prewarmSendCatalog('codex');
            const explicit = { provider: 'openai' as const, vendor: 'codex', modelId: 'codex/locked-pro' };
            expect(await resolveSendAgentModel('codex', lockedCwd, explicit)).to.deep.equal({
                ok: false,
                reason: 'sign-in-required',
                modelLabel: 'Codex Pro',
            });
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    describe('a chosen model with a cold send catalog (e.g. right after a reload)', () => {
        let originalFetch: typeof fetch;
        let requests: string[];

        function serveCatalog(models: unknown[] | 'hang'): void {
            globalThis.fetch = ((input: RequestInfo | URL) => {
                requests.push(String(input));
                return models === 'hang'
                    ? new Promise(() => undefined)
                    : Promise.resolve({ ok: true, json: async () => ({ models }) });
            }) as unknown as typeof fetch;
        }

        beforeEach(() => {
            originalFetch = globalThis.fetch;
            requests = [];
        });

        afterEach(() => {
            globalThis.fetch = originalFetch;
        });

        it('fetches the catalog before deciding and blocks an explicit Pro pick it lists as locked', async () => {
            serveCatalog([{ provider: 'openai', vendor: 'cursor', modelId: 'cursor/pro', label: 'Cursor Pro', available: false, unavailableReason: 'not-connected' }]);
            const explicit = { provider: 'openai' as const, vendor: 'cursor', modelId: 'cursor/pro' };
            expect(await resolveSendAgentModel('cursor', '/repo/cold-explicit', explicit)).to.deep.equal({
                ok: false,
                reason: 'sign-in-required',
                modelLabel: 'Cursor Pro',
            });
            expect(requests.some(url => url.includes('agent=cursor'))).to.equal(true);
        });

        it('fetches the catalog before deciding and blocks a stored Pro pick it lists as locked, keeping the pick', async () => {
            const storedCwd = '/repo/cold-stored';
            const storedPro = { provider: 'openai' as const, vendor: 'gemini', modelId: 'gemini/pro', label: 'Gemini Pro' };
            writeStoredAgentModel(storedCwd, 'gemini', storedPro);
            serveCatalog([{ ...storedPro, available: false, unavailableReason: 'not-connected', tier: 'pro' }]);
            expect(await resolveSendAgentModel('gemini', storedCwd)).to.deep.equal({ ok: false, reason: 'sign-in-required', modelLabel: 'Gemini Pro' });
            expect(readStoredAgentModelSelection(storedCwd, 'gemini')?.model.modelId).to.equal('gemini/pro');
        });

        it('holds a Pro pick fail-closed when the catalog does not arrive in time, and lets a Free pick go', async function (): Promise<void> {
            this.timeout(10_000);
            serveCatalog('hang');
            const pro = { provider: 'openai' as const, vendor: 'pi', modelId: 'pi/pro-model' };
            expect(await resolveSendAgentModel('pi', '/repo/cold-hung', pro)).to.deep.equal({
                ok: false,
                reason: 'availability-unknown',
                modelLabel: 'pi/pro-model',
            });
            const free = await resolveSendAgentModel('opencode', '/repo/cold-hung-free', beamFree);
            expect(free).to.deep.equal({ ok: true, model: beamFree });
        });

        it('says why a send was held, visibly, for each reason', () => {
            const shown = (): string => Array.from(document.querySelectorAll('.theia-mobile-snackbar-message')).map(node => node.textContent).join('\n');
            warnBlockedSend({ ok: false, reason: 'sign-in-required', modelLabel: 'MiniMax-M3' }, 'OpenCode');
            expect(shown()).to.contain('Sign in to OpenCode to use MiniMax-M3.');
            // Announced to assistive technology, not only drawn.
            expect(document.querySelector('[role="status"][aria-live="polite"]')).to.not.equal(null);
            warnBlockedSend({ ok: false, reason: 'availability-unknown', modelLabel: 'MiniMax-M3' }, 'OpenCode');
            expect(shown()).to.contain("Couldn't check whether OpenCode can use MiniMax-M3. Try again.");
        });
    });

    it('a seeded paid default is the effective send model, so the gate sees it and must confirm', async () => {
        const seededCwd = '/repo/seeded-paid';
        // Seeded by an older build, never chosen by the user: the send resolves to it.
        window.localStorage.setItem(
            `qaap.agentTasks.selectedAgentModel.${hashString(seededCwd)}.opencode`,
            JSON.stringify({ provider: 'openai', vendor: 'opencode', modelId: 'opencode/minimax-m3' }),
        );
        // The live catalog lists it unlocked (signed in): only then may a paid pick go out.
        const effective = await resolveSendAgentModel('opencode', seededCwd, undefined, [
            { provider: 'openai', vendor: 'opencode', modelId: 'opencode/minimax-m3', label: 'MiniMax-M3', available: true },
        ]);
        expect(effective.ok && effective.model?.modelId).to.equal('opencode/minimax-m3');
        expect(window.sessionStorage.getItem(`qaap.paidModelSendConfirmed.${hashString(seededCwd)}`)).to.be.null;
    });

    it('a cold first send with a slow catalog uses the static free default, stored as an auto default', async function (): Promise<void> {
        this.timeout(5000);
        const coldCwd = '/repo/cold-first-send';
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (() => new Promise(() => undefined)) as unknown as typeof fetch;
        try {
            const resolved = await resolveSendAgentModel('opencode', coldCwd);
            expect(resolved.ok && resolved.model?.modelId).to.equal('opencode/beam-free');
            expect(readStoredAgentModelSelection(coldCwd, 'opencode')?.userChosen).to.be.false;
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it('a catalog that loaded with only paid models blocks even when a static default exists', async () => {
        const paidOnly = [openCodePaid, { provider: 'openai' as const, vendor: 'opencode', modelId: 'opencode/gpt-5', label: 'GPT-5' }];
        expect(await resolveSendAgentModel('opencode', '/repo/loaded-paid-only', undefined, paidOnly)).to.deep.equal({ ok: false });
    });

    it('prewarming the send catalog caches it, so a later send does not need the network', async () => {
        const warmCwd = '/repo/prewarm';
        const originalFetch = globalThis.fetch;
        let calls = 0;
        globalThis.fetch = (async () => {
            calls++;
            return { ok: true, json: async () => ({ models: [{ provider: 'openai', vendor: 'qwen', modelId: 'google/gemma-4-31b-it:free', label: 'Gemma' }] }) };
        }) as unknown as typeof fetch;
        try {
            await prewarmSendCatalog('qwen');
            globalThis.fetch = (() => { throw new Error('offline'); }) as unknown as typeof fetch;
            const resolved = await resolveSendAgentModel('qwen', warmCwd);
            expect(resolved.ok && resolved.model?.modelId).to.equal('google/gemma-4-31b-it:free');
            expect(calls).to.equal(1);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it('a model resolved for another harness does not belong to the routed agent', () => {
        const cohere = { provider: 'openai' as const, vendor: 'openrouter', modelId: 'openrouter/cohere/north-mini-code:free' };
        expect(sendModelBelongsToAgent('pi', cohere, 'pi')).to.be.true;
        expect(sendModelBelongsToAgent('@Pi', cohere, 'pi')).to.be.true;
        expect(sendModelBelongsToAgent('opencode', cohere, 'pi')).to.be.false;
        expect(sendModelBelongsToAgent('pi', beamFree, 'opencode')).to.be.false;
        // Nothing to check without a model, or for an agent that takes no model.
        expect(sendModelBelongsToAgent('pi', undefined, 'opencode')).to.be.true;
        expect(sendModelBelongsToAgent('shell', cohere, 'pi')).to.be.true;
    });

    it('a model the agent\'s loaded catalog does not list does not belong to it', async () => {
        const nativeModel = { provider: 'openai' as const, vendor: 'openclaude', modelId: 'openclaude/coder-mini:free', label: 'Coder Mini' };
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () => ({ ok: true, json: async () => ({ models: [nativeModel] }) })) as unknown as typeof fetch;
        try {
            await prewarmSendCatalog('openclaude');
        } finally {
            globalThis.fetch = originalFetch;
        }
        expect(sendModelBelongsToAgent('openclaude', nativeModel)).to.be.true;
        expect(sendModelBelongsToAgent('openclaude', { provider: 'openai', vendor: 'openrouter', modelId: 'openrouter/cohere/north-mini-code:free' })).to.be.false;
    });

    it('warns and opens the model picker when a send is held for a model choice', () => {
        let opened = 0;
        warnChooseSendModel('OpenCode', () => { opened++; });
        expect(opened).to.equal(1);
    });

    it('passes a paid model through once this project was confirmed in this session', async () => {
        expect(hasConfirmedPaidSendForProject(cwd)).to.be.false;
        window.sessionStorage.setItem(`qaap.paidModelSendConfirmed.${hashString(cwd)}`, 'true');
        expect(hasConfirmedPaidSendForProject(cwd)).to.be.true;
        expect(await confirmPaidModelSend(cwd, paidModel)).to.be.true;
        // Confirmation is per project: another project is still asked.
        expect(hasConfirmedPaidSendForProject('/repo/other')).to.be.false;
    });
});
