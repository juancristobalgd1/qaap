// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { Emitter } from '@theia/core/lib/common/event';
import type { QuickInputButton, QuickInputService, QuickPick, QuickPickItem } from '@theia/core/lib/common/quick-pick-service';
import type { MobileProjectEntry } from './mobile-projects-types';
import {
    MobileProjectsPullRequestsSidebarUi,
    type MobileProjectsPullRequestsSidebarHost,
} from './mobile-projects-pull-requests-sidebar-ui';

function createTestQuickPick(): {
    quickPick: QuickPick<QuickPickItem>;
    triggerButton(button: QuickInputButton): void;
    shown(): boolean;
} {
    const onDidAccept = new Emitter<{ inBackground: boolean } | undefined>();
    const onDidChangeValue = new Emitter<string>();
    const onDidTriggerButton = new Emitter<QuickInputButton>();
    const onDidTriggerItemButton = new Emitter<never>();
    const onDidChangeActive = new Emitter<QuickPickItem[]>();
    const onDidChangeSelection = new Emitter<QuickPickItem[]>();
    const onDidHide = new Emitter<{ reason: number }>();
    let visible = false;
    const quickPick = {
        value: '',
        placeholder: undefined,
        items: [] as QuickPickItem[],
        activeItems: [] as QuickPickItem[],
        selectedItems: [] as QuickPickItem[],
        canSelectMany: false,
        matchOnDescription: false,
        matchOnDetail: false,
        keepScrollPosition: false,
        buttons: [] as QuickInputButton[],
        title: undefined,
        description: undefined,
        step: undefined,
        totalSteps: undefined,
        enabled: true,
        busy: false,
        ignoreFocusOut: false,
        onDidAccept: onDidAccept.event,
        onDidChangeValue: onDidChangeValue.event,
        onDidTriggerButton: onDidTriggerButton.event,
        onDidTriggerItemButton: onDidTriggerItemButton.event,
        onDidChangeActive: onDidChangeActive.event,
        onDidChangeSelection: onDidChangeSelection.event,
        onDidHide: onDidHide.event,
        onDispose: new Emitter<void>().event,
        show: () => { visible = true; },
        hide: () => {
            visible = false;
            onDidHide.fire({ reason: 3 });
        },
        dispose: () => { visible = false; },
    } as unknown as QuickPick<QuickPickItem>;
    return {
        quickPick,
        triggerButton: button => onDidTriggerButton.fire(button),
        shown: () => visible,
    };
}

describe('mobile-projects-pull-requests-sidebar-ui', () => {

    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    beforeEach(() => {
        document.body.replaceChildren();
    });

    it('keeps search controls out of the sidebar until the header button opens them', () => {
        let refreshCalls = 0;
        const searchPick = createTestQuickPick();
        const host: MobileProjectsPullRequestsSidebarHost = {
            inboxPullRequests: [],
            inboxPullRequestsLoading: false,
            inboxPullRequestsLoaded: true,
            inboxGithubSignedIn: true,
            quickInputService: {
                createQuickPick: () => searchPick.quickPick,
            } as unknown as QuickInputService,
            refreshInboxPullRequests: async (_projects?: MobileProjectEntry[], _force?: boolean) => {
                refreshCalls++;
            },
            openPullRequestDetail: () => undefined,
        };
        const ui = new MobileProjectsPullRequestsSidebarUi(host);
        const container = document.createElement('div');
        const anchor = document.createElement('button');
        document.body.append(container, anchor);

        ui.render(container);

        expect(container.querySelector('.theia-mobile-work-hub-pull-requests-search-row')).to.equal(null);
        expect(container.querySelector('.theia-mobile-work-hub-pull-requests-tabs')).to.not.equal(null);

        ui.toggleSearchPopup(anchor);

        expect(searchPick.shown()).to.equal(true);
        expect(searchPick.quickPick.placeholder).to.equal('Search pull requests');
        expect(searchPick.quickPick.buttons).to.have.length(2);
        searchPick.triggerButton(searchPick.quickPick.buttons[1]);
        expect(refreshCalls).to.equal(1);
        expect(anchor.getAttribute('aria-expanded')).to.equal('true');

        ui.closeSearchPopup();
        expect(searchPick.shown()).to.equal(false);
        expect(anchor.getAttribute('aria-expanded')).to.equal('false');
    });
});
