// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapAgentCliUpdateService } from './qaap-agent-cli-update-service';

describe('QaapAgentCliUpdateService', () => {
    const originalCheck = process.env.QAAP_AGENT_CLI_UPDATE_CHECK;

    afterEach(() => {
        if (originalCheck === undefined) {
            delete process.env.QAAP_AGENT_CLI_UPDATE_CHECK;
        } else {
            process.env.QAAP_AGENT_CLI_UPDATE_CHECK = originalCheck;
        }
    });

    it('disables the update check via QAAP_AGENT_CLI_UPDATE_CHECK', async () => {
        process.env.QAAP_AGENT_CLI_UPDATE_CHECK = '0';
        const service = new QaapAgentCliUpdateService();
        expect(service.isUpdateCheckEnabled()).to.equal(false);
        expect(await service.listOutdated()).to.deep.equal({ updates: [] });
    });

    it('rejects in-place update for QAIQ (Docker-layer only)', async () => {
        const service = new QaapAgentCliUpdateService();
        const result = await service.installUpdate('qaiq');
        expect(result.ok).to.equal(false);
        expect(result.id).to.equal('qaiq');
        expect(result.message).to.match(/not updated in-place|Rebuild/i);
    });

    it('rejects unknown agent ids without shelling out', async () => {
        const service = new QaapAgentCliUpdateService();
        const result = await service.installUpdate('not-a-real-agent');
        expect(result.ok).to.equal(false);
        expect(result.message).to.match(/Unknown agent CLI/i);
    });
});
