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
 * Codex in the "Choose agent" picker follows the backend access answer. With no sign-in and no
 * hosted entitlement (`none`) the row is unavailable and offers "Sign in" through the existing
 * sign-in flow. While the probe is pending (`unknown`) the row stays usable.
 */
describe('agent picker: Codex sign-in row', () => {

    useSuiteJSDOM();

    beforeEach(() => {
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

    async function render(agents: QaapAgentTaskAgentOption[]): Promise<{ list: HTMLElement; logins: string[] }> {
        const logins: string[] = [];
        const ctx = {
            host: {
                stickyComposerAgentsUi: { getOfferableCoderAgent: () => undefined },
                readPreference: () => undefined,
            },
            renderComposerAgentPicker: async () => undefined,
            resolveModelsForAgentPickerSafe: async () => ({ models: [], loadFailed: false }),
            syncAgentPickerPopoverPosition: () => undefined,
            createAgentPickerNoResultsHint: () => document.createElement('p'),
        } as unknown as MobileProjectsStickyComposerSheetsUiContext;
        const target = chrome();
        await renderComposerAgentPickerExtracted(ctx, target, {
            view: 'agents',
            cwd: undefined,
            agents,
            selectedAgentId: undefined,
            includeCoder: false,
            onSelectAgent: () => undefined,
            onProactiveLogin: agentId => logins.push(agentId),
            onOpenAiFeaturesSettings: () => undefined,
        });
        return { list: target.list, logins };
    }

    it('offers Sign in for Codex when its access is none', async () => {
        const { list, logins } = await render([
            { id: 'codex', label: 'Codex', available: false, connectionState: 'disconnected', accessState: 'none' },
        ] as unknown as QaapAgentTaskAgentOption[]);
        const action = list.querySelector<HTMLButtonElement>('.theia-qaap-agent-sheet-unavailable[data-agent-id="codex"] .theia-qaap-agent-sheet-connect');
        expect(action?.textContent).to.equal('Sign in');
        action!.click();
        expect(logins).to.deep.equal(['codex']);
    });

    it('offers Sign in for a settled-unknown Codex probe (access none, connection unknown)', async () => {
        const { list } = await render([
            { id: 'codex', label: 'Codex', available: false, connectionState: 'unknown', accessState: 'none' },
        ] as unknown as QaapAgentTaskAgentOption[]);
        const action = list.querySelector<HTMLButtonElement>('.theia-qaap-agent-sheet-unavailable[data-agent-id="codex"] .theia-qaap-agent-sheet-connect');
        expect(action?.textContent).to.equal('Sign in');
    });

    it('keeps Codex usable without a Sign in row while its probe is pending', async () => {
        const { list } = await render([
            { id: 'codex', label: 'Codex', available: true, connectionState: 'unknown', accessState: 'unknown' },
        ] as unknown as QaapAgentTaskAgentOption[]);
        expect(list.querySelector('.theia-qaap-agent-sheet-unavailable[data-agent-id="codex"]')).to.equal(null);
    });

    it('keeps Codex usable through hosted access even when the CLI is disconnected', async () => {
        const { list } = await render([
            { id: 'codex', label: 'Codex', available: true, connectionState: 'disconnected', accessState: 'hosted' },
        ] as unknown as QaapAgentTaskAgentOption[]);
        expect(list.querySelector('.theia-qaap-agent-sheet-unavailable[data-agent-id="codex"]')).to.equal(null);
    });
});
