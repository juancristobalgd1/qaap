// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import type { QaapAgentTaskAgentOption } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import type { ComposerAgentPickerChrome } from './mobile-projects-sticky-composer-sheets-ui';
import type { MobileProjectsStickyComposerSheetsUiContext } from './mobile-projects-sticky-composer-sheets-ui-context';
import { renderComposerAgentPickerExtracted } from './mobile-projects-sticky-composer-sheets-ui-timeline';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

/**
 * QAIQ runs on the user's own provider keys (BYOK). When the backend reports it `disconnected` (no
 * key for the provider its model routes to), the picker must send the user to Settings → AI
 * Features — even when the user holds some other provider's key — and never start a CLI sign-in.
 */
describe('agent picker: keyless QAIQ', () => {

    useSuiteJSDOM();

    beforeEach(() => {
        // The picker only uses rAF for focus / popover positioning; run it as a no-op frame.
        window.requestAnimationFrame = (): number => 0;
    });

    function chrome(): ComposerAgentPickerChrome {
        return {
            sheet: document.createElement('div'),
            list: document.createElement('div'),
            header: document.createElement('div'),
            backBtn: document.createElement('button'),
            intro: document.createElement('p'),
            title: document.createElement('h2'),
            searchInput: document.createElement('input'),
            modelsByAgent: new Map(),
            modelLoadFailedByAgent: new Map(),
            onClose: () => undefined,
        } as unknown as ComposerAgentPickerChrome;
    }

    async function render(prefs: Record<string, unknown>): Promise<{ list: HTMLElement; settings: string[]; logins: string[] }> {
        const settings: string[] = [];
        const logins: string[] = [];
        const ctx = {
            host: {
                stickyComposerAgentsUi: { getOfferableCoderAgent: () => undefined },
                readPreference: (key: string) => prefs[key],
            },
            renderComposerAgentPicker: async () => undefined,
            resolveModelsForAgentPickerSafe: async () => ({ models: [], loadFailed: false }),
            syncAgentPickerPopoverPosition: () => undefined,
            createAgentPickerNoResultsHint: () => document.createElement('p'),
        } as unknown as MobileProjectsStickyComposerSheetsUiContext;
        const agents = [
            { id: 'qaiq', label: 'QAIQ', available: false, connectionState: 'disconnected' },
        ] as unknown as QaapAgentTaskAgentOption[];
        const target = chrome();
        await renderComposerAgentPickerExtracted(ctx, target, {
            view: 'agents',
            cwd: undefined,
            agents,
            selectedAgentId: undefined,
            includeCoder: false,
            onSelectAgent: () => undefined,
            onProactiveLogin: agentId => logins.push(agentId),
            onOpenAiFeaturesSettings: agentId => settings.push(agentId ?? ''),
        });
        return { list: target.list, settings, logins };
    }

    for (const [name, prefs] of [
        ['no key at all', {}],
        ['an OpenAI key but no OpenRouter key', { 'ai-features.openAiOfficial.openAiApiKey': 'sk-openai' }],
    ] as const) {
        it(`offers "Add API key" that opens Settings, never a sign-in (${name})`, async () => {
            const { list, settings, logins } = await render(prefs);
            const action = list.querySelector<HTMLButtonElement>('.theia-qaap-agent-sheet-unavailable[data-agent-id="qaiq"] .theia-qaap-agent-sheet-connect');
            expect(action?.textContent).to.equal('Add API key');
            expect(list.querySelector('.theia-qaap-agent-sheet-unavailable-description')?.textContent).to.contain('API key required');
            action!.click();
            expect(settings).to.deep.equal(['qaiq']);
            expect(logins).to.deep.equal([]);
        });
    }
});
