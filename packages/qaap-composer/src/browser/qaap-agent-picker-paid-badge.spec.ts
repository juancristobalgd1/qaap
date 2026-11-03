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
import type { MobileProjectsStickyComposerSheetsUiContext } from './mobile-projects-sticky-composer-sheets-ui-context';
import { appendAgentModelPickerListExtracted } from './mobile-projects-sticky-composer-sheets-ui-activity';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

/** Paid models carry a "Paid" badge, free models keep their `:free` label, and free models list first. */
describe('agent picker: model rows mark paid models and list free ones first', () => {

    useSuiteJSDOM();

    const paidModel: QaapQaiqModelOption = {
        provider: 'openai',
        vendor: 'openrouter',
        modelId: 'openai/gpt-5',
        label: 'GPT-5',
    };
    const freeModel: QaapQaiqModelOption = {
        provider: 'openai',
        vendor: 'openrouter',
        modelId: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        label: 'Nemotron 3 Ultra',
    };

    function renderRows(models: readonly QaapQaiqModelOption[]): HTMLElement {
        const list = document.createElement('div');
        appendAgentModelPickerListExtracted(
            {} as unknown as MobileProjectsStickyComposerSheetsUiContext,
            list,
            'qaiq',
            models,
            undefined,
            () => undefined,
        );
        return list;
    }

    it('shows a Paid badge only on paid rows and keeps the :free marker on free rows', () => {
        const list = renderRows([paidModel, freeModel]);
        const rows = [...list.querySelectorAll<HTMLElement>('.theia-qaap-picker-sheet-option, .theia-mobile-sticky-composer-sheet-option')];
        expect(rows).to.have.length(2);
        const freeRow = rows.find(row => row.textContent?.includes('Nemotron'));
        const paidRow = rows.find(row => row.textContent?.includes('GPT-5'));
        expect(freeRow?.textContent).to.contain(':free');
        expect(freeRow?.querySelector('.theia-qaap-picker-sheet-option-badge')).to.equal(null);
        expect(paidRow?.querySelector('.theia-qaap-picker-sheet-option-badge')?.textContent).to.equal('Paid');
    });

    it('lists the free model before the paid one regardless of catalog order', () => {
        const list = renderRows([paidModel, freeModel]);
        const rows = [...list.querySelectorAll<HTMLElement>('.theia-qaap-picker-sheet-option, .theia-mobile-sticky-composer-sheet-option')];
        expect(rows[0].textContent).to.contain('Nemotron');
        expect(rows[1].textContent).to.contain('GPT-5');
    });
});
