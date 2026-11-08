// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
import { MobileWorkHubSessionsSidebar } from './mobile-work-hub-sessions-sidebar';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

/** The parts of the dialog this spec drives. */
interface UsageDialogUnderTest {
    client: { fetchSummary: () => Promise<never> };
    open(): void;
    close(): void;
}

describe('sessions sidebar Usage entry', () => {

    useSuiteJSDOM();

    beforeEach(() => {
        document.body.innerHTML = '';
        FrontendApplicationConfigProvider.set({ applicationName: 'Qaap' });
    });

    it('places the Usage button between Account and Settings and opens the dialog on click', async () => {
        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: () => undefined,
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);
        // Offline stub: the dialog must still open and show its error state.
        const usageDialog = (sidebar as unknown as { usageDialog: UsageDialogUnderTest }).usageDialog;
        usageDialog.client.fetchSummary = async () => { throw new Error('offline'); };

        const footer = sidebar.node.querySelector('.theia-mobile-work-hub-sessions-sidebar-foot') as HTMLElement;
        const children = Array.from(footer.children).map(child => child.className);
        const usageIndex = children.findIndex(name => name.includes('theia-mobile-work-hub-sessions-sidebar-usage-button'));
        const accountIndex = children.findIndex(name => name.includes('theia-workbench-account-btn'));
        const settingsIndex = children.findIndex(name => name.includes('theia-mobile-work-hub-sessions-sidebar-settings-button'));
        expect(usageIndex).to.be.greaterThan(accountIndex);
        expect(usageIndex).to.be.lessThan(settingsIndex);

        const button = footer.querySelector('.theia-mobile-work-hub-sessions-sidebar-usage-button') as HTMLButtonElement;
        expect(button.getAttribute('aria-label')).to.equal('Usage');
        button.click();

        const backdrop = document.querySelector('.theia-qaap-usage-backdrop') as HTMLElement;
        expect(backdrop).to.not.equal(null);
        expect(backdrop.hidden).to.equal(false);
        usageDialog.close();
    });
});
