// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    buildStaticServeCommand,
    nestedStaticUrlFallbacks,
    shouldServeNestedStaticFromWorkspaceRoot,
    staticEntryPathFromDevCommand,
} from './qaap-project-bootstrap-static';

function decodeStaticBootstrap(command: string): string {
    const matches = [...command.matchAll(/Buffer\.from\('([^']+)'\s*,\s*'base64'\)/g)];
    const encodedScript = matches[matches.length - 1]?.[1];
    expect(encodedScript).to.be.a('string');
    return Buffer.from(encodedScript!, 'base64').toString('utf8');
}

describe('qaap-project-bootstrap-static', () => {

    describe('buildStaticServeCommand', () => {

        it('serves the workspace root when given "."', () => {
            const cmd = buildStaticServeCommand('.');
            expect(cmd).to.match(/^node -e "/);
            expect(cmd).to.include('process.env.QAAP_STATIC_ROOT=Buffer.from(');
            expect(cmd).to.include('process.env.QAAP_STATIC_ENTRY=Buffer.from(');
            expect(decodeStaticBootstrap(cmd)).to.include('http.createServer');
            expect(cmd.endsWith('"')).to.equal(true);
        });

        it('defaults to "." when the directory is empty', () => {
            expect(buildStaticServeCommand('')).to.equal(buildStaticServeCommand('.'));
        });

        it('embeds a subdirectory serve root', () => {
            expect(buildStaticServeCommand('public')).to.match(/^node -e "/);
        });

        it('serves nested demo folders from the workspace root with an entry path', () => {
            const cmd = buildStaticServeCommand('docs/demo');
            expect(staticEntryPathFromDevCommand(cmd)).to.equal('/docs/demo/');
        });

        it('reads the port from the PORT env var so the bootstrap port wrapper can inject it', () => {
            expect(decodeStaticBootstrap(buildStaticServeCommand('.'))).to.include('process.env.PORT');
        });

        it('binds to loopback so the same-origin dev preview proxy can reach it', () => {
            expect(decodeStaticBootstrap(buildStaticServeCommand('.'))).to.include('"127.0.0.1"');
        });

        it('does not SPA-fallback missing JS/CSS to index.html', () => {
            const script = decodeStaticBootstrap(buildStaticServeCommand('.'));
            expect(script).to.include('ext!==".html"');
            expect(script).to.include('Not found');
        });

        it('retries nested demo library paths at the workspace root', () => {
            const cmd = buildStaticServeCommand('docs/demo');
            const script = decodeStaticBootstrap(cmd);
            expect(script).to.include('stripSeg');
            expect(script).to.include('writeHead(302');
            expect(script).to.include('alts.push');
            expect(staticEntryPathFromDevCommand(cmd)).to.equal('/docs/demo/');
            expect(staticEntryPathFromDevCommand(buildStaticServeCommand('.'))).to.equal(undefined);
            expect(staticEntryPathFromDevCommand('npm run dev')).to.equal(undefined);
            expect(staticEntryPathFromDevCommand(buildStaticServeCommand('.', 'game.html'))).to.equal('/game.html');
            expect(decodeStaticBootstrap(buildStaticServeCommand('.', 'game.html'))).to.include('entryIsFile');
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
            expect(decodeStaticBootstrap(buildStaticServeCommand('.'))).to.include('http://127.0.0.1:');
        });

        it('uses a shell-neutral encoded bootstrap for node -e', () => {
            const cmd = buildStaticServeCommand('.');
            expect(cmd).not.to.include("node -e '");
            expect(cmd).to.include('eval(Buffer.from(');
        });
    });
});
