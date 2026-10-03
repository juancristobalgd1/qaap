// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    isInPlaceCliUpdateAllowed,
    QaapAgentCliUpdateService,
    QAAP_ALLOW_IN_PLACE_CLI_UPDATE,
    TRACKED_AGENT_CLIS,
} from './qaap-agent-cli-update-service';

class NpmUpdateResultProbe extends QaapAgentCliUpdateService {
    result: {
        readonly status: number | null;
        readonly signal: NodeJS.Signals | null;
        readonly stdout: string;
        readonly stderr: string;
        readonly error?: Error;
    } = { status: null, signal: 'SIGTERM', stdout: '', stderr: '' };

    override isUpdateCheckEnabled(): boolean {
        return true;
    }

    override isInPlaceCliUpdateAllowed(): boolean {
        return true;
    }

    protected override runNpmInstall(): NpmUpdateResultProbe['result'] {
        return this.result;
    }
}

describe('QaapAgentCliUpdateService', () => {
    const originalCheck = process.env.QAAP_AGENT_CLI_UPDATE_CHECK;
    const originalNodeEnv = process.env.NODE_ENV;
    const originalCloudMode = process.env.QAAP_CLOUD_MODE;
    const originalAllow = process.env[QAAP_ALLOW_IN_PLACE_CLI_UPDATE];

    afterEach(() => {
        if (originalCheck === undefined) {
            delete process.env.QAAP_AGENT_CLI_UPDATE_CHECK;
        } else {
            process.env.QAAP_AGENT_CLI_UPDATE_CHECK = originalCheck;
        }
        if (originalNodeEnv === undefined) {
            delete process.env.NODE_ENV;
        } else {
            process.env.NODE_ENV = originalNodeEnv;
        }
        if (originalCloudMode === undefined) {
            delete process.env.QAAP_CLOUD_MODE;
        } else {
            process.env.QAAP_CLOUD_MODE = originalCloudMode;
        }
        if (originalAllow === undefined) {
            delete process.env[QAAP_ALLOW_IN_PLACE_CLI_UPDATE];
        } else {
            process.env[QAAP_ALLOW_IN_PLACE_CLI_UPDATE] = originalAllow;
        }
    });

    it('disables the update check via QAAP_AGENT_CLI_UPDATE_CHECK', async () => {
        process.env.QAAP_AGENT_CLI_UPDATE_CHECK = '0';
        const service = new QaapAgentCliUpdateService();
        expect(service.isUpdateCheckEnabled()).to.equal(false);
        expect(await service.listOutdated()).to.deep.equal({ updates: [] });
    });

    it('rejects in-place update for QAIQ (Docker-layer only)', async () => {
        delete process.env.NODE_ENV;
        delete process.env.QAAP_CLOUD_MODE;
        const service = new QaapAgentCliUpdateService();
        const result = await service.installUpdate('qaiq');
        expect(result.ok).to.equal(false);
        expect(result.id).to.equal('qaiq');
        expect(result.message).to.match(/not updated in-place|Rebuild/i);
    });

    it('rejects unknown agent ids without shelling out', async () => {
        delete process.env.NODE_ENV;
        delete process.env.QAAP_CLOUD_MODE;
        const service = new QaapAgentCliUpdateService();
        const result = await service.installUpdate('not-a-real-agent');
        expect(result.ok).to.equal(false);
        expect(result.message).to.match(/Unknown agent CLI/i);
    });

    it('denies in-place updates in production without an escape hatch', async () => {
        process.env.NODE_ENV = 'production';
        delete process.env.QAAP_CLOUD_MODE;
        process.env.QAAP_AGENT_CLI_UPDATE_CHECK = '1';
        delete process.env[QAAP_ALLOW_IN_PLACE_CLI_UPDATE];
        expect(isInPlaceCliUpdateAllowed()).to.equal(false);
        const service = new QaapAgentCliUpdateService();
        const result = await service.installUpdate('codex');
        expect(result.ok).to.equal(false);
        expect(result.message).to.match(/not available on this server.*contact your administrator/i);
        expect(result.message).not.to.match(/in-place|rebuild/i);
    });

    it('still denies in-place updates in production when the legacy override is set', () => {
        process.env.NODE_ENV = 'production';
        process.env[QAAP_ALLOW_IN_PLACE_CLI_UPDATE] = '1';
        expect(isInPlaceCliUpdateAllowed()).to.equal(false);
    });

    it('rejects install when update checks are disabled', async () => {
        delete process.env.NODE_ENV;
        delete process.env.QAAP_CLOUD_MODE;
        process.env.QAAP_AGENT_CLI_UPDATE_CHECK = '0';
        const service = new QaapAgentCliUpdateService();
        const result = await service.installUpdate('codex');
        expect(result.ok).to.equal(false);
        expect(result.message).to.match(/UPDATE_CHECK/i);
    });

    it('treats a signaled npm install as failure and preserves an actionable reason', async () => {
        const service = new NpmUpdateResultProbe();
        const result = await service.installUpdate('codex');
        expect(result.ok).to.equal(false);
        expect(result.message).to.match(/SIGTERM/);

        service.result = { status: 1, signal: null, stdout: '', stderr: 'EACCES: permission denied' };
        const permissionFailure = await service.installUpdate('codex');
        expect(permissionFailure.ok).to.equal(false);
        expect(permissionFailure.message).to.contain('EACCES: permission denied');
    });
});

describe('Dockerfile tracked agent CLI coverage', () => {
    it('pins every npm-backed tracked harness into the runtime image and smoke checks Copilot', () => {
        const repositoryRoot = resolve(__dirname, '../../../..');
        const dockerfile = readFileSync(resolve(repositoryRoot, 'Dockerfile'), 'utf8');
        const runtimeSmoke = readFileSync(resolve(repositoryRoot, 'scripts/qaap-image-runtime-check.js'), 'utf8');
        const npmInstall = dockerfile.match(/&& npm install -g \\\r?\n([\s\S]*?)\\\r?\n\s*&& npm install -g bun/)?.[1];

        if (!npmInstall) {
            throw new Error('Dockerfile global agent npm install block was not found.');
        }
        for (const tracked of TRACKED_AGENT_CLIS.filter(cli => !!cli.npmPackage)) {
            expect(tracked.expectedVersionEnv).to.be.a('string');
            expect(npmInstall).to.include(`${tracked.npmPackage}@"\${${tracked.expectedVersionEnv}}"`);
            const versionArg = dockerfile.match(
                new RegExp(`^ARG ${tracked.expectedVersionEnv}=([0-9]+\\.[0-9]+\\.[0-9]+(?:-[A-Za-z0-9.-]+)?)$`, 'm'),
            );
            expect(versionArg, `${tracked.id} must have an exact Dockerfile version pin`).not.to.equal(null);
        }
        expect(TRACKED_AGENT_CLIS.find(cli => cli.id === 'copilot')?.bins).to.include('copilot');
        expect(dockerfile).to.include('&& copilot --version');
        expect(runtimeSmoke).to.include("'copilot'");
        expect(runtimeSmoke).to.include("spawnSync('copilot', ['--version']");
    });
});
