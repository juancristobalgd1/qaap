// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { MobileOpenRepositoryDialog } from './mobile-open-repository-dialog';
import type { MobileProjectsService } from '@theia/qaap-shared-core/lib/browser/mobile-projects-service';
import { QaapApiRequestError } from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

describe('MobileOpenRepositoryDialog GitHub sign-in prompt', () => {
    useSuiteJSDOM();

    async function reloadWith(error: unknown): Promise<MobileOpenRepositoryDialog> {
        const service = {
            listGithubRepositories: async () => { throw error; },
            getConnectedUser: () => undefined,
            formatRepositoryLabel: (value: string) => value,
        } as unknown as MobileProjectsService;
        const dialog = new MobileOpenRepositoryDialog(service, {});
        document.body.append(dialog.node);
        await (dialog as unknown as { reloadRepositories(): Promise<void> }).reloadRepositories();
        return dialog;
    }

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('outside the desktop app a sign-in code is shown as the plain list error, with no sign-in button', async () => {
        const dialog = await reloadWith(new QaapApiRequestError('Sign in with GitHub to import your repositories.', 401, 'github_sign_in_required'));
        const empty = dialog.node.querySelector<HTMLElement>('.theia-mobile-open-repo-empty') ?? dialog.node;
        expect(dialog.node.querySelector('.theia-mobile-github-device-button')).to.not.exist;
        expect(empty.textContent).to.include('Sign in with GitHub to import your repositories.');
    });

    it('outside the desktop app the connected-status row never shows a sign-out button', async () => {
        const dialog = await reloadWith(undefined);
        expect(dialog.node.querySelector('.theia-mobile-open-repo-signout')).to.not.exist;
    });
});
