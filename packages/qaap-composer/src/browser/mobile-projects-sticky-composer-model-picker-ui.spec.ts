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

    it('offers the sign-in action of the old agent sheet when the harness is disconnected', async () => {
        const ctx = {
            resolveModelsForAgentPickerSafe: async () => ({ models: [], loadFailed: false }),
        };
        const signedIn: string[] = [];
        await renderStickyComposerModelPicker(ctx, chrome, {
            cwd: undefined,
            agents: [{ id: 'claude', label: 'Claude Code', available: true, connectionState: 'disconnected' }],
            selectedAgentId: 'claude',
            project: undefined,
            isMobile: false,
            onSelectAgent: () => undefined,
            approval: 'approve-for-me',
            onSelectApproval: () => undefined,
            onRefresh: () => undefined,
            onProactiveLogin: agentId => { signedIn.push(agentId); },
        });
        const action = chrome.list.querySelector<HTMLButtonElement>('.qaap-model-picker-connect-action');
        expect(action?.textContent).to.equal('Sign in');
        action?.click();
        expect(signedIn).to.deep.equal(['claude']);
    });
});
