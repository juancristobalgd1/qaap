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
import { OPENCODE_FREE_MODEL_OPTIONS, OPENCODE_PAID_MODEL_OPTIONS } from '@theia/qaap-shared-core/lib/common/qaap-opencode-model-catalog';
import type { ComposerAgentPickerChrome } from './mobile-projects-sticky-composer-sheets-ui';
import type { MobileProjectsStickyComposerSheetsUiContext } from './mobile-projects-sticky-composer-sheets-ui-context';
import { appendAgentModelPickerListExtracted } from './mobile-projects-sticky-composer-sheets-ui-activity';
import { renderComposerAgentPickerExtracted } from './mobile-projects-sticky-composer-sheets-ui-timeline';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

/** Arguments after the context in {@link appendAgentModelPickerListExtracted}. */
type AppendModelListArgs = Parameters<typeof appendAgentModelPickerListExtracted> extends [unknown, ...infer Rest] ? Rest : never;

/**
 * OpenCode's model picker keeps the free models usable and groups the paid ones under one "Paid"
 * header. Without a sign-in the paid group shows a single "Sign in" action and every locked row
 * opens the same sign-in flow.
 */
describe('agent picker: OpenCode paid models', () => {

    useSuiteJSDOM();

    beforeEach(() => {
        window.requestAnimationFrame = (): number => 0;
    });

    const agents = [
        { id: 'opencode', label: 'OpenCode', available: true, connectionState: 'disconnected', accessState: 'none' },
    ] as unknown as QaapAgentTaskAgentOption[];

    function chrome(): ComposerAgentPickerChrome {
        const modelsByAgent = new Map<string, QaapQaiqModelOption[]>();
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

    function lockedModels(): QaapQaiqModelOption[] {
        const free = OPENCODE_FREE_MODEL_OPTIONS.slice(0, 2);
        const paid = OPENCODE_PAID_MODEL_OPTIONS.slice(0, 2).map(model => ({
            ...model,
            available: false,
            unavailableReason: 'not-connected' as const,
        }));
        return [...free, ...paid];
    }

    async function renderModels(models: QaapQaiqModelOption[]): Promise<{
        list: HTMLElement;
        logins: string[];
        selected: string[];
    }> {
        const logins: string[] = [];
        const selected: string[] = [];
        const target = chrome();
        target.modelsByAgent.set('opencode', models);
        const ctx: MobileProjectsStickyComposerSheetsUiContext = {
            host: {
                stickyComposerAgentsUi: { getOfferableCoderAgent: () => undefined },
                readPreference: () => undefined,
            },
            renderComposerAgentPicker: async () => undefined,
            resolveModelsForAgentPickerSafe: async () => ({ models, loadFailed: false }),
            syncAgentPickerPopoverPosition: () => undefined,
            createAgentPickerNoResultsHint: () => document.createElement('p'),
            appendAgentModelPickerList: (...args: AppendModelListArgs) => appendAgentModelPickerListExtracted(ctx, ...args),
        } as unknown as MobileProjectsStickyComposerSheetsUiContext;
        await renderComposerAgentPickerExtracted(ctx, target, {
            view: 'models',
            modelPickerAgentId: 'opencode',
            cwd: undefined,
            agents,
            selectedAgentId: undefined,
            includeCoder: false,
            onSelectAgent: (agentId, model) => selected.push(model?.modelId ?? agentId),
            onProactiveLogin: agentId => logins.push(agentId),
            onOpenAiFeaturesSettings: () => undefined,
        });
        return { list: target.list, logins, selected };
    }

    it('shows one Sign in action in the Paid header and leaves free rows selectable', async () => {
        const { list, selected } = await renderModels(lockedModels());
        const paidLabel = Array.from(list.querySelectorAll<HTMLElement>('.theia-qaap-agent-sheet-provider-label'))
            .find(label => label.textContent?.includes('Paid'));
        expect(paidLabel).to.not.equal(undefined);
        expect(list.querySelectorAll('.theia-qaap-agent-sheet-connect')).to.have.length(1);
        expect(paidLabel!.querySelector('.theia-qaap-agent-sheet-connect')?.textContent).to.equal('Sign in');

        const freeRow = Array.from(list.querySelectorAll<HTMLButtonElement>('.theia-mobile-sticky-composer-sheet-option'))
            .find(row => !row.classList.contains('theia-mod-disabled'));
        expect(freeRow).to.not.equal(undefined);
        freeRow!.click();
        expect(selected).to.have.length(1);
    });

    it('opens the sign-in flow from a locked paid row', async () => {
        const { list, logins, selected } = await renderModels(lockedModels());
        const lockedRow = list.querySelector<HTMLButtonElement>('.theia-mobile-sticky-composer-sheet-option.theia-mod-disabled');
        expect(lockedRow).to.not.equal(null);
        lockedRow!.click();
        expect(logins).to.deep.equal(['opencode']);
        expect(selected).to.deep.equal([]);
    });

    it('shows no Sign in action when every paid model is already unlocked', async () => {
        const unlocked = OPENCODE_PAID_MODEL_OPTIONS.slice(0, 2).map(model => ({ ...model, available: true }));
        const { list } = await renderModels([...OPENCODE_FREE_MODEL_OPTIONS.slice(0, 1), ...unlocked]);
        expect(list.querySelectorAll('.theia-qaap-agent-sheet-connect')).to.have.length(0);
        expect(list.querySelectorAll('.theia-mod-disabled')).to.have.length(0);
    });
});

/** Keep the locked-row helper exercised directly as well (no picker chrome needed). */
describe('agent picker: OpenCode locked group helper', () => {
    useSuiteJSDOM();

    it('renders a paid group without a sign-in handler as plain locked rows', () => {
        const list = document.createElement('div');
        const paid = OPENCODE_PAID_MODEL_OPTIONS.slice(0, 1).map(model => ({
            ...model,
            available: false,
            unavailableReason: 'not-connected' as const,
        }));
        const ctx = {
            createAgentPickerNoResultsHint: () => document.createElement('p'),
        } as unknown as MobileProjectsStickyComposerSheetsUiContext;
        appendAgentModelPickerListExtracted(ctx, list, 'opencode', paid, undefined, () => undefined);
        expect(list.querySelectorAll('.theia-qaap-agent-sheet-connect')).to.have.length(0);
        const row = list.querySelector<HTMLButtonElement>('.theia-mobile-sticky-composer-sheet-option');
        expect(row?.disabled).to.equal(true);
    });
});

describe('agent picker: Pi sign-in', () => {
    useSuiteJSDOM();

    it('shows one Sign in action in the first group header and calls the handler', () => {
        const list = document.createElement('div');
        const models: QaapQaiqModelOption[] = [
            { provider: 'openai', vendor: 'openrouter', modelId: 'openrouter/~anthropic/claude-sonnet-latest', label: 'anthropic/claude-sonnet-latest' },
            { provider: 'openai', vendor: 'anthropic', modelId: 'anthropic/claude-opus-4-8', label: 'claude-opus-4-8' },
        ];
        const ctx = {
            createAgentPickerNoResultsHint: () => document.createElement('p'),
        } as unknown as MobileProjectsStickyComposerSheetsUiContext;
        let signIns = 0;
        appendAgentModelPickerListExtracted(ctx, list, 'pi', models, undefined, () => undefined,
            false, undefined, undefined, () => { signIns++; });
        const buttons = list.querySelectorAll<HTMLButtonElement>('.theia-qaap-agent-sheet-connect');
        expect(buttons).to.have.length(1);
        expect(buttons[0].textContent).to.equal('Sign in');
        expect(buttons[0].closest('.theia-qaap-agent-sheet-provider-label')).to.not.equal(null);
        expect(list.querySelectorAll('.theia-qaap-agent-sheet-provider')).to.have.length(2);
        buttons[0].click();
        expect(signIns).to.equal(1);
    });
});
