// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import {
    QAAP_AGENT_PREVIEW_API_PATH,
    QAAP_AGENT_PREVIEW_ROUTES,
    QAAP_PREVIEW_CLI_DEFAULT_TIMEOUT_SEC,
    QAAP_PREVIEW_CLI_EXIT_FAILED,
    QAAP_PREVIEW_CLI_EXIT_READY,
    QAAP_PREVIEW_CLI_EXIT_STARTING,
    QAAP_PREVIEW_TOKEN_FILE_ENV,
    QAAP_PREVIEW_URL_ENV,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-preview-protocol';
import { QAAP_AGENT_DELEGATION_TOKEN_HEADER } from '../common/qaap-agent-delegation-protocol';
import { applyQaapPreviewCli, releaseQaapDelegationMcpConfigFile, resolveQaapPreviewCliPath } from './qaap-agent-delegation-launch';

interface QaaqPreviewModule {
    readonly PREVIEW_API_PATH: string;
    readonly PREVIEW_TOKEN_HEADER: string;
    readonly PREVIEW_URL_ENV: string;
    readonly PREVIEW_TOKEN_FILE_ENV: string;
    readonly PREVIEW_DEFAULT_TIMEOUT_SEC: number;
    readonly PREVIEW_EXIT_READY: number;
    readonly PREVIEW_EXIT_FAILED: number;
    readonly PREVIEW_EXIT_STARTING: number;
    readonly PREVIEW_ROUTES: Record<string, string>;
    parsePreviewCliArgs(argv: string[]): {
        readonly help: boolean;
        readonly operation?: string;
        readonly body?: Record<string, unknown>;
        readonly includeImage?: boolean;
    };
    runPreviewCli(
        argv: string[],
        options?: {
            readonly env?: NodeJS.ProcessEnv;
            readonly fetch?: typeof fetch;
        },
    ): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }>;
}

describe('qaaq-preview CLI fallback', () => {
    let mod: QaaqPreviewModule;
    let tmpDir: string;
    let tokenFile: string;

    before(async () => {
        const dynamicImport = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<QaaqPreviewModule>;
        mod = await dynamicImport(pathToFileURL(resolveQaapPreviewCliPath()).href);
    });

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-preview-cli-spec-'));
        tokenFile = path.join(tmpDir, 'token');
        fs.writeFileSync(tokenFile, 'tok-preview-secret\n', { mode: 0o600 });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('keeps its protocol constants pinned to qaap-agent-preview-protocol', () => {
        expect(mod.PREVIEW_API_PATH).to.equal(QAAP_AGENT_PREVIEW_API_PATH);
        expect(mod.PREVIEW_TOKEN_HEADER).to.equal(QAAP_AGENT_DELEGATION_TOKEN_HEADER);
        expect(mod.PREVIEW_URL_ENV).to.equal(QAAP_PREVIEW_URL_ENV);
        expect(mod.PREVIEW_TOKEN_FILE_ENV).to.equal(QAAP_PREVIEW_TOKEN_FILE_ENV);
        expect(mod.PREVIEW_DEFAULT_TIMEOUT_SEC).to.equal(QAAP_PREVIEW_CLI_DEFAULT_TIMEOUT_SEC);
        expect(mod.PREVIEW_EXIT_READY).to.equal(QAAP_PREVIEW_CLI_EXIT_READY);
        expect(mod.PREVIEW_EXIT_FAILED).to.equal(QAAP_PREVIEW_CLI_EXIT_FAILED);
        expect(mod.PREVIEW_EXIT_STARTING).to.equal(QAAP_PREVIEW_CLI_EXIT_STARTING);
        expect(mod.PREVIEW_ROUTES).to.deep.equal(QAAP_AGENT_PREVIEW_ROUTES);
    });

    it('parses start, wait, logs, snapshot and passthrough argv', () => {
        expect(mod.parsePreviewCliArgs(['start', '--script', 'dev', '--port', '4100', '--restart'])).to.deep.include({
            help: false,
            operation: 'start',
            body: { script: 'dev', port: 4100, restart: true, timeoutSec: QAAP_PREVIEW_CLI_DEFAULT_TIMEOUT_SEC },
        });
        expect(mod.parsePreviewCliArgs(['start', '--', 'node', 'server.js', '--port', '{{PORT}}'])).to.deep.include({
            operation: 'start',
            body: { argv: ['node', 'server.js', '--port', '{{PORT}}'], timeoutSec: QAAP_PREVIEW_CLI_DEFAULT_TIMEOUT_SEC },
        });
        expect(mod.parsePreviewCliArgs(['wait'])).to.deep.include({
            operation: 'status',
            body: { waitSec: QAAP_PREVIEW_CLI_DEFAULT_TIMEOUT_SEC },
        });
        expect(mod.parsePreviewCliArgs(['logs', '--lines', '50', '--stream', 'stderr', '--grep', 'ERR'])).to.deep.include({
            operation: 'logs',
            body: { lines: 50, stream: 'stderr', grep: 'ERR' },
        });
        expect(mod.parsePreviewCliArgs(['snapshot', '--path', '/about', '--viewport', 'mobile'])).to.deep.include({
            operation: 'snapshot',
            body: { path: '/about', viewport: 'mobile' },
            includeImage: false,
        });
    });

    it('sends the token from QAAP_PREVIEW_TOKEN_FILE and maps ready/starting/failed to exit codes 0/3/2', async () => {
        const calls: Array<{ url: string; header: string; body: unknown }> = [];
        const makeFetch = (status: number, payload: unknown): typeof fetch => (async (input: RequestInfo | URL, init?: RequestInit) => {
            const headers = init?.headers as Record<string, string>;
            calls.push({ url: String(input), header: headers[QAAP_AGENT_DELEGATION_TOKEN_HEADER], body: JSON.parse(String(init?.body ?? '{}')) });
            return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(payload) } as Response;
        }) as typeof fetch;
        const env: NodeJS.ProcessEnv = {
            [QAAP_PREVIEW_URL_ENV]: 'http://127.0.0.1:4873',
            [QAAP_PREVIEW_TOKEN_FILE_ENV]: tokenFile,
        };

        const ready = await mod.runPreviewCli(['start'], { env, fetch: makeFetch(200, { status: 'ready', httpStatus: 200, url: '/qaap-preview/p1/' }) });
        expect(ready.exitCode).to.equal(0);
        expect(JSON.parse(ready.stdout).status).to.equal('ready');
        expect(calls[0]).to.deep.equal({
            url: 'http://127.0.0.1:4873/qaap/api/agent-preview/start',
            header: 'tok-preview-secret',
            body: { timeoutSec: 25 },
        });

        const starting = await mod.runPreviewCli(['start'], { env, fetch: makeFetch(200, { status: 'starting' }) });
        expect(starting.exitCode).to.equal(3);
        expect(JSON.parse(starting.stdout).nextCommand).to.equal('qaaq-preview wait');

        const failed = await mod.runPreviewCli(['start'], { env, fetch: makeFetch(200, { status: 'failed', failure: { kind: 'configuration', message: 'Missing API_KEY' } }) });
        expect(failed.exitCode).to.equal(2);
    });

    it('stages an executable wrapper on PATH with a 0600 token file and cleans it up on task release', () => {
        const taskId = `cli-stage-${Date.now()}`;
        const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
        const staged = applyQaapPreviewCli(env, taskId, { url: 'http://127.0.0.1:4873', token: 'tok-abc' }, undefined);
        expect(staged).to.not.equal(undefined);
        expect(env[QAAP_PREVIEW_URL_ENV]).to.equal('http://127.0.0.1:4873');
        expect(env[QAAP_PREVIEW_TOKEN_FILE_ENV]).to.equal(staged!.tokenFile);
        expect(env.PATH?.startsWith(staged!.binDir)).to.equal(true);
        expect(fs.readFileSync(staged!.tokenFile, 'utf8')).to.equal('tok-abc');
        expect(fs.existsSync(path.join(staged!.binDir, process.platform === 'win32' ? 'qaaq-preview.cmd' : 'qaaq-preview'))).to.equal(true);

        releaseQaapDelegationMcpConfigFile(taskId);
        expect(fs.existsSync(staged!.binDir)).to.equal(false);
        expect(fs.existsSync(staged!.tokenFile)).to.equal(false);
    });
});
