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
 * Enter in the open agent picker must act only on a result the user navigated to with the arrow keys.
 * With nothing navigated to, Enter closes the picker and keeps the selection; Escape closes it.
 */
describe('agent picker: Enter and Escape keyboard handling', () => {

    useSuiteJSDOM();

    const codexModel: QaapQaiqModelOption = {
        provider: 'openai',
        vendor: 'OpenAI',
        modelId: 'gpt-5.4',
        label: 'GPT 5.4',
    };

    const agents = [
        { id: 'codex', label: 'Codex', available: true, connectionState: 'connected', accessState: 'hosted' },
    ] as unknown as QaapAgentTaskAgentOption[];

    beforeEach(() => {
        window.requestAnimationFrame = (): number => 0;
    });

    function render(): {
        target: ComposerAgentPickerChrome;
        selected: Array<{ agentId: string; model?: QaapQaiqModelOption }>;
        closed: { count: number };
    } {
        const selected: Array<{ agentId: string; model?: QaapQaiqModelOption }> = [];
        const closed = { count: 0 };
        const ctx = {
            host: {
                stickyComposerAgentsUi: { getOfferableCoderAgent: () => undefined },
                readPreference: () => undefined,
            },
            renderComposerAgentPicker: async (): Promise<void> => undefined,
            resolveModelsForAgentPickerSafe: async () => ({ models: [codexModel], loadFailed: false }),
            syncAgentPickerPopoverPosition: () => undefined,
            createAgentPickerNoResultsHint: () => document.createElement('p'),
        } as unknown as MobileProjectsStickyComposerSheetsUiContext;
        const target = {
            sheet: document.createElement('div'),
            list: document.createElement('div'),
            header: document.createElement('div'),
            backBtn: document.createElement('button'),
            intro: document.createElement('p'),
            title: document.createElement('h2'),
            searchInput: document.createElement('input'),
            modelsByAgent: new Map(),
            modelLoadFailedByAgent: new Map(),
            onClose: () => { closed.count++; },
        } as unknown as ComposerAgentPickerChrome;
        document.body.append(target.list, target.searchInput);
        void renderComposerAgentPickerExtracted(ctx, target, {
            view: 'agents',
            cwd: '/repo/enter-key',
            agents,
            selectedAgentId: undefined,
            includeCoder: false,
            onSelectAgent: (agentId, model) => selected.push({ agentId, model }),
        });
        return { target, selected, closed };
    }

    const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));
    const key = (target: HTMLElement, name: string): KeyboardEvent => {
        const event = new window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
        target.dispatchEvent(event);
        return event;
    };

    it('Enter with nothing navigated to closes the picker without selecting the single result', async () => {
        const { target, selected, closed } = render();
        await flush();
        const results = target.list.querySelectorAll<HTMLElement>('.theia-qaap-agent-sheet-option, .theia-qaap-agent-sheet-split-chevron, .theia-qaap-agent-sheet-inline-model');
        expect(results.length).to.be.greaterThan(0);
        key(target.searchInput, 'Enter');
        expect(closed.count).to.equal(1);
        expect(selected).to.be.empty;
    });

    it('ArrowDown moves focus to the first result so Enter can activate only that result', async () => {
        const { target, closed } = render();
        await flush();
        key(target.searchInput, 'ArrowDown');
        const first = target.list.querySelector<HTMLElement>('.theia-qaap-agent-sheet-option:not(.theia-qaap-agent-sheet-split-main), .theia-qaap-agent-sheet-split-chevron');
        expect(document.activeElement).to.equal(first);
        // Enter on a focused result is a native button activation, not a search-box Enter: no close here.
        expect(closed.count).to.equal(0);
    });

    it('Escape closes the picker from the search box when it is empty', async () => {
        const { target, closed } = render();
        await flush();
        key(target.searchInput, 'Escape');
        expect(closed.count).to.equal(1);
    });
});
