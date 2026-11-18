// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { Emitter } from '@theia/core/lib/common/event';
import URI from '@theia/core/lib/common/uri';
import type { QaapPreviewSurfaceHandle } from '@theia/qaap-adapters/lib/browser/qaap-preview-surface-registry';
import type { QaapBootstrapStateChange } from '@theia/qaap-shared-core/lib/browser/qaap-project-bootstrap-service';
import { applyQaapPreviewTurnRefresh, isQaapPreviewTurnRefreshSameProject } from './qaap-preview-turn-refresh-apply';
import { classifyQaapPreviewTurnRefresh } from '@theia/qaap-shared-core/lib/common/qaap-preview-turn-refresh';

disableImportJSDOM();

describe('applyQaapPreviewTurnRefresh', () => {
    let disableDOM: () => void;

    before(() => {
        disableDOM = enableJSDOM();
    });

    after(() => {
        disableDOM();
    });

    const previewUrl = 'http://37f15d58.localhost:3000/';

    function surface(src: string): QaapPreviewSurfaceHandle & { navigations: string[] } {
        const navigations: string[] = [];
        return {
            frame: { src, contentWindow: undefined } as unknown as HTMLIFrameElement,
            kind: 'mini-browser',
            isConnected: () => true,
            navigate: (url: string) => { navigations.push(url); },
            navigations,
        } as unknown as QaapPreviewSurfaceHandle & { navigations: string[] };
    }

    function harness(options: { managed: boolean }): {
        restarts: number[];
        refresh(changed: string[], devCommand: string, surfaces: QaapPreviewSurfaceHandle[]): Promise<void>;
    } {
        const restarts: number[] = [];
        const state = new Emitter<QaapBootstrapStateChange>();
        const bootstrap = {
            previewUrl,
            previewId: 'u-dev-x-todo',
            onStateChange: state.event,
            restartManagedDevServer: async () => {
                restarts.push(Date.now());
                if (options.managed) {
                    setTimeout(() => state.fire({ phase: 'running', previewUrl } as QaapBootstrapStateChange), 5);
                }
                return options.managed;
            },
        };
        const refresh = (changed: string[], devCommand: string, surfaces: QaapPreviewSurfaceHandle[]): Promise<void> =>
            applyQaapPreviewTurnRefresh(classifyQaapPreviewTurnRefresh(changed, devCommand), surfaces, bootstrap);
        return { restarts, refresh };
    }

    it('restarts the managed server after a server.js change and reopens the page the user was on', async function (): Promise<void> {
        this.timeout(5000);
        const { restarts, refresh } = harness({ managed: true });
        const browser = surface(`${previewUrl}items?tab=2&_qaap_cache_bust=1#top`);
        await refresh(['server.js'], 'npm run start node server.js', [browser]);
        expect(restarts).to.have.length(1);
        expect(browser.navigations).to.have.length(1);
        const target = new URL(browser.navigations[0]!);
        expect(target.origin + target.pathname).to.equal(`${previewUrl}items`);
        expect(target.searchParams.get('tab')).to.equal('2');
        expect(target.hash).to.equal('#top');
        expect(target.searchParams.get('_qaap_cache_bust')).to.not.equal('1');
    });

    it('only reloads for page edits, and never restarts a server Qaap does not manage', async () => {
        const pageEdit = harness({ managed: true });
        const browser = surface(`${previewUrl}`);
        await pageEdit.refresh(['public/index.html'], 'node server.js', [browser]);
        expect(pageEdit.restarts).to.deep.equal([]);
        expect(browser.navigations).to.have.length(1);

        const external = harness({ managed: false });
        const other = surface(`${previewUrl}`);
        await external.refresh(['server.js'], 'node server.js', [other]);
        expect(external.restarts).to.have.length(1);
        expect(other.navigations).to.have.length(1);
    });

    it('leaves an HMR dev server alone', async () => {
        const { restarts, refresh } = harness({ managed: true });
        const browser = surface(`${previewUrl}`);
        await refresh(['src/main.ts'], 'npm run dev vite', [browser]);
        expect(restarts).to.deep.equal([]);
        expect(browser.navigations).to.deep.equal([]);
    });

    it('matches the conversation folder to the preview project in both directions', () => {
        const sameProject = (root: string, cwd: string): boolean => isQaapPreviewTurnRefreshSameProject(new URI(`file://${root}`), cwd);
        expect(sameProject('/ws/todo', '/ws/todo')).to.equal(true);
        expect(sameProject('/ws/mono/apps/web', '/ws/mono')).to.equal(true);
        expect(sameProject('/ws/todo', '/ws/notes')).to.equal(false);
        expect(sameProject('/ws/todo', '')).to.equal(false);
    });
});
