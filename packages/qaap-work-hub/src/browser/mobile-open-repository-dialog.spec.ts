// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Imports below touch the DOM at load time; each suite re-enables it after other specs' cleanup.
let disableJSDOM = enableJSDOM();

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { MobileOpenRepositoryDialog } from './mobile-open-repository-dialog';
import type { MobileProjectsService } from '@theia/qaap-shared-core/lib/browser/mobile-projects-service';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';

const STYLE_DIR = path.join(__dirname, '..', '..', 'src', 'browser', 'style');
const BROWSER_DIR = path.join(__dirname, '..', '..', 'src', 'browser');

describe('mobile-open-repository-dialog styles', () => {

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM();
    });
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

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM();
    });
    it('opens the returned workspace and notifies the host after cloning', async () => {
        const nextProjects: MobileProjectEntry[] = [];
        let clonedRepository: string | undefined;
        let projectsChanged = 0;
        let workspaceOpened = 0;
        const service = {
            cloneGithubProjectByRepository: async (repository: string): Promise<MobileProjectEntry[]> => {
                clonedRepository = repository;
                return nextProjects;
            },
            getConnectedUser: () => undefined,
        } as unknown as MobileProjectsService;
        const dialog = new MobileOpenRepositoryDialog(service, {
            onProjectsChanged: () => { projectsChanged += 1; },
            onWorkspaceOpened: () => { workspaceOpened += 1; },
        });
        const input = dialog.node.querySelector<HTMLInputElement>('.theia-mobile-open-repo-public-input');
        expect(input).to.not.equal(null);
        input!.value = 'https://github.com/octocat/Hello-World.git';

        await (dialog as unknown as { onSubmitPublic(): Promise<void> }).onSubmitPublic();

        expect(clonedRepository).to.equal('https://github.com/octocat/Hello-World.git');
        expect(projectsChanged).to.equal(1);
        expect(workspaceOpened).to.equal(1);
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
