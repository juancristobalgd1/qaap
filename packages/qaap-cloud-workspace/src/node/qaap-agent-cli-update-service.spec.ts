// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    isInPlaceCliUpdateAllowed,
    QaapAgentCliUpdateService,
    QAAP_ALLOW_IN_PLACE_CLI_UPDATE,
} from './qaap-agent-cli-update-service';

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

    it('denies in-place updates in production unless the operator opts in', async () => {
        process.env.NODE_ENV = 'production';
        delete process.env.QAAP_CLOUD_MODE;
        delete process.env[QAAP_ALLOW_IN_PLACE_CLI_UPDATE];
        expect(isInPlaceCliUpdateAllowed()).to.equal(false);
        const service = new QaapAgentCliUpdateService();
        const result = await service.installUpdate('codex');
        expect(result.ok).to.equal(false);
        expect(result.message).to.match(/hosted\/production|Rebuild the Qaap image/i);
    });

    it('allows in-place updates in production when QAAP_ALLOW_IN_PLACE_CLI_UPDATE is set', () => {
        process.env.NODE_ENV = 'production';
        process.env[QAAP_ALLOW_IN_PLACE_CLI_UPDATE] = '1';
        expect(isInPlaceCliUpdateAllowed()).to.equal(true);
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
});
