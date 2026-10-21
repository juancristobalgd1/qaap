// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Request, Response } from '@theia/core/shared/express';
import { QAAP_DEPLOY_TOKEN_HEADER, QaapTenantRuntimeEndpoint, resolveQaapDeployTokenPath } from './qaap-tenant-runtime-endpoint';

class TestRuntimeEndpoint extends QaapTenantRuntimeEndpoint {
    readonly drains: boolean[] = [];

    constructor() {
        super();
        (this as unknown as { taskRunner: unknown }).taskRunner = {
            setDrainingForDeploy: (draining: boolean) => { this.drains.push(draining); },
            isDrainingForDeploy: () => this.drains[this.drains.length - 1] ?? false,
            countRunningTasks: () => 0,
        };
    }

    writeToken(tokenPath: string): string | undefined {
        this.deployToken = this.writeDeployToken(tokenPath);
        return this.deployToken;
    }

    drain(headers: Record<string, string>, remoteAddress = '127.0.0.1'): number {
        let status = 200;
        const res = {
            status: (code: number) => { status = code; return res; },
            end: () => res,
            json: () => res,
        };
        this.handleDrain({ socket: { remoteAddress }, headers, body: { draining: false } } as unknown as Request, res as unknown as Response);
        return status;
    }
}

describe('QaapTenantRuntimeEndpoint deploy drain', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-drain-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('refuses a loopback request without the deploy token', () => {
        const endpoint = new TestRuntimeEndpoint();
        endpoint.writeToken(path.join(tmpDir, 'qaap', 'deploy', 'drain.token'));
        expect(endpoint.drain({})).to.equal(404);
        expect(endpoint.drain({ [QAAP_DEPLOY_TOKEN_HEADER]: 'wrong' })).to.equal(404);
        expect(endpoint.drains).to.deep.equal([]);
    });

    it('accepts the token read from the file, but only over loopback without forwarding headers', () => {
        const endpoint = new TestRuntimeEndpoint();
        const tokenPath = path.join(tmpDir, 'qaap', 'deploy', 'drain.token');
        endpoint.writeToken(tokenPath);
        const token = fs.readFileSync(tokenPath, 'utf8').trim();
        expect(endpoint.drain({ [QAAP_DEPLOY_TOKEN_HEADER]: token }, '10.0.0.5')).to.equal(404);
        expect(endpoint.drain({ [QAAP_DEPLOY_TOKEN_HEADER]: token, 'x-forwarded-for': '1.2.3.4' })).to.equal(404);
        expect(endpoint.drain({ [QAAP_DEPLOY_TOKEN_HEADER]: token })).to.equal(200);
        expect(endpoint.drains).to.deep.equal([false]);
    });

    it('writes a fresh token readable only by the backend user', function (): void {
        if (process.platform === 'win32') {
            this.skip();
        }
        const tokenPath = path.join(tmpDir, 'qaap', 'deploy', 'drain.token');
        fs.mkdirSync(path.dirname(tokenPath), { recursive: true, mode: 0o755 });
        fs.writeFileSync(tokenPath, 'planted\n', { mode: 0o644 });
        const endpoint = new TestRuntimeEndpoint();
        const token = endpoint.writeToken(tokenPath);
        expect(token).to.match(/^[0-9a-f]{64}$/);
        expect(fs.readFileSync(tokenPath, 'utf8').trim()).to.equal(token);
        expect(fs.statSync(tokenPath).mode & 0o777).to.equal(0o600);
        expect(fs.statSync(path.dirname(tokenPath)).mode & 0o777).to.equal(0o700);
    });

    it('locks down only the token directory, never the shared ~/.qaap above it', function (): void {
        if (process.platform === 'win32') {
            this.skip();
        }
        const qaapDir = path.join(tmpDir, 'qaap');
        fs.mkdirSync(path.join(qaapDir, 'bin'), { recursive: true, mode: 0o755 });
        fs.chmodSync(qaapDir, 0o755);
        new TestRuntimeEndpoint().writeToken(path.join(qaapDir, 'deploy', 'drain.token'));
        expect(fs.statSync(qaapDir).mode & 0o777).to.equal(0o755);
        expect(fs.statSync(path.join(qaapDir, 'bin')).mode & 0o777).to.equal(0o755);
        expect(fs.statSync(path.join(qaapDir, 'deploy')).mode & 0o777).to.equal(0o700);
    });

    it('resolves the token path from QAAP_DEPLOY_TOKEN_FILE or the backend home', () => {
        expect(resolveQaapDeployTokenPath({ QAAP_DEPLOY_TOKEN_FILE: '/run/qaap/token' })).to.equal('/run/qaap/token');
        expect(resolveQaapDeployTokenPath({})).to.equal(path.join(os.homedir(), '.qaap', 'deploy', 'drain.token'));
    });
});
