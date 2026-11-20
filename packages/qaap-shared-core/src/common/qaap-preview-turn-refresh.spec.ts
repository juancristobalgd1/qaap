// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    classifyQaapPreviewTurnRefresh,
    isQaapPreviewIgnoredPath,
    isQaapPreviewServerSideFile,
    resolveQaapPreviewDevScript,
} from './qaap-preview-turn-refresh';

describe('qaap-preview-turn-refresh', () => {
    it('tells server code from browser assets', () => {
        for (const file of ['server.js', 'src/routes/api.ts', 'lib/db.mjs', 'package.json', '.env', '.env.local', 'app.py', 'config.yaml']) {
            expect(isQaapPreviewServerSideFile(file), file).to.equal(true);
        }
        for (const file of ['public/index.html', 'public/app.js', 'static/main.js', 'styles.css', 'index.html', 'logo.svg', 'README.md', 'node_modules/x/index.js']) {
            expect(isQaapPreviewServerSideFile(file), file).to.equal(false);
        }
        expect(isQaapPreviewIgnoredPath('node_modules/x/index.js')).to.equal(true);
        expect(isQaapPreviewIgnoredPath('.git/HEAD')).to.equal(true);
        expect(isQaapPreviewIgnoredPath('public/index.html')).to.equal(false);
    });

    it('restarts a plain node server when its code changed, and only reloads for page-only edits', () => {
        expect(classifyQaapPreviewTurnRefresh(['server.js'], 'npm run start node server.js')).to.equal('restart');
        expect(classifyQaapPreviewTurnRefresh(['package.json'], 'node server.js')).to.equal('restart');
        expect(classifyQaapPreviewTurnRefresh(['public/index.html'], 'node server.js')).to.equal('reload');
        expect(classifyQaapPreviewTurnRefresh([], 'node server.js')).to.equal('none');
        expect(classifyQaapPreviewTurnRefresh(['node_modules/x/index.js'], 'node server.js')).to.equal('none');
    });

    it('leaves dev servers with their own HMR or watcher alone', () => {
        expect(classifyQaapPreviewTurnRefresh(['src/main.ts', 'vite.config.ts'], 'npm run dev vite')).to.equal('none');
        expect(classifyQaapPreviewTurnRefresh(['app/page.tsx'], 'next dev')).to.equal('none');
        // A watcher restarts the server, but nothing reloads the page.
        expect(classifyQaapPreviewTurnRefresh(['server.js'], 'nodemon server.js')).to.equal('reload');
        expect(classifyQaapPreviewTurnRefresh(['server.js'], 'node --watch server.js')).to.equal('reload');
        expect(classifyQaapPreviewTurnRefresh(['index.html'], 'live-server')).to.equal('none');
    });

    it('reads the dev script before the start script', () => {
        expect(resolveQaapPreviewDevScript({ scripts: { dev: 'vite', start: 'node server.js' } })).to.equal('vite');
        expect(resolveQaapPreviewDevScript({ scripts: { start: 'node server.js' } })).to.equal('node server.js');
        expect(resolveQaapPreviewDevScript(undefined)).to.equal(undefined);
    });
});
