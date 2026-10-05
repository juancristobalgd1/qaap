// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Runs the image `CMD` through a real POSIX `sh` with a stub `node` on `PATH`, so the spec checks the
 * command line the main backend actually starts with. Tenant backends: `tenant backend command` in
 * qaap-docker-orchestrator.spec.ts.
 */
describe('main backend entry (Dockerfile CMD)', () => {
    const repositoryRoot = path.resolve(__dirname, '../../../..');
    const dockerfile = fs.readFileSync(path.join(repositoryRoot, 'Dockerfile'), 'utf8').replace(/\r\n/g, '\n');
    const compose = fs.readFileSync(path.join(repositoryRoot, 'docker-compose.yml'), 'utf8').replace(/\r\n/g, '\n');
    const backendArgs = [
        '--hostname=0.0.0.0', '--port=4873', '--no-cluster',
        '--plugins=local-dir:/app/plugins', '--ovsx-router-config=/app/examples/ovsx-router-config.json',
    ];
    let stubBin: string;

    function imageCommand(): string[] {
        const match = /^CMD (\[[\s\S]*?\])$/m.exec(dockerfile.replace(/\\\n/g, ''));
        if (!match) {
            throw new Error('Dockerfile CMD not found');
        }
        return JSON.parse(match[1]) as string[];
    }

    function runImageCommand(entry: string | undefined): { status: number | null; argv: string[]; stderr: string } {
        const [shell, flag, script] = imageCommand();
        const env: NodeJS.ProcessEnv = {
            PATH: `${stubBin}${path.delimiter}${process.env.PATH ?? ''}`,
            HOST: '0.0.0.0',
            PORT: '4873',
            THEIA_PLUGINS_DIR: '/app/plugins',
        };
        if (entry !== undefined) {
            env.QAAP_BACKEND_ENTRY = entry;
        }
        const result = spawnSync(shell, [flag, script], { env, encoding: 'utf8' });
        const argv = result.stdout ? result.stdout.split('\n').filter(line => line.length > 0) : [];
        return { status: result.status, argv, stderr: result.stderr };
    }

    before(function (): void {
        if (process.platform === 'win32') {
            this.skip();
        }
        stubBin = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-backend-entry-'));
        fs.writeFileSync(path.join(stubBin, 'node'), '#!/bin/sh\nfor arg in "$@"; do printf \'%s\\n\' "$arg"; done\n', { mode: 0o755 });
    });

    after(() => {
        if (stubBin) {
            fs.rmSync(stubBin, { recursive: true, force: true });
        }
    });

    it('starts the generated src-gen entry when QAAP_BACKEND_ENTRY is unset or empty', () => {
        for (const entry of [undefined, '']) {
            const result = runImageCommand(entry);
            expect(result.status, String(entry)).to.equal(0);
            expect(result.argv, String(entry)).to.deep.equal(['src-gen/backend/main.js', ...backendArgs]);
        }
    });

    it('starts the esbuild backend bundle when QAAP_BACKEND_ENTRY selects it', () => {
        const result = runImageCommand('lib/backend/main.js');
        expect(result.status).to.equal(0);
        expect(result.argv).to.deep.equal(['lib/backend/main.js', ...backendArgs]);
    });

    it('refuses to start any other entry', () => {
        for (const entry of [' lib/backend/main.js', 'lib/backend/plugin-host.js', '/tmp/evil.js', 'lib/backend/main.js --inspect=0.0.0.0']) {
            const result = runImageCommand(entry);
            expect(result.status, entry).to.equal(64);
            expect(result.argv, entry).to.deep.equal([]);
            expect(result.stderr, entry).to.include('Unsupported QAAP_BACKEND_ENTRY');
        }
    });

    it('passes the compose setting to the main backend, which hands it to tenant backends', () => {
        expect(compose).to.include('      QAAP_BACKEND_ENTRY: ${QAAP_BACKEND_ENTRY:-}\n');
    });
});
