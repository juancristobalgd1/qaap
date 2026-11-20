// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';
import {
    MISSING_PROJECT_FOLDER_BANNER_CLASS,
    resetMissingProjectFolderBannerDismissals,
    showMissingProjectFolderBanner,
} from './mobile-projects-transcript-missing-folder-banner';

describe('mobile-projects-transcript-missing-folder-banner', () => {

    useSuiteJSDOM();

    const project = { id: 'custom:demo', name: 'Demo' } as MobileProjectEntry;
    const bannerOf = (anchor: HTMLElement): HTMLElement | null => anchor.parentElement?.querySelector<HTMLElement>(`.${MISSING_PROJECT_FOLDER_BANNER_CLASS}`) ?? null;

    const setup = (): { shell: HTMLElement; anchor: HTMLElement } => {
        const shell = document.createElement('div');
        const anchor = document.createElement('div');
        shell.append(anchor);
        document.body.append(shell);
        return { shell, anchor };
    };

    beforeEach(() => {
        resetMissingProjectFolderBannerDismissals();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('shows the banner above the composer with the folder path when the folder is gone', async () => {
        const { anchor } = setup();
        await showMissingProjectFolderBanner({
            project,
            folderPath: '/srv/gone',
            anchor,
            folderExists: async () => false,
            stillMounted: () => true,
        });
        const banner = bannerOf(anchor);
        expect(banner).to.not.equal(null);
        expect(banner!.nextElementSibling).to.equal(anchor);
        expect(banner!.querySelector(`.${MISSING_PROJECT_FOLDER_BANNER_CLASS}-text`)?.textContent)
            .to.equal('This project\'s folder no longer exists: /srv/gone');
    });

    it('stays silent when the folder exists or the existence is unknown', async () => {
        for (const exists of [true, undefined]) {
            const { anchor } = setup();
            await showMissingProjectFolderBanner({
                project,
                folderPath: '/srv/here',
                anchor,
                folderExists: async () => exists,
                stillMounted: () => true,
            });
            expect(bannerOf(anchor), String(exists)).to.equal(null);
        }
    });

    it('offers Remove from list only when the existing remove flow is wired, and calls it', async () => {
        const { anchor } = setup();
        const removed: string[] = [];
        await showMissingProjectFolderBanner({
            project,
            folderPath: '/srv/gone',
            anchor,
            folderExists: async () => false,
            stillMounted: () => true,
            removeProject: target => { removed.push(target.id); },
        });
        const remove = bannerOf(anchor)!.querySelector<HTMLButtonElement>(`.${MISSING_PROJECT_FOLDER_BANNER_CLASS}-action`);
        expect(remove?.textContent).to.equal('Remove from list');
        remove!.click();
        expect(removed).to.deep.equal([project.id]);
    });

    it('omits Remove from list without a remove flow, and Dismiss hides the banner for the session', async () => {
        const { anchor } = setup();
        const input = {
            project,
            folderPath: '/srv/gone',
            anchor,
            folderExists: async () => false,
            stillMounted: () => true,
        };
        await showMissingProjectFolderBanner(input);
        const buttons = [...bannerOf(anchor)!.querySelectorAll<HTMLButtonElement>(`.${MISSING_PROJECT_FOLDER_BANNER_CLASS}-action`)];
        expect(buttons.map(button => button.textContent)).to.deep.equal(['Dismiss']);
        buttons[0].click();
        expect(bannerOf(anchor)).to.equal(null);

        await showMissingProjectFolderBanner(input);
        expect(bannerOf(anchor)).to.equal(null);
    });

    it('drops a stale check when the composer was remounted meanwhile', async () => {
        const { anchor } = setup();
        await showMissingProjectFolderBanner({
            project,
            folderPath: '/srv/gone',
            anchor,
            folderExists: async () => false,
            stillMounted: () => false,
        });
        expect(bannerOf(anchor)).to.equal(null);
    });
});
