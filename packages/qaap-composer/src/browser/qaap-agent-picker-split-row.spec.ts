// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import type { QaapAgentTaskAgentOption, QaapQaiqModelOption } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import type { ComposerAgentPickerChrome } from './mobile-projects-sticky-composer-sheets-ui';
import type { MobileProjectsStickyComposerSheetsUiContext } from './mobile-projects-sticky-composer-sheets-ui-context';
import { renderComposerAgentPickerExtracted } from './mobile-projects-sticky-composer-sheets-ui-timeline';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

/**
 * A model-capable agent row is split: the main area selects the agent directly with its stored or
 * fallback model, and the trailing chevron opens the model submenu. Agents without models keep one
 * plain row that selects directly.
 */
describe('agent picker: split model row', () => {

    useSuiteJSDOM();

    const codexModel: QaapQaiqModelOption = {
        provider: 'openai',
        vendor: 'OpenAI',
        modelId: 'gpt-5.4',
        label: 'GPT 5.4',
    };

    beforeEach(() => {
        window.requestAnimationFrame = (): number => 0;
    });

    function chrome(modelsByAgent: Map<string, QaapQaiqModelOption[]>): ComposerAgentPickerChrome {
        return {
            sheet: document.createElement('div'),
            list: document.createElement('div'),
            header: document.createElement('div'),
            backBtn: document.createElement('button'),
            intro: document.createElement('p'),
            title: document.createElement('h2'),
            searchInput: document.createElement('input'),
            modelsByAgent,
            modelLoadFailedByAgent: new Map(),
            onClose: () => undefined,
        } as unknown as ComposerAgentPickerChrome;
    }

    const agents = [
        { id: 'codex', label: 'Codex', available: true, connectionState: 'connected', accessState: 'hosted' },
        { id: 'shell', label: 'Shell', available: true, connectionState: 'connected', accessState: 'hosted' },
    ] as unknown as QaapAgentTaskAgentOption[];

    function render(modelsByAgent: Map<string, QaapQaiqModelOption[]> = new Map()): {
        target: ComposerAgentPickerChrome;
        selected: Array<{ agentId: string; model?: QaapQaiqModelOption }>;
        modelViews: string[];
    } {
        const selected: Array<{ agentId: string; model?: QaapQaiqModelOption }> = [];
        const modelViews: string[] = [];
        const ctx = {
            host: {
                stickyComposerAgentsUi: { getOfferableCoderAgent: () => undefined },
                readPreference: () => undefined,
            },
            renderComposerAgentPicker: async (_chrome: ComposerAgentPickerChrome, options: { view: string }) => {
                modelViews.push(options.view);
            },
            resolveModelsForAgentPickerSafe: async () => ({ models: [codexModel], loadFailed: false }),
            syncAgentPickerPopoverPosition: () => undefined,
            createAgentPickerNoResultsHint: () => document.createElement('p'),
        } as unknown as MobileProjectsStickyComposerSheetsUiContext;
        const target = chrome(modelsByAgent);
        void renderComposerAgentPickerExtracted(ctx, target, {
            view: 'agents',
            cwd: '/repo/split-row',
            agents,
            selectedAgentId: undefined,
            includeCoder: false,
            onSelectAgent: (agentId, model) => selected.push({ agentId, model }),
        });
        return { target, selected, modelViews };
    }

    const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

    it('renders a model-capable agent as a main button beside a separate chevron button', async () => {
        const { target } = render();
        await flush();
        const row = target.list.querySelector<HTMLElement>('.theia-qaap-agent-sheet-split');
        expect(row).to.not.equal(null);
        const main = row!.querySelector<HTMLButtonElement>('.theia-qaap-agent-sheet-split-main');
        const chevron = row!.querySelector<HTMLButtonElement>('.theia-qaap-agent-sheet-split-chevron');
        expect(main?.tagName).to.equal('BUTTON');
        expect(chevron?.tagName).to.equal('BUTTON');
        expect(main?.querySelector('button')).to.equal(null);
        expect(chevron?.getAttribute('aria-label')).to.equal('Choose model for Codex');
    });

    it('main-area click selects the agent directly without a model while its catalog is still loading', async () => {
        const { target, selected, modelViews } = render();
        // Tapped before the model lists resolve: the row must not wait on them.
        const main = target.list.querySelector<HTMLButtonElement>('.theia-qaap-agent-sheet-split-main');
        main!.click();
        await flush();
        expect(selected).to.deep.equal([{ agentId: 'codex', model: undefined }]);
        expect(modelViews).to.be.empty;
    });

    it('main-area click passes the resolved default model when the catalog is already cached', async () => {
        const { target, selected } = render(new Map([['codex', [codexModel]]]));
        await flush();
        target.list.querySelector<HTMLButtonElement>('.theia-qaap-agent-sheet-split-main')!.click();
        expect(selected).to.have.length(1);
        expect(selected[0].agentId).to.equal('codex');
        expect(selected[0].model?.modelId).to.equal('gpt-5.4');
    });

    it('chevron click opens the model submenu without selecting the agent', async () => {
        const { target, selected, modelViews } = render();
        await flush();
        target.list.querySelector<HTMLButtonElement>('.theia-qaap-agent-sheet-split-chevron')!.click();
        await flush();
        await flush();
        expect(modelViews).to.deep.equal(['models']);
        expect(selected).to.be.empty;
    });

    it('keeps an agent without models as a single row that selects directly', async () => {
        const { target, selected } = render();
        await flush();
        const plainRows = [...target.list.querySelectorAll<HTMLButtonElement>('.theia-qaap-agent-sheet-option')]
            .filter(button => !button.classList.contains('theia-qaap-agent-sheet-split-main'));
        expect(plainRows).to.have.length(1);
        plainRows[0].click();
        expect(selected).to.deep.equal([{ agentId: 'shell', model: undefined }]);
    });
});
