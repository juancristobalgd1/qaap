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
import {
    confirmPaidModelSend,
    hasConfirmedPaidSendForProject,
    resolveSendAgentModel,
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

    it('a seeded paid default is the effective send model, so the gate sees it and must confirm', async () => {
        const seededCwd = '/repo/seeded-paid';
        // Seeded by an older build, never chosen by the user: the send resolves to it.
        window.localStorage.setItem(
            `qaap.agentTasks.selectedAgentModel.${hashString(seededCwd)}.opencode`,
            JSON.stringify({ provider: 'openai', vendor: 'opencode', modelId: 'opencode/minimax-m3' }),
        );
        const effective = await resolveSendAgentModel('opencode', seededCwd);
        expect(effective.ok && effective.model?.modelId).to.equal('opencode/minimax-m3');
        expect(window.sessionStorage.getItem(`qaap.paidModelSendConfirmed.${hashString(seededCwd)}`)).to.be.null;
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
