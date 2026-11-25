// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import URI from '@theia/core/lib/common/uri';
import type { QaapProjectBootstrapService } from './qaap-project-bootstrap-service';

describe('ensureTranscriptDevPreview automatic-restart bound', () => {
    let disableJSDOM: (() => void) | undefined;
    let ensureTranscriptDevPreview: typeof import('./qaap-transcript-preview-bootstrap').ensureTranscriptDevPreview;
    let serviceModule: typeof import('./qaap-project-bootstrap-service');

    before(() => {
        disableJSDOM = enableJSDOM();
        // The mini-browser preview frame pulls the whole mini-browser DI graph into a unit test;
        // this bound never reaches it, so load the module against a stub.
        const frameModule = require.resolve('@theia/qaap-adapters/lib/browser/qaap-mini-browser-preview-frame');
        require.cache[frameModule] = {
            id: frameModule,
            filename: frameModule,
            loaded: true,
            exports: { syncQaapMiniBrowserPreviewSuspension: () => undefined },
        } as NodeJS.Module;
        ({ ensureTranscriptDevPreview } = require('./qaap-transcript-preview-bootstrap'));
        serviceModule = require('./qaap-project-bootstrap-service');
    });

    after(() => disableJSDOM?.());

    const ROOT = URI.fromFilePath('/workspace/app');

    /** A bootstrap whose root already failed `streak` times in a row and sits in `run-failed`. */
    function failedBootstrap(streak: number): { bootstrap: QaapProjectBootstrapService; runs: () => number } {
        const service = new serviceModule.QaapProjectBootstrapService();
        let runs = 0;
        Object.assign(service, {
            _phase: 'run-failed',
            _descriptor: { name: 'app', rootUri: ROOT, nodeModulesPresent: true, apps: [] },
            devRunFailureStreak: streak,
            devRunFailureStreakRoot: ROOT.toString(),
            getStateSnapshot: () => ({ phase: 'run-failed', descriptor: { rootUri: ROOT, nodeModulesPresent: true, apps: [] } }),
            runDevServer: async () => { runs++; },
            runInstall: async () => { runs++; },
        });
        return { bootstrap: service, runs: () => runs };
    }

    it('reports the root exhausted only after the limit of consecutive failures of that root', () => {
        const { bootstrap } = failedBootstrap(serviceModule.DEV_RUN_AUTOMATIC_RESTART_LIMIT - 1);
        expect(bootstrap.isDevRunAutomaticRestartExhausted()).to.equal(false);
        Object.assign(bootstrap, { devRunFailureStreak: serviceModule.DEV_RUN_AUTOMATIC_RESTART_LIMIT });
        expect(bootstrap.isDevRunAutomaticRestartExhausted()).to.equal(true);
        Object.assign(bootstrap, { devRunFailureStreakRoot: URI.fromFilePath('/workspace/other').toString() });
        expect(bootstrap.isDevRunAutomaticRestartExhausted()).to.equal(false);
    });

    it('does not restart a repeatedly failing root from an automatic launcher', async () => {
        const { bootstrap, runs } = failedBootstrap(serviceModule.DEV_RUN_AUTOMATIC_RESTART_LIMIT);
        expect(await ensureTranscriptDevPreview(bootstrap, { skipConversationPortProbe: true })).to.equal(undefined);
        expect(runs()).to.equal(0);
        expect(bootstrap.isDevRunAutomaticRestartExhausted()).to.equal(true);
    });

    it('still restarts it on an explicit user start, which clears the streak', async () => {
        const { bootstrap, runs } = failedBootstrap(serviceModule.DEV_RUN_AUTOMATIC_RESTART_LIMIT);
        expect(await ensureTranscriptDevPreview(bootstrap, { skipConversationPortProbe: true, userInitiated: true })).to.equal(undefined);
        expect(runs()).to.equal(1);
        expect(bootstrap.isDevRunAutomaticRestartExhausted()).to.equal(false);
    });

    it('keeps restarting automatically below the limit', async () => {
        const { bootstrap, runs } = failedBootstrap(1);
        await ensureTranscriptDevPreview(bootstrap, { skipConversationPortProbe: true });
        expect(runs()).to.equal(1);
    });
});
