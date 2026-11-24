// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { renderStickyComposerModelPicker } from './mobile-projects-sticky-composer-model-picker-ui';
import type { ComposerAgentPickerChrome } from './mobile-projects-sticky-composer-sheets-ui';

describe('mobile-projects-sticky-composer-model-picker-ui', () => {
    let disableJSDOM: () => void;
    let chrome: ComposerAgentPickerChrome;

    beforeEach(() => {
        disableJSDOM = enableJSDOM();
        const sheet = document.createElement('div');
        document.body.append(sheet);
        const searchInput = document.createElement('input');
        const search = document.createElement('div');
        search.append(searchInput);
        chrome = {
            sheet,
            header: document.createElement('header'),
            title: document.createElement('h2'),
            backBtn: document.createElement('button'),
            intro: document.createElement('p'),
            searchInput,
            list: document.createElement('div'),
            modelsByAgent: new Map(),
            modelLoadFailedByAgent: new Map(),
            onClose: () => undefined,
            popoverCleanup: undefined,
        } as unknown as ComposerAgentPickerChrome;
        sheet.append(search, chrome.list);
    });

    afterEach(() => {
        chrome.sheet.remove();
        disableJSDOM();
    });

    it('paints the unified model picker into the agent sheet, not the old agent list', async () => {
        const ctx = {
            resolveModelsForAgentPickerSafe: async () => ({
                models: [{ provider: 'anthropic' as const, vendor: 'anthropic', modelId: 'opus-4-6', label: 'Opus 4.6' }],
                loadFailed: false,
            }),
        };
        await renderStickyComposerModelPicker(ctx, chrome, {
            cwd: undefined,
            agents: [{ id: 'claude', label: 'Claude Code', available: true }],
            selectedAgentId: 'claude',
            project: undefined,
            isMobile: false,
            onSelectAgent: () => undefined,
            approval: 'approve-for-me',
            onSelectApproval: () => undefined,
            onRefresh: () => undefined,
        });
        expect(chrome.list.querySelector('.qaap-model-picker')).to.not.equal(null);
        expect(chrome.list.querySelectorAll('.qaap-model-picker-row')).to.have.length(1);
        expect(chrome.header.style.display).to.equal('none');
        expect(chrome.sheet.classList.contains('theia-mod-model-picker')).to.equal(true);
    });

    it('names each Pi row by its provider (catalog name, raw vendor id when the catalog does not know it)', async () => {
        const ctx = {
            resolveModelsForAgentPickerSafe: async (agentId: string) => ({
                models: agentId === 'pi'
                    ? [
                        { provider: 'openai' as const, vendor: 'groq', modelId: 'groq/llama-3.1-8b-instant', label: 'llama-3.1-8b-instant' },
                        { provider: 'openai' as const, vendor: 'nvidia', modelId: 'nvidia/llama-3.1-70b', label: 'llama-3.1-70b' },
                        { provider: 'openai' as const, vendor: 'acme-unknown', modelId: 'acme-unknown/x', label: 'x' },
                    ]
                    : [{ provider: 'anthropic' as const, vendor: 'anthropic', modelId: 'opus-4-6', label: 'Opus 4.6' }],
                loadFailed: false,
            }),
        };
        await renderStickyComposerModelPicker(ctx, chrome, {
            cwd: undefined,
            agents: [{ id: 'pi', label: 'Pi', available: true }, { id: 'claude', label: 'Claude Code', available: true }],
            selectedAgentId: 'pi',
            project: undefined,
            isMobile: false,
            onSelectAgent: () => undefined,
            approval: 'approve-for-me',
            onSelectApproval: () => undefined,
            onRefresh: () => undefined,
        });
        const providers = Array.from(chrome.list.querySelectorAll('.qaap-model-picker-row-provider')).map(element => element.textContent);
        expect(providers).to.deep.equal(['Groq', 'NVIDIA', 'acme-unknown']);
    });

    describe('connect another provider (Pi rail)', () => {
        const piAgents = [{ id: 'pi', label: 'Pi', available: true }];
        const piOptions = {
            cwd: undefined,
            agents: piAgents,
            selectedAgentId: 'pi',
            project: undefined,
            isMobile: true,
            onSelectAgent: () => undefined,
            approval: 'approve-for-me' as const,
            onSelectApproval: () => undefined,
            onRefresh: () => undefined,
        };
        const ctx = { resolveModelsForAgentPickerSafe: async () => ({ models: [], loadFailed: false }) };

        it('shows the action on the Pi rail when Pi is not reported signed out, and runs the Pi sign-in on click', async () => {
            const logins: string[] = [];
            await renderStickyComposerModelPicker(ctx, chrome, {
                ...piOptions,
                onProactiveLogin: agentId => logins.push(agentId),
                isAgentNotSignedOut: agentId => agentId === 'pi',
            });
            const action = chrome.list.querySelector<HTMLButtonElement>('.qaap-model-picker-connect-another');
            expect(action?.textContent).to.equal('Connect another provider');
            action?.click();
            expect(logins).to.deep.equal(['pi']);
        });

        it('hides the action when Pi reads signed out, when no sign-in is wired, or when the option is absent', async () => {
            await renderStickyComposerModelPicker(ctx, chrome, {
                ...piOptions,
                onProactiveLogin: () => undefined,
                isAgentNotSignedOut: () => false,
            });
            expect(chrome.list.querySelector('.qaap-model-picker-connect-another')).to.equal(null);

            await renderStickyComposerModelPicker(ctx, chrome, {
                ...piOptions,
                isAgentNotSignedOut: () => true,
            });
            expect(chrome.list.querySelector('.qaap-model-picker-connect-another')).to.equal(null);

            await renderStickyComposerModelPicker(ctx, chrome, {
                ...piOptions,
                onProactiveLogin: () => undefined,
            });
            expect(chrome.list.querySelector('.qaap-model-picker-connect-another')).to.equal(null);
        });
    });

    it('has no Sign in button: picking a signed-out model opens the sign-in, then selects that model', async () => {
        const opus = { provider: 'anthropic' as const, vendor: 'claude', modelId: 'opus', label: 'Opus', available: false, unavailableReason: 'not-connected' as const, tier: 'pro' as const };
        const ctx = { resolveModelsForAgentPickerSafe: async () => ({ models: [opus], loadFailed: false }) };
        const signedIn: string[] = [];
        const selected: string[] = [];
        await renderStickyComposerModelPicker(ctx, chrome, {
            cwd: undefined,
            agents: [{ id: 'claude', label: 'Claude Code', available: false, connectionState: 'disconnected', session: 'signed-out' }],
            selectedAgentId: 'claude',
            project: undefined,
            isMobile: false,
            onSelectAgent: (agentId, model) => { selected.push(`${agentId}:${model?.modelId}`); },
            approval: 'approve-for-me',
            onSelectApproval: () => undefined,
            onRefresh: () => undefined,
            onProactiveLogin: agentId => { signedIn.push(agentId); },
        });
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(chrome.list.querySelector('.qaap-model-picker-connect-action'), 'no Sign in button').to.equal(null);
        const row = chrome.list.querySelector<HTMLButtonElement>('.qaap-model-picker-row');
        expect(row?.getAttribute('aria-disabled'), 'looks like any other row').to.equal('false');
        expect(row?.classList.contains('theia-mod-disabled')).to.equal(false);
        row?.click();
        expect(signedIn).to.deep.equal(['claude']);
        expect(selected, 'not selected before the sign-in is confirmed').to.deep.equal([]);
        window.dispatchEvent(new window.CustomEvent('qaap-agent-signed-in', { detail: { agentId: 'codex' } }));
        expect(selected, 'another harness signing in does not select it').to.deep.equal([]);
        window.dispatchEvent(new window.CustomEvent('qaap-agent-signed-in', { detail: { agentId: 'claude' } }));
        expect(selected).to.deep.equal(['claude:opus']);
        window.dispatchEvent(new window.CustomEvent('qaap-agent-signed-in', { detail: { agentId: 'claude' } }));
        expect(selected, 'selected once').to.deep.equal(['claude:opus']);
    });

    it('offers no Sign in while the session is still checking (probe running) or not reported', async () => {
        const ctx = { resolveModelsForAgentPickerSafe: async () => ({ models: [], loadFailed: false }) };
        for (const session of ['checking', undefined] as const) {
            await renderStickyComposerModelPicker(ctx, chrome, {
                cwd: undefined,
                agents: [{ id: 'copilot', label: 'Copilot CLI', available: true, connectionState: 'unknown', accessState: 'unknown', session }],
                selectedAgentId: 'copilot',
                project: undefined,
                isMobile: false,
                onSelectAgent: () => undefined,
                approval: 'approve-for-me',
                onSelectApproval: () => undefined,
                onRefresh: () => undefined,
                onProactiveLogin: () => undefined,
            });
            expect(chrome.list.querySelector('.qaap-model-picker-connect-action'), String(session)).to.equal(null);
        }
    });

    it('selecting a model of another harness hands that harness and model to the caller', async () => {
        const ctx = {
            resolveModelsForAgentPickerSafe: async (agentId: string) => ({
                models: agentId === 'codex'
                    ? [{ provider: 'openai' as const, vendor: 'openai', modelId: 'gpt-5-6-sol', label: 'GPT-5.6 Sol' }]
                    : [],
                loadFailed: false,
            }),
        };
        const picked: Array<{ agentId: string; modelId?: string }> = [];
        await renderStickyComposerModelPicker(ctx, chrome, {
            cwd: undefined,
            agents: [{ id: 'claude', label: 'Claude Code', available: true }, { id: 'codex', label: 'Codex', available: true }],
            selectedAgentId: 'claude',
            project: undefined,
            isMobile: false,
            onSelectAgent: (agentId, model) => { picked.push({ agentId, modelId: model?.modelId }); },
            approval: 'approve-for-me',
            onSelectApproval: () => undefined,
            onRefresh: () => undefined,
        });
        const codexRail = Array.from(chrome.list.querySelectorAll<HTMLButtonElement>('.qaap-model-picker-rail-item'))
            .find(button => button.title === 'Codex');
        expect(codexRail).to.not.equal(undefined);
        codexRail?.click();
        const row = chrome.list.querySelector<HTMLButtonElement>('.qaap-model-picker-row');
        row?.click();
        expect(picked).to.deep.equal([{ agentId: 'codex', modelId: 'gpt-5-6-sol' }]);
    });

    it('refreshes the composer when the picker is removed and paints again on reopen', async () => {
        const ctx = { resolveModelsForAgentPickerSafe: async () => ({ models: [], loadFailed: false }) };
        let refreshed = 0;
        const options = {
            cwd: undefined,
            agents: [{ id: 'claude', label: 'Claude Code', available: true }],
            selectedAgentId: 'claude',
            project: undefined,
            isMobile: false,
            onSelectAgent: () => undefined,
            approval: 'approve-for-me' as const,
            onSelectApproval: () => undefined,
            onRefresh: () => { refreshed++; },
        };
        await renderStickyComposerModelPicker(ctx, chrome, options);
        chrome.sheet.remove();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(refreshed).to.equal(1);
        expect(chrome.list.querySelector('.qaap-model-picker')).to.equal(null);

        document.body.append(chrome.sheet);
        await renderStickyComposerModelPicker(ctx, chrome, options);
        expect(chrome.list.querySelector('.qaap-model-picker')).to.not.equal(null);
    });
});
