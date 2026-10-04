// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import type { QaapQaiqModelOption } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';
import type { ComposerAgentPickerChrome } from './mobile-projects-sticky-composer-sheets-ui';
import type { MobileProjectsStickyComposerSheetsUiContext } from './mobile-projects-sticky-composer-sheets-ui-context';
import { renderComposerAgentPickerExtracted } from './mobile-projects-sticky-composer-sheets-ui-timeline';

disableImportJSDOM();

describe('renderComposerAgentPickerExtracted (agents view)', () => {

    useSuiteJSDOM();

    beforeEach(() => {
        (window as { requestAnimationFrame: (callback: FrameRequestCallback) => number }).requestAnimationFrame = () => 0;
    });

    type ModelLoad = { readonly models: QaapQaiqModelOption[]; readonly loadFailed: boolean };

    function createChrome(): ComposerAgentPickerChrome {
        const sheet = document.createElement('div');
        const list = document.createElement('div');
        sheet.append(list);
        return {
            sheet,
            header: document.createElement('div'),
            title: document.createElement('div'),
            backBtn: document.createElement('button'),
            intro: document.createElement('div'),
            searchInput: document.createElement('input'),
            list,
            modelsByAgent: new Map(),
            modelLoadFailedByAgent: new Map(),
            onClose: () => undefined,
        };
    }

    function createContext(): { ctx: MobileProjectsStickyComposerSheetsUiContext, requests: string[], finish: (agentId: string, models: QaapQaiqModelOption[]) => void } {
        const requests: string[] = [];
        const pending = new Map<string, (load: ModelLoad) => void>();
        const ctx = {
            host: {
                stickyComposerAgentsUi: { getOfferableCoderAgent: () => undefined },
            },
            resolveModelsForAgentPickerSafe: (agentId: string) => {
                requests.push(agentId);
                return new Promise<ModelLoad>(resolve => pending.set(agentId, resolve));
            },
            syncAgentPickerPopoverPosition: () => undefined,
            createAgentPickerNoResultsHint: () => document.createElement('p'),
        } as unknown as MobileProjectsStickyComposerSheetsUiContext;
        (ctx as { renderComposerAgentPicker: unknown }).renderComposerAgentPicker =
            (chrome: ComposerAgentPickerChrome, options: Parameters<typeof renderComposerAgentPickerExtracted>[2]) =>
                renderComposerAgentPickerExtracted(ctx, chrome, options);
        return { ctx, requests, finish: (agentId, models) => pending.get(agentId)?.({ models, loadFailed: false }) };
    }

    const options = {
        view: 'agents' as const,
        cwd: undefined,
        agents: [{ id: 'codex', label: 'Codex', available: true }],
        selectedAgentId: undefined,
        includeCoder: false,
        onSelectAgent: () => undefined,
    };

    function rowIds(chrome: ComposerAgentPickerChrome): string[] {
        return [...chrome.list.querySelectorAll<HTMLElement>('.theia-qaap-agent-sheet-option')]
            .map(row => row.dataset.agentId ?? row.textContent ?? '');
    }

    it('paints the agent rows before any model catalog answers', async () => {
        const { ctx, requests, finish } = createContext();
        const chrome = createChrome();

        const rendered = renderComposerAgentPickerExtracted(ctx, chrome, options);

        expect(requests).to.deep.equal(['codex']);
        expect(chrome.list.querySelector('.theia-qaap-agent-sheet-skeleton')).to.equal(null);
        expect(rowIds(chrome)).to.have.length(1);

        finish('codex', [{ provider: 'openai', vendor: 'openai', modelId: 'gpt-5', label: 'GPT-5' }]);
        await rendered;
        expect(rowIds(chrome)).to.have.length(1);
        expect(chrome.modelsByAgent.get('codex')).to.have.length(1);
    });

    it('shares one in-flight model request across re-renders of the same picker', async () => {
        const { ctx, requests, finish } = createContext();
        const chrome = createChrome();

        const first = renderComposerAgentPickerExtracted(ctx, chrome, options);
        chrome.searchInput.value = 'co';
        const second = renderComposerAgentPickerExtracted(ctx, chrome, options);
        expect(requests).to.deep.equal(['codex']);

        finish('codex', []);
        await Promise.all([first, second]);
        expect(rowIds(chrome)).to.have.length(1);
    });
});
