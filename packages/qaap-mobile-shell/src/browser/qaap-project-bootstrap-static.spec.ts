// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    buildStaticServeCommand,
    nestedStaticUrlFallbacks,
    shouldServeNestedStaticFromWorkspaceRoot,
} from './qaap-project-bootstrap-static';

describe('qaap-project-bootstrap-static', () => {

    describe('buildStaticServeCommand', () => {

        it('serves the workspace root when given "."', () => {
            const cmd = buildStaticServeCommand('.');
            expect(cmd).to.match(/^QAAP_STATIC_ROOT="\." QAAP_STATIC_ENTRY="\/" node -e '/);
            expect(cmd).to.include('http.createServer');
            expect(cmd.endsWith("'")).to.equal(true);
        });

        it('defaults to "." when the directory is empty', () => {
            expect(buildStaticServeCommand('')).to.equal(buildStaticServeCommand('.'));
        });

        it('embeds a subdirectory serve root', () => {
            expect(buildStaticServeCommand('public')).to.include('QAAP_STATIC_ROOT="public"');
        });

        it('serves nested demo folders from the workspace root with an entry path', () => {
            const cmd = buildStaticServeCommand('docs/demo');
            expect(cmd).to.include('QAAP_STATIC_ROOT="."');
            expect(cmd).to.include('QAAP_STATIC_ENTRY="/docs/demo/"');
            expect(cmd).to.include('docs/demo');
        });

        it('reads the port from the PORT env var so the bootstrap port wrapper can inject it', () => {
            expect(buildStaticServeCommand('.')).to.include('process.env.PORT');
        });

        it('binds to loopback so the same-origin dev preview proxy can reach it', () => {
            expect(buildStaticServeCommand('.')).to.include('"127.0.0.1"');
        });

        it('does not SPA-fallback missing JS/CSS to index.html', () => {
            const cmd = buildStaticServeCommand('.');
            expect(cmd).to.include('ext!==".html"');
            expect(cmd).to.include('Not found');
        });

        it('retries nested demo library paths at the workspace root', () => {
            const cmd = buildStaticServeCommand('docs/demo');
            expect(cmd).to.include('stripSeg');
            expect(cmd).to.include('alts.push');
            expect(nestedStaticUrlFallbacks('/docs/lib/marked.esm.js', '/docs/demo/')).to.deep.equal([
                '/docs/lib/marked.esm.js',
                '/lib/marked.esm.js',
            ]);
            expect(nestedStaticUrlFallbacks('/', '/docs/demo/')).to.deep.equal([
                '/',
                '/docs/demo/',
                '/docs/demo/index.html',
            ]);
            expect(shouldServeNestedStaticFromWorkspaceRoot('docs/demo')).to.equal(true);
            expect(shouldServeNestedStaticFromWorkspaceRoot('public')).to.equal(false);
        });

        it('prints a localhost URL the dev-output scanner can detect', () => {
            expect(buildStaticServeCommand('.')).to.include('http://127.0.0.1:');
        });

        it('embeds a script free of single quotes (so node -e \'...\' stays valid)', () => {
            const cmd = buildStaticServeCommand('.');
            const script = cmd.slice(cmd.indexOf("node -e '") + "node -e '".length, -1);
            expect(script.includes("'")).to.equal(false);
        });

        it('escapes double quotes in the directory name', () => {
            expect(buildStaticServeCommand('we"ird')).to.include('QAAP_STATIC_ROOT="we\\"ird"');
        });
    });
});
