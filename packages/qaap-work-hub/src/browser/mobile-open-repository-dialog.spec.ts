// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { MobileOpenRepositoryDialog } from './mobile-open-repository-dialog';
import type { MobileProjectsService } from '@theia/qaap-shared-core/lib/browser/mobile-projects-service';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import {
    QaapRepositoryImportTracker,
    type QaapRepositoryImportApi,
} from '@theia/qaap-shared-core/lib/browser/qaap-repository-import-tracker';
import type {
    QaapGithubOpenRepositoryResponse,
    QaapGithubWorkspaceJobRequest,
} from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

const STYLE_DIR = path.join(__dirname, '..', '..', 'src', 'browser', 'style');
const BROWSER_DIR = path.join(__dirname, '..', '..', 'src', 'browser');

describe('mobile-open-repository-dialog styles', () => {

    useSuiteJSDOM();

    it('is imported from the boot-critical frontend module', () => {
        const src = fs.readFileSync(
            path.join(BROWSER_DIR, 'qaap-work-hub-frontend-module.ts'),
            'utf8'
        );
        expect(src).to.include("import '../../src/browser/style/mobile-workbench-open-repo.css'");
    });

    it('themes tabs, filter, and create so they do not fall back to native chrome', () => {
        const css = fs.readFileSync(path.join(STYLE_DIR, 'mobile-workbench-open-repo.css'), 'utf8');
        expect(css).to.include('.theia-mobile-open-repo-tab {');
        expect(css).to.include('.theia-mobile-open-repo-filter {');
        expect(css).to.include('.theia-mobile-open-repo-create {');
        expect(css).to.match(/\.theia-mobile-open-repo-tab\s*\{[^}]*background:\s*transparent;/s);
        expect(css).to.match(/\.theia-mobile-open-repo-create\s*\{[^}]*background:\s*transparent;/s);
        expect(css).to.match(/\.theia-mobile-open-repo-filter\s*\{[^}]*background:\s*var\(--theia-input-background/s);
        expect(css).to.include('.theia-mobile-open-repo button {');
        expect(css).to.include('appearance: none');
        expect(css).to.include('display: none !important');
    });
});

describe('MobileOpenRepositoryDialog clone flow', () => {

    useSuiteJSDOM();

    const RESULT = {
        repository: { fullName: 'octocat/Hello-World' },
        workspaceUri: 'file:///workspace/repos/users/alice/octocat/Hello-World',
    } as unknown as QaapGithubOpenRepositoryResponse;

    async function flush(): Promise<void> {
        for (let i = 0; i < 20; i++) {
            await Promise.resolve();
        }
    }

    interface DialogHarness {
        dialog: MobileOpenRepositoryDialog;
        finished: Array<{ open: boolean }>;
        background: number;
        events: string[];
        poll(): Promise<void>;
    }

    function createHarness(api: Partial<QaapRepositoryImportApi>): DialogHarness {
        const queue: Array<() => void> = [];
        const running = { id: 'job-1', kind: 'clone', label: 'octocat/Hello-World', startedAt: 0, updatedAt: 0 } as const;
        const tracker = new QaapRepositoryImportTracker({
            start: async () => ({ ...running, state: 'running', phase: 'cloning', percent: 30 }),
            get: async () => ({ ...running, state: 'succeeded', phase: 'ready', percent: 100, result: RESULT }),
            cancel: async () => ({ ...running, state: 'cancelled', phase: 'cloning' }),
            legacy: async () => RESULT,
            ...api,
        }, {
            setTimeout: callback => { queue.push(callback); return queue.length; },
            clearTimeout: () => undefined,
            now: () => 0,
        });
        const harness: DialogHarness = {
            finished: [],
            background: 0,
            events: [],
            dialog: undefined as unknown as MobileOpenRepositoryDialog,
            poll: async () => {
                queue.splice(0).forEach(callback => callback());
                await flush();
            },
        };
        const service = {
            startGithubRepositoryImport: (request: QaapGithubWorkspaceJobRequest, label: string) => tracker.start(request, label),
            finishGithubRepositoryImport: async (_result: QaapGithubOpenRepositoryResponse, open: boolean) => {
                harness.finished.push({ open });
                return [] as MobileProjectEntry[];
            },
            watchGithubRepositoryImportInBackground: (repositoryImport: { presenter: string }) => {
                repositoryImport.presenter = 'background';
                harness.background++;
            },
            formatRepositoryLabel: (value: string) => value,
            listGithubRepositories: async () => [] as MobileProjectEntry[],
            getConnectedUser: () => undefined,
        } as unknown as MobileProjectsService;
        harness.dialog = new MobileOpenRepositoryDialog(service, {
            onProjectsChanged: () => harness.events.push('projectsChanged'),
            onWorkspaceOpened: () => harness.events.push('workspaceOpened'),
        });
        document.body.append(harness.dialog.node);
        return harness;
    }

    async function submitClone(dialog: MobileOpenRepositoryDialog, value: string): Promise<void> {
        const input = dialog.node.querySelector<HTMLInputElement>('.theia-mobile-open-repo-public-input');
        expect(input).to.not.equal(null);
        input!.value = value;
        await (dialog as unknown as { onSubmitPublic(): Promise<void> }).onSubmitPublic();
        await flush();
    }

    function progress(dialog: MobileOpenRepositoryDialog): HTMLElement {
        return dialog.node.querySelector<HTMLElement>('.theia-mobile-open-repo-progress')!;
    }

    it('shows phased progress, then opens the workspace and notifies the host', async () => {
        const harness = createHarness({});
        await harness.dialog.show();
        await submitClone(harness.dialog, 'https://github.com/octocat/Hello-World.git');

        expect(progress(harness.dialog).hidden).to.equal(false);
        expect(harness.dialog.node.querySelector('.theia-mobile-open-repo-progress-percent')?.textContent).to.equal('30%');
        expect(harness.dialog.node.querySelector<HTMLElement>('.theia-mobile-open-repo-panels')?.hidden).to.equal(true);

        await harness.poll();
        expect(harness.finished).to.deep.equal([{ open: true }]);
        expect(harness.events).to.deep.equal(['projectsChanged', 'workspaceOpened']);
        expect(harness.dialog.isVisible()).to.equal(false);
        expect(progress(harness.dialog).hidden).to.equal(true, 'the next open starts from the tabs again');
    });

    it('keeps the import running in the background when the dialog is closed', async () => {
        const harness = createHarness({});
        await harness.dialog.show();
        await submitClone(harness.dialog, 'octocat/Hello-World');

        harness.dialog.hide();
        expect(harness.background).to.equal(1);
        expect(harness.dialog.node.classList.contains('theia-mod-busy')).to.equal(false);

        await harness.poll();
        expect(harness.finished).to.deep.equal([], 'a closed dialog never switches the workspace');
        expect(harness.events).to.deep.equal([]);
    });

    it('shows the failure with a Retry that starts the import again', async () => {
        let starts = 0;
        const harness = createHarness({
            start: async () => {
                starts++;
                throw Object.assign(new Error('GitHub repository not found, or you do not have access to it.'), { status: 502 });
            },
        });
        await harness.dialog.show();
        await submitClone(harness.dialog, 'octocat/missing');

        const error = harness.dialog.node.querySelector<HTMLElement>('.theia-mobile-open-repo-progress-error')!;
        expect(error.hidden).to.equal(false);
        expect(error.textContent).to.contain('not found');
        const retry = [...harness.dialog.node.querySelectorAll<HTMLButtonElement>('.theia-mobile-open-repo-progress-action')]
            .find(button => !button.hidden && button.classList.contains('theia-mod-primary'))!;
        retry.click();
        await flush();
        expect(starts).to.equal(2);

        harness.dialog.hide();
        expect(harness.background).to.equal(0);
        await harness.dialog.show();
        expect(progress(harness.dialog).hidden).to.equal(true, 'a failed import is not shown again after closing');
    });

    it('rejects a repository subpath before making a clone request', async () => {
        let cloneCalls = 0;
        const service = {
            cloneGithubProjectByRepository: async (): Promise<MobileProjectEntry[]> => {
                cloneCalls += 1;
                return [];
            },
        } as unknown as MobileProjectsService;
        const dialog = new MobileOpenRepositoryDialog(service);
        const input = dialog.node.querySelector<HTMLInputElement>('.theia-mobile-open-repo-public-input');
        expect(input).to.not.equal(null);
        input!.value = 'https://github.com/octocat/Hello-World/issues';

        await (dialog as unknown as { onSubmitPublic(): Promise<void> }).onSubmitPublic();

        expect(cloneCalls).to.equal(0);
        const error = dialog.node.querySelector<HTMLElement>('.theia-mobile-open-repo-public-error');
        expect(error?.hidden).to.equal(false);
    });
});
